/**
 * Prompt builder for AIReviewerService.
 *
 * Returns the system + user message pair fed to Claude. The system
 * prompt is assembled in `buildSystemParts` from DB-managed pieces
 * (universal Base + rule packs + per-form guidance + learned
 * corrections). The user prompt is a small interpolation skeleton
 * (`USER_TEMPLATE` below) populated by `buildUserVars`.
 *
 * `buildAiReviewerPrompt` is the SINGLE-SOURCE entry point — the
 * two-pass / chunked-synthesis path uses `buildTracePrompt`,
 * `buildSynthesisPrompt`, `buildReasoningPrompt`, and
 * `buildAnswerChunkPrompt` from `aiReviewerTwoPassPrompts.ts`. The
 * single-source path is what ticket-only / call-only / task-only
 * reviews use (one Claude call).
 */

import type { CRMNote } from './CRMService';
import type { CalibrationCorrection } from './AICalibrationService';
import { rulePackService } from './RulePackService';
import { basePromptService } from './BasePromptService';
import prisma from '../config/prisma';
import logger from '../config/logger';
import {
  renderTranscriptBlock as renderTranscriptBlockShared,
  formatTranscriptContent as formatTranscriptContentShared,
} from './transcriptRender';

/**
 * User-message skeleton. Pure `{{key}}` interpolation against the
 * variable bag produced by `buildUserVars`. The bag computes every
 * non-trivial value (formatted notes, transcript turns, KB blocks),
 * so this template's only job is layout — what order the sections
 * appear in.
 *
 * Lives next to its only consumer so changing the input shape and
 * the layout is a single edit, not a code-vs-markdown round trip.
 */
const USER_TEMPLATE = [
  'INTERACTION TYPE: {{adapterKind}}',
  '',
  'INTERACTION HEADER:',
  '{{headerLines}}',
  '',
  '{{notesHeader}}',
  '{{noteLines}}',
  '',
  '{{kbHeader}}',
  '{{kbBlock}}',
  '',
  'AUDIT FORM TO FILL OUT:',
  '{{formSummary}}',
  '',
  'Now produce the JSON object as specified.',
].join('\n');

function interpolateUserTemplate(vars: Record<string, string>): string {
  return USER_TEMPLATE.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!(key in vars)) {
      throw new Error(`USER_TEMPLATE references {{${key}}} but no value was supplied.`);
    }
    return vars[key];
  });
}

export interface FormForPrompt {
  id: number;
  form_name: string;
  interaction_type: string;
  /** Free-text rules from the Form Builder, injected as ADDITIONAL FORM-SPECIFIC GRADING RULES. */
  ai_review_guidance?: string | null;
  /** Per-form override of the active base prompt. NULL/undefined falls back to the global default. */
  ai_base_prompt_id?: number | null;
  categories: { id: number; category_name: string }[];
  questions: {
    id: number;
    category_name: string;
    question_text: string;
    question_type: string;
    yes_value: number;
    no_value: number;
    na_value: number;
    is_na_allowed: boolean;
    radio_options: { value: string; text: string; score: number }[];
    /**
     * Question role - DETAIL (graded by AI / human) vs ROLLUP (auto-derived
     * by the rollup engine from member questions). Optional with a DETAIL
     * fallback so older fixtures and callers that pre-date the rollup
     * feature keep typechecking. The prompt renderers and answer mapper
     * skip ROLLUP rows; only the rollup engine ever writes their answer.
     */
    role?: 'DETAIL' | 'ROLLUP';
  }[];
}

export interface PromptInput {
  form: FormForPrompt;
  adapterKind: 'TICKET' | 'TASK' | 'CALL';
  header: Record<string, string>;
  notes: CRMNote[];
  kbHits: {
    id: number;
    name: string;
    url: string;
    content: string;
    is_playbook?: boolean;
    /**
     * KB link expansion: when this page was pulled in by following an
     * in-body hyperlink from another KB page, we tag it with the
     * source page name + hop distance. The prompt renders these as
     * `LINKED KB PAGE` so the model treats them as parent / sibling
     * decision-flow context rather than primary search hits.
     */
    linked_from?: { name: string; url: string; hop: number };
  }[];
  /**
   * Recent human corrections injected as few-shot lessons in the system
   * prompt. Empty / undefined → section is omitted entirely (preserves
   * byte-equivalence with the legacy inline prompt).
   */
  corrections?: CalibrationCorrection[];
}

export function buildAiReviewerPrompt(input: PromptInput): { system: string; user: string } {
  const { systemBase, packsSection, guidanceSection } = buildSystemParts(input.form);
  const correctionsSection = buildCorrectionsSection(input.corrections);
  const userVars = buildUserVars(input);
  const user = interpolateUserTemplate(userVars);
  return { system: systemBase + packsSection + guidanceSection + correctionsSection, user };
}

/**
 * Sectioned breakdown of the system prompt the model will see for a given
 * form + corrections set. Used by the "Preview prompt" diagnostic endpoint
 * so operators can SEE prompt size and provenance without having to grep
 * server logs after a real run. Each section is the literal string that
 * gets concatenated; `chars` is the byte count of that section.
 */
export interface PromptPreview {
  systemBase: { text: string; chars: number };
  packs: { text: string; chars: number };
  guidance: { text: string; chars: number };
  corrections: { text: string; chars: number };
  /** Concatenated system prompt — same string `buildAiReviewerPrompt` returns. */
  systemFull: string;
  /** Total system-prompt chars. */
  totalChars: number;
  /**
   * Rough token estimate at ~4 chars per token. This is a heuristic for
   * orientation only — exact token counts come from `ai_call_logs` after
   * an actual run.
   */
  approxTokens: number;
}

/**
 * Build the same system prompt `buildAiReviewerPrompt` would, but as a
 * sectioned breakdown for the diagnostic UI. Does NOT touch the user
 * prompt (which is dominated by ticket-specific data and isn't useful
 * for the "is my prompt growing out of control?" question).
 */
export function previewSystemPrompt(args: { form: FormForPrompt; corrections?: CalibrationCorrection[] }): PromptPreview {
  const { systemBase, packsSection, guidanceSection } = buildSystemParts(args.form);
  const correctionsSection = buildCorrectionsSection(args.corrections);
  const systemFull = systemBase + packsSection + guidanceSection + correctionsSection;
  const totalChars = systemFull.length;
  return {
    systemBase: { text: systemBase, chars: systemBase.length },
    packs: { text: packsSection, chars: packsSection.length },
    guidance: { text: guidanceSection, chars: guidanceSection.length },
    corrections: { text: correctionsSection, chars: correctionsSection.length },
    systemFull,
    totalChars,
    approxTokens: Math.ceil(totalChars / 4),
  };
}

/** Build the system prompt parts: the resolved base + assigned rule packs + the optional per-form guidance section. */
function buildSystemParts(form: FormForPrompt): { systemBase: string; packsSection: string; guidanceSection: string } {
  // Layer 1 — universal Base prompt (DB-managed) PLUS the single-source
  // pass addendum (input shape + output schema) appended in code. Same
  // Base body is used for the multi-source synthesis pipeline; only the
  // appended addendum differs per pass.
  const systemBase = basePromptService.getAssembledPrompt('single_source', form?.ai_base_prompt_id ?? null).body;
  const packsBody = rulePackService.renderPacksForPrompt(form.id);
  const packsSection = packsBody
    ? '\n\nRULE PACKS ASSIGNED TO THIS FORM (apply each pack as authoritative for its subject area):' + packsBody
    : '';
  const guidanceBlock = (form.ai_review_guidance ?? '').trim();
  const guidanceSection = guidanceBlock
    ? '\n\nADDITIONAL FORM-SPECIFIC GRADING RULES (configured by the form author — apply these as strictly as the rules above):\n' + guidanceBlock
    : '';
  return { systemBase, packsSection, guidanceSection };
}

/**
 * Render the per-form learned-corrections block. Placed AFTER the
 * form-specific guidance so it reads as the most recent, most concrete
 * source of truth. Returns '' (no header, no placeholder) when there
 * are no corrections — that empty path is what keeps the byte-equivalence
 * test green for forms with no calibration history yet.
 */
function buildCorrectionsSection(corrections: CalibrationCorrection[] | undefined): string {
  if (!corrections || corrections.length === 0) return '';
  const lines: string[] = [
    '',
    '',
    'LEARNED CORRECTIONS FROM HUMAN REVIEWERS (most recent first; these are how QA actually grades this form). When you encounter a substantively similar question to one listed below, prefer the corrected answer over your own initial judgment. The human grade is ground truth for that question on this form:',
  ];
  for (const c of corrections) {
    lines.push(`- Question: "${c.question_text}"`);
    lines.push(`  AI previously answered: ${c.ai_value || '(empty)'}`);
    lines.push(`  Human corrected to: ${c.human_value || '(empty)'}`);
    if (c.correction_reason) {
      lines.push(`  Reviewer's reason: ${c.correction_reason}`);
    }
    // Phase B (B4): label by source_kind so the AI knows whether the
    // lesson originated on a ticket review or a call review. Falls back
    // to 'ticket' for legacy rows that pre-date the column.
    const kindLabel = c.source_kind === 'CALL' ? 'call' : 'ticket';
    lines.push(`  Source: ${kindLabel} #${c.ticket_id}`);
    lines.push('');
  }
  // Trim trailing blank line for cleanliness.
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

/** Build the variable bag `USER_TEMPLATE` interpolates. */
function buildUserVars(input: PromptInput): Record<string, string> {
  const formSummary = renderFormForPrompt(input.form);
  const headerLines = Object.entries(input.header)
    .filter(([, v]) => v && v.length > 0)
    .map(([k, v]) => `  ${k}: ${truncate(v, 400)}`)
    .join('\n');

  const isCall = input.adapterKind === 'CALL';
  const notesHeader = isCall
    ? 'CALL TRANSCRIPT (verbatim — read top-to-bottom for chronological order):'
    : 'INTERACTION NOTES (newest first — read bottom-to-top for chronological order):';

  const noteLines = isCall
    ? renderTranscriptBlock(input.notes)
    : input.notes
        .map((n, i) => {
          const author = n.created_by_name || (n.created_by != null ? `User #${n.created_by}` : 'unknown');
          const when = formatNoteDate(n.created_on) || 'unknown date';
          return `(${i + 1}/${input.notes.length}) ${when} by ${author}\n${truncate(n.note, 1500)}`;
        })
        .join('\n\n');

  const hasPlaybookPage = input.kbHits.some((p) => p.is_playbook);
  const hasLinkedPage = input.kbHits.some((p) => p.linked_from);
  const kbBlock = input.kbHits.length === 0
    ? '(no KB pages matched the classification text — grade based on notes alone)'
    : input.kbHits.map(renderKbHit).join('\n\n');

  const kbHeader = buildKbHeader(hasPlaybookPage, hasLinkedPage);

  return {
    adapterKind: input.adapterKind,
    headerLines: headerLines || '  (empty)',
    notesHeader,
    noteLines: noteLines || (isCall ? '  (no transcript)' : '  (no notes)'),
    kbHeader,
    kbBlock,
    formSummary,
  };
}

/**
 * Renders the transcript as one line per speaker turn so the model sees
 * who said what and when, instead of a single wall of text or pretty-
 * printed JSON. Phase B replacement for the legacy verbatim block.
 *
 * Recognised shapes (per CRMNote):
 *   1. JSON array of `{ speaker | role, ts | timestamp | start | offset, text | utterance | message }` —
 *      the dominant Genesys/Five9/AWS Connect transcript format.
 *   2. Plain text already laid out as `[mm:ss — Speaker] text` lines —
 *      preserved verbatim.
 *   3. Any other plain-text content — emitted verbatim under the call
 *      metadata header.
 *
 * Falling back from JSON to verbatim text is intentional: a malformed
 * transcript should never break the AI review, and the model can still
 * grade off raw text when the structured form isn't available.
 */
/**
 * Thin pass-through to the shared transcript renderer. Kept as a local
 * alias so existing call sites in this file don't need to update — the
 * actual implementation lives in `./transcriptRender` so the trace pass
 * (in `aiReviewerTwoPassPrompts.ts`) can reuse the exact same logic.
 */
function renderTranscriptBlock(notes: CRMNote[]): string {
  return renderTranscriptBlockShared(notes);
}

function formatTranscriptContent(raw: string): string {
  return formatTranscriptContentShared(raw);
}

function renderFormForPrompt(form: FormForPrompt): string {
  const byCategory = new Map<string, FormForPrompt['questions']>();
  for (const q of form.questions) {
    // Only show gradeable questions to the model. TEXT/INFO_BLOCK/SUB_CATEGORY are skipped.
    if (q.question_type === 'TEXT' || q.question_type === 'INFO_BLOCK' || q.question_type === 'SUB_CATEGORY') continue;
    // ROLLUP questions are auto-derived by deriveRollupAnswers in
    // backend/src/utils/rollupEngine.ts and overwritten on persist by
    // SubmissionService.applyRollupEngineToAnswers - sending them to
    // the model is wasted tokens both ways.
    if (q.role === 'ROLLUP') continue;
    if (!byCategory.has(q.category_name)) byCategory.set(q.category_name, []);
    byCategory.get(q.category_name)!.push(q);
  }
  const lines: string[] = [`Form: "${form.form_name}" (id=${form.id}, interaction_type=${form.interaction_type})`, ''];
  for (const [cat, qs] of byCategory) {
    lines.push(`## Category: ${cat}`);
    for (const q of qs) {
      const opts = renderOptions(q);
      lines.push(`  - question_id=${q.id} type=${q.question_type}${q.is_na_allowed ? ' (NA allowed)' : ''}`);
      lines.push(`    text: ${q.question_text}`);
      if (opts) lines.push(`    options: ${opts}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function renderOptions(q: FormForPrompt['questions'][number]): string {
  if (q.question_type === 'YES_NO') return `yes (=${q.yes_value}), no (=${q.no_value})${q.is_na_allowed ? `, NA (=${q.na_value})` : ''}`;
  if (q.question_type === 'RADIO' || q.question_type === 'MULTI_SELECT') {
    return q.radio_options.map((o) => `${o.value} ("${o.text}", score=${o.score})`).join('; ');
  }
  return '';
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ---------------------------------------------------------------------------
// Per-question rubrics (Tier-2 Item 6).
// ---------------------------------------------------------------------------
// Per-(form, question) grading rubric authored by QA admins on the AI
// Reviewer Form Detail page (Question Rubrics card). Stored in
// `ai_form_question_rubric` and rendered as the indented "RUBRIC:"
// block under each question by `renderFormSpec` in
// `aiReviewerTwoPassPrompts`.
//
// Replaced the file-based convention `backend/prompts/form-rubrics/<form_id>.md`
// in 20260513100000 — see [backend/prisma/schema.prisma](backend/prisma/schema.prisma)
// for the table shape.
//
// Caching strategy mirrors `RulePackService`: sync read API (prompt
// builders run synchronously and we don't want to cascade `await`
// through them) backed by an in-process cache hydrated at server
// bootstrap via `warmFormRubricsCache()` and refreshed on every write.
// Missing form / no-rubric is the common case — returns an empty map.

/** form_id → Map<question_id, rubric_md> */
const rubricsCache = new Map<number, Map<number, string>>();
let rubricsCacheLoaded = false;
let rubricsRefreshTimer: NodeJS.Timeout | null = null;
const RUBRICS_REFRESH_INTERVAL_MS = 60_000;

async function refreshFormRubricsCache(): Promise<void> {
  const rows = await prisma.aiFormQuestionRubric.findMany({
    select: { form_id: true, question_id: true, rubric_md: true },
  });
  const next = new Map<number, Map<number, string>>();
  for (const row of rows) {
    let inner = next.get(row.form_id);
    if (!inner) {
      inner = new Map<number, string>();
      next.set(row.form_id, inner);
    }
    const md = (row.rubric_md ?? '').trim();
    if (md.length > 0) inner.set(row.question_id, md);
  }
  rubricsCache.clear();
  for (const [k, v] of next) rubricsCache.set(k, v);
  rubricsCacheLoaded = true;
}

/**
 * Hydrate the per-question rubrics cache and start the background
 * refresh timer. Call once during server bootstrap before `app.listen`,
 * alongside `rulePackService.warmCache()`.
 */
export async function warmFormRubricsCache(): Promise<void> {
  await refreshFormRubricsCache();
  logger.info(`[ai-reviewer] rubrics cache warmed: ${rubricsCache.size} form(s) with rubrics`);
  if (!rubricsRefreshTimer) {
    rubricsRefreshTimer = setInterval(() => {
      refreshFormRubricsCache().catch((err) => {
        logger.warn(`[ai-reviewer] rubrics background refresh failed: ${(err as Error).message}`);
      });
    }, RUBRICS_REFRESH_INTERVAL_MS);
    if (rubricsRefreshTimer.unref) rubricsRefreshTimer.unref();
  }
}

/**
 * Load per-question rubrics for a form. Returns an empty map when the
 * form has none (the common case). Sync — served from the cache
 * hydrated by `warmFormRubricsCache()` at boot.
 */
export function loadFormRubrics(formId: number): Map<number, string> {
  if (!rubricsCacheLoaded) {
    // Production should never hit this branch (bootstrap warms the
    // cache before listen()). In tests / scripts that don't warm the
    // cache, returning empty is the safer default than throwing.
    return new Map();
  }
  return rubricsCache.get(formId) ?? new Map();
}

/**
 * Upsert a per-question rubric. Empty / whitespace-only `rubricMd` is
 * treated as a delete request (rubrics are optional). Cache is refreshed
 * synchronously on success so the next AI run picks up the change.
 */
export async function upsertQuestionRubric(
  formId: number,
  questionId: number,
  rubricMd: string,
  updatedBy: number | null = null,
): Promise<void> {
  if (!Number.isInteger(formId) || formId <= 0) {
    throw new Error('Invalid form id');
  }
  if (!Number.isInteger(questionId) || questionId <= 0) {
    throw new Error('Invalid question id');
  }
  const trimmed = (rubricMd ?? '').trim();
  if (trimmed.length === 0) {
    await deleteQuestionRubric(formId, questionId);
    return;
  }
  await prisma.aiFormQuestionRubric.upsert({
    where: { form_id_question_id: { form_id: formId, question_id: questionId } },
    update: { rubric_md: trimmed, updated_by: updatedBy },
    create: { form_id: formId, question_id: questionId, rubric_md: trimmed, updated_by: updatedBy },
  });
  await refreshFormRubricsCache();
}

/** Delete a rubric. No-op when none exists. */
export async function deleteQuestionRubric(formId: number, questionId: number): Promise<void> {
  if (!Number.isInteger(formId) || formId <= 0) {
    throw new Error('Invalid form id');
  }
  if (!Number.isInteger(questionId) || questionId <= 0) {
    throw new Error('Invalid question id');
  }
  await prisma.aiFormQuestionRubric
    .delete({ where: { form_id_question_id: { form_id: formId, question_id: questionId } } })
    .catch((err: any) => {
      // P2025 = "record not found" — already absent, treat as success.
      if (err?.code !== 'P2025') throw err;
    });
  await refreshFormRubricsCache();
}

/** List all rubrics for a form (admin / UI use), full row shape. */
export async function listQuestionRubricsForForm(formId: number): Promise<
  Array<{ question_id: number; rubric_md: string; updated_by: number | null; updated_at: Date }>
> {
  if (!Number.isInteger(formId) || formId <= 0) return [];
  const rows = await prisma.aiFormQuestionRubric.findMany({
    where: { form_id: formId },
    select: { question_id: true, rubric_md: true, updated_by: true, updated_at: true },
    orderBy: { question_id: 'asc' },
  });
  return rows;
}

/**
 * Test-only: clear the in-process rubrics cache + stop the refresh
 * timer so unit tests can exercise the loader against a mocked DB
 * without cross-test pollution.
 * @internal
 */
export function _clearFormRubricsCache(): void {
  rubricsCache.clear();
  rubricsCacheLoaded = false;
  if (rubricsRefreshTimer) {
    clearInterval(rubricsRefreshTimer);
    rubricsRefreshTimer = null;
  }
}

/**
 * Test-only: seed the cache directly so tests of `loadFormRubrics` can
 * skip the Prisma round-trip without forcing every test to mock prisma.
 * @internal
 */
export function _seedFormRubricsCache(formId: number, rubrics: Map<number, string>): void {
  rubricsCache.set(formId, rubrics);
  rubricsCacheLoaded = true;
}

/** Render a CRM note date as "Apr 28 2026 9:14 AM" so the model can cite by date. */
function formatNoteDate(raw: unknown): string | null {
  if (!raw) return null;
  const d = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * Render a single KB hit into its `--- TAG id=... name="..." url=... ---`
 * block. Mandatory pages get the `ASSIGNED PLAYBOOK PAGE` tag; pages
 * pulled in by following an in-body hyperlink (KB link expansion) get
 * the `LINKED KB PAGE` tag with a breadcrumb back to their source so
 * the model knows they are decision-flow context, not direct hits.
 */
function renderKbHit(p: {
  id: number;
  name: string;
  url: string;
  content: string;
  is_playbook?: boolean;
  linked_from?: { name: string; url: string; hop: number };
}): string {
  let tag: string;
  if (p.is_playbook) {
    tag = 'ASSIGNED PLAYBOOK PAGE';
  } else if (p.linked_from) {
    tag = `LINKED KB PAGE (linked from "${p.linked_from.name}", hop=${p.linked_from.hop})`;
  } else {
    tag = 'KB PAGE';
  }
  return `--- ${tag} id=${p.id} name="${p.name}" url=${p.url} ---\n${p.content}`;
}

/**
 * Build the KB-section header explaining how the model should read each
 * tag. We only mention the variants we actually emit so the prompt
 * stays terse on reviews that don't trigger every layer.
 */
function buildKbHeader(hasPlaybookPage: boolean, hasLinkedPage: boolean): string {
  const sentences: string[] = ['KNOWLEDGE BASE EXCERPTS'];
  if (hasPlaybookPage) {
    sentences.push(
      '(the page(s) marked "ASSIGNED PLAYBOOK PAGE" are the exact documented process the agent was supposed to follow on this ticket — treat them as the highest-authority source. Other KB PAGE entries are additional documented process matched on the classification text — also treat them as authoritative.'
    );
  } else {
    sentences.push(
      '(matched on classification text — these ARE the documented process; treat them as authoritative.'
    );
  }
  if (hasLinkedPage) {
    sentences.push(
      'Pages tagged "LINKED KB PAGE" were pulled in by following an in-body hyperlink from another KB page in this set — they typically supply parent / sibling decision-flow context (e.g. "choose path A or path B") that the leaf page itself does not document. Read them BEFORE you decide whether the agent followed the leaf-level steps; if a linked parent page documents a valid alternate path the agent took, do not penalize the agent for not following the leaf page\'s steps.'
    );
  }
  sentences.push('Cite by page name only in the narrative — never by id or page number):');
  return sentences.join(' ');
}

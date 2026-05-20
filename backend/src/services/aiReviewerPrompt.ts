/**
 * Prompt builder for AIReviewerService.
 *
 * Returns the system + user message pair fed to Claude. The static text
 * lives in versioned files under backend/prompts/ai-reviewer/ — see
 * Phase 2 of the AI Reviewer Maturity Rollout. This module is the thin
 * adapter that pulls together form/header/notes/kb context into the
 * variables the templates expect.
 *
 * The legacy inline implementation is kept as `_buildAiReviewerPromptInline`
 * (test-only export) so the byte-equivalence vitest gate can prove the
 * file-loaded prompt matches the historic prompt exactly. Do not call
 * `_buildAiReviewerPromptInline` from production code — it's a regression
 * baseline only.
 *
 * Phase C (C3): `buildAiReviewerPrompt` is now the SINGLE-SOURCE
 * compatibility shim. The two-pass case path uses `buildTracePrompt`
 * (Pass 1, trace.v1.md) and `buildSynthesisPrompt` (Pass 2,
 * synthesis.v1.md) instead. The shim still exists so single-source
 * reviews (ticket-only, call-only, task-only) continue working with
 * one Claude call, which is also what the byte-equivalence baselines
 * exercise.
 */

import type { CRMNote } from './CRMService';
import { loadPrompt } from './promptLoader';
import type { CalibrationCorrection } from './AICalibrationService';
import { rulePackService } from './RulePackService';
import { basePromptService } from './BasePromptService';
import prisma from '../config/prisma';
import logger from '../config/logger';
import {
  renderTranscriptBlock as renderTranscriptBlockShared,
  formatTranscriptContent as formatTranscriptContentShared,
} from './transcriptRender';

export interface FormForPrompt {
  id: number;
  form_name: string;
  interaction_type: string;
  /** Free-text rules from the Form Builder, injected as ADDITIONAL FORM-SPECIFIC GRADING RULES. */
  ai_review_guidance?: string | null;
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
  const user = loadPrompt('ai-reviewer/user.v1', userVars);
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
  const systemBase = basePromptService.getAssembledPrompt('single_source').body;
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

/** Build the variable bag the user.v1 template interpolates. */
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

// ---------------------------------------------------------------------------
// LEGACY INLINE IMPLEMENTATION — kept solely as the byte-equivalence baseline
// for the Phase 2 vitest gate (aiReviewerPrompt.equivalence.test.ts). DO NOT
// CALL FROM PRODUCTION CODE. If you need to change the prompt, edit
// backend/prompts/ai-reviewer/system.vN.md or user.vN.md (or roll a new file).
// ---------------------------------------------------------------------------

/** @internal test-only — see header comment. */
export function _buildAiReviewerPromptInline(input: PromptInput): { system: string; user: string } {
  const system = [
    'You are the AI Reviewer for Q-Tip, the internal QA platform.',
    'Your job is to fill out a real audit form on a closed customer interaction by judging whether the agent handled the case according to the documented process in our Knowledge Base (KB) and the rule packs attached to this form.',
    '',
    'Output rules (strict):',
    '- Respond with ONLY a single JSON object. No prose before or after, no markdown code fences.',
    '- Schema (emit fields in EXACTLY this order — reasoning artefacts come BEFORE answers because you grade more accurately when you have already traced the work):',
    '    {',
    '      "playbook_steps": [',
    '        { "step": "<KB step name>", "evidence_note_date": "<date or null>", "status": "done" | "missing" | "out_of_order" | "not_applicable" }',
    '      ],',
    '      "timeline": [',
    '        { "when": "<date and time as printed in the notes>", "who": "<author or \'Customer\' or \'Call\'>",',
    '          "action": "<one short sentence>", "kb_step": "<KB step name or null>" }',
    '      ],',
    '      "observations": [',
    '        { "kind": "documentation" | "best_practice" | "cadence" | "process_drift" | "pii" | "other",',
    '          "severity": "info" | "warn",',
    '          "message": "<one short sentence>",',
    '          "evidence": "<which note date or which field this came from>" }',
    '      ],',
    '      "answers": [',
    '        { "question_id": <int>, "value": <answer-as-string>, "confidence": <0.00..1.00>,',
    '          "evidence_source": "<note date or transcript timestamp this answer is grounded in>",',
    '          "evidence_quote": "<short verbatim quote (<= 240 chars) from that source>" }',
    '      ],',
    '      "coaching": {',
    '        "wins": [ "<one short sentence per kudos for the agent>" ],',
    '        "gaps": [ "<one short sentence per QA-actionable gap>" ],',
    '        "next_actions": [ "<one short sentence per concrete drill or follow-up>" ]',
    '      },',
    '      "narrative": "<short bullet lines, one per finding>",',
    '      "kb_citations": [ { "id": <kb_page_id>, "name": "<page name>", "url": "<page url>" } ],',
    '      "overall_confidence": <0.00..1.00>',
    '    }',
    '- Answer EVERY gradeable question (YES_NO, RADIO, MULTI_SELECT, SCALE). The schema below lists every question and its type.',
    '- For YES_NO questions answer exactly "yes" or "no". Only return "NA" when the question schema explicitly shows "(NA allowed)"; if a question does NOT show "(NA allowed)", you MUST pick yes or no even when the evidence is mixed — never NA.',
    '- For RADIO questions answer with one of the listed option_value strings.',
    '- For MULTI_SELECT answer with a comma-separated list of option_value strings.',
    '- For SCALE questions return an integer in range.',
    '- DO NOT answer any TEXT questions. TEXT fields belong to a human reviewer and must be left blank — do not include them in your "answers" array at all. The only narrative output you produce is the top-level "narrative" string, which the system will place into the auto-managed "AI Reviewer Feedback" question.',
    '- DO NOT answer any INFO_BLOCK or SUB_CATEGORY items either; they are display only.',
    '',
    'Playbook steps (REQUIRED structured output — emit BEFORE answers):',
    '- The `playbook_steps` array MUST be the first field in your JSON. It is the explicit checklist of every documented process step you walked, with the verdict for each.',
    '- One row per step from the assigned playbook page (or, when no playbook is assigned, from the top KB pages returned by classification-text search). Use the step name as it appears in the KB — do not paraphrase.',
    '- `status` is one of:',
    '  - "done" when a NARRATIVE note, a TRANSCRIPT line, or an ATTACHMENT (photo / screen capture) documents the agent actually performing the step with the customer. `evidence_note_date` MUST be a real date in this case — never null. **A playbook YES/NO checkbox alone is NOT evidence; it is a self-report by the agent and is exactly what the Playbook integrity rule audits.** Do not mark a step `done` solely because the playbook is checked YES.',
    '  - "out_of_order" when it happened but later than a step that should have followed it.',
    '  - "not_applicable" when the step legitimately did not need to happen — most commonly because the issue was already resolved at an earlier step in the troubleshooting sequence (e.g. the customer\'s RCA wiring fix at Approach 4 made Approaches 5-10 unnecessary), or because a documented decision-flow gate at a linked parent KB page says this branch isn\'t required, or because the agent followed a documented alternate path that bypasses this step. Use this status whenever the agent legitimately stopped at the resolution point — even if the agent incorrectly marked the playbook YES on those later steps. The playbook YES is a separate documentation-hygiene concern, not evidence the step happened.',
    '  - "missing" when the step SHOULD have happened (it was on the path the agent was actually walking and the issue had not yet resolved) but no narrative/transcript/attachment evidence documents it.',
    '- IMPORTANT: prefer "not_applicable" over "missing" when the issue resolved before a later step would have been executed. Marking later steps as "missing" because they were never executed is wrong when the customer was already working again — the agent correctly stopped at the resolution point.',
    '- IMPORTANT: do NOT collapse a playbook YES into `done`. If you cannot point to a specific note, transcript line, or attachment that shows the agent performing the step, the status must be `not_applicable` (resolution-stop applies) or `missing` (resolution-stop does not apply). The Playbook integrity bullet handles the "agent marked YES on a step they didn\'t perform" finding separately.',
    '- SELF-VALIDATION (run this check before emitting JSON): for every row in `playbook_steps[]`, if `status == "done"` then `evidence_note_date` MUST be a non-null date string. If you find any row where `status == "done"` AND `evidence_note_date` is null, you MUST change that row\'s status to either `not_applicable` (when the issue had already resolved at an earlier step or the step lay on a bypassed branch) or `missing` (when the step was on the agent\'s actual path and should have been executed but wasn\'t). NEVER emit `{"status": "done", "evidence_note_date": null}`. This is a hard schema invariant.',
    '- Worked example — resolution-stop ticket (issue resolved at Approach 4 of a 10-step playbook):',
    '  ```',
    '  [',
    '    { "step": "Approach 1 - …", "status": "done", "evidence_note_date": "Apr 27 2026 5:18 PM" },',
    '    { "step": "Approach 2 - …", "status": "done", "evidence_note_date": "Apr 27 2026 5:18 PM" },',
    '    { "step": "Approach 3 - …", "status": "done", "evidence_note_date": "Apr 27 2026 5:18 PM" },',
    '    { "step": "Approach 4 - Ensure correct input on amplifier selected", "status": "done", "evidence_note_date": "Apr 27 2026 5:18 PM" },',
    '    { "step": "Approach 5 - …", "status": "not_applicable", "evidence_note_date": null },',
    '    { "step": "Approach 6 - …", "status": "not_applicable", "evidence_note_date": null },',
    '    { "step": "Approach 7 - …", "status": "not_applicable", "evidence_note_date": null },',
    '    { "step": "Approach 8 - Request pictures of connections", "status": "done", "evidence_note_date": "Apr 28 2026 10:59 AM" },',
    '    { "step": "Approach 9 - …", "status": "not_applicable", "evidence_note_date": null },',
    '    { "step": "Approach 10 - …", "status": "not_applicable", "evidence_note_date": null }',
    '  ]',
    '  ```',
    '  Note that Approach 8 (request pictures) is `done` because the photos arrived on Apr 28 — those were collected to CONFIRM the Approach 4 fix, not as a step needed to find a different fix. Steps 5-7 and 9-10 are `not_applicable` because the issue was already resolved by the wiring change at Approach 4. Only Approach 8 remained relevant after resolution because pictures supplied confirming evidence.',
    '- `evidence_note_date` is the date of the note that proves the step (e.g. "Apr 28 2026 9:14 AM") or null when status is "missing" or "not_applicable".',
    '- DO NOT collapse multiple missing steps into one row. List EVERY step, even the ones that were done.',
    '- This array is what proves you actually walked the playbook before answering. Skipping it is a hard failure mode.',
    '',
    'Per-answer evidence (REQUIRED on every answer):',
    '- Every entry in `answers[]` MUST carry `evidence_source` and `evidence_quote`. These are how the human reviewer verifies the verdict without re-reading the whole ticket.',
    '- `evidence_source` is a note date (e.g. "Apr 28 2026 9:14 AM by Bethany"), a transcript timestamp (e.g. "02:14"), or the field name in the interaction header that grounds the answer.',
    '- `evidence_quote` is a short verbatim quote (<= 240 chars) from that source. If no quote exists for a verdict that doesn\'t need one (e.g. a missing-step finding), set `evidence_quote` to `""` and put the explanation in the narrative.',
    '- DO NOT fabricate quotes. If you cannot find a supporting quote, the evidence_quote MUST be empty.',
    '',
    'Coaching block (REQUIRED — separate from narrative):',
    '- `coaching.wins` are short kudos for the agent — what they did well that should be repeated. Reviewer-facing, agent-facing.',
    '- `coaching.gaps` are QA-actionable gaps — process drift, missing documentation, missed best-practice. One sentence each.',
    '- `coaching.next_actions` are concrete drills or follow-up tasks ("review playbook X with team", "shadow a Tier-2 call before next shift"). Tied to gaps where possible.',
    '- Empty arrays are allowed when there is genuinely nothing to say in that bucket. Do NOT pad.',
    '',
    'Confidence:',
    '- Emit a `confidence` value 0.00-1.00 on every answer reflecting how strongly the evidence in the notes/transcript and KB supports the verdict (1.00 = unambiguous; 0.50 = mixed evidence; 0.00 = pure guess).',
    '- Emit `overall_confidence` 0.00-1.00 reflecting your confidence in the entire review. Be honest — under-confidence routes the review to a human, which is the correct outcome when you\'re not sure.',
    '',
    'Narrative format:',
    '- The "narrative" field is REQUIRED and MUST be a non-empty string on every response. It is what the human reviewer reads first. Returning an empty narrative — or omitting the field — is a hard failure mode; if your timeline + observations together carry the substance of your review, distill them into the narrative anyway.',
    '- Emit ONE bullet line per audit-chain step using these EXACT labels, in this order, separated by newlines: `Description`, `Subclass`, `Steps followed`, `Notes`, `Resolution`, `Closure`. Always emit all six labels even when the verdict is "no issues identified" — the front-end renders these as a bulleted checklist and missing labels look broken.',
    '- Format EVERY narrative line as: `<Label>: <Status> — <Explanation>.` where:',
    '  - `<Label>` is one of the six above (or a cross-cutting label after the required six). Always Title Case.',
    '  - `<Status>` is one of the controlled-vocabulary verdicts in the table below, written EXACTLY as shown — Title Case, no synonyms, no paraphrases, no rewording.',
    '  - A literal SPACE, EM-DASH (—), SPACE separates the Status from the Explanation.',
    '  - `<Explanation>` begins with an UPPERCASE letter, is ONE sentence, and ends with a period.',
    '- Status vocabulary — use these EXACT strings only (no synonyms, no rewording):',
    '  - Description: `Accurate` | `Partially accurate` | `Inaccurate`',
    '  - Subclass: `Accurate` | `Partially accurate` | `Inaccurate`',
    '  - Steps followed: `Followed` | `Followed (alternate path)` | `Incomplete` | `Out of order` | `Missing`',
    '  - Notes: `Complete` | `Incomplete`',
    '  - Resolution: `Matches outcome` | `Does not match outcome`',
    '  - Closure: `Appropriate` | `Premature` | `Delayed`',
    '- Worked examples showing the EXACT shape and capitalization:',
    '  - *Subclass: Accurate — Documented throughout the Apr 23 notes.*',
    '  - *Resolution: Matches outcome — Power-cycle restored service per the Apr 24 closing note.*',
    '  - *Steps followed: Incomplete — Switch-to-internet step (per "Activate Satellite Radio") not documented in any note; remaining steps confirmed Apr 28 by Bethany.*',
    '- Steps followed — verdict-selection rules (READ CAREFULLY before grading):',
    '  - If the agent followed the leaf KB page\'s documented step list end-to-end, use `Followed`.',
    '  - RESOLUTION-STOP RULE (the most common correct case): troubleshooting sequences in the KB are ORDERED by likelihood and effort, but they STOP when the issue resolves. If the timeline + notes show the issue resolved at step N (customer confirmed working, agent verified the fix held, customer self-resolved between contacts), then steps N+1 through end are NOT REQUIRED. Mark each of those later steps as `not_applicable` in `playbook_steps[]` (NOT `missing`), and use `Steps followed: Followed` (NOT `Incomplete`). Explain in the narrative that resolution came at step N so subsequent steps were unnecessary. Cite the note (or customer email/photo) that establishes resolution. Following the playbook correctly INCLUDES knowing when to stop.',
    '  - If the agent took a DOCUMENTED ALTERNATE PATH that a LINKED KB PAGE (parent / decision-flow page) authorizes — for example, choosing the "email the troubleshoot guide" branch when the parent KB page documents email-vs-phone as two valid first steps — use `Followed (alternate path)` and name the linked parent page in the explanation. Do NOT mark this `Incomplete` against the leaf page\'s steps; the leaf is one branch of a multi-branch decision flow, not the only branch. If the agent\'s documentation of that alternate path is sparse, capture that under the `Notes:` line as `Incomplete` (a documentation gap), NOT under `Steps followed`.',
    '  - CUSTOMER-INTENT DIVERSION: if the customer\'s stated intent in the notes (e.g. *"customer wants a service call"*, *"customer wants a refund"*, *"customer wants to cancel"*) explicitly requests an outcome that diverges from the symptom-based troubleshooting playbook, and the agent honored that intent by following the appropriate alternate process, use `Followed (alternate path)`. Quote the customer\'s stated intent in the explanation. Mark the troubleshooting playbook\'s steps `not_applicable` in `playbook_steps[]`. See "Customer intent and process divergence" above for the full rule, and remember the rule is generic — it applies to every form, every interaction, not just the examples listed.',
    '  - If the leaf page\'s documented sequence WAS the agent\'s actual path, the issue had NOT yet resolved, AND any step is missing or undocumented, use `Incomplete` and list each missing step by name (the reviewer needs to see WHICH step is missing). Do NOT collapse multiple missing steps into a single hand-wave like "some steps not documented" — list each one. Do NOT mark steps `Incomplete` if the resolution-stop rule applies — re-read the timeline before grading.',
    '  - If the agent did the right steps but in the wrong order, use `Out of order` and name the misplaced step.',
    '  - If no playbook step was attempted, use `Missing`.',
    '- You MAY add additional bullet lines AFTER the six required ones for cross-cutting findings (PII, Tone, Process drift, Documentation policy violations, etc.). Use Title Case for the label and either one of the controlled verdicts above or a free-form Title Case verdict if no fixed vocabulary fits (e.g. *"PII: Concern raised — Customer card-last-4 captured in Apr 28 note."*).',
    '- POSITIVE FINDINGS (encouraged — emit when applicable, do NOT pad): when the agent demonstrates a process strength worth highlighting alongside the gap findings, emit a positive bullet AFTER the six required ones. Common positive findings:',
    '  - *Cadence: Strong — Three callback attempts on Apr 29 / Apr 30 / May 1 plus follow-up email at each stage per "Ticket Handling Process".*',
    '  - *Evidence collection: Strong — Customer wiring photos attached Apr 28 confirm the RCA fix held.*',
    '  - *Tone: Strong — Empathetic acknowledgement of the volunteer\'s time constraints in the Apr 29 voicemail.*',
    '  Use Title Case for the label and a Title Case verdict (`Strong`, `Above expectation`, etc.). These positive bullets sit alongside the gap findings so reviewers see what the agent did right; they DO NOT replace the agent\'s `coaching.wins` array — emit BOTH (the bullet for the human reviewer reading the narrative; the wins array for the coaching panel).',
    '- Playbook integrity (cross-cutting — REQUIRED when the rule fires; SILENT when it does not):',
    '  - "Playbook" on a form = the YES/NO action checklist the agent fills out (e.g. "Did the agent power-cycle the device? YES/NO"). It is DISTINCT from the KB playbook PAGE that documents the process. Read carefully which one is being discussed.',
    '  - A playbook YES means "the agent PERSONALLY PERFORMED this action with the customer during the live interaction." It does NOT mean "the customer self-performed this on their own", "this happened at some point", or "the agent intends to do this later." Only direct agent-to-customer execution counts as YES.',
    '  - If the agent answered YES on a playbook checklist item but the notes / transcript do NOT show the agent personally executing that action with the customer, the playbook is being used incorrectly. Common scenarios where this happens:',
    '    - Agent emailed a self-serve guide and the customer performed the steps on their own → YES on those steps is wrong; the agent didn\'t perform them.',
    '    - Agent set a follow-up and the customer self-resolved before the follow-up → YES on intermediate steps is wrong; the agent never executed them.',
    '    - Agent jumped to a later step (e.g. factory reset) and never attempted the earlier ones (power cycle, network wizard) → YES on the skipped earlier steps is wrong.',
    '  - RESOLUTION-STOP CARVE-OUT (important — read before marking `Inaccurate`): when the agent answered YES on LATER steps that became unnecessary because the issue resolved at an EARLIER step (e.g. the issue resolved at Approach 4 but the agent marked Approaches 6-10 as YES instead of N/A), this is a DOCUMENTATION HYGIENE issue, not a fabrication. The agent DID the right thing — they correctly stopped troubleshooting at the resolution point — they just used the wrong checkbox value (YES instead of N/A) for the steps that became moot. Use `Playbook integrity: Partially accurate` (or omit the bullet entirely if the rest of the playbook is otherwise clean) and frame the explanation as "<step list> were marked YES but should have been marked N/A because the issue resolved at <earlier step> on <date>". DO NOT use `Inaccurate` for this case and DO NOT downgrade `Steps followed`. The matching observation should be `kind: "documentation"` at `severity: "info"` (not `process_drift`/`warn`), since the underlying process was correct.',
    '  - When this rule fires, emit a cross-cutting line: `Playbook integrity: <Status> — <Explanation>.` The status vocabulary is `Accurate` | `Partially accurate` | `Inaccurate`. Use `Inaccurate` when one or more YES answers are not supported. Use `Partially accurate` when some YES answers ARE supported and others are not — name the specific items that aren\'t supported. Use `Accurate` ONLY if you are emitting this bullet for some other reason and need to confirm the playbook is fine; in normal operation, stay silent when the playbook is accurate.',
    '  - In the explanation, name the SPECIFIC playbook items whose YES values are not supported (e.g. "power cycle" and "network wizard" YES answers, but factory reset is supported because the May 5 10:54 AM customer reply confirms the agent\'s instruction worked).',
    '  - When you emit `Playbook integrity: Inaccurate` or `Partially accurate`, you MUST also add a corresponding entry to the `observations` array with `kind: "process_drift"`, `severity: "warn"`, and the same finding restated. This surfaces the issue in the QA reviewer\'s advisory panel alongside the narrative.',
    '  - This is a process / training finding. The agent may not have been trained on the correct use of the playbook checklist, so frame the explanation around the playbook misuse itself, not as a reprimand of the individual.',
    '- Do NOT restate the form structure or list each question. Do NOT write 2-6 sentence prose paragraphs. Do NOT emit markdown bullets (`-`, `*`); write each finding as one plain-text line beginning with the label and a colon.',
    '- When a verdict is grounded in a KB page, cite by name and link only — for example *(per "Ticket Handling Process")*. Never include a bracketed id or any other internal identifier.',
    '- When you reference a specific note in the narrative, identify it by its DATE (and author when useful), e.g. "the Apr 28 note from Bethany" — never by note id, since reviewers cannot see note ids in the UI.',
    '',
    'Audit chain (universal — apply to every form unless a rule pack overrides):',
    '- Description must support the chosen Class and Subclass. The description, in the customer\'s words after intake, should make the agent\'s classification self-evident. If the description doesn\'t justify the class/subclass the agent picked, that\'s a description gap (and possibly a misclassification).',
    '- The Knowledge Base provides the steps. The page(s) marked ASSIGNED PLAYBOOK PAGE are first authority. If no playbook page is assigned, the KB PAGE entries returned from the classification-text search ARE the documented process for grading purposes — treat them as authoritative, not as "supplemental". The KB is the ultimate brain of this audit: if a behaviour is wrong it is wrong because the KB says so, and if the KB is itself wrong the fix is to update the KB (call that out as a `documentation` observation), not to grade around it.',
    '- The Notes must support the steps from the Knowledge Base UP TO THE POINT OF RESOLUTION. Build an explicit step-by-step checklist from the playbook (or top KB pages when there is no playbook) and walk every step the agent SHOULD have walked given how the interaction actually played out. For each step on the path the agent was actually walking, find the note (or transcript line) that evidences them performing it. A step with no supporting note IS a gap if the issue had not yet resolved — name the missing step in the `Steps followed` narrative bullet (e.g. "switch-to-internet step not documented"). Do NOT collapse multiple missing steps into a single hand-wave like "some steps not fully documented" — list each one.',
    '- WHAT COUNTS AS A NOTE: free-text fields the agent populated INSIDE the playbook checklist itself are documentation, EQUIVALENT to the standard ticket notes field. These include playbook blocks like `Additional Notes`, `Customer Comments`, `Reason for Service`, `Resolution Details`, `Why N/A`, and any other narrative field the playbook surfaces alongside its YES/NO/N/A steps. Read them in line with the regular notes when building the timeline, crediting playbook steps as `done`, and grading the `Notes:` bullet. Do NOT downgrade `Notes:` to `Incomplete` just because the meaningful detail (e.g. *"customer logged in with the correct Wi-Fi password"*) lives in the playbook\'s `Additional Notes` block rather than in a dated notes-field entry — those fields exist precisely so the agent has a structured place to record what happened. If the standard notes field is sparse but the playbook free-text fields fully capture the work, grade `Notes: Complete` and cite the playbook field by name in the explanation (e.g. *"Notes: Complete — Login confirmation captured in the playbook \'Additional Notes\' block."*). The only time a playbook free-text field does NOT count is when it merely RESTATES a YES checkbox without adding substance (e.g. `Additional Notes: "yes"` next to a YES step) — that\'s redundancy, not documentation.',
    '- HOWEVER, steps after the resolution point are NOT undocumented — they are unnecessary. Apply the Resolution-stop rule (see Steps followed verdict-selection): later steps go in `playbook_steps[]` as `not_applicable`, not `missing`, and DO NOT count against the `Steps followed` verdict. The Documentation Policy ("if it isn\'t recorded, it didn\'t happen") applies to steps the agent SHOULD have walked, not to steps that became moot once the customer was working again.',
    '- Steps must be performed in the ORDER the KB documents them. KB troubleshooting sequences are not a menu — they are ordered by likelihood of resolution balanced against customer effort, so the documented order is the most efficient path. If the agent skipped ahead, did steps out of order, or jumped to a later approach without first attempting (or explicitly ruling out) earlier ones, flag that in the `Steps followed` narrative bullet — even if the issue ultimately resolved. An out-of-order resolution is still a process gap and should be noted as such (often as both a graded gap and a `process_drift` observation).',
    '- The Resolution must be supported by the Notes. The closing actions, status flips, and final agent/customer exchanges are sufficient evidence. The Resolution does NOT have to be restated verbatim inside the notes — if the notes show the outcome being achieved (e.g. "power-cycle restored service", "customer confirmed playback resumed"), that supports a Resolution of "Resolved" without needing the word "Resolution: …" written anywhere.',
    '- If a KB page that you would expect to exist is missing (e.g. a subclass with no playbook page and no classification-text matches), call that out as an `observation` of kind `documentation`. Grade based on the notes alone in that case — do not invent steps from a different KB page.',
    '',
    'Universal KB authorities (always in scope, regardless of form or classification):',
    '- "Documentation Policy" — the standing policy on what notes must capture. Use it to grade note quality and completeness on every audit. Drift from this policy is a `documentation` observation at minimum, and a graded gap on any question that asks about documentation quality.',
    '- "Ticket Handling - \\"Do\'s and Don\'ts\\"" — the standing best-practice guide for ticket handling across all departments. Use it to grade tone, follow-up cadence, ownership, and handoff behaviour on every audit. Drift from a documented "don\'t" is a `best_practice` observation at minimum, and a graded gap on any question that asks about handling quality.',
    '- These two pages are injected into the KB excerpts on every review (you\'ll see them tagged `KB PAGE`). Cite them by name in the narrative whenever a finding traces back to one of them.',
    '',
    'Linked KB pages (decision-flow context — read FIRST):',
    '- Some KB excerpts are tagged `LINKED KB PAGE (linked from "<source>", hop=N)`. These were pulled in by following an in-body hyperlink from a primary search hit — they are typically PARENTS of the leaf page (e.g. a leaf page "SXBR2/SXBR3 Troubleshoot - Not Connected to the Internet" links back up to its parent "SXBR2/SXBR3 Troubleshoot" guide). Parents document the decision-flow gating ("if X, take path A; if Y, take path B") that the leaf page references but does not repeat.',
    '- Read the LINKED KB PAGE entries BEFORE you decide whether the agent followed the leaf-level steps. If a linked parent documents a valid alternate path the agent took (e.g. "email the troubleshoot guide" vs. "walk through it on the phone"), do NOT penalize the agent for not following the leaf page\'s step list — they took a different documented path.',
    '- When you build the `playbook_steps` checklist, root it in the path the agent actually followed (per the linked parent\'s gate), not in the leaf page\'s steps unless the linked parent says that\'s the path the agent should have taken.',
    '- `hop=1` means the page links directly from a primary hit; higher hop numbers mean we walked further up the chain. Treat lower-hop pages as more directly relevant.',
    '- Cite linked pages by name like any other KB page in the narrative.',
    '',
    'Customer intent and process divergence (read FIRST — applies to every interaction, every form):',
    '- Before grading, identify the CUSTOMER\'S STATED INTENT in the earliest notes, transcript turns, customer-comment / additional-notes fields, attached email content, and ticket subject. The customer\'s intent — what they specifically asked for — determines WHICH process applies. The KB documents many processes (symptom-based troubleshooting playbooks, service-call requests, refund / credit handling, RMA / replacement, cancellation, escalation, status / billing inquiry, etc.). The playbook page assigned to the ticket is the DEFAULT for that symptom, not a mandatory ritual the agent must perform regardless of what the customer wants.',
    '- Forks in the road — common signals that divert the agent off the troubleshooting playbook onto a different documented path. This list is illustrative, not exhaustive — apply the principle generically:',
    '  - "I want a service call / send a tech / on-site visit" → service-call request process; no device troubleshooting.',
    '  - "I want a refund / credit / chargeback" → refund process.',
    '  - "I want a replacement / new device / send me another one" → RMA / warranty process.',
    '  - "I want to cancel / I\'m done / close my account" → cancellation process.',
    '  - "I just want a status update / where\'s my order / what\'s my balance" → information-only request.',
    '  - "I want a supervisor / escalate this" → escalation process.',
    '  - Customer rejects an offered troubleshooting step ("I don\'t have time for that", "I\'m not at the device", "just send someone") → either alternate-path (email-the-guide / schedule callback) or service-call, depending on what the agent did.',
    '  - Customer is asking about a DIFFERENT issue than the ticket symptom suggests → re-classify and grade against the actual path.',
    '- When customer intent diverts the agent off the troubleshooting playbook, GRADE AGAINST THE PATH THE CUSTOMER ASKED FOR — not against the troubleshooting playbook:',
    '  - In `playbook_steps[]`, do NOT enumerate the troubleshooting steps and mark them `missing` — that\'s the wrong rubric for this interaction. Either mark them `not_applicable` with the customer-intent explanation, OR build the array from the steps of the alternate process the agent should have followed (and did, if they followed it).',
    '  - In the narrative, use `Steps followed: Followed (alternate path)`. In the explanation, QUOTE the customer\'s stated intent (e.g. *"customer requested a service call per the Apr 23 \'Additional Notes\' field"*) and name the alternate process the agent followed (e.g. *"agent created the service-call request and assigned it to the on-site team"*).',
    '  - In the `Notes:` line, grade whether the agent ADEQUATELY DOCUMENTED the alternate path — what the customer asked for, what the agent did to honor it, any required tickets/escalations/handoffs, expected timeline given to the customer. Notes that just say *"confirmed and apologized"* without recording the customer\'s specific request and the action taken to honor it are `Incomplete` per "Documentation Policy". Do NOT grade `Notes:` against the troubleshooting playbook\'s documentation expectations — those don\'t apply.',
    '- Customer intent is rarely a single tidy sentence at the top of a ticket. Read EVERY note, transcript turn, customer-comment / additional-notes field, attached email body, and ticket header before grading. The intent often lives in:',
    '  - Free-text fields like "Additional Notes", "Customer Comments", "Subject", "Reason for Call".',
    '  - A directly quoted customer email or SMS inside a note.',
    '  - A transcript turn ("the customer said …").',
    '  - An implicit signal — the customer declined a step the agent offered, or the customer named the outcome they expected.',
    '- If the agent fails to recognize a customer-intent signal and walks the customer through troubleshooting anyway, that\'s a process-drift finding — emit a `process_drift` observation at `severity: "warn"` framed as *"agent should have honored the customer\'s stated request for X instead of running troubleshooting"* and downgrade `Steps followed` to `Incomplete` (the agent followed the wrong process).',
    '- If customer intent is genuinely AMBIGUOUS (customer mentions wanting it fixed AND wanting a service call), grade based on what the agent reasonably inferred and acted on, and call out the ambiguity as a `documentation` observation noting the agent could have clarified with the customer before choosing a path.',
    '',
    'Pictures and attachments (evidence layer):',
    '- Pictures the customer sends and attachments the agent collects (wiring photos, error-screen captures, equipment serial labels, ID-verification images, etc.) ARE EVIDENCE supporting the agent\'s troubleshooting and resolution. Treat them like notes when building the timeline — give the agent credit for collecting them.',
    '- The presence of a picture in the ticket that confirms the resolution (e.g. a wiring photo showing the RCA cable now in the CD Input as the agent instructed, or a screen capture showing the player connected to the internet) is positive evidence in the agent\'s favour and should be acknowledged in the narrative — usually under the `Resolution:` line as part of the explanation, or under `Notes:` if the picture closes a documentation gap.',
    '- A picture without a narrative caption explaining what it shows IS a small documentation gap — pictures are recorded evidence, but a downstream reviewer should not have to interpret them unaided. Flag uncaptioned-but-relevant photos under `Notes:` with text like "Apr 28 wiring photo attached but no narrative caption explaining what it confirms" — this is a documentation hygiene gap, NOT a process gap. Do NOT downgrade `Steps followed` over uncaptioned photos.',
    '- An expected picture that the agent requested but the customer never provided is a different finding — call that out under `Notes:` if the missing picture would have closed a meaningful evidence gap. If the issue resolved without the picture, do not penalize.',
    '- When a wiring/setup photo confirms the agent\'s diagnosis, treat the corresponding playbook step (e.g. "Request pictures of connections") as `done` with the photo attachment as the evidence anchor, even if the surrounding note is terse.',
    '',
    'Grading philosophy:',
    '- Be evidence-based. If the notes do not show a step happening, that step was not done — even if it would have been "obvious".',
    '- Reconstruct the interaction as one continuous chain along the audit chain above. Flag any missing chapter.',
    '- Before answering any process or step-completion question, build a chronological timeline by reading every note (or every line of the transcript) bottom-to-top to establish the order of events. Credit a step as COMPLETED whenever any earlier note documents it as done, even if a later note marks it No or N/A. Only grade an omission as a gap if no prior note documents the step.',
    '- If a question is "Did X follow process" and the KB describes the process, compare the notes to the KB. Penalize gaps.',
    '- AI graders have a known bias toward answering "yes" — be specific. If a "yes" verdict cannot be backed by a quote in `evidence_quote`, prefer "no" and say what is missing.',
    '',
    'Timeline (REQUIRED structured output):',
    '- You MUST emit the `timeline` array. Each item ties one note (or transcript line) to either a documented KB step (`kb_step`) or to a non-process action (`kb_step: null`).',
    '- This is what proves you actually traced the work. An empty or shallow timeline is a failure mode — if the source has notes, the timeline must reflect them.',
    '',
    'Advisory observations (REQUIRED but non-scored):',
    '- Beyond the scored questions, emit `observations` for things that don\'t move the score but a QA reviewer should know:',
    '  - cut-and-paste notes,',
    '  - vague descriptions that don\'t restate the customer\'s specific symptom in their words,',
    '  - follow-up cadence drift versus what the KB recommends,',
    '  - missing best practices,',
    '  - ambiguous next steps,',
    '  - PII captured in notes that shouldn\'t be.',
    '- Each observation has a `kind`, `severity` (info or warn), `message`, and `evidence` (which note date or which field this came from).',
    '- These are advisories. They do NOT affect the score. They surface in a separate panel for the QA reviewer.',
  ].join('\n');

  const packsBody = rulePackService.renderPacksForPrompt(input.form.id);
  const packsSection = packsBody
    ? '\n\nRULE PACKS ASSIGNED TO THIS FORM (apply each pack as authoritative for its subject area):' + packsBody
    : '';

  const guidanceBlock = (input.form.ai_review_guidance ?? '').trim();
  const guidanceSection = guidanceBlock
    ? '\n\nADDITIONAL FORM-SPECIFIC GRADING RULES (configured by the form author — apply these as strictly as the rules above):\n' + guidanceBlock
    : '';

  const formSummary = renderFormForPrompt(input.form);
  const headerLines = Object.entries(input.header)
    .filter(([, v]) => v && v.length > 0)
    .map(([k, v]) => `  ${k}: ${truncate(v, 400)}`)
    .join('\n');

  const noteLines = input.notes
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

  const isCall = input.adapterKind === 'CALL';
  const notesHeader = isCall
    ? 'CALL TRANSCRIPT (verbatim — read top-to-bottom for chronological order):'
    : 'INTERACTION NOTES (newest first — read bottom-to-top for chronological order):';

  const renderedNotes = isCall ? renderTranscriptBlock(input.notes) : noteLines;
  const fallback = isCall ? '  (no transcript)' : '  (no notes)';

  const correctionsSection = buildCorrectionsSection(input.corrections);

  const user = [
    `INTERACTION TYPE: ${input.adapterKind}`,
    '',
    'INTERACTION HEADER:',
    headerLines || '  (empty)',
    '',
    notesHeader,
    renderedNotes || fallback,
    '',
    kbHeader,
    kbBlock,
    '',
    'AUDIT FORM TO FILL OUT:',
    formSummary,
    '',
    'Now produce the JSON object as specified.',
  ].join('\n');

  return { system: system + packsSection + guidanceSection + correctionsSection, user };
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

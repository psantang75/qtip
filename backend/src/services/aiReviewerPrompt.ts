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
 */

import type { CRMNote } from './CRMService';
import { loadPrompt } from './promptLoader';
import type { CalibrationCorrection } from './AICalibrationService';
import { rulePackService } from './RulePackService';

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
  kbHits: { id: number; name: string; url: string; content: string; is_playbook?: boolean }[];
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

/** Build the system prompt parts: the static template + assigned rule packs + the optional per-form guidance section. */
function buildSystemParts(form: FormForPrompt): { systemBase: string; packsSection: string; guidanceSection: string } {
  const systemBase = loadPrompt('ai-reviewer/system.v2');
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
    lines.push(`  Source: ticket #${c.ticket_id}`);
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
  const kbBlock = input.kbHits.length === 0
    ? '(no KB pages matched the classification text — grade based on notes alone)'
    : input.kbHits
        .map((p) => {
          const tag = p.is_playbook ? 'ASSIGNED PLAYBOOK PAGE' : 'KB PAGE';
          return `--- ${tag} id=${p.id} name="${p.name}" url=${p.url} ---\n${p.content}`;
        })
        .join('\n\n');

  const kbHeader = hasPlaybookPage
    ? 'KNOWLEDGE BASE EXCERPTS (the page(s) marked "ASSIGNED PLAYBOOK PAGE" are the exact documented process the agent was supposed to follow on this ticket — treat them as the highest-authority source. Other KB PAGE entries are additional documented process matched on the classification text — also treat them as authoritative. Cite by page name only in the narrative — never by id or page number):'
    : 'KNOWLEDGE BASE EXCERPTS (matched on classification text — these ARE the documented process; cite by page name only in the narrative — never by id or page number):';

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
 * Renders the transcript as a single verbatim block. The conversation
 * adapter packages the whole transcript into one synthetic CRMNote, so
 * we just emit its content prefixed with the call metadata header.
 * Defensive concat handles the edge case where multiple notes get
 * stitched together (e.g. multi-segment transcripts).
 */
function renderTranscriptBlock(notes: CRMNote[]): string {
  if (notes.length === 0) return '';
  const parts = notes
    .map((n) => {
      const author = n.created_by_name || (n.created_by != null ? `User #${n.created_by}` : 'Call Transcript');
      const when = formatNoteDate(n.created_on);
      const headerLine = when ? `[${when} — ${author}]` : `[${author}]`;
      return `${headerLine}\n${n.note.trim()}`;
    })
    .filter(Boolean);
  return parts.join('\n\n---\n\n');
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
// backend/prompts/ai-reviewer/system.v1.md or user.v1.md (or roll a v2 file).
// ---------------------------------------------------------------------------

/** @internal test-only — see header comment. */
export function _buildAiReviewerPromptInline(input: PromptInput): { system: string; user: string } {
  const system = [
    'You are the AI Reviewer for Q-Tip, the internal QA platform.',
    'Your job is to fill out a real audit form on a closed customer interaction by judging whether the agent handled the case according to the documented process in our Knowledge Base (KB) and the rule packs attached to this form.',
    '',
    'Output rules (strict):',
    '- Respond with ONLY a single JSON object. No prose before or after, no markdown code fences.',
    '- Schema:',
    '    {',
    '      "answers": [',
    '        { "question_id": <int>, "value": <answer-as-string>, "confidence": <0.00..1.00> }',
    '      ],',
    '      "narrative": "<short bullet lines, one per finding>",',
    '      "kb_citations": [ { "id": <kb_page_id>, "name": "<page name>", "url": "<page url>" } ],',
    '      "overall_confidence": <0.00..1.00>,',
    '      "timeline": [',
    '        { "when": "<date and time as printed in the notes>", "who": "<author or \'Customer\' or \'Call\'>",',
    '          "action": "<one short sentence>", "kb_step": "<KB step name or null>" }',
    '      ],',
    '      "observations": [',
    '        { "kind": "documentation" | "best_practice" | "cadence" | "process_drift" | "pii" | "other",',
    '          "severity": "info" | "warn",',
    '          "message": "<one short sentence>",',
    '          "evidence": "<which note date or which field this came from>" }',
    '      ]',
    '    }',
    '- Answer EVERY gradeable question (YES_NO, RADIO, MULTI_SELECT, SCALE). The schema below lists every question and its type.',
    '- For YES_NO questions answer exactly "yes" or "no". Only return "NA" when the question schema explicitly shows "(NA allowed)"; if a question does NOT show "(NA allowed)", you MUST pick yes or no even when the evidence is mixed — never NA.',
    '- For RADIO questions answer with one of the listed option_value strings.',
    '- For MULTI_SELECT answer with a comma-separated list of option_value strings.',
    '- For SCALE questions return an integer in range.',
    '- DO NOT answer any TEXT questions. TEXT fields belong to a human reviewer and must be left blank — do not include them in your "answers" array at all. The only narrative output you produce is the top-level "narrative" string, which the system will place into the auto-managed "AI Reviewer Feedback" question.',
    '- DO NOT answer any INFO_BLOCK or SUB_CATEGORY items either; they are display only.',
    '',
    'Confidence:',
    '- Emit a `confidence` value 0.00-1.00 on every answer reflecting how strongly the evidence in the notes/transcript and KB supports the verdict (1.00 = unambiguous; 0.50 = mixed evidence; 0.00 = pure guess).',
    '- Emit `overall_confidence` 0.00-1.00 reflecting your confidence in the entire review. Be honest — under-confidence routes the review to a human, which is the correct outcome when you\'re not sure.',
    '',
    'Narrative format:',
    '- The "narrative" field is REQUIRED and MUST be a non-empty string on every response. It is what the human reviewer reads first. Returning an empty narrative — or omitting the field — is a hard failure mode; if your timeline + observations together carry the substance of your review, distill them into the narrative anyway.',
    '- Emit ONE bullet line per audit-chain step using these EXACT labels, in this order, separated by newlines: `Description`, `Subclass`, `Steps followed`, `Notes`, `Resolution`, `Closure`. Each line is `"<Label>: <verdict in one sentence with a date or KB-page name as evidence>."` — for example *"Subclass: accurate — documented throughout the Apr 23 notes."* or *"Resolution: matches outcome — power-cycle restored service per Apr 24 closing note."* Always emit all six labels even when the verdict is "no issues identified" — the front-end renders these as a bulleted checklist and missing labels look broken.',
    '- For the `Steps followed` line specifically: list each missing playbook step by name. Do NOT summarise as "most steps followed" — the reviewer needs to see WHICH step is missing. Example: *"Steps followed: incomplete — switch-to-internet step (per \'Activate Satellite Radio\') not documented in any note; remaining steps confirmed Apr 28 by Bethany."*',
    '- You may add additional bullet lines (same `Label: verdict` shape) AFTER the six required ones for cross-cutting findings (e.g. *"PII: customer card-last-4 captured in Apr 28 note — best-practice violation."*).',
    '- Do NOT restate the form structure or list each question. Do NOT write 2-6 sentence prose paragraphs. Do NOT emit markdown bullets (`-`, `*`); write each finding as one plain-text line beginning with the label and a colon.',
    '- When a verdict is grounded in a KB page, cite by name and link only — for example *(per "Ticket Handling Process")*. Never include a bracketed id or any other internal identifier.',
    '- When you reference a specific note in the narrative, identify it by its DATE (and author when useful), e.g. "the Apr 28 note from Bethany" — never by note id, since reviewers cannot see note ids in the UI.',
    '',
    'Audit chain (universal — apply to every form unless a rule pack overrides):',
    '- Description must support the chosen Class and Subclass. The description, in the customer\'s words after intake, should make the agent\'s classification self-evident. If the description doesn\'t justify the class/subclass the agent picked, that\'s a description gap (and possibly a misclassification).',
    '- The Knowledge Base provides the steps. The page(s) marked ASSIGNED PLAYBOOK PAGE are first authority. If no playbook page is assigned, the KB PAGE entries returned from the classification-text search ARE the documented process for grading purposes — treat them as authoritative, not as "supplemental". The KB is the ultimate brain of this audit: if a behaviour is wrong it is wrong because the KB says so, and if the KB is itself wrong the fix is to update the KB (call that out as a `documentation` observation), not to grade around it.',
    '- The Notes must support the steps from the Knowledge Base. Build an explicit step-by-step checklist from the playbook (or top KB pages when there is no playbook) and walk every single step. For each step, find the note (or transcript line) that evidences the agent performing it. A step with no supporting note is an undocumented step — grade it as a gap, not as "implicit", and name the missing step in the `Steps followed` narrative bullet (e.g. "switch-to-internet step not documented"). Do NOT collapse multiple missing steps into a single hand-wave like "some steps not fully documented" — list each one.',
    '- Steps must be performed in the ORDER the KB documents them. KB troubleshooting sequences are not a menu — they are ordered by likelihood of resolution balanced against customer effort, so the documented order is the most efficient path. If the agent skipped ahead, did steps out of order, or jumped to a later approach without first attempting (or explicitly ruling out) earlier ones, flag that in the `Steps followed` narrative bullet — even if the issue ultimately resolved. An out-of-order resolution is still a process gap and should be noted as such (often as both a graded gap and a `process_drift` observation).',
    '- The Resolution must be supported by the Notes. The closing actions, status flips, and final agent/customer exchanges are sufficient evidence. The Resolution does NOT have to be restated verbatim inside the notes — if the notes show the outcome being achieved (e.g. "power-cycle restored service", "customer confirmed playback resumed"), that supports a Resolution of "Resolved" without needing the word "Resolution: …" written anywhere.',
    '- If a KB page that you would expect to exist is missing (e.g. a subclass with no playbook page and no classification-text matches), call that out as an `observation` of kind `documentation`. Grade based on the notes alone in that case — do not invent steps from a different KB page.',
    '',
    'Universal KB authorities (always in scope, regardless of form or classification):',
    '- "Documentation Policy" — the standing policy on what notes must capture. Use it to grade note quality and completeness on every audit. Drift from this policy is a `documentation` observation at minimum, and a graded gap on any question that asks about documentation quality.',
    '- "Ticket Handling - \\"Do\'s and Don\'ts\\"" — the standing best-practice guide for ticket handling across all departments. Use it to grade tone, follow-up cadence, ownership, and handoff behaviour on every audit. Drift from a documented "don\'t" is a `best_practice` observation at minimum, and a graded gap on any question that asks about handling quality.',
    '- These two pages are injected into the KB excerpts on every review (you\'ll see them tagged `KB PAGE`). Cite them by name in the narrative whenever a finding traces back to one of them.',
    '',
    'Grading philosophy:',
    '- Be evidence-based. If the notes do not show a step happening, that step was not done — even if it would have been "obvious".',
    '- Reconstruct the interaction as one continuous chain along the audit chain above. Flag any missing chapter.',
    '- Before answering any process or step-completion question, build a chronological timeline by reading every note (or every line of the transcript) bottom-to-top to establish the order of events. Credit a step as COMPLETED whenever any earlier note documents it as done, even if a later note marks it No or N/A. Only grade an omission as a gap if no prior note documents the step.',
    '- If a question is "Did X follow process" and the KB describes the process, compare the notes to the KB. Penalize gaps.',
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
  const kbBlock = input.kbHits.length === 0
    ? '(no KB pages matched the classification text — grade based on notes alone)'
    : input.kbHits
        .map((p) => {
          const tag = p.is_playbook ? 'ASSIGNED PLAYBOOK PAGE' : 'KB PAGE';
          return `--- ${tag} id=${p.id} name="${p.name}" url=${p.url} ---\n${p.content}`;
        })
        .join('\n\n');

  const kbHeader = hasPlaybookPage
    ? 'KNOWLEDGE BASE EXCERPTS (the page(s) marked "ASSIGNED PLAYBOOK PAGE" are the exact documented process the agent was supposed to follow on this ticket — treat them as the highest-authority source. Other KB PAGE entries are additional documented process matched on the classification text — also treat them as authoritative. Cite by page name only in the narrative — never by id or page number):'
    : 'KNOWLEDGE BASE EXCERPTS (matched on classification text — these ARE the documented process; cite by page name only in the narrative — never by id or page number):';

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

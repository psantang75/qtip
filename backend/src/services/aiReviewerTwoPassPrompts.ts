/**
 * Phase C (C3): two-pass prompt builders for the AI Reviewer.
 *
 * Pass 1 (trace pass, runs on Sonnet) ingests ONE source's
 *   header + notes/transcript + KB excerpts and emits a structured
 *   trace (playbook_steps + timeline + observations + extracted_claims).
 *   The trace is intentionally neutral — it does NOT answer the audit
 *   form's questions. Pass 2 does. The trace system prompt is the
 *   DB-managed `ai_base_prompt` row with `prompt_kind = 'trace'`.
 *
 * Pass 2 (synthesis pass, runs on Opus) takes the form spec, all
 *   per-source traces, the rule packs, and the learned corrections and
 *   produces the final answers + narrative + coaching + faithfulness.
 *   Its system prompt is the DB-managed `ai_base_prompt` row with
 *   `prompt_kind = 'base'` plus the synthesis addendum appended in
 *   `aiReviewerPromptAddenda.ts`.
 *
 * Why two passes:
 *   - Single-pass reviews can't reliably do faithfulness checks
 *     (call vs ticket-notes) because the model's attention budget is
 *     spent on tracing instead of cross-referencing.
 *   - Cheap Sonnet can do the labour-intensive trace work; expensive
 *     Opus only sees the *summarized* per-source view, which keeps
 *     the synthesis prompt small and the cost reasonable even on
 *     multi-source cases.
 *   - The trace is also a useful artifact in its own right (eval
 *     traces, UI debugging) regardless of whether the synthesis pass
 *     runs.
 *
 * This module lives next to aiReviewerPrompt.ts (the single-source
 * compatibility shim) and shares its `FormForPrompt` shape so callers
 * can build either flavour without re-shaping the form.
 */

import type { CRMNote } from './CRMService';
import type { CalibrationCorrection } from './AICalibrationService';
import { rulePackService } from './RulePackService';
import { basePromptService } from './BasePromptService';
import type { FormForPrompt } from './aiReviewerPrompt';
import { loadFormRubrics } from './aiReviewerPrompt';
import type { CasePivot } from './aiReviewerPivotDetector';
import type { TraceAgreement } from './aiReviewerTraceVoting';
import { renderTranscriptBlock } from './transcriptRender';
import type { ParsedProcedure } from './kbProcedureParser';
import { renderKbProcedureBlock } from './kbProcedureParser';

export type SourceKind = 'TICKET' | 'TASK' | 'CALL';

export interface TracePromptInput {
  form: FormForPrompt;
  /** The kind of source this trace describes. */
  sourceKind: SourceKind;
  /** The external id (string for CALL, stringified int for TICKET/TASK). */
  sourceId: string;
  /** Flattened header rows for the source. */
  header: Record<string, string>;
  /** Notes (TICKET / TASK) or rendered transcript turns (CALL). */
  notes: CRMNote[];
  /**
   * KB excerpts already filtered to what this source's classification
   * needs. Phase D (D3) populates `playbook_steps` from
   * `kb_pages_meta` so the trace prompt can inject the canonical step
   * list directly instead of asking the model to rederive it from the
   * page body.
   */
  kbHits: {
    id: number;
    name: string;
    url: string;
    content: string;
    is_playbook?: boolean;
    playbook_steps?: string[] | null;
    /**
     * Phase F (F3): parsed Approach + chain structure for Tech-Support
     * style pages, derived from the page body at crawl time and
     * persisted into `kb_pages_meta.qtip_steps`. When present, the
     * trace builder emits a deterministic KB PROCEDURE block alongside
     * the raw page body so the model doesn't have to re-infer step
     * structure from prose. Absent for pages whose body doesn't fit
     * the `Approach N` skeleton (those keep today's body-only
     * rendering with no regression).
     */
    procedure?: ParsedProcedure | null;
    /**
     * KB link expansion: when this page was pulled in by following an
     * in-body hyperlink from another KB page in the search results,
     * the trace prompt tags it as a `LINKED KB PAGE` so the per-source
     * pass treats it as parent / sibling decision-flow context rather
     * than a primary search hit.
     */
    linked_from?: { name: string; url: string; hop: number };
  }[];
}

export interface SynthesisPromptInput {
  form: FormForPrompt;
  /**
   * Pass-1 trace JSON for each source on the case, primary first. Each
   * element is the raw JSON STRING produced by Pass 1 — the synthesis
   * model parses it back, so we don't shape it here. Letting the model
   * see the literal JSON also keeps the per-source verdict / quote
   * field names visible.
   */
  traces: Array<{
    sourceKind: SourceKind;
    sourceId: string;
    /** Raw JSON string returned by Pass 1 for this source. */
    traceJson: string;
    /**
     * Per-source flat header (Contact, Device Type, Site, Assigned To, ...).
     * Surfaced into Pass-2 / chunked Pass-2B prompts so cross-source grading
     * questions can quote raw header values instead of guessing from
     * `traceJson`. Pass-1 traces already render the same header to the
     * trace model, but the trace JSON does not preserve those values, so
     * Pass-2 was previously blind to them.
     */
    header?: Record<string, string>;
  }>;
  /** Same shape used by the single-source builder. */
  corrections?: CalibrationCorrection[];
  /**
   * Phase E (pivot detector): topical pivots identified by the
   * combined-source pre-pass. When present, rendered as a CASE PIVOTS
   * block in the user message so the synthesis model treats each
   * pivot as a grading lens (e.g. an "Install Refund" pivot reminds
   * the model to grade against install-refund process steps in
   * addition to the bare refund flow). Absent / empty for back-compat
   * with single-source paths that don't run the detector.
   */
  pivots?: CasePivot[];
  /**
   * Tier-1 N-sample trace voting (Item 1): cross-run agreement scores
   * for each per-source trace. Rendered as a TRACE AGREEMENT block in
   * the user message — the synthesis prompt anchors `overall_confidence`
   * within +/- 0.10 of the LOWEST source's composite, so the model can
   * never report higher confidence in its final answer than the trace
   * pass had in its own reasoning. Absent when N-sample voting is
   * disabled (AI_REVIEWER_TRACE_SAMPLES=1) or for back-compat on
   * single-source paths.
   */
  traceAgreements?: TraceAgreement[];
  /**
   * KB anchors loaded for this case (Workstream B2). Pass-1 trace sees
   * the full KB page bodies; Pass-2 synthesis previously only saw the
   * trace JSON, so if Pass 1 under-cited KB the synthesis had no
   * recovery path and fell back to ticket notes as the de-facto
   * playbook. This block surfaces the name + url + playbook flag of
   * every KB page that was actually attached to the case so the KB-NA
   * rule in the synthesis addendum can fire deterministically when
   * `kbAnchors` is empty (or missing the topic the question is about).
   * Caller passes a flat dedup list across all sources.
   */
  kbAnchors?: Array<{ url: string; name: string; is_playbook: boolean }>;
  /**
   * Phase F (F3): parsed KB PROCEDURE blocks for every attached KB
   * page whose body fits the Tech-Support `Approach N` skeleton. Same
   * shape as the parser output. Rendered in the reasoning prompt so
   * Pass 2A sees the same authoritative procedure data that Pass 1's
   * trace pass saw — without this, the trace pass could correctly
   * grade against the parsed structure but the reasoning pass would
   * have to re-derive it from the trace JSON's free-text playbook
   * steps. Caller passes a flat dedup list (by `pageUrl`) across all
   * sources.
   */
  kbProcedures?: Array<{ pageName: string; pageUrl: string; procedure: ParsedProcedure }>;
}

/**
 * Build the system + user pair for Pass 1 (per-source trace).
 *
 * The system prompt is the infrastructure-managed Trace prompt
 * (kind='trace' in `ai_base_prompt`, hidden from the Library UI) plus
 * the form's rule packs (the same packs the synthesis pass will see)
 * so the trace surfaces playbook steps that match the rule pack's
 * expectations. No corrections are injected here — corrections teach
 * answers, and Pass 1 doesn't answer.
 */
export function buildTracePrompt(input: TracePromptInput): { system: string; user: string } {
  const systemBase = basePromptService.getBaseForKind('trace').body;
  const packsBody = rulePackService.renderPacksForPrompt(input.form.id);
  const packsSection = packsBody
    ? '\n\nRULE PACKS ASSIGNED TO THIS FORM (use them to know which playbook steps matter for this source):' + packsBody
    : '';
  const guidanceBlock = (input.form.ai_review_guidance ?? '').trim();
  const guidanceSection = guidanceBlock
    ? '\n\nADDITIONAL FORM-SPECIFIC GRADING RULES (extract relevant evidence into the trace, but DO NOT answer questions on this pass):\n' + guidanceBlock
    : '';

  const headerLines = Object.entries(input.header)
    .filter(([, v]) => v != null && String(v).trim().length > 0)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  // Workstream D1: CALL transcripts use the same speaker-flow parser
  // as the single-source path so the same CRMNote renders identically
  // in both pipelines. Non-CALL sources keep the simpler raw-text
  // rendering (ticket / task notes don't carry structured turn JSON).
  const renderedNotes =
    input.sourceKind === 'CALL'
      ? renderTranscriptBlock(input.notes)
      : input.notes
          .map((n) => {
            const when = n.created_on ?? '';
            const who = n.created_by_name ?? (n.created_by != null ? `User #${n.created_by}` : '');
            const headLine = `[${when || 'unknown date'}${who ? ` — ${who}` : ''}]`;
            return `${headLine}\n${n.note ?? ''}`;
          })
          .join('\n\n---\n\n');

  const kbBlock = input.kbHits
    .map((h) => {
      let tag: string;
      if (h.is_playbook) {
        tag = 'ASSIGNED PLAYBOOK PAGE';
      } else if (h.linked_from) {
        tag = `LINKED KB PAGE (linked from "${h.linked_from.name}", hop=${h.linked_from.hop})`;
      } else {
        tag = 'KB PAGE';
      }
      // Phase F (F3): when this page has a parsed Approach structure,
      // emit the deterministic KB PROCEDURE block BEFORE the raw page
      // body so the model sees the canonical step + chain summary
      // first. Raw body still follows for author commentary, hyperlinks,
      // and any narrative the parser doesn't capture.
      const procedureBlock = h.procedure
        ? renderKbProcedureBlock(h.procedure, h.name, h.url) + '\n\n'
        : '';
      return `${tag}: ${h.name} (${h.url})\n${procedureBlock}${h.content}`;
    })
    .join('\n\n---\n\n');

  // Phase D (D3): emit pre-extracted playbook step lists separately so
  // the model uses the canonical step names verbatim instead of trying
  // to parse them out of the page body. Only pages that have been
  // tagged with a `Steps` section / `qtip_steps` front-matter show up
  // here — other pages still fall through to the body-based KB block.
  const prefabSteps = input.kbHits
    .filter((h) => Array.isArray(h.playbook_steps) && h.playbook_steps!.length > 0)
    .map((h) => {
      const ordered = h.playbook_steps!.map((s, i) => `  ${i + 1}. ${s}`).join('\n');
      return `From "${h.name}" (${h.url}):\n${ordered}`;
    })
    .join('\n\n');

  const user = [
    `SOURCE_KIND: ${input.sourceKind}`,
    `SOURCE_ID: ${input.sourceId}`,
    '',
    'HEADER:',
    headerLines || '(none)',
    '',
    // Workstream D2: SQL is ORDER BY CreatedOn DESC, so the first note
    // in `input.notes` is the NEWEST. Single-source path already says
    // "newest first — read bottom-to-top"; trace pass previously lied
    // and said "oldest first," leading the model to misread the
    // chronological order.
    input.sourceKind === 'CALL'
      ? 'CALL TRANSCRIPT (turn-by-turn):'
      : 'NOTES (newest first — read bottom-to-top for chronological order):',
    renderedNotes || '(none)',
    '',
    'KB EXCERPTS:',
    kbBlock || '(none — no KB pages matched this source\'s classification)',
    ...(prefabSteps
      ? [
          '',
          'PREFAB PLAYBOOK STEPS (use these step NAMES verbatim in playbook_steps[].step; do NOT paraphrase):',
          prefabSteps,
        ]
      : []),
    '',
    'FORM CONTEXT (use to pick which playbook steps and observations matter — do NOT answer the form on this pass):',
    `Form: ${input.form.form_name} (interaction_type=${input.form.interaction_type})`,
  ].join('\n');

  return { system: systemBase + packsSection + guidanceSection, user };
}

/**
 * Reasoning artefacts produced by Pass 2A (chunked synthesis pipeline).
 * Used as authoritative grading context for each Pass-2B answer chunk.
 * The shape mirrors the relevant fields of the monolithic synthesis
 * output minus `answers[]`, so the assembler can re-attach answers
 * from the chunked outputs and produce a single object indistinguishable
 * from the legacy synthesis result.
 */
export interface ChunkedReasoningInput {
  /** JSON string from the reasoning pass (Pass 2A). Embedded raw so the
   *  chunked pass sees the exact field names + nesting it must defer to. */
  reasoningJson: string;
}

/** A single per-question draft verdict parsed from the reasoning pass output. */
export interface DraftAnswer {
  question_id: number;
  verdict: 'yes' | 'no' | 'na';
  brief_rationale: string;
  evidence_pointer?: {
    source_kind?: string;
    source_id?: string;
    where?: string;
  };
}

/** Input for one Pass-2B chunk: a single form category's worth of questions. */
export interface AnswerChunkPromptInput {
  form: FormForPrompt;
  /** Category key — used in logs / errors. Free-form. */
  categoryName: string;
  /** Question ids the model must answer on this chunk. Pulled from
   *  form.questions filtered by category, gradeable types only. */
  questionIds: number[];
  /** The reasoning pass's output, embedded verbatim. */
  reasoning: ChunkedReasoningInput;
  /**
   * Draft verdicts from the reasoning pass — ONE per question_id in this
   * chunk. Surfaced into the user prompt as a `DRAFT VERDICTS FROM
   * REASONING` block so the chunk model has the source-of-truth verdict
   * to confirm + attach evidence to (or, rarely, flag dissent on).
   * Optional only so the test/legacy paths that haven't been updated
   * can still build a prompt; in production it MUST be populated.
   */
  draftAnswers?: DraftAnswer[];
  /** Same trace blocks the synthesis pass receives, primary first. */
  traces: SynthesisPromptInput['traces'];
  /** Same as the monolithic synthesis pass. */
  corrections?: CalibrationCorrection[];
  pivots?: CasePivot[];
  traceAgreements?: TraceAgreement[];
  /** Same KB anchors block surfaced to the synthesis / reasoning passes (B2). */
  kbAnchors?: SynthesisPromptInput['kbAnchors'];
}

/**
 * Build the system + user pair for Pass 2 (cross-source synthesis).
 *
 * The system prompt is the universal Base prompt PLUS the synthesis
 * pass addendum (input shape — PER-SOURCE TRACES — plus the
 * cross-source output schema with `evidence_source_kind`/`id`,
 * `faithfulness`, and the trace-agreement confidence ceiling). The
 * same Base body is used by the single-source pipeline; only the
 * appended addendum differs per pass. The form's rule packs,
 * form-specific grading rules, and learned corrections are appended
 * after the system prompt — the same three sections the single-source
 * shim injects. Pass 2 sees every per-source trace JSON in the user
 * message; the model reads them as the source of truth and produces
 * the final answers.
 */
export function buildSynthesisPrompt(input: SynthesisPromptInput): { system: string; user: string } {
  const systemBase = basePromptService.getAssembledPrompt('synthesis', input.form?.ai_base_prompt_id ?? null).body;
  const packsBody = rulePackService.renderPacksForPrompt(input.form.id);
  const packsSection = packsBody
    ? '\n\nRULE PACKS ASSIGNED TO THIS FORM (apply each pack as authoritative for its subject area):' + packsBody
    : '';
  const guidanceBlock = (input.form.ai_review_guidance ?? '').trim();
  const guidanceSection = guidanceBlock
    ? '\n\nADDITIONAL FORM-SPECIFIC GRADING RULES (configured by the form author — apply these as strictly as the rules above):\n' + guidanceBlock
    : '';
  const correctionsSection = renderCorrections(input.corrections);

  const formSpec = renderFormSpec(input.form);
  const traceBlocks = input.traces
    .map((t, i) => {
      const role = i === 0 ? 'PRIMARY' : 'ATTACHED';
      const headerLines = Object.entries(t.header ?? {})
        .filter(([, v]) => v && v.length > 0)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n');
      return [
        '--- SOURCE TRACE ---',
        `ROLE: ${role}`,
        `SOURCE_KIND: ${t.sourceKind}`,
        `SOURCE_ID: ${t.sourceId}`,
        ...(headerLines ? ['HEADER:', headerLines] : []),
        'TRACE_JSON:',
        t.traceJson,
      ].join('\n');
    })
    .join('\n\n');

  const pivotsBlock = renderPivots(input.pivots);
  const agreementBlock = renderTraceAgreement(input.traceAgreements);
  const kbAnchorsBlock = renderKbAnchors(input.kbAnchors);
  const proceduresBlock = renderKbProcedures(input.kbProcedures);

  const user = [
    'FORM SPEC:',
    formSpec,
    ...(pivotsBlock ? ['', pivotsBlock] : []),
    '',
    kbAnchorsBlock,
    ...(proceduresBlock ? ['', proceduresBlock] : []),
    ...(agreementBlock ? ['', agreementBlock] : []),
    '',
    'PER-SOURCE TRACES (primary first; each block is the raw Pass-1 JSON):',
    traceBlocks || '(no traces — return overall_confidence: 0 and explain in the narrative)',
  ].join('\n');

  return {
    system: systemBase + packsSection + guidanceSection + correctionsSection,
    user,
  };
}

/**
 * Build Pass 2A of the chunked synthesis pipeline: the REASONING pass.
 *
 * Same scaffolding as `buildSynthesisPrompt` (rule packs, form
 * guidance, learned corrections, form spec, traces, pivots, trace
 * agreement) — the model needs the full context to reason about the
 * case. The differences are:
 *   - System prompt uses the 'reasoning' addendum, which OMITS the
 *     `answers[]` schema and explicitly tells the model not to emit
 *     answers (a separate pass per category will do that).
 *   - The form spec is still rendered in full so the model
 *     understands what kinds of questions need to be graded — that
 *     context shapes the granularity of the timeline / observations
 *     it produces.
 *
 * Output is consumed by `buildAnswerChunkPrompt` as authoritative
 * grading context.
 */
export function buildReasoningPrompt(input: SynthesisPromptInput): { system: string; user: string } {
  const systemBase = basePromptService.getAssembledPrompt('reasoning', input.form?.ai_base_prompt_id ?? null).body;
  const packsBody = rulePackService.renderPacksForPrompt(input.form.id);
  const packsSection = packsBody
    ? '\n\nRULE PACKS ASSIGNED TO THIS FORM (apply each pack as authoritative for its subject area):' + packsBody
    : '';
  const guidanceBlock = (input.form.ai_review_guidance ?? '').trim();
  const guidanceSection = guidanceBlock
    ? '\n\nADDITIONAL FORM-SPECIFIC GRADING RULES (configured by the form author — apply these as strictly as the rules above):\n' + guidanceBlock
    : '';
  const correctionsSection = renderCorrections(input.corrections);

  const formSpec = renderFormSpec(input.form);
  const traceBlocks = input.traces
    .map((t, i) => {
      const role = i === 0 ? 'PRIMARY' : 'ATTACHED';
      const headerLines = Object.entries(t.header ?? {})
        .filter(([, v]) => v && v.length > 0)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n');
      return [
        '--- SOURCE TRACE ---',
        `ROLE: ${role}`,
        `SOURCE_KIND: ${t.sourceKind}`,
        `SOURCE_ID: ${t.sourceId}`,
        ...(headerLines ? ['HEADER:', headerLines] : []),
        'TRACE_JSON:',
        t.traceJson,
      ].join('\n');
    })
    .join('\n\n');

  const pivotsBlock = renderPivots(input.pivots);
  const agreementBlock = renderTraceAgreement(input.traceAgreements);
  const kbAnchorsBlock = renderKbAnchors(input.kbAnchors);
  const proceduresBlock = renderKbProcedures(input.kbProcedures);

  const user = [
    'FORM SPEC (the questions you must grade — emit one `draft_answers` entry for EVERY gradeable question_id; rubrics are authoritative):',
    formSpec,
    ...(pivotsBlock ? ['', pivotsBlock] : []),
    '',
    kbAnchorsBlock,
    ...(proceduresBlock ? ['', proceduresBlock] : []),
    ...(agreementBlock ? ['', agreementBlock] : []),
    '',
    'PER-SOURCE TRACES (primary first; each block is the raw Pass-1 JSON):',
    traceBlocks || '(no traces — return overall_confidence: 0 and explain in the narrative)',
  ].join('\n');

  return {
    system: systemBase + packsSection + guidanceSection + correctionsSection,
    user,
  };
}

/**
 * Build Pass 2B of the chunked synthesis pipeline: ONE answer chunk
 * for ONE form category. Runs in parallel with the other categories
 * on Sonnet (~3-5x faster than Opus, ~5x cheaper).
 *
 * The chunk's user prompt carries:
 *   - REASONING ARTEFACTS (raw JSON from Pass 2A) as authoritative
 *     grading context. The model is told to defer to it.
 *   - The PER-SOURCE TRACES block for verbatim evidence quotes.
 *   - Optional CASE PIVOTS / TRACE AGREEMENT context (mirrors the
 *     reasoning pass).
 *   - The CATEGORY's form spec slice (questions filtered to this
 *     category only — keeps each chunk small and focused).
 *   - An ALLOWED QUESTION IDS list — the addendum tells the model
 *     to answer EVERY listed id and ONLY those ids.
 *
 * The system prompt uses the 'answers_chunk' addendum, which restricts
 * output to {answers: [...]} and forbids re-emitting reasoning
 * artefacts (the assembler already has them from Pass 2A).
 */
export function buildAnswerChunkPrompt(input: AnswerChunkPromptInput): { system: string; user: string } {
  const systemBase = basePromptService.getAssembledPrompt('answers_chunk', input.form?.ai_base_prompt_id ?? null).body;
  const packsBody = rulePackService.renderPacksForPrompt(input.form.id);
  const packsSection = packsBody
    ? '\n\nRULE PACKS ASSIGNED TO THIS FORM (apply each pack as authoritative for its subject area):' + packsBody
    : '';
  const guidanceBlock = (input.form.ai_review_guidance ?? '').trim();
  const guidanceSection = guidanceBlock
    ? '\n\nADDITIONAL FORM-SPECIFIC GRADING RULES (configured by the form author — apply these as strictly as the rules above):\n' + guidanceBlock
    : '';
  const correctionsSection = renderCorrections(input.corrections);

  // Slice the form spec to just this category's gradeable questions.
  // We render the full form's questions so the per-question rubrics
  // and option lists keep the same shape, but filter by id.
  const allowedSet = new Set(input.questionIds);
  const slicedForm: FormForPrompt = {
    ...input.form,
    questions: input.form.questions.filter((q) => allowedSet.has(q.id)),
  };
  const categorySpec = renderFormSpec(slicedForm);

  const traceBlocks = input.traces
    .map((t, i) => {
      const role = i === 0 ? 'PRIMARY' : 'ATTACHED';
      const headerLines = Object.entries(t.header ?? {})
        .filter(([, v]) => v && v.length > 0)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n');
      return [
        '--- SOURCE TRACE ---',
        `ROLE: ${role}`,
        `SOURCE_KIND: ${t.sourceKind}`,
        `SOURCE_ID: ${t.sourceId}`,
        ...(headerLines ? ['HEADER:', headerLines] : []),
        'TRACE_JSON:',
        t.traceJson,
      ].join('\n');
    })
    .join('\n\n');

  const pivotsBlock = renderPivots(input.pivots);
  const agreementBlock = renderTraceAgreement(input.traceAgreements);
  const kbAnchorsBlock = renderKbAnchors(input.kbAnchors);

  const draftsBlock = renderDraftAnswersBlock(input.draftAnswers, input.questionIds);

  const user = [
    `CHUNK: category="${input.categoryName}" — attach evidence to the DRAFT VERDICTS below; flag dissent ONLY when the rubric+evidence clearly contradicts the draft.`,
    '',
    `ALLOWED QUESTION IDS (emit one answer for every one of these; emit nothing for ids outside the list): ${input.questionIds.join(', ')}`,
    '',
    draftsBlock,
    '',
    'CATEGORY FORM SPEC (per-question rubrics are the contract you check the draft against):',
    categorySpec,
    ...(pivotsBlock ? ['', pivotsBlock] : []),
    '',
    kbAnchorsBlock,
    ...(agreementBlock ? ['', agreementBlock] : []),
    '',
    'REASONING ARTEFACTS (full reasoning JSON — context for the drafts above; the drafts ARE the source of truth, not this block):',
    input.reasoning.reasoningJson,
    '',
    'PER-SOURCE TRACES (primary first; each block is the raw Pass-1 JSON — use these for verbatim evidence_quote values):',
    traceBlocks || '(no traces)',
  ].join('\n');

  return {
    system: systemBase + packsSection + guidanceSection + correctionsSection,
    user,
  };
}

/**
 * Group a form's gradeable question_ids by category. Used by the
 * orchestrator to fan out one Pass-2B call per category. TEXT,
 * INFO_BLOCK, SUB_CATEGORY questions are skipped (they are
 * non-gradeable display-only items or human-only commentary).
 *
 * Categories with no gradeable questions are omitted — no LLM call
 * is needed for them. Order is preserved (matches form definition
 * order) so logs / cost reports are stable across runs.
 */
export function groupGradeableQuestionsByCategory(
  form: FormForPrompt
): { category: string; questionIds: number[] }[] {
  const order: string[] = [];
  const byCategory = new Map<string, number[]>();
  for (const q of form.questions) {
    const type = (q.question_type ?? '').toUpperCase();
    if (type === 'TEXT' || type === 'INFO_BLOCK' || type === 'SUB_CATEGORY') continue;
    // ROLLUP questions are auto-derived; don't include them in any
    // chunk, and don't even create a chunk for a category that only
    // contains ROLLUPs (the engine handles it post-scoring).
    if (q.role === 'ROLLUP') continue;
    const cat = q.category_name || '(uncategorized)';
    if (!byCategory.has(cat)) {
      byCategory.set(cat, []);
      order.push(cat);
    }
    byCategory.get(cat)!.push(q.id);
  }
  return order.map((category) => ({ category, questionIds: byCategory.get(category)! }));
}

/**
 * Render the form's gradeable questions in a compact, model-friendly
 * spec. Mirrors the shape used by user.v1 in the single-source path so
 * the synthesis model sees the same question contract. When a per-
 * question rubric is defined for the form (Tier-2 Item 6), append it
 * as an indented `RUBRIC:` block right after the question line so the
 * grader gets the explicit pass/fail rules instead of having to
 * invent its own bar.
 */
function renderFormSpec(form: FormForPrompt): string {
  const rubrics = loadFormRubrics(form.id);
  const lines: string[] = [];
  for (const q of form.questions) {
    const type = (q.question_type ?? '').toUpperCase();
    if (type === 'TEXT' || type === 'INFO_BLOCK' || type === 'SUB_CATEGORY') continue;
    // Skip ROLLUP rows here too - they are auto-derived by the rollup
    // engine and would be overwritten on persist by SubmissionService.
    if (q.role === 'ROLLUP') continue;
    const naFlag = q.is_na_allowed ? ' (NA allowed)' : '';
    let optionsLabel = '';
    if (type === 'RADIO' || type === 'MULTI_SELECT') {
      // Render BOTH the option_value AND the human label so the model
      // has natural-language anchors to match against the question text.
      // Authors often use opaque values like "1"/"2" with meaningful
      // labels ("Inbound"/"Outbound") - rendering only the values
      // leaves the LLM guessing and biased toward yes/no. The answer
      // mapper accepts either form back (case-insensitive) and
      // normalises to option_value on persist.
      const opts = (q.radio_options ?? [])
        .filter((o) => o.value)
        .map((o) => (o.text ? `${o.value} ("${o.text}")` : o.value))
        .join(' | ');
      if (opts) optionsLabel = ` options=[${opts}]`;
    }
    lines.push(
      `q${q.id} [${type}${naFlag}]${optionsLabel} (category="${q.category_name}"): ${q.question_text}`
    );
    const rubric = rubrics.get(q.id);
    if (rubric) {
      lines.push('   RUBRIC:');
      // Indent each rubric line by 3 spaces so the block is visually
      // grouped with its question. Trim trailing whitespace per line
      // so the prompt stays tight.
      for (const line of rubric.split('\n')) {
        lines.push(`   ${line.replace(/\s+$/, '')}`);
      }
    }
  }
  return lines.join('\n');
}

/**
 * Render the pivot detector's findings as a CASE PIVOTS block. The
 * synthesis system prompt already tells the model to treat each pivot
 * as a grading lens — this block is what gives it the labels and the
 * one-sentence rationale per pivot.
 */
/**
 * Render the KB anchors block (Workstream B2). Lists the name + URL +
 * playbook flag of every KB page actually attached to this case so the
 * KB-NA rule in the synthesis / reasoning addenda can fire cleanly:
 *
 *  - block populated -> normal KB-following grading
 *  - block empty (`(none)`) -> answer KB questions N/A + documentation
 *    observation; the model MUST NOT fall back to ticket notes or its
 *    training knowledge
 *
 * The block is always emitted (even when empty) so the model has a
 * deterministic signal — silence isn't enough; the addendum needs to
 * see the explicit `(none)` to know KB really was unavailable vs simply
 * forgotten by the prompt assembler.
 */
/**
 * Phase F (F3): Render the structured KB PROCEDURE blocks the parser
 * extracted from Tech-Support style pages. One block per page,
 * separated by horizontal rules. Returns empty string when no parsed
 * procedures are present so callers can skip the prompt section
 * entirely (avoids an empty heading that would just confuse the
 * model). Trace pass also renders these inline with each KB page
 * body; surfacing them again in the reasoning pass keeps the same
 * authoritative structure visible across both passes.
 */
function renderKbProcedures(
  kbProcedures:
    | Array<{ pageName: string; pageUrl: string; procedure: ParsedProcedure }>
    | undefined
): string {
  if (!kbProcedures || kbProcedures.length === 0) return '';
  const blocks = kbProcedures.map((p) =>
    renderKbProcedureBlock(p.procedure, p.pageName, p.pageUrl)
  );
  return blocks.join('\n\n---\n\n');
}

function renderKbAnchors(
  kbAnchors: Array<{ url: string; name: string; is_playbook: boolean }> | undefined
): string {
  const lines: string[] = [
    'KB PAGES LOADED FOR THIS CASE (the authoritative playbook surface for KB-following questions; per-source traces already saw the full page bodies):',
  ];
  if (!kbAnchors || kbAnchors.length === 0) {
    lines.push(
      '(none — no playbook page assigned to the ticket AND no pivot search returned any KB pages. KB-following questions MUST be answered N/A with a documentation observation; do not substitute ticket notes or your own knowledge.)'
    );
    return lines.join('\n');
  }
  // Stable sort: playbook pages first (they're the highest-authority
  // source per the base prompt), then alphabetical by name.
  const sorted = [...kbAnchors].sort((a, b) => {
    if (a.is_playbook !== b.is_playbook) return a.is_playbook ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const p of sorted) {
    const tag = p.is_playbook ? 'ASSIGNED PLAYBOOK PAGE' : 'KB PAGE';
    lines.push(`- ${tag}: "${p.name}" (${p.url})`);
  }
  return lines.join('\n');
}

/**
 * Render the DRAFT VERDICTS FROM REASONING block surfaced to the
 * chunk pass (Pass 2B). One line per allowed question id; missing
 * drafts are rendered as `MISSING — defer to the rubric` so the chunk
 * model has a deterministic fallback rather than guessing.
 *
 * Format example:
 *   DRAFT VERDICTS FROM REASONING (single source of truth — confirm and attach evidence; flag dissent only on clear rubric/evidence contradiction):
 *   - q99325 -> YES: "Agent says 'Alright, and Ben' at [01:24]..."
 *   - q99326 -> YES: "Agent paraphrases the request at [02:13]..."
 *   - q99315 -> NO: "Closing line 'thanks for calling' lacks Dynamic Media reference."
 */
function renderDraftAnswersBlock(
  drafts: DraftAnswer[] | undefined,
  allowedIds: number[]
): string {
  const lines: string[] = [
    'DRAFT VERDICTS FROM REASONING (single source of truth — confirm and attach evidence; flag dissent ONLY on clear rubric/evidence contradiction):',
  ];
  // undefined === draftAnswers param not provided at all (legacy /
  // test paths). Render the "no drafts available" sentinel so the
  // chunk model has a deterministic signal that reasoning never
  // forwarded drafts (vs. drafts were forwarded but a specific id
  // was missing).
  if (drafts == null) {
    lines.push('(no drafts available — defer to per-question rubric for each id and set dissent=false)');
    return lines.join('\n');
  }
  const byId = new Map<number, DraftAnswer>();
  for (const d of drafts) {
    if (typeof d.question_id === 'number') byId.set(d.question_id, d);
  }
  for (const id of allowedIds) {
    const d = byId.get(id);
    if (!d) {
      lines.push(`- q${id} -> MISSING (reasoning omitted this id; defer to rubric, set dissent=false)`);
      continue;
    }
    const where = d.evidence_pointer?.where ? ` @ ${d.evidence_pointer.where}` : '';
    const rationale = (d.brief_rationale ?? '').trim();
    lines.push(`- q${id} -> ${d.verdict.toUpperCase()}${where}: ${rationale}`);
  }
  return lines.join('\n');
}

function renderPivots(pivots: CasePivot[] | undefined): string {
  if (!pivots || pivots.length === 0) return '';
  const lines: string[] = [
    'CASE PIVOTS (this case touches these distinct topics; your final grading must cover each):',
  ];
  for (const p of pivots) {
    const rationale = p.rationale ? ` — ${p.rationale}` : '';
    lines.push(`- ${p.label}${rationale}`);
  }
  return lines.join('\n');
}

/**
 * Render the Tier-1 N-sample trace voting agreement scores as a
 * TRACE AGREEMENT block. The synthesis system prompt instructs the
 * model to use the LOWEST source's composite as a hard ceiling for
 * `overall_confidence` (cannot exceed `min(composite) + 0.10`). Empty
 * / single-trace runs render nothing (back-compat).
 */
function renderTraceAgreement(agreements: TraceAgreement[] | undefined): string {
  if (!agreements || agreements.length === 0) return '';
  // No information added when there's only one sample per source —
  // every item is trivially unanimous so the composite is always 1.0.
  if (agreements.every((a) => a.k <= 1)) return '';
  const lines: string[] = [
    'TRACE AGREEMENT (each source was independently traced multiple times; these scores reflect cross-run consistency. Anchor your overall_confidence within +/- 0.10 of the LOWEST source\'s composite — you cannot be more confident in the final answer than the trace pass was in its own reasoning):',
  ];
  for (const a of agreements) {
    lines.push(
      `- ${a.sourceKind}:${a.sourceId} -> composite=${a.composite.toFixed(2)} (k=${a.k}, playbook=${a.playbookAgreement.toFixed(2)}, claims=${a.claimAgreement.toFixed(2)}, observations=${a.observationAgreement.toFixed(2)}, dropped: playbook=${a.droppedItems.playbook}, observations=${a.droppedItems.observations}, claims=${a.droppedItems.claims})`
    );
  }
  return lines.join('\n');
}

function renderCorrections(corrections: CalibrationCorrection[] | undefined): string {
  if (!corrections || corrections.length === 0) return '';
  const lines: string[] = [
    '',
    '',
    'LEARNED CORRECTIONS FROM HUMAN REVIEWERS (most relevant first; treat the human grade as ground truth for substantively similar questions on this form):',
  ];
  for (const c of corrections) {
    lines.push(`- Question: "${c.question_text}"`);
    lines.push(`  AI previously answered: ${c.ai_value || '(empty)'}`);
    lines.push(`  Human corrected to: ${c.human_value || '(empty)'}`);
    if (c.correction_reason) {
      lines.push(`  Reviewer's reason: ${c.correction_reason}`);
    }
    const kindLabel = c.source_kind === 'CALL' ? 'call' : 'ticket';
    lines.push(`  Source: ${kindLabel} #${c.ticket_id}`);
    lines.push('');
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

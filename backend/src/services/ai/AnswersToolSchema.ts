/**
 * AnswersToolSchema — builds an Anthropic `tools` payload that
 * constrains the AI reviewer's answer emission to legal values per
 * question_id. The tool's JSON Schema is generated dynamically from the
 * form spec so each gradeable question gets ITS OWN value-enum
 * constraint enforced at the API layer.
 *
 * Why this exists:
 *  - Historically the answers pass relied on prompt-level discipline
 *    ("answer with one of the listed option_value strings"). When the
 *    model ignored it (e.g. emitting "yes" for a RADIO whose options
 *    are ["Inbound","Outbound"]), the downstream validator dropped the
 *    answer and surfaced a self-consistency warning, leaving the
 *    question unanswered for the human reviewer.
 *  - With this tool, the model literally cannot submit "yes" for that
 *    RADIO; Anthropic's API rejects model output that does not match
 *    the input_schema, so the class of bug disappears at the wire.
 *
 * Schema layout (returned shape):
 *   {
 *     name: 'submit_answers',
 *     description: '...',
 *     input_schema: {
 *       type: 'object',
 *       required: ['answers'],
 *       properties: {
 *         answers: {
 *           type: 'array',
 *           minItems: N, maxItems: N,    // N = allowedQuestionIds.length
 *           items: { oneOf: [<per-question branch>...] }
 *         }
 *       }
 *     }
 *   }
 *
 * Each branch carries `question_id: { const: <id> }` so the model is
 * forced to pick a specific id, and `value` carries the per-type enum
 * / type constraint. The discriminated-union pattern is the canonical
 * JSON-Schema way to express "each item must match one of these
 * per-type shapes".
 */

import type { FormForPrompt } from '../aiReviewerPrompt';

/**
 * Which call site is building the schema. The single-source path only
 * needs simple evidence fields; the chunked answers-chunk pass also
 * carries cross-source attribution (`evidence_source_kind` /
 * `evidence_source_id`) and the dissent fields used by the Pass-2C
 * reconciliation logic. We surface the difference here so each call
 * site gets a schema sized to what it actually consumes.
 */
export type AnswersToolMode = 'single_source' | 'answers_chunk';

/**
 * Public shape of the tool. Matches the @anthropic-ai/sdk Tool type
 * structurally; we don't import the SDK type here to keep the schema
 * builder dependency-free (tests can construct one without spinning up
 * the SDK).
 */
export interface AnswersTool {
  name: 'submit_answers';
  description: string;
  input_schema: {
    type: 'object';
    required: ['answers'];
    properties: {
      answers: {
        type: 'array';
        minItems?: number;
        maxItems?: number;
        items: { oneOf: object[] };
      };
    };
  };
}

/**
 * Build the JSON-Schema fragment for one question's `value` field.
 * Per-type constraints:
 *  - YES_NO       → enum {'yes','no'} (+ 'na' when is_na_allowed)
 *  - RADIO        → enum of option_value strings (+ 'na' when allowed)
 *  - MULTI_SELECT → array of option_value strings, minItems 1, unique
 *  - SCALE        → integer (range bounds enforced by validator, not schema)
 *  - other        → string fallback
 */
function buildValueSchema(
  q: FormForPrompt['questions'][number]
): Record<string, unknown> {
  switch (q.question_type) {
    case 'YES_NO': {
      const allowed: string[] = ['yes', 'no'];
      if (q.is_na_allowed) allowed.push('na');
      return { enum: allowed };
    }
    case 'RADIO': {
      const allowed = q.radio_options.map((o) => o.value).filter((v) => !!v);
      if (q.is_na_allowed) allowed.push('na');
      // Defensive: a RADIO with no options is a misconfigured form, but
      // we don't want the schema build to crash — fall through to an
      // unconstrained string.
      if (allowed.length === 0) return { type: 'string' };
      return { enum: allowed };
    }
    case 'MULTI_SELECT': {
      const allowed = q.radio_options.map((o) => o.value).filter((v) => !!v);
      if (allowed.length === 0) return { type: 'string' };
      return {
        type: 'array',
        items: { enum: allowed },
        minItems: 1,
        uniqueItems: true,
      };
    }
    case 'SCALE':
      return { type: 'integer' };
    default:
      return { type: 'string' };
  }
}

/**
 * Build one `oneOf` branch for a single question_id. The branch is an
 * object schema whose `question_id` is `const: <id>` and whose `value`
 * is the per-type constraint from `buildValueSchema`. `additionalProperties`
 * stays open so the model can still attach extra metadata fields the
 * downstream parser may consume in the future without a schema bump.
 */
function buildQuestionBranch(
  q: FormForPrompt['questions'][number],
  mode: AnswersToolMode
): Record<string, unknown> {
  const props: Record<string, unknown> = {
    question_id: { const: q.id },
    value: buildValueSchema(q),
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    evidence_source: { type: 'string' },
    evidence_quote: { type: 'string' },
  };
  const required: string[] = ['question_id', 'value'];
  if (mode === 'answers_chunk') {
    props.evidence_source_kind = { enum: ['TICKET', 'TASK', 'CALL'] };
    props.evidence_source_id = { type: 'string' };
    props.dissent = { type: 'boolean' };
    props.dissent_reason = { type: 'string' };
  }
  return {
    type: 'object',
    properties: props,
    required,
    additionalProperties: true,
  };
}

/**
 * Resolve which question_ids are gradeable on this form. Mirrors the
 * filter used by `renderFormSpec` (chunked) and `renderFormForPrompt`
 * (single-source): TEXT / INFO_BLOCK / SUB_CATEGORY are non-gradeable,
 * and ROLLUP rows are auto-derived by the rollup engine.
 *
 * Exposed so the single-source path can ask for "every gradeable id on
 * the form" without re-implementing the filter at the call site.
 */
export function getGradeableQuestionIds(form: FormForPrompt): number[] {
  const out: number[] = [];
  for (const q of form.questions) {
    const t = (q.question_type ?? '').toUpperCase();
    if (t === 'TEXT' || t === 'INFO_BLOCK' || t === 'SUB_CATEGORY') continue;
    if (q.role === 'ROLLUP') continue;
    out.push(q.id);
  }
  return out;
}

/**
 * Build the `submit_answers` tool for the given form + allowed
 * question_ids + call-site mode. The returned object is ready to pass
 * into `client.messages.create({ tools: [tool], tool_choice: ... })`.
 *
 * The schema enforces `minItems === maxItems === allowedQuestionIds.length`
 * so the model cannot skip questions or emit strays for ids outside
 * the chunk — both behaviours we previously had to detect post-hoc.
 */
export function buildAnswersTool(
  form: FormForPrompt,
  allowedQuestionIds: number[],
  mode: AnswersToolMode
): AnswersTool {
  const byId = new Map(form.questions.map((q) => [q.id, q]));
  const branches: object[] = [];
  for (const qid of allowedQuestionIds) {
    const q = byId.get(qid);
    if (!q) continue;
    branches.push(buildQuestionBranch(q, mode));
  }
  return {
    name: 'submit_answers',
    description:
      'Submit the answer for EVERY question_id listed in ALLOWED QUESTION IDS, ' +
      'one entry per id. Each entry must match exactly one of the per-question ' +
      'branches; the `value` field is constrained to the allowed options for ' +
      'THAT specific question_id. Do not call this tool with any other shape.',
    input_schema: {
      type: 'object',
      required: ['answers'],
      properties: {
        answers: {
          type: 'array',
          minItems: branches.length,
          maxItems: branches.length,
          items: { oneOf: branches },
        },
      },
    },
  };
}

/**
 * Case Pivot Detector — Phase E (multi-pivot KB grounding).
 *
 * One cheap Sonnet pass that looks at EVERY source on a Case
 * (primary + attached) and returns the distinct topical pivots the
 * agent had to handle. Each pivot drives an independent KB lookup so
 * compound topics (e.g. an "Install Refund" — refund flow PLUS
 * install refund flow) get the right reference pages instead of the
 * single best-effort topic the per-source classifier would emit.
 *
 * Why a separate module:
 *   - `classifyCallTopic` (in AIReviewerService.ts) only ever sees
 *     one CALL transcript and returns one short class/subclass label.
 *     Stretching it to take every source on a Case would change its
 *     callers and tests, and conflate "what is THIS source about" with
 *     "what topics does the case as a whole touch".
 *   - Keeping the detector standalone lets `reviewCase` keep its
 *     load-then-trace shape and lets future single-source paths opt
 *     in without re-doing this work inline.
 *
 * Failure semantics — fail-OPEN:
 *   - Any error (Anthropic down, JSON unparseable after one retry,
 *     bad shape) returns `[]`. The caller is expected to fall back to
 *     the legacy `classifyCallTopic`-driven KB path so we never
 *     regress KB grounding when this pass is unavailable.
 *   - Wrapped in `withCallLog` with `pass: 'pivot_detection'` so cost
 *     and latency for this pass land in `ai_call_logs` next to the
 *     trace/synthesis rows for the same `case_id`.
 */

import { aiConfig } from '../config/ai';
import logger from '../config/logger';
import { getAnthropicClient, isAnthropicConfigured } from './ai/AnthropicClient';
import { withCallLog } from './aiCallLogger';
import { tryParseJson } from './AIReviewerService';
import type { CostEstimate } from './aiCostEstimator';

export interface CasePivot {
  /** Human-readable label, e.g. "Install Refund". Surfaced to the synthesis prompt. */
  label: string;
  /** Search string fed to `searchKb` — usually a few KB-friendly keywords. */
  query: string;
  /** One-sentence justification, surfaced to the synthesis prompt so the model
   *  knows WHY this pivot was flagged (also helps the AI Reviewer Feedback narrative
   *  call out missing documentation when no KB page covers the pivot). */
  rationale: string;
}

/**
 * Slim shape the detector needs from each source. Mirrors the parts of
 * `InteractionMaterial` that are useful for topic detection (header
 * keys + the early notes/transcript). Keeping this narrower than the
 * full material avoids dragging CRMNote / adapter types into a module
 * whose only job is one cheap Claude call.
 */
export interface PivotInputSource {
  kind: 'TICKET' | 'TASK' | 'CALL';
  /** External id, used only to label sources in the prompt. */
  id: string;
  /** Header key/value pairs as the trace prompt would render them. */
  header: Record<string, string>;
  /** First few notes/transcript chunks, in order. Detector head-truncates further internally. */
  notesOrTranscript: { note: string }[];
}

/** Hard cap on pivots returned to caller (matches the prompt instruction). */
const MAX_PIVOTS = 5;
/** Per-source preview cap — keeps total prompt size predictable when a Case has 4 sources. */
const PER_SOURCE_HEAD_CHARS = 2000;
/** Total combined-preview cap across all sources after per-source truncation. */
const TOTAL_PREVIEW_CHARS = 6000;

const pivotCache = new Map<string, CasePivot[]>();

/**
 * Run the detector. Caches by `caseId` in-process so re-runs of the
 * same Case (e.g. user re-clicks "Run AI manually") don't pay for it
 * twice. Cache is module-local; tests should call `_clearPivotCache`.
 */
export async function detectCasePivots(
  sources: PivotInputSource[],
  opts: { caseId: string; formId: number; onCost?: (cost: CostEstimate | null) => void }
): Promise<CasePivot[]> {
  const cached = pivotCache.get(opts.caseId);
  if (cached !== undefined) return cached;

  if (!isAnthropicConfigured() || sources.length === 0) {
    pivotCache.set(opts.caseId, []);
    return [];
  }

  const preview = buildCombinedPreview(sources);
  if (!preview.trim()) {
    pivotCache.set(opts.caseId, []);
    return [];
  }

  const sysPrompt =
    'You analyse a multi-source customer-service Case (a primary interaction plus optional ' +
    'attached interactions: tickets, tasks, conversations). Your job is to identify EVERY ' +
    'distinct topical pivot the agent had to handle — primary topic AND compound qualifiers. ' +
    'Examples of pivots: "Refund", "Install Refund", "Activation Failure", "After-Hours ' +
    'Support", "Retention Escalation", "Tier-2 Handoff". A compound pivot like "Install ' +
    'Refund" must be its OWN entry — do not collapse it into the bare "Refund". Each pivot ' +
    'should justify a distinct knowledge-base lookup. ' +
    `Return AT MOST ${MAX_PIVOTS} pivots, ranked by importance. ` +
    'Respond with ONLY this JSON object (no prose, no code fences):\n' +
    '{ "pivots": [{ "label": "<short topic name>", ' +
    '"query": "<3-6 keywords for KB search>", ' +
    '"rationale": "<one short sentence>" }, ...] }\n' +
    'Empty array is fine when the Case has no clear topic.';

  const userPrompt = `CASE_ID: ${opts.caseId}\nFORM_ID: ${opts.formId}\n\n${preview}\n\nJSON:`;

  const cheapModel =
    process.env.ANTHROPIC_CHEAP_MODEL || aiConfig.anthropic?.defaultModel || 'claude-sonnet-4-5';

  try {
    const pivots = await withCallLog<CasePivot[]>(
      {
        provider: 'anthropic',
        purpose: 'ai_reviewer.case.pivot_detection',
        pass: 'pivot_detection',
        formId: opts.formId,
        caseId: opts.caseId,
        onCost: opts.onCost,
      },
      { system: sysPrompt, user: userPrompt },
      async () => {
        const client = getAnthropicClient();
        let retried = false;
        let tokensIn: number | null = null;
        let tokensOut: number | null = null;

        const sendOnce = async (extraSystem?: string): Promise<string> => {
          const res = await client.messages.create({
            model: cheapModel,
            max_tokens: 600,
            system: sysPrompt + (extraSystem ?? ''),
            messages: [{ role: 'user', content: userPrompt }],
          });
          const usage = (res as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
          if (usage) {
            tokensIn = usage.input_tokens ?? null;
            tokensOut = usage.output_tokens ?? null;
          }
          const block = res.content.find((b) => b.type === 'text') as { text: string } | undefined;
          if (!block) throw new Error('Pivot detector: Claude returned no text content');
          return block.text;
        };

        let raw = await sendOnce();
        let parsed = tryParseJson(raw);
        if (!parsed || !Array.isArray(parsed.pivots)) {
          retried = true;
          logger.warn(
            '[AI REVIEWER] Pivot detector response was not valid JSON; retrying once with stricter system prompt.'
          );
          raw = await sendOnce(
            '\n\nIMPORTANT: Your previous response could not be parsed. Respond with ONLY the JSON object as specified, nothing else.'
          );
          parsed = tryParseJson(raw);
        }

        const cleaned = sanitisePivots(parsed?.pivots);
        return {
          result: cleaned,
          model: cheapModel,
          rawResponse: raw,
          retried,
          tokensIn,
          tokensOut,
        };
      }
    );

    pivotCache.set(opts.caseId, pivots);
    if (pivots.length > 0) {
      logger.info(
        `[AI REVIEWER] pivot detector case=${opts.caseId} → [${pivots.map((p) => p.label).join(', ')}]`
      );
    }
    return pivots;
  } catch (err) {
    // Fail-open: never block a review on a detector hiccup.
    logger.warn(
      `[AI REVIEWER] pivot detector failed for case=${opts.caseId}: ${(err as Error).message}; ` +
        `falling back to per-source classifier KB grounding`
    );
    pivotCache.set(opts.caseId, []);
    return [];
  }
}

/**
 * Compose the combined preview block fed to the detector. Each source
 * gets its header (a couple of key/value lines) plus a head-truncated
 * window of its notes/transcript. Total size is bounded by
 * TOTAL_PREVIEW_CHARS so a Case with many long sources still fits.
 */
function buildCombinedPreview(sources: PivotInputSource[]): string {
  const blocks: string[] = [];
  let used = 0;
  for (const s of sources) {
    const headerLines = Object.entries(s.header)
      .filter(([, v]) => v != null && String(v).trim() !== '')
      .slice(0, 8)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');
    const notesText = (s.notesOrTranscript ?? [])
      .map((n) => (n?.note ?? '').trim())
      .filter(Boolean)
      .join('\n---\n')
      .slice(0, PER_SOURCE_HEAD_CHARS);
    const block = [
      `--- SOURCE ${s.kind}:${s.id} ---`,
      headerLines || '  (no header fields)',
      'NOTES/TRANSCRIPT (head-truncated):',
      notesText || '(empty)',
    ].join('\n');
    if (used + block.length > TOTAL_PREVIEW_CHARS) {
      blocks.push(block.slice(0, TOTAL_PREVIEW_CHARS - used));
      break;
    }
    blocks.push(block);
    used += block.length + 2;
  }
  return blocks.join('\n\n');
}

/**
 * Coerce the model's `pivots[]` into well-formed CasePivot records.
 * Drops entries missing label or query (rationale is allowed to be
 * empty), trims everything, dedupes by lowercased label, and caps the
 * list at MAX_PIVOTS.
 */
function sanitisePivots(raw: unknown): CasePivot[] {
  if (!Array.isArray(raw)) return [];
  const out: CasePivot[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const label = String((item as any).label ?? '').trim();
    const query = String((item as any).query ?? '').trim();
    const rationale = String((item as any).rationale ?? '').trim();
    if (!label || !query) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, query, rationale });
    if (out.length >= MAX_PIVOTS) break;
  }
  return out;
}

/** @internal Test-only: clear the per-case detector cache. */
export function _clearPivotCache(): void {
  pivotCache.clear();
}

/**
 * salesPlays.extractor — one LLM pass that mines "winning plays" from a call.
 *
 * Mirrors the analyzer's single-pass + withCallLog shape (spend lands in
 * ai_call_logs, cost surfaces through onCost) but asks a different question: not
 * "what was missed" but "what specific, repeatable move worked (WON) or was the
 * gap that lost it (LOST)". Output is a short list of plays the admin reviews
 * before any of them can influence recommendations.
 *
 * Never throws: a provider or parse failure returns an empty play list with the
 * error attached, so one bad transcript never fails the monthly mine.
 */
import logger from '../../../../config/logger';
import { callChatModel, type ModelProvider } from '../../../ai/ChatModelClient';
import { withCallLog } from '../../../aiCallLogger';
import { PLAY_CATEGORIES, type NewSalesPlay, type PlayOutcome } from './plays.service';

const MAX_OUTPUT_TOKENS = 1500;
const CALL_TIMEOUT_MS = 120_000;
const MAX_PLAYS_PER_CALL = 3;

const CATEGORY_SET = new Set<string>(PLAY_CATEGORIES);

const FIXED_CONTRACT = [
  'You are given one sales call transcript and its known deal OUTCOME (WON or LOST).',
  'Extract at most ' + String(MAX_PLAYS_PER_CALL) + ' concrete, REUSABLE plays another rep could copy.',
  '',
  'What a "play" is:',
  '- On a WON call: a specific move that advanced or closed the deal — an objection rebuttal that landed, an urgency/close line, a discovery question that surfaced a need, an upsell/second-location ask, a research point that built trust.',
  '- On a LOST call: the specific gap that cost it, expressed as the play the rep SHOULD have run (still a positive, reusable tactic — never "the rep was bad").',
  '',
  'Hard rules:',
  '- A play must be GENERALIZABLE. No account-specific facts as the lesson; the evidence quote may be specific, the play itself must transfer to other calls.',
  '- NEVER recommend free product, free service, waived fees, or unauthorized discounts. Plays must be paid offers or authorized tactics.',
  '- `category` must be exactly one of: ' + PLAY_CATEGORIES.join(', ') + '.',
  '- `title` is a short imperative label under 12 words (e.g. "Anchor urgency to the licensing deadline").',
  '- `body_md` is 1-3 sentences a rep can act on: what to say or do, and why it works.',
  '- `evidence_quote` is a VERBATIM span from the transcript under 40 words, or null.',
  '- `evidence_speaker` is "CUSTOMER" or "AGENT" for who said the quote, or null when there is no quote.',
  '- `est_value_note` is a short revenue note (e.g. "second location subscription") or null.',
  '- If nothing generalizable stands out, return an empty array. An empty result is valid — do not invent filler.',
  '',
  'Respond with ONLY a JSON object in this exact shape:',
  '{"plays":[{"category":"...","title":"...","body_md":"...","evidence_quote":"verbatim or null","evidence_speaker":"CUSTOMER or AGENT or null","est_value_note":"short note or null"}]}',
].join('\n');

/** System prompt for the miner: persona (reused from settings) + fixed contract. */
export function buildMinerSystemPrompt(persona: string): string {
  return `${persona.trim()}\n\n${FIXED_CONTRACT}`;
}

function stripFence(raw: string): string {
  const t = (raw ?? '').trim();
  if (!t.startsWith('```')) return t;
  return t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
}

function cap(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t || t.toLowerCase() === 'null') return null;
  return t.length > max ? t.slice(0, max) : t;
}

function parseSpeaker(value: unknown): 'CUSTOMER' | 'AGENT' | null {
  const v = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return v === 'CUSTOMER' || v === 'AGENT' ? v : null;
}

export function parsePlays(
  raw: string,
  outcome: PlayOutcome,
  meta: { conversationId: string; agentName: string },
): NewSalesPlay[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch {
    return [];
  }
  let arr: unknown[] = [];
  if (Array.isArray(parsed)) arr = parsed;
  else if (parsed && typeof parsed === 'object') {
    const c = (parsed as Record<string, unknown>).plays;
    if (Array.isArray(c)) arr = c;
  }

  const out: NewSalesPlay[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const category = typeof o.category === 'string' ? o.category.trim().toLowerCase() : '';
    const title = cap(o.title, 240);
    const bodyMd = cap(o.body_md, 2000);
    if (!CATEGORY_SET.has(category) || !title || !bodyMd) continue;

    const quote = cap(o.evidence_quote, 1200);
    out.push({
      category: category as NewSalesPlay['category'],
      title,
      bodyMd,
      evidenceQuote: quote,
      evidenceSpeaker: quote ? parseSpeaker(o.evidence_speaker) : null,
      sourceOutcome: outcome,
      sourceConversationId: meta.conversationId,
      sourceAgentName: meta.agentName,
      estValueNote: cap(o.est_value_note, 240),
    });
    if (out.length >= MAX_PLAYS_PER_CALL) break;
  }
  return out;
}

export interface ExtractPlaysArgs {
  conversationId: string;
  agentName: string;
  transcript: string;
  outcome: PlayOutcome;
  provider: ModelProvider;
  model: string | undefined;
  systemPrompt: string;
}

export interface ExtractPlaysResult {
  plays: NewSalesPlay[];
  usdCost: number;
  error?: string;
}

/** Mine one call. Never throws; returns [] with an error on failure. */
export async function extractPlays(args: ExtractPlaysArgs): Promise<ExtractPlaysResult> {
  if (!args.transcript.trim()) return { plays: [], usdCost: 0 };

  const user = [
    `DEAL OUTCOME: ${args.outcome}`,
    `SALESPERSON: ${args.agentName}`,
    '',
    'CALL TRANSCRIPT:',
    args.transcript,
  ].join('\n');

  let usd = 0;
  try {
    const plays = await withCallLog(
      {
        provider: args.provider,
        purpose: 'insights.sales_plays_miner',
        pass: 'single_pass',
        caseId: args.conversationId,
        onCost: (cost) => { usd = cost?.usd ?? 0; },
      },
      { system: args.systemPrompt, user },
      async () => {
        const res = await callChatModel(args.provider, {
          system: args.systemPrompt,
          user,
          model: args.model,
          maxTokens: MAX_OUTPUT_TOKENS,
          responseFormat: 'json_object',
          timeoutMs: CALL_TIMEOUT_MS,
        });
        const out = parsePlays(res.text, args.outcome, {
          conversationId: args.conversationId,
          agentName: args.agentName,
        });
        return {
          result: out,
          model: res.model,
          rawResponse: res.text,
          retried: false,
          tokensIn: res.tokensIn,
          tokensOut: res.tokensOut,
        };
      },
    );
    return { plays, usdCost: usd };
  } catch (err) {
    const message = (err as Error)?.message ?? 'unknown miner error';
    logger.warn(`[SALES PLAYS] mine failed for ${args.conversationId}: ${message}`);
    return { plays: [], usdCost: usd, error: message };
  }
}

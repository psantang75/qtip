/**
 * Verification pass — the disconfirming-evidence check on a call's findings.
 *
 * WHY A SECOND PASS. Every rule in the set describes something the rep did NOT
 * do, but `evidence_quote` only ever proves the OPENING existed (the customer's
 * buying signal). Nothing forced the first pass to prove the omission, so a rep
 * who asked for the card and was told "just email me the link" was graded the
 * same as a rep who never asked. The prompt contract now demands that check, but
 * an instruction the model can silently skip is not a control — this pass is.
 *
 * IT ONLY EVER REMOVES. The auditor cannot add a finding, change a severity, or
 * rewrite a recommendation; its single verdict is "did the transcript show the
 * rep attempting this?". That keeps the report's content owned by the rule set
 * and the persona, and makes the pass safe to fail open.
 *
 * NOT EVERY RULE IS IN SCOPE. A rule whose miss is a COMMISSION — the rep did
 * the thing, the problem is what they did — has no useful answer to that
 * verdict, and a literal yes deletes the finding on the grounds that the rep
 * did the very thing it criticises. Callers pass `omissionRuleKeys`, the
 * allow-list built from `ie_missed_opportunity_rule.is_omission`, so the
 * distinction lives on the rule an admin authored rather than in a list here.
 * It is enforced in code because the prompt below does tell the auditor to
 * leave those findings alone and it ignored the instruction, dropping a
 * high-severity margin-disclosure finding because the rep had indeed spoken on
 * the recorded line.
 *
 * THE VERDICT IS ONLY AS GOOD AS ITS QUOTE. The auditor is asked for the line
 * where the rep made the move, and a removal now requires that line to actually
 * resolve in the transcript (evidence.quoteResolves). Taking the bare boolean
 * meant an unsupported "yes, they did that" silently deleted a real finding —
 * the same unchecked-citation problem on the other side of the ledger.
 *
 * FAIL OPEN. A provider error, a timeout, unparseable JSON, or a verdict whose
 * quote does not resolve keeps every finding. Silently emptying a day's review
 * because an auxiliary call failed would be a far worse outcome than the false
 * positives this exists to catch.
 *
 * COST. One cheap-model call per call that produced findings — zero on the
 * (common, expected) empty result. Spend lands in `ai_call_logs` under
 * pass='verification' alongside the AI Reviewer's own verification pass, and
 * flows into the run's USD total through the same `onCost` sink as the main call.
 */
import logger from '../../../config/logger';
import {
  callChatModel,
  resolveCheapModelName,
  type ModelProvider,
} from '../../ai/ChatModelClient';
import { withCallLog } from '../../aiCallLogger';
import { quoteResolves } from './evidence';
import { stripFence } from './parse';
import { AnalyzedFinding } from './types';

const MAX_OUTPUT_TOKENS = 900;
const CALL_TIMEOUT_MS = 60_000;

const SYSTEM_PROMPT = [
  'You audit draft coaching notes about a sales call for one specific error: claiming the salesperson did not do something they actually did.',
  '',
  'For each numbered finding you are given the miss it alleges. Read the transcript and answer one question: does the transcript show the SALESPERSON attempting that action at any point?',
  '',
  'Count it as attempted when the rep made the move and the customer declined, deferred, or chose another path — the rep asked for the order or the card, offered to place or activate it while on the line, offered the warranty, the upsell, the site survey, the group quote, or the transfer, or asked the qualifying question the finding says they never asked. The customer choosing a slower path does not make it unattempted.',
  '',
  'Count it as NOT attempted when the rep never made the move, or only mentioned it in passing without offering it.',
  '',
  'Some findings are not about an omission at all — they are about HOW WELL the rep did something they plainly did: the content of a voicemail they left, or a professionalism or compliance lapse in what they said on the recorded line. Those are outside what you audit, so answer rep_attempted: false for them and leave them alone. Answering true would delete a finding on the grounds that the rep did the very thing it criticises.',
  '',
  'Judge each finding independently and only against the transcript. Do not consider whether the miss is important, whether the coaching is good, or whether some other miss occurred. You are not grading the call.',
  '',
  'When you answer rep_attempted: true you MUST quote the SALESPERSON line that shows the attempt, verbatim from the transcript, in agent_quote. A true verdict without a verbatim quote that appears in the transcript is discarded and the finding is kept — so if you cannot point to the line, answer false.',
  '',
  'Respond with ONLY a JSON object in this exact shape:',
  '{"verdicts":[{"index":1,"rep_attempted":true,"agent_quote":"verbatim line where the rep attempted it, or null"}]}',
].join('\n');

/** The claim under audit, without the coaching text the auditor must not weigh. */
function renderFindings(findings: AnalyzedFinding[]): string {
  return findings
    .map((f, i) => [
      `FINDING ${i + 1}`,
      `ALLEGED MISS: ${f.title}`,
      `DETAIL: ${f.whatHappened}`,
    ].join('\n'))
    .join('\n\n');
}

export interface VerifyFindingsArgs {
  findings: AnalyzedFinding[];
  transcript: string;
  provider: ModelProvider;
  /** Conversation id, logged as `case_id` so a run's passes group together. */
  conversationId: string;
  /**
   * Rule keys this pass may audit — the active rules with `is_omission` set.
   * A finding on any other rule passes through untouched. An empty set means
   * nothing is auditable, which is the correct reading of "no rule claims to be
   * about a skipped step".
   */
  omissionRuleKeys: ReadonlySet<string>;
}

export interface VerifyFindingsResult {
  /** The surviving findings, in their original order. */
  findings: AnalyzedFinding[];
  tokensIn: number;
  tokensOut: number;
  usdCost: number;
  /** How many findings the transcript contradicted. */
  dropped: number;
}

/**
 * Drop the findings whose alleged omission the transcript contradicts. Never
 * throws; on any failure the input is returned unchanged.
 */
export async function verifyFindings(args: VerifyFindingsArgs): Promise<VerifyFindingsResult> {
  const unchanged: VerifyFindingsResult = {
    findings: args.findings,
    tokensIn: 0,
    tokensOut: 0,
    usdCost: 0,
    dropped: 0,
  };

  // No transcript means the first pass could not have read one either.
  if (!args.transcript.trim()) return unchanged;

  // Commission-type findings never reach the auditor, so it cannot drop them.
  const auditable = args.findings.filter((f) => args.omissionRuleKeys.has(f.ruleKey));
  if (auditable.length === 0) return unchanged;

  const user = [
    'DRAFT FINDINGS TO AUDIT:',
    renderFindings(auditable),
    '',
    'CALL TRANSCRIPT:',
    args.transcript,
  ].join('\n');

  let usd = 0;
  try {
    const res = await withCallLog(
      {
        provider: args.provider,
        purpose: 'insights.missed_opportunities',
        pass: 'verification',
        caseId: args.conversationId,
        onCost: (cost) => {
          usd = cost?.usd ?? 0;
        },
      },
      { system: SYSTEM_PROMPT, user },
      async () => {
        const out = await callChatModel(args.provider, {
          system: SYSTEM_PROMPT,
          user,
          model: resolveCheapModelName(args.provider),
          maxTokens: MAX_OUTPUT_TOKENS,
          responseFormat: 'json_object',
          timeoutMs: CALL_TIMEOUT_MS,
        });
        return {
          result: out,
          model: out.model,
          rawResponse: out.text,
          retried: false,
          tokensIn: out.tokensIn,
          tokensOut: out.tokensOut,
        };
      },
    );

    const attempted = parseAttemptedIndexes(res.text, auditable.length, args.transcript);
    if (attempted.size === 0) {
      return { ...unchanged, tokensIn: res.tokensIn ?? 0, tokensOut: res.tokensOut ?? 0, usdCost: usd };
    }

    // Indexes are positions in `auditable`, so resolve them back to the actual
    // findings before filtering the full list — the exempt ones shift the
    // positions and would otherwise drop the wrong rows.
    const drop = new Set(
      [...attempted].map((i) => auditable[i]).filter((f): f is AnalyzedFinding => !!f),
    );
    const kept = args.findings.filter((f) => !drop.has(f));
    logger.info(
      `[MISSED OPPS] verification dropped ${drop.size} finding(s) on ${args.conversationId} `
        + 'the transcript showed the rep attempting',
    );
    return {
      findings: kept,
      tokensIn: res.tokensIn ?? 0,
      tokensOut: res.tokensOut ?? 0,
      usdCost: usd,
      dropped: drop.size,
    };
  } catch (err) {
    logger.warn(
      `[MISSED OPPS] verification failed for ${args.conversationId}, keeping all findings: ${(err as Error).message}`,
    );
    return { ...unchanged, usdCost: usd };
  }
}

/**
 * Zero-based indexes the auditor marked as attempted AND backed with a quote
 * the transcript contains.
 *
 * Only an explicit `true` counts, an out-of-range index is ignored, and a
 * verdict whose `agent_quote` is missing or resolves nowhere in the transcript
 * is discarded — anything ambiguous keeps the finding, matching the fail-open
 * stance of the pass as a whole. Dropping a real miss on an unverifiable "yes"
 * is the failure mode this guards.
 */
function parseAttemptedIndexes(raw: string, count: number, transcript: string): Set<number> {
  const attempted = new Set<number>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch {
    return attempted;
  }

  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>).verdicts
      : null;
  if (!Array.isArray(list)) return attempted;

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (o.rep_attempted !== true) continue;
    const oneBased = Number(o.index);
    if (!Number.isInteger(oneBased) || oneBased < 1 || oneBased > count) continue;

    const quote = typeof o.agent_quote === 'string' ? o.agent_quote.trim() : '';
    if (!quote || quote.toLowerCase() === 'null') {
      logger.info(
        `[MISSED OPPS] verification verdict ${oneBased} claimed an attempt with no quote — finding kept`,
      );
      continue;
    }
    if (!quoteResolves(quote, transcript)) {
      logger.info(
        `[MISSED OPPS] verification verdict ${oneBased} quoted a line absent from the transcript — finding kept`,
      );
      continue;
    }
    attempted.add(oneBased - 1);
  }
  return attempted;
}

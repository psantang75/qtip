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
 * IT ASKS TWO QUESTIONS. "Did this salesperson attempt it?" enforces a rule's
 * INCLUSION half. "Does this rule's own stated exclusion apply?" enforces the
 * other half, which nothing enforced before: rule bodies say things like "Do NOT
 * flag when the customer chose another path", and a call where the customer asked
 * for a revised quote and said they would come back was still reported as a
 * missed close, because the rep genuinely never asked for the order. The contract
 * for both questions lives in verifyContract.ts.
 *
 * IT ONLY EVER REMOVES. The auditor cannot add a finding, change a severity, or
 * rewrite a recommendation. That keeps the report's content owned by the rule set
 * and the persona, and makes the pass safe to fail open.
 *
 * THE TWO QUESTIONS HAVE DIFFERENT SCOPES. A rule whose miss is a COMMISSION —
 * the rep did the thing, the problem is what they did — has no useful answer to
 * the attempt question, and a literal yes deletes the finding on the grounds that
 * the rep did the very thing it criticises. Callers pass `omissionRuleKeys`, the
 * allow-list built from `ie_missed_opportunity_rule.is_omission`, so the
 * distinction lives on the rule an admin authored rather than in a list here. It
 * is enforced in code because the prompt does tell the auditor to leave those
 * findings alone and it ignored the instruction, dropping a high-severity
 * margin-disclosure finding because the rep had indeed spoken on the recorded line.
 *
 * The EXCLUSION question has no such problem, and content-graded rules are now
 * audited on it. They used to skip this pass altogether, which meant the only
 * findings with no check of any kind were the ones graded purely on judgment: a
 * rule whose body lists margin disclosure, profanity, disparagement and small talk
 * produced a finding about a rep's tone while he correctly explained copyright law,
 * and nothing anywhere was in a position to catch it.
 *
 * THE VERDICT IS ONLY AS GOOD AS ITS QUOTE. Both questions require a verbatim
 * line that resolves in the material. Taking the bare boolean meant an
 * unsupported "yes, they did that" silently deleted a real finding — the same
 * unchecked-citation problem on the other side of the ledger.
 *
 * ATTRIBUTION BOUNDS ONE QUESTION, NOT BOTH. An attempt removal asserts that THIS
 * salesperson spoke the line, so on a transferred call — where any AGENT turn may
 * be a colleague — it is refused outright. That is the control for the Jason
 * warranty case: Customer Service explained a five-year option on an earlier
 * segment, the auditor read it as "the warranty was offered", and a real omission
 * was deleted. A rule exclusion asserts something about the SITUATION instead
 * ("the customer asked to be emailed a link"), which is true no matter which
 * employee was on the line, so it is still audited on a transferred call.
 *
 * FAIL OPEN. A provider error, a timeout, unparseable JSON, or a verdict whose
 * quote does not resolve keeps every finding. Silently emptying a day's review
 * because an auxiliary call failed would be a far worse outcome than the false
 * positives this exists to catch.
 *
 * COST. One cheap-model call per call that produced auditable findings — zero on
 * the (common, expected) empty result. Spend lands in `ai_call_logs` under
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
import { AnalyzedFinding, CallAttribution } from './types';
import { SYSTEM_PROMPT, parseVerdicts, renderFindings } from './verifyContract';

const MAX_OUTPUT_TOKENS = 1200;
const CALL_TIMEOUT_MS = 60_000;

export interface VerifyFindingsArgs {
  findings: AnalyzedFinding[];
  transcript: string;
  provider: ModelProvider;
  /** Conversation id, logged as `case_id` so a run's passes group together. */
  conversationId: string;
  /**
   * Rule keys the ATTEMPT question applies to — the active rules with
   * `is_omission` set. A finding on any other rule is still audited, but on the
   * exclusion question only. An empty set means no finding can be dropped for
   * having been attempted, which is the correct reading of "no rule claims to be
   * about a skipped step".
   */
  omissionRuleKeys: ReadonlySet<string>;
  /**
   * `rule_key` → that rule's `body_md`, verbatim, so the auditor can be asked
   * whether one of the rule's OWN stated exclusions applies. Passed whole rather
   * than pattern-matched here: the exclusions are admin-editable business content
   * and a clause worded unexpectedly must still be enforced. A key absent from
   * this map simply has no exclusion to check.
   */
  ruleBodies: ReadonlyMap<string, string>;
  /** The person under review, named to the auditor so "the rep" is unambiguous. */
  salespersonName: string;
  /**
   * The reviewed salesperson's rendered lead/CM history — the documentation gate.
   * A note THEY authored can show a documented attempt (an offer, a quote, a
   * dated follow-up) that the transcript alone does not; a colleague's note or a
   * ticket note never can, which is enforced on the quote's author in code.
   */
  salesNotes: string;
  /**
   * Whether an internal turn is attributable to them. When it is not — a second
   * employee was on the conversation, or we could not tell — an ATTEMPT verdict is
   * refused, because every such removal asserts that THIS person spoke the line.
   * Rule-exclusion verdicts are unaffected: they are about the situation.
   */
  attribution: CallAttribution;
}

export interface VerifyFindingsResult {
  /** The surviving findings, in their original order. */
  findings: AnalyzedFinding[];
  tokensIn: number;
  tokensOut: number;
  usdCost: number;
  /** How many findings were removed, on either question. */
  dropped: number;
}

/**
 * Drop the findings the transcript contradicts or the rule's own text excludes.
 * Never throws; on any failure the input is returned unchanged.
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

  // What each finding can be asked. An omission rule gets both questions; a
  // content-graded rule gets the exclusion question only, which is why it is here
  // at all — those findings used to skip this pass entirely and so were audited by
  // nothing, which is how a rule listing margin disclosure, profanity and small
  // talk came back with a finding about tone.
  const canAskAttempt = (f: AnalyzedFinding): boolean => args.omissionRuleKeys.has(f.ruleKey);
  const canAskExclusion = (f: AnalyzedFinding): boolean => !!args.ruleBodies.get(f.ruleKey)?.trim();
  const auditable = args.findings.filter((f) => canAskAttempt(f) || canAskExclusion(f));
  if (auditable.length === 0) return unchanged;

  const attributable = args.attribution.soleInternalParty;
  if (!attributable) {
    logger.info(
      `[MISSED OPPS] verification on ${args.conversationId}: `
        + `${args.attribution.internalPartyCount ?? 'an unknown number of'} employees were on this `
        + `conversation, so no transcript line can be attributed to ${args.salespersonName} — `
        + 'auditing rule exclusions only',
    );
  }

  const user = [
    `REVIEWED SALESPERSON: ${args.salespersonName}`,
    attributable
      ? 'They were the only employee on this conversation, so a turn labelled AGENT is theirs.'
      : `${args.attribution.internalPartyCount ?? 'An unknown number of'} employees were on this `
        + 'conversation, so a turn labelled AGENT may be a transferred colleague or an IVR prompt '
        + `rather than ${args.salespersonName}. Answer rep_attempted: false unless the dialogue makes `
        + 'it unmistakable. This does NOT limit question 2: a rule exclusion is about the situation, '
        + 'so whoever spoke the line, it still counts.',
    '',
    'DRAFT FINDINGS TO AUDIT:',
    renderFindings(auditable, args.ruleBodies, args.omissionRuleKeys),
    '',
    'CALL TRANSCRIPT:',
    args.transcript,
    '',
    `ACCOUNT HISTORY (only ${args.salespersonName}'s own notes here document an attempt; a colleague's or ticket note does not):`,
    args.salesNotes.trim() || '(none on this record)',
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
          // The auditor's instructions are a fixed constant; only the findings
          // and transcript in `user` vary. Cache the prefix like the main pass.
          // (Under the cheap model's minimum cacheable length it is simply
          // processed uncached, so this is safe even though the block is small.)
          cacheSystem: true,
        });
        return {
          result: out,
          model: out.model,
          rawResponse: out.text,
          retried: false,
          tokensIn: out.tokensIn,
          tokensOut: out.tokensOut,
          cacheReadTokens: out.cacheReadTokens,
          cacheWriteTokens: out.cacheWriteTokens,
        };
      },
    );

    const spend = { tokensIn: res.tokensIn ?? 0, tokensOut: res.tokensOut ?? 0, usdCost: usd };
    const verdicts = parseVerdicts(res.text, auditable.length, {
      transcript: args.transcript,
      salesNotes: args.salesNotes,
      salespersonName: args.salespersonName,
      attributable,
    });

    // Indexes are positions in `auditable`, so resolve them back to the actual
    // findings before filtering the full list — the exempt ones shift the
    // positions and would otherwise drop the wrong rows.
    const resolve = (indexes: Set<number>): AnalyzedFinding[] => [...indexes]
      .map((i) => auditable[i])
      .filter((f): f is AnalyzedFinding => !!f);

    // A content-graded rule concedes the rep did the thing, so a literal "yes they
    // attempted it" would delete the finding on the grounds it criticises. Enforced
    // here as well as stated in the prompt, because the auditor has ignored the
    // instruction before — it dropped a margin-disclosure finding that way.
    const byAttempt = resolve(verdicts.attempted).filter(canAskAttempt);
    const byExclusion = resolve(verdicts.carvedOut);
    const drop = new Set([...byAttempt, ...byExclusion]);
    if (drop.size === 0) return { ...unchanged, ...spend };

    const reasons = [
      byAttempt.length ? `${byAttempt.length} the rep was shown attempting` : null,
      byExclusion.length ? `${byExclusion.length} the rule's own text excludes` : null,
    ].filter(Boolean).join(', ');
    logger.info(
      `[MISSED OPPS] verification dropped ${drop.size} finding(s) on ${args.conversationId}: ${reasons}`,
    );

    return {
      ...spend,
      findings: args.findings.filter((f) => !drop.has(f)),
      dropped: drop.size,
    };
  } catch (err) {
    logger.warn(
      `[MISSED OPPS] verification failed for ${args.conversationId}, keeping all findings: ${(err as Error).message}`,
    );
    return { ...unchanged, usdCost: usd };
  }
}

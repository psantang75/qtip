/**
 * Missed Opportunities analyzer — the grading pass over one connected sales call.
 *
 * TWO PASSES, ASYMMETRIC. The grading pass reads the call and applies the rule
 * set; a cheap verification pass (verify.ts) then audits its output for the one
 * error the grading pass cannot self-check — alleging the rep did not do
 * something the transcript shows them doing. That auditor may only REMOVE a
 * finding, so it costs one cheap call on the calls that produced findings and
 * nothing on the empty results that are the expected outcome of a good call.
 * This is not the AI Reviewer's trace/synthesis shape and should not grow into
 * it: there is no rubric to reconcile here, only a short list of misses to
 * disconfirm.
 *
 * Every call goes through `withCallLog` so the spend lands in `ai_call_logs`
 * alongside AI Reviewer spend, and the run's own USD total is accumulated
 * through the `onCost` sink rather than re-deriving pricing here.
 *
 * The model may only report findings whose `rule_key` is in the rendered rule
 * set: an unknown key is dropped rather than stored, which is what keeps the
 * report's rule filter and the Settings tab in agreement with the data.
 *
 * Prompt assembly lives in prompt.ts and is re-exported here so this module
 * stays the single import surface for the worker and the tests.
 */
import { aiConfig } from '../../../config/ai';
import logger from '../../../config/logger';
import { callChatModel, type ModelProvider } from '../../ai/ChatModelClient';
import { withCallLog } from '../../aiCallLogger';
import { parseFindings } from './parse';
import { MAX_FINDINGS_PER_CALL, buildUserPrompt } from './prompt';
import { type ModelTier } from './settings';
import { verifyFindings } from './verify';
import { AnalyzeCallResult, CallMaterial } from './types';

export { buildSystemPrompt, buildUserPrompt } from './prompt';
export { parseFindings } from './parse';

/**
 * Sized for MAX_CANDIDATE_FINDINGS, not the report ceiling. The model is now
 * asked for a slightly wider ordered list so verification has something to cut
 * from, and a budget sized for three would truncate the JSON mid-object — which
 * the parser correctly reports as a failed review, turning a cost saving into a
 * lost call.
 */
const MAX_OUTPUT_TOKENS = 3500;
const CALL_TIMEOUT_MS = 120_000;

/** First configured provider. Null means AI is not set up in this environment. */
export function resolveProvider(): ModelProvider | null {
  if (aiConfig.anthropic) return 'anthropic';
  if (aiConfig.openai) return 'openai';
  return null;
}

/**
 * Model for the run's configured tier. The cheap tier is the default because
 * this is a high-volume classification job over short transcripts, not the
 * rubric reasoning the Opus/GPT-5 default is sized for. `undefined` means
 * "use the provider default", which is what the reasoning tier wants.
 */
export function resolveTierModel(provider: ModelProvider, tier: ModelTier): string | undefined {
  if (tier === 'reasoning') return undefined;
  return provider === 'openai' ? 'gpt-5-mini' : 'claude-sonnet-4-6';
}

export interface AnalyzeCallArgs {
  material: CallMaterial;
  provider: ModelProvider;
  model: string | undefined;
  systemPrompt: string;
  validRuleKeys: Set<string>;
  defaultSeverityByRule: Map<string, string>;
  /**
   * Rule keys the verification pass may audit — the active rules whose miss is a
   * skipped step (`is_omission`). Findings on content-graded rules bypass it.
   */
  omissionRuleKeys: ReadonlySet<string>;
}

/**
 * Analyze one call. Never throws: a provider or parse failure comes back as
 * `error` on the result so the worker can finish the day as PARTIAL instead of
 * losing every other agent's findings to one bad transcript.
 */
export async function analyzeCall(args: AnalyzeCallArgs): Promise<AnalyzeCallResult> {
  const { material } = args;
  const base: AnalyzeCallResult = {
    conversationId: material.conversationId,
    findings: [],
    tokensIn: 0,
    tokensOut: 0,
    usdCost: 0,
    modelUsed: null,
    skipped: false,
  };

  // A transcript we could not RETRIEVE is a review that did not happen, and it
  // must not land in the analyzed population — a phone-DB outage would
  // otherwise report as a day of calls with nothing to coach.
  if (material.transcriptUnavailable) {
    return { ...base, error: 'transcript retrieval failed' };
  }

  // No transcript means nothing to judge. Skipping is not a failure — some
  // conversations legitimately have no recording consent or no captured audio.
  if (!material.transcript.trim()) {
    return { ...base, skipped: true, skipReason: 'no-transcript' };
  }

  const user = buildUserPrompt(material);
  let usd = 0;

  try {
    const parsed = await withCallLog(
      {
        provider: args.provider,
        purpose: 'insights.missed_opportunities',
        pass: 'single_pass',
        caseId: material.conversationId,
        onCost: (cost) => {
          usd = cost?.usd ?? 0;
        },
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
          // The system prompt (persona + rules + KB/plays grounding) is built
          // once per run and identical on every call, while everything specific
          // to THIS call lives in `user`. That makes the system block a large
          // constant prefix — exactly what prompt caching bills once and reads
          // back cheaply, which is the dominant cost lever for this worker.
          cacheSystem: true,
        });
        const out = parseFindings({
          raw: res.text,
          validRuleKeys: args.validRuleKeys,
          defaultSeverityByRule: args.defaultSeverityByRule,
          validCrmRefs: new Set(material.crm.refs),
          // Every block the prompt rendered, kept labelled so the parser can ask
          // not just "was this said" but "by whom, and on what kind of record".
          // The created-leads block is included because it is real rendered text
          // the model may quote, though it is context rather than a citable ref.
          evidence: {
            transcript: material.transcript,
            salesNotes: material.crm.notes,
            ticketNotes: material.crm.ticketNotes ?? '',
            leadsCreated: material.leadsCreated,
            salespersonName: material.agentName,
            soleInternalParty: material.attribution.soleInternalParty,
          },
        });
        if (res.cacheReadTokens || res.cacheWriteTokens) {
          logger.info(
            `[MISSED OPPS] ${material.conversationId}: prompt cache `
              + `read=${res.cacheReadTokens ?? 0} write=${res.cacheWriteTokens ?? 0} `
              + `(total input ${res.tokensIn ?? 0})`,
          );
        }
        return {
          result: { out, res },
          model: res.model,
          rawResponse: res.text,
          retried: false,
          tokensIn: res.tokensIn,
          tokensOut: res.tokensOut,
          cacheReadTokens: res.cacheReadTokens,
          cacheWriteTokens: res.cacheWriteTokens,
        };
      },
    );

    // A response we could not parse is a failed review, not a clean call. It
    // used to return the same empty finding list as a well-handled call, which
    // quietly inflated the clean-call rate every time the model refused or
    // truncated its JSON.
    if (parsed.out.parseFailed) {
      return {
        ...base,
        tokensIn: parsed.res.tokensIn ?? 0,
        tokensOut: parsed.res.tokensOut ?? 0,
        usdCost: usd,
        modelUsed: parsed.res.model,
        error: 'model response was not parseable JSON',
      };
    }

    for (const r of parsed.out.rejectedQuotes) {
      logger.warn(
        `[MISSED OPPS] ${material.conversationId}: dropped ${r.ruleKey} — quote absent from the `
          + `material: "${r.quote.slice(0, 200)}"`,
      );
    }
    if (parsed.out.missingQuotes > 0) {
      logger.warn(
        `[MISSED OPPS] ${material.conversationId}: dropped ${parsed.out.missingQuotes} finding(s) `
          + 'citing no quote, which the prompt contract forbids',
      );
    }
    if (parsed.out.unattributedSpeakers > 0) {
      logger.warn(
        `[MISSED OPPS] ${material.conversationId}: withdrew AGENT attribution on `
          + `${parsed.out.unattributedSpeakers} finding(s) — the quote is real but nothing shows `
          + `${material.agentName} said or wrote it `
          + `(internal parties: ${material.attribution.internalPartyCount ?? 'unknown'})`,
      );
    }

    // Audit the grading pass for the one error it cannot self-check: alleging
    // the rep did not do something the transcript shows them doing. Fails open
    // and costs nothing on the empty results a well-handled call produces.
    const verified = await verifyFindings({
      findings: parsed.out.findings,
      transcript: material.transcript,
      provider: args.provider,
      conversationId: material.conversationId,
      omissionRuleKeys: args.omissionRuleKeys,
      salespersonName: material.agentName,
      // The same validated lead/CM history the grading pass saw, so a documented
      // attempt the rep authored is not read as a miss.
      salesNotes: material.crm.notes,
      attribution: material.attribution,
    });

    return {
      ...base,
      // Cut to the report ceiling only AFTER verification. Applying it during
      // parsing meant a call whose top findings were contradicted came back
      // empty while its sound ones sat unparsed past the cap.
      findings: verified.findings.slice(0, MAX_FINDINGS_PER_CALL),
      tokensIn: (parsed.res.tokensIn ?? 0) + verified.tokensIn,
      tokensOut: (parsed.res.tokensOut ?? 0) + verified.tokensOut,
      usdCost: usd + verified.usdCost,
      modelUsed: parsed.res.model,
    };
  } catch (err) {
    const message = (err as Error)?.message ?? 'unknown analyzer error';
    logger.warn(`[MISSED OPPS] analysis failed for ${material.conversationId}: ${message}`);
    return { ...base, usdCost: usd, error: message };
  }
}

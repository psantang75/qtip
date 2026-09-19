/**
 * MissedOpportunitiesWorker — nightly LLM review of the prior business day's
 * connected sales calls.
 *
 * Extends `BaseInsightsWorker` for the lock + ie_ingestion_log behaviour every
 * other Insights worker has (so this shows up in the same operational views),
 * and adds three things the SQL workers don't need:
 *
 *   1. A daily USD cap, checked before every model call. When it trips the run
 *      finishes as PARTIAL with whatever it already produced rather than
 *      failing — half a review is worth more than none, and the cap exists to
 *      stop runaway spend, not to discard work.
 *   2. Bounded concurrency, so a 60-call day doesn't open 60 provider sockets.
 *   3. Per-call try/catch. One unparseable transcript must not cost the other
 *      agents their findings, so per-call failures are counted and the run is
 *      marked PARTIAL.
 *
 * Idempotency is by `run_date`: the insert transaction deletes that date's
 * findings first, so a re-run after a rule change replaces the day cleanly.
 * That is what makes the manual re-run endpoint safe.
 */
import logger from '../config/logger';
import { BaseInsightsWorker, WorkerResult } from './BaseInsightsWorker';
import {
  loadCallMaterial,
  selectCandidateCalls,
} from '../services/insights/missedOpportunities/candidates';
import { loadCrmActivityByAgent } from '../services/insights/missedOpportunities/crmActivity';
import { loadCreatedLeadsByAgent } from '../services/insights/missedOpportunities/crmCreated';
import { resolveCallCrmRecord } from '../services/insights/missedOpportunities/crmLink';
import {
  analyzeCall,
  buildSystemPrompt,
  resolveProvider,
  resolveTierModel,
} from '../services/insights/missedOpportunities/analyzer';
import { listActiveRules } from '../services/insights/missedOpportunities/rules.service';
import { getMissedOpportunitySettings } from '../services/insights/missedOpportunities/settings';
import { buildGroundingBlock } from '../services/insights/missedOpportunities/grounding';
import { getSalesPlaysSettings } from '../services/insights/missedOpportunities/salesPlays/settings';
import { renderPlaysForPrompt } from '../services/insights/missedOpportunities/salesPlays/plays.service';
import { recordRun, replaceFindings, resolvePriorBusinessDay, resolveEmployeeKeys, type PendingFinding } from '../services/insights/missedOpportunities/workerSupport';
export { resolvePriorBusinessDay } from '../services/insights/missedOpportunities/workerSupport';

/** Parallel model calls in flight. Four keeps a 60-call day under ~3 minutes. */
const CONCURRENCY = 4;

const SERVICE = 'MissedOpportunitiesWorker';

export class MissedOpportunitiesWorker extends BaseInsightsWorker {
  /** Business day to analyze (YYYY-MM-DD). Defaults to the prior business day. */
  private readonly requestedDate: string | null;

  constructor(runDate?: string) {
    super('MissedOpportunitiesWorker', 'phone+crm+llm');
    this.requestedDate = runDate ?? null;
  }

  protected async execute(): Promise<WorkerResult> {
    const runDate = this.requestedDate ?? (await resolvePriorBusinessDay());
    const settings = await getMissedOpportunitySettings();

    const provider = resolveProvider();
    if (!provider) {
      // Not an error: dev and test environments legitimately run without an AI
      // key. Recording it as a failed run row makes that visible on the report
      // instead of looking like a silent day with no misses.
      await recordRun(runDate, {
        status: 'FAILED',
        errorText: 'No AI provider configured (set OPENAI_API_KEY or ANTHROPIC_API_KEY)',
      });
      logger.warn(`[${SERVICE}] no AI provider configured; skipping ${runDate}`);
      return { rowsExtracted: 0, rowsLoaded: 0, rowsSkipped: 0, rowsErrored: 0 };
    }

    const rules = await listActiveRules();
    if (rules.length === 0) {
      await recordRun(runDate, {
        status: 'FAILED',
        errorText: 'No active rules in ie_missed_opportunity_rule',
      });
      logger.warn(`[${SERVICE}] no active rules; skipping ${runDate}`);
      return { rowsExtracted: 0, rowsLoaded: 0, rowsSkipped: 0, rowsErrored: 0 };
    }

    const candidates = await selectCandidateCalls({
      runDate,
      minTalkSecs: settings.minTalkSecs,
      excludedAgents: settings.excludedAgents,
      maxCalls: settings.maxCallsPerRun,
    });

    await recordRun(runDate, { status: 'RUNNING', callsConsidered: candidates.length });
    logger.info(`[${SERVICE}] ${runDate}: ${candidates.length} candidate call(s)`, { service: SERVICE });

    if (candidates.length === 0) {
      await recordRun(runDate, { status: 'SUCCESS', callsConsidered: 0, finishedAt: new Date() });
      await replaceFindings(runDate, []);
      return { rowsExtracted: 0, rowsLoaded: 0, rowsSkipped: 0, rowsErrored: 0 };
    }

    // Fetched once per run and shared across every call's prompt. Non-fatal: an
    // unconfigured KB or a failed page just yields no grounding, and the review
    // runs exactly as it did before Phase 1.
    const kbGrounding = await buildGroundingBlock(settings.kbAnchorUrls);
    if (kbGrounding) {
      logger.info(
        `[${SERVICE}] ${runDate}: KB grounding loaded (${kbGrounding.length} chars from ` +
          `${settings.kbAnchorUrls.length} anchor(s))`,
        { service: SERVICE },
      );
    }

    // Phase 2: blend admin-approved mined plays into the grounding, but only when
    // the learning loop is enabled — the toggle severs both mining AND injection,
    // so turning it off returns the review to KB-only grounding immediately.
    let playsBlock = '';
    const playsSettings = await getSalesPlaysSettings();
    if (playsSettings.enabled) {
      playsBlock = await renderPlaysForPrompt();
      if (playsBlock) {
        logger.info(`[${SERVICE}] ${runDate}: sales plays grounding loaded (${playsBlock.length} chars)`, {
          service: SERVICE,
        });
      }
    }

    const grounding = [kbGrounding, playsBlock].filter(Boolean).join('\n\n');
    const systemPrompt = buildSystemPrompt(rules, settings.systemPersona, grounding);
    const validRuleKeys = new Set(rules.map((r) => r.rule_key));
    const defaultSeverityByRule = new Map(rules.map((r) => [r.rule_key, r.severity as string]));
    // Only rules whose miss is a skipped step may be audited by the verification
    // pass; the content-graded ones (voicemail wording, conduct) would be
    // deleted by its "did the rep attempt this?" question. Read from the rule
    // rows already in hand, so the flag stays where an admin sets it.
    const omissionRuleKeys = new Set(
      rules.filter((r) => r.is_omission).map((r) => r.rule_key),
    );
    const model = resolveTierModel(provider, settings.modelTier);
    const crmByAgent = await loadCrmActivityByAgent(candidates, runDate);
    // Separate read from the notes above: those show work LOGGED, this shows
    // records CREATED, which is what the expansion rule needs to tell "never
    // captured the other locations" from "opened a lead for them".
    const leadsByAgent = await loadCreatedLeadsByAgent(candidates, runDate);
    const employeeKeys = await resolveEmployeeKeys(candidates);

    const findings: PendingFinding[] = [];
    let analyzed = 0;
    let failed = 0;
    let skipped = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    let usdCost = 0;
    let capTripped = false;
    let modelUsed: string | null = null;

    let cursor = 0;
    const runOne = async (): Promise<void> => {
      for (;;) {
        const index = cursor++;
        if (index >= candidates.length) return;
        // Checked inside the loop rather than once up front so the cap stops
        // spend mid-run, which is the only point at which it can help.
        if (usdCost >= settings.dailyUsdCap) {
          capTripped = true;
          return;
        }
        const candidate = candidates[index];
        // Resolve the one task/ticket this call was about, from its phone
        // number, and feed the model THAT record's full history so it grades
        // the call against what was already done. Falls back to the agent's
        // day-wide notes when the number can't be resolved to a record.
        const resolved = await resolveCallCrmRecord(candidate).catch(() => null);
        // A resolution that did not land on a record must NOT fall back to the
        // agent's day-wide notes: those are other customers' histories, and
        // presenting them as this account's is how a lookup failure became
        // "there is no documentation of a warranty offer". The resolver's own
        // block already says why it found nothing, which is the honest input.
        const crm = resolved
          ? resolved.crm
          : crmByAgent.get(candidate.agentName) ?? { notes: '', refs: [] };
        const material = await loadCallMaterial(
          candidate,
          crm,
          leadsByAgent.has(candidate.agentName) ? leadsByAgent.get(candidate.agentName)! : null,
          resolved?.attribution,
        );
        const result = await analyzeCall({
          material,
          provider,
          model,
          systemPrompt,
          validRuleKeys,
          defaultSeverityByRule,
          omissionRuleKeys,
        });

        tokensIn += result.tokensIn;
        tokensOut += result.tokensOut;
        usdCost += result.usdCost;
        if (result.modelUsed) modelUsed = result.modelUsed;

        if (result.error) {
          failed += 1;
        } else if (result.skipped) {
          skipped += 1;
        } else {
          analyzed += 1;
          // Only a VERIFIED resolution may overwrite the model's citation. The
          // model's ref was at least checked against the tokens it was shown; a
          // resolution that is merely provisional is the closest of several
          // records on a shared phone number, and letting that win is what
          // deep-linked managers into an unrelated La Mesa account. Verified
          // means the phone match was corroborated by something else about the
          // call, so it is the better of the two answers.
          const authoritative = resolved?.outcome === 'verified' ? resolved : null;
          if (resolved && resolved.outcome !== 'verified') {
            logger.info(
              `[MISSED OPPS] ${candidate.conversationId}: CRM resolution `
                + `${resolved.outcome} (${resolved.crm.resolution?.reason ?? 'no reason recorded'}) `
                + '— keeping the model\'s citation',
            );
          }
          for (const f of result.findings) {
            findings.push({
              ...f,
              crmRefKind: authoritative?.kind ?? f.crmRefKind,
              crmRefId: authoritative?.id ?? f.crmRefId,
              candidate,
              employeeKey: employeeKeys.get((candidate.agentEmail ?? '').toLowerCase()) ?? null,
            });
          }
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, runOne));

    await replaceFindings(runDate, findings);

    const status = failed > 0 || capTripped ? 'PARTIAL' : 'SUCCESS';
    const errorText = capTripped
      ? `Daily cost cap of $${settings.dailyUsdCap.toFixed(2)} reached after ${analyzed} call(s)`
      : failed > 0
        ? `${failed} call(s) could not be analyzed`
        : null;

    await recordRun(runDate, {
      status,
      callsConsidered: candidates.length,
      callsAnalyzed: analyzed,
      callsFailed: failed,
      callsSkipped: skipped,
      findingsCount: findings.length,
      tokensIn,
      tokensOut,
      usdCost,
      modelUsed,
      errorText,
      finishedAt: new Date(),
    });

    logger.info(
      `[${SERVICE}] ${runDate}: ${status} — ${analyzed} analyzed, ${skipped} skipped, ` +
        `${failed} failed, ${findings.length} finding(s), $${usdCost.toFixed(4)}`,
      { service: SERVICE },
    );

    return {
      rowsExtracted: candidates.length,
      rowsLoaded: findings.length,
      rowsSkipped: skipped,
      rowsErrored: failed,
      batchIdentifier: runDate,
    };
  }

}

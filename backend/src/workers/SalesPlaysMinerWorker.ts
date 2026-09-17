/**
 * SalesPlaysMinerWorker — the monthly, incremental "learning loop" (Phase 2).
 *
 * Once a month it reads the current sales team's connected calls since the last
 * mined day, labels each by its deal OUTCOME (WON/LOST via the account's lead),
 * and asks the model to extract a few REUSABLE plays from the WON calls (and the
 * gaps from LOST ones). Every play lands as 'proposed' for an admin to approve;
 * only approved ('active') plays ever influence a recommendation.
 *
 * Guardrails that keep this from becoming a runaway train:
 *   - The whole loop is gated by the `enabled` setting. Off = nothing runs, and
 *     active plays are not injected into the review prompt either.
 *   - Roster-scoped to the active team only (settings.roster).
 *   - Incremental: resumes from the day after `lastMined`, so a monthly run only
 *     processes new calls. First run seeds a bounded lookback (seedDays).
 *   - Budget-capped (monthlyUsdCap), checked before every model call; when it
 *     trips the run finishes PARTIAL with what it produced and does NOT advance
 *     `lastMined`, so the leftover window is retried next month (already-mined
 *     conversations are skipped, so nothing is double-charged).
 *
 * Extends BaseInsightsWorker for the same lock + ie_ingestion_log visibility as
 * every other Insights worker.
 */
import logger from '../config/logger';
import { BaseInsightsWorker, WorkerResult } from './BaseInsightsWorker';
import { resolvePriorBusinessDay } from './MissedOpportunitiesWorker';
import {
  loadTranscript,
  selectCandidateCallsInRange,
} from '../services/insights/missedOpportunities/candidates';
import { resolveProvider, resolveTierModel } from '../services/insights/missedOpportunities/analyzer';
import { getMissedOpportunitySettings } from '../services/insights/missedOpportunities/settings';
import {
  getSalesPlaysSettings,
  setLastMined,
} from '../services/insights/missedOpportunities/salesPlays/settings';
import { labelCallOutcome } from '../services/insights/missedOpportunities/salesPlays/outcome';
import {
  insertProposedPlays,
  minedConversationIds,
  type NewSalesPlay,
} from '../services/insights/missedOpportunities/salesPlays/plays.service';
import { consolidatePlays } from '../services/insights/missedOpportunities/salesPlays/consolidate';
import {
  buildMinerSystemPrompt,
  extractPlays,
} from '../services/insights/missedOpportunities/salesPlays/extractor';

const SERVICE = 'SalesPlaysMinerWorker';
/** Hard ceiling on calls pulled into a single mine, independent of the USD cap. */
const MAX_CANDIDATES = 2000;

const ZERO: WorkerResult = { rowsExtracted: 0, rowsLoaded: 0, rowsSkipped: 0, rowsErrored: 0 };

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export class SalesPlaysMinerWorker extends BaseInsightsWorker {
  constructor() {
    super('SalesPlaysMinerWorker', 'phone+crm+llm');
  }

  protected async execute(): Promise<WorkerResult> {
    const plays = await getSalesPlaysSettings();
    if (!plays.enabled) {
      logger.info(`[${SERVICE}] disabled — skipping mine`, { service: SERVICE });
      return ZERO;
    }
    if (plays.roster.length === 0) {
      logger.info(`[${SERVICE}] empty roster — nothing to mine`, { service: SERVICE });
      return ZERO;
    }

    const provider = resolveProvider();
    if (!provider) {
      logger.warn(`[${SERVICE}] no AI provider configured — skipping mine`, { service: SERVICE });
      return ZERO;
    }

    const mo = await getMissedOpportunitySettings();
    const model = resolveTierModel(provider, mo.modelTier);
    const systemPrompt = buildMinerSystemPrompt(mo.systemPersona);

    const end = await resolvePriorBusinessDay();
    const start = plays.lastMined ? addDaysYmd(plays.lastMined, 1) : addDaysYmd(end, -(plays.seedDays - 1));
    if (start > end) {
      logger.info(`[${SERVICE}] already up to date (last mined ${plays.lastMined})`, { service: SERVICE });
      return ZERO;
    }
    logger.info(`[${SERVICE}] mining ${start}..${end} for [${plays.roster.join(', ')}]`, { service: SERVICE });

    const candidates = await selectCandidateCallsInRange({
      startDate: start,
      endDate: end,
      minTalkSecs: mo.minTalkSecs,
      roster: plays.roster,
      maxCalls: MAX_CANDIDATES,
    });
    const alreadyMined = await minedConversationIds();
    const fresh = candidates.filter((c) => !alreadyMined.has(c.conversationId));

    // Label first (cheap CRM reads), keep only calls with a known result, and
    // put WON calls first so budget favours learning what actually works.
    const labeled: { conversationId: string; agentName: string; outcome: 'WON' | 'LOST' }[] = [];
    for (const c of fresh) {
      const outcome = await labelCallOutcome(c.conversationId);
      if (outcome === 'WON' || outcome === 'LOST') {
        labeled.push({ conversationId: c.conversationId, agentName: c.agentName, outcome });
      }
    }
    labeled.sort((a, b) => (a.outcome === b.outcome ? 0 : a.outcome === 'WON' ? -1 : 1));

    let usd = 0;
    let errored = 0;
    let skipped = fresh.length - labeled.length;
    let budgetTripped = false;
    const collected: NewSalesPlay[] = [];

    for (const l of labeled) {
      if (usd >= plays.monthlyUsdCap) {
        budgetTripped = true;
        logger.warn(`[${SERVICE}] monthly cap $${plays.monthlyUsdCap} reached — finishing PARTIAL`, { service: SERVICE });
        break;
      }
      const loaded = await loadTranscript(l.conversationId);
      // A retrieval failure is an error, not a call with nothing to learn from —
      // counting it as skipped would hide a phone-DB outage behind a thin mine.
      if (loaded.unavailable) { errored++; continue; }
      if (!loaded.text.trim()) { skipped++; continue; }

      const r = await extractPlays({
        conversationId: l.conversationId,
        agentName: l.agentName,
        transcript: loaded.text,
        outcome: l.outcome,
        provider,
        model,
        systemPrompt,
      });
      usd += r.usdCost;
      if (r.error) { errored++; continue; }
      collected.push(...r.plays);
    }

    const inserted = collected.length ? await insertProposedPlays(collected) : 0;

    // Collapse this batch's near-duplicates into canonical exemplars (support
    // counts roll up), so the review queue and reviewer prompt stay compact.
    // Best-effort: a consolidation failure must not fail the mine or lose plays.
    if (inserted > 0) {
      try {
        const c = await consolidatePlays();
        if (!c.skipped) {
          logger.info(
            `[${SERVICE}] consolidated: ${c.exemplars} exemplars, ${c.archived} dupes archived, ${c.bumped} canon bumped`,
            { service: SERVICE },
          );
        }
      } catch (err) {
        logger.warn(`[${SERVICE}] consolidation failed (plays kept as-is): ${(err as Error).message}`, {
          service: SERVICE,
        });
      }
    }

    // Only advance the resume point on a complete window. On a budget-partial we
    // leave lastMined alone; the leftover is retried next month and dedup by
    // conversation id keeps already-mined calls from being re-charged.
    if (!budgetTripped) await setLastMined(end);

    logger.info(
      `[${SERVICE}] done: ${fresh.length} fresh, ${labeled.length} labeled, ` +
        `${inserted} plays proposed, ${errored} errors, $${usd.toFixed(2)} spent`,
      { service: SERVICE },
    );

    return {
      rowsExtracted: fresh.length,
      rowsLoaded: inserted,
      rowsSkipped: skipped,
      rowsErrored: errored,
      batchIdentifier: `${start}..${end}`,
    };
  }
}

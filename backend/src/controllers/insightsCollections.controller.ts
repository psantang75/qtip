import { Request, Response } from 'express';
import logger from '../config/logger';
import { resolveAaScope } from './insightsAgentActivity.controller';
import { getAgentPerformance as svcGetAgentPerformance } from '../services/insightsCollectionsAgent.service';
import { getCampaignTouch as svcGetCampaignTouch } from '../services/insightsCollectionsCampaign.service';
import {
  getCyclePerformance as svcGetCyclePerformance,
  getCycleInvoices as svcGetCycleInvoices,
  getFailedChargeInvoices as svcGetFailedChargeInvoices,
} from '../services/insightsCollectionsCycle.service';
import type { CollectionsFilters } from '../services/insightsCollections.shared';

/**
 * Insights → Collections controllers. Access is resolved through the shared
 * `ie_page_role_access` model (same as every other Insights page) via
 * `InsightsPermissionService.resolveAccess(pageKey)` — no hardcoded role gate.
 * The resolved data scope (SELF employee key / DEPARTMENT keys) is passed to the
 * service so the queries self-scope, mirroring the Agent Activity read path.
 *
 * Scope resolution itself is `resolveAaScope`, the shared helper Agent Activity
 * exports and Missed Opportunities and Call Length already call. Collections used
 * to keep a private copy of it. Two copies of an authorization gate is the worst
 * place to allow drift: a fix to one silently leaves the other permissive.
 */
interface CollectionsScope {
  selfEmployeeKey: number | null;
  departmentKeys: number[];
}

function parseFilters(req: Request, scope: CollectionsScope): CollectionsFilters {
  const { period, start, end, users, departments, campaign } = req.query as Record<string, string | undefined>;
  return {
    period: period || 'current_month',
    customStart: start,
    customEnd: end,
    users: users ? users.split(',').filter(Boolean) : undefined,
    departments: departments ? departments.split(',').filter(Boolean) : undefined,
    campaign: campaign || undefined,
    selfEmployeeKey: scope.selfEmployeeKey,
    departmentKeys: scope.departmentKeys,
  };
}

export const getCampaignTouch = async (req: Request, res: Response): Promise<void> => {
  try {
    const scope = await resolveAaScope(req, res, 'collections_campaign');
    if (!scope) return;
    // Defaulted in the service, which owns what its aggregate covers — this report
    // scores every dollar against the declined-charge pool, so "all" is All Declined.
    const campaign = (req.query.campaign as string) || undefined;
    // Same currency contract as Cycle Performance: this report sums money against that
    // report's population, so it has to be denominated the same way or the two disagree
    // by whatever CAD happens to be in the window.
    const currency = parseCurrency(req);
    if (currency === null) {
      res.status(400).json({ error: 'Unsupported currency' });
      return;
    }
    res.json(await svcGetCampaignTouch(parseFilters(req, scope), campaign, currency));
  } catch (error) {
    logger.error('collections getCampaignTouch error:', error);
    res.status(500).json({ error: 'Failed to load campaign & touch report' });
  }
};

export const getAgentPerformance = async (req: Request, res: Response): Promise<void> => {
  try {
    const scope = await resolveAaScope(req, res, 'collections_agents');
    if (!scope) return;
    // Same campaign + currency contract as Cycle Invoices. This page measures that
    // report's invoice set, so it has to be handed the same two choices or it would
    // reconcile against a population the caller did not ask for.
    const campaign = (req.query.campaign as string) || undefined;
    const currency = parseCurrency(req);
    if (currency === null) {
      res.status(400).json({ error: 'Unsupported currency' });
      return;
    }
    res.json(await svcGetAgentPerformance(parseFilters(req, scope), campaign, currency));
  } catch (error) {
    logger.error('collections getAgentPerformance error:', error);
    res.status(500).json({ error: 'Failed to load collections agent performance' });
  }
};

/**
 * Cycle Performance reports one currency at a time, because its measures are sums and
 * USD plus CAD is not a number. An unrecognised code is rejected rather than quietly
 * falling back, so a caller can never be shown USD while believing it asked for CAD.
 */
const CYCLE_CURRENCIES = new Set(['USD', 'CAD']);

function parseCurrency(req: Request): string | undefined | null {
  const raw = req.query.currency;
  if (raw == null || raw === '') return undefined;
  const code = String(raw).toUpperCase();
  return CYCLE_CURRENCIES.has(code) ? code : null;
}

// Non-numeric or negative paging is dropped rather than passed through, so a bad query
// string cannot silently reframe which slice of the population is returned.
const asCount = (v: unknown): number | undefined => {
  const n = Number(v);
  return v == null || v === '' || !Number.isFinite(n) || n < 0 ? undefined : Math.floor(n);
};

export const getCyclePerformance = async (req: Request, res: Response): Promise<void> => {
  try {
    const scope = await resolveAaScope(req, res, 'collections_cycle');
    if (!scope) return;
    const currency = parseCurrency(req);
    if (currency === null) {
      res.status(400).json({ error: 'Unsupported currency' });
      return;
    }
    res.json(await svcGetCyclePerformance(parseFilters(req, scope), { currency }));
  } catch (error) {
    logger.error('collections getCyclePerformance error:', error);
    res.status(500).json({ error: 'Failed to load cycle performance report' });
  }
};

export const getCycleInvoices = async (req: Request, res: Response): Promise<void> => {
  try {
    const scope = await resolveAaScope(req, res, 'collections_cycle_invoices');
    if (!scope) return;
    const currency = parseCurrency(req);
    if (currency === null) {
      res.status(400).json({ error: 'Unsupported currency' });
      return;
    }
    const result = (req.query.result as string) || undefined;
    res.json(await svcGetCycleInvoices(parseFilters(req, scope), {
      result,
      limit: asCount(req.query.limit),
      offset: asCount(req.query.offset),
      currency,
    }));
  } catch (error) {
    logger.error('collections getCycleInvoices error:', error);
    res.status(500).json({ error: 'Failed to load cycle invoice list' });
  }
};

/**
 * Failed Charge Invoices — the declined slice of Cycle Invoices, filtered by decline
 * reason. Same access audience and currency contract as Cycle Invoices.
 */
export const getFailedChargeInvoices = async (req: Request, res: Response): Promise<void> => {
  try {
    const scope = await resolveAaScope(req, res, 'collections_failed_charges');
    if (!scope) return;
    const currency = parseCurrency(req);
    if (currency === null) {
      res.status(400).json({ error: 'Unsupported currency' });
      return;
    }
    const reason = (req.query.reason as string) || undefined;
    res.json(await svcGetFailedChargeInvoices(parseFilters(req, scope), {
      reason,
      limit: asCount(req.query.limit),
      offset: asCount(req.query.offset),
      currency,
    }));
  } catch (error) {
    logger.error('collections getFailedChargeInvoices error:', error);
    res.status(500).json({ error: 'Failed to load failed charge invoice list' });
  }
};

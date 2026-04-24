import { Request, Response } from 'express';
import { serviceLogger } from '../config/logger';
import { resolvePeriod } from '../utils/periodUtils';
import {
  getOnDemandReport,
  getOnDemandFilterOptions,
  listOnDemandReportsForRole,
  type OnDemandReportFilters,
  type OnDemandReportUser,
} from '../services/onDemandReportsRegistry';
import { formatFilename as escapeFilename } from '../utils/contentDisposition';
import { withQueryTimeout } from '../utils/queryTimeout';
// Local `escapeFilename` removed during pre-production review (item #26).
// `utils/contentDisposition.formatFilename` is the canonical implementation.

const ROLE_NAME_TO_ID: Record<string, number> = {
  Admin: 1,
  QA: 2,
  CSR: 3,
  Trainer: 4,
  Manager: 5,
  Director: 6,
};

function resolveUser(req: Request): OnDemandReportUser | null {
  if (!req.user) return null;
  const role_id = ROLE_NAME_TO_ID[req.user.role] ?? 0;
  return { user_id: req.user.user_id, role: req.user.role, role_id };
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolve the request's period selector into concrete `start_date`/`end_date`
 * strings. Period names mirror the InsightsFilterBar options
 * (`current_month`, `prior_week`, `custom`, …) with `custom` requiring
 * `customStart` + `customEnd`.
 *
 * Returns the rest of the filter shape unchanged, ready to hand off to the
 * registry.
 */
function resolveFilters(
  body: any,
): { ok: true; filters: OnDemandReportFilters } | { ok: false; message: string } {
  const period: string = (body?.period || '').toString().trim().toLowerCase().replace(/\s+/g, '_');

  // Backwards-compat: callers may still pass start_date/end_date directly.
  if (!period) {
    const start = body?.start_date;
    const end = body?.end_date;
    if (typeof start !== 'string' || typeof end !== 'string' || !DATE_RE.test(start) || !DATE_RE.test(end)) {
      return { ok: false, message: 'period is required (or pass start_date+end_date directly).' };
    }
    if (start > end) return { ok: false, message: 'start_date must be on or before end_date.' };
    return { ok: true, filters: pickFilters(body, start, end) };
  }

  if (period === 'custom') {
    const cs = body?.customStart;
    const ce = body?.customEnd;
    if (typeof cs !== 'string' || typeof ce !== 'string' || !DATE_RE.test(cs) || !DATE_RE.test(ce)) {
      return { ok: false, message: 'customStart and customEnd are required for custom periods (YYYY-MM-DD).' };
    }
    if (cs > ce) return { ok: false, message: 'customStart must be on or before customEnd.' };
    return { ok: true, filters: pickFilters(body, cs, ce) };
  }

  const ranges = resolvePeriod(period);
  return {
    ok: true,
    filters: pickFilters(body, toIso(ranges.current.start), toIso(ranges.current.end)),
  };
}

function pickFilters(body: any, start_date: string, end_date: string): OnDemandReportFilters {
  const arr = (v: any): string[] | undefined =>
    Array.isArray(v) && v.length > 0 ? v.map(String).map(s => s.trim()).filter(Boolean) : undefined;
  const str = (v: any): string | undefined =>
    v != null && String(v).trim() ? String(v).trim() : undefined;
  return {
    start_date,
    end_date,
    departments: arr(body?.departments),
    forms: arr(body?.forms),
    agents: arr(body?.agents),
    submissionId: str(body?.submissionId),
    topics: arr(body?.topics),
    status: str(body?.status),
    sessionId: str(body?.sessionId),
  };
}

function reportToSummary(r: ReturnType<typeof getOnDemandReport>) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    columns: r.columns,
    supportedFilters: r.supportedFilters,
    defaultFilters: r.defaultFilters ?? {},
  };
}

/**
 * GET /api/on-demand-reports
 * List the reports the current user is allowed to run.
 */
export const listReports = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = resolveUser(req);
    if (!user) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }

    const reports = listOnDemandReportsForRole(user.role_id).map(r => reportToSummary(r));
    res.json({ success: true, data: reports });
  } catch (error) {
    serviceLogger.error('on-demand-reports', 'listReports', error as Error, req.user?.user_id);
    res.status(500).json({ success: false, message: 'Failed to list reports' });
  }
};

/**
 * GET /api/on-demand-reports/:id
 */
export const getReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = resolveUser(req);
    if (!user) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }

    const report = getOnDemandReport(req.params.id);
    if (!report) { res.status(404).json({ success: false, message: 'Report not found' }); return; }
    if (!report.roles.includes(user.role_id)) {
      res.status(403).json({ success: false, message: 'Access denied for this report' });
      return;
    }

    res.json({ success: true, data: reportToSummary(report) });
  } catch (error) {
    serviceLogger.error('on-demand-reports', 'getReport', error as Error, req.user?.user_id);
    res.status(500).json({ success: false, message: 'Failed to fetch report metadata' });
  }
};

/**
 * POST /api/on-demand-reports/:id/data
 * Body: { period, customStart?, customEnd?, departments?, forms?, agents?, submissionId?, page?, pageSize? }
 */
export const getReportData = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = resolveUser(req);
    if (!user) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }

    const report = getOnDemandReport(req.params.id);
    if (!report) { res.status(404).json({ success: false, message: 'Report not found' }); return; }
    if (!report.roles.includes(user.role_id)) {
      res.status(403).json({ success: false, message: 'Access denied for this report' });
      return;
    }

    const resolved = resolveFilters(req.body);
    if (!resolved.ok) { res.status(400).json({ success: false, message: resolved.message }); return; }

    const page = Math.max(1, parseInt(req.body?.page) || 1);
    const pageSizeRaw = parseInt(req.body?.pageSize) || 50;
    const pageSize = Math.min(500, Math.max(10, pageSizeRaw));

    const result = await withQueryTimeout(
      report.getRows(resolved.filters, user, { page, pageSize }),
      `on-demand-report.${report.id}.data`,
    );

    res.json({
      success: true,
      data: {
        columns: report.columns,
        rows: result.rows,
        total: result.total,
        page,
        pageSize,
        appliedRange: { start_date: resolved.filters.start_date, end_date: resolved.filters.end_date },
      },
    });
  } catch (error) {
    serviceLogger.error('on-demand-reports', 'getReportData', error as Error, req.user?.user_id);
    res.status(500).json({ success: false, message: 'Failed to run report' });
  }
};

/**
 * POST /api/on-demand-reports/:id/download
 * Same body shape as `/data`.
 */
export const downloadReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = resolveUser(req);
    if (!user) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }

    const report = getOnDemandReport(req.params.id);
    if (!report) { res.status(404).json({ success: false, message: 'Report not found' }); return; }
    if (!report.roles.includes(user.role_id)) {
      res.status(403).json({ success: false, message: 'Access denied for this report' });
      return;
    }

    const resolved = resolveFilters(req.body);
    if (!resolved.ok) { res.status(400).json({ success: false, message: resolved.message }); return; }

    const { buffer, filename } = await withQueryTimeout(
      report.getXlsx(resolved.filters, user),
      `on-demand-report.${report.id}.xlsx`,
      // Downloads can legitimately scan more rows than a screen view, so
      // double the default deadline before failing the request.
      60_000,
    );

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; ${escapeFilename(filename)}`);
    res.send(buffer);
  } catch (error) {
    serviceLogger.error('on-demand-reports', 'downloadReport', error as Error, req.user?.user_id);
    res.status(500).json({ success: false, message: 'Failed to download report' });
  }
};

/**
 * POST /api/on-demand-reports/:id/filter-options
 * Body: { period, customStart?, customEnd?, departments?, forms?, agents? }
 *
 * Returns the values available for the dept / form / agent dropdowns inside
 * the requested period, cross-filtered by other current selections.
 */
export const getFilterOptions = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = resolveUser(req);
    if (!user) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }

    const report = getOnDemandReport(req.params.id);
    if (!report) { res.status(404).json({ success: false, message: 'Report not found' }); return; }
    if (!report.roles.includes(user.role_id)) {
      res.status(403).json({ success: false, message: 'Access denied for this report' });
      return;
    }

    const resolved = resolveFilters(req.body);
    if (!resolved.ok) { res.status(400).json({ success: false, message: resolved.message }); return; }

    const options = await getOnDemandFilterOptions(
      report.id,
      user,
      { start_date: resolved.filters.start_date, end_date: resolved.filters.end_date },
      {
        departments: resolved.filters.departments,
        forms: resolved.filters.forms,
        agents: resolved.filters.agents,
      },
    );

    res.json({ success: true, data: options });
  } catch (error) {
    serviceLogger.error('on-demand-reports', 'getFilterOptions', error as Error, req.user?.user_id);
    res.status(500).json({ success: false, message: 'Failed to load filter options' });
  }
};

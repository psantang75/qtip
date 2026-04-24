import { AnalyticsService } from './AnalyticsService';
import { MySQLAnalyticsRepository } from '../repositories/MySQLAnalyticsRepository';
import cacheService from './CacheService';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import {
  fetchAllCoachingSessions,
  fetchCoachingSessionsPage,
  generateCoachingSessionsXlsx,
  getCsrRoleId,
  COACHING_SESSIONS_COLUMNS,
  formatCoachingSessionRow,
} from './coachingSessionsReport';

/**
 * On Demand Reports registry.
 *
 * Each report is a thin facade over existing report-generation logic so the
 * paginated in-browser viewer and the xlsx download stay aligned and we
 * don't duplicate SQL or Excel layout code.
 *
 * To add a new report: register a new entry in `ON_DEMAND_REPORTS` below.
 */

export interface OnDemandReportColumn {
  key: string;
  label: string;
  /** Optional column-level alignment hint for the UI. */
  align?: 'left' | 'right' | 'center';
  /**
   * Optional value-formatting hint the UI uses when rendering cells.
   * - `percent`  → number formatted as "86.74%"
   * - `number`   → numeric, 2-decimals when non-integer
   * - `date`     → ISO date string
   * - `text`     → plain string (default)
   */
  format?: 'percent' | 'number' | 'date' | 'text';
}

export interface OnDemandReportUser {
  user_id: number;
  role: string;
  role_id: number;
}

/**
 * Filter shape passed into the report functions. The controller has already
 * resolved `period` + `customStart/End` to concrete `start_date / end_date`
 * by this point. Reports only honor the filters they declare in
 * `supportedFilters`; everything else is ignored.
 */
export interface OnDemandReportFilters {
  start_date: string;
  end_date: string;
  departments?: string[];
  forms?: string[];
  agents?: string[];
  submissionId?: string;
  /** Training topic labels (resolved to list_items.id by the report). */
  topics?: string[];
  /** Coaching session status enum value (e.g. 'CLOSED'). */
  status?: string;
  /** Numeric coaching_sessions.id (session number). */
  sessionId?: string;
}

export type OnDemandFilterKey =
  | 'period' | 'departments' | 'forms' | 'agents' | 'submissionId'
  | 'topics' | 'status' | 'sessionId';

export interface OnDemandReportPage {
  page: number;
  pageSize: number;
}

export interface OnDemandReportRowsResult {
  rows: Record<string, unknown>[];
  total: number;
}

export interface OnDemandReportXlsxResult {
  buffer: Buffer;
  filename: string;
}

export interface OnDemandReport {
  id: string;
  name: string;
  description: string;
  /** Numeric role ids permitted to run this report (matches users.role_id). */
  roles: number[];
  /** Display columns for the in-browser table. */
  columns: OnDemandReportColumn[];
  /**
   * Filter keys the UI should expose for this report. `period` is implied for
   * every report (date range is required), but listing it keeps the contract
   * explicit for the front-end.
   */
  supportedFilters: OnDemandFilterKey[];
  /**
   * Optional default values the UI should pre-populate the filter form with
   * (e.g. coaching defaults to status=CLOSED). Honored on initial load and on
   * Reset Filters.
   */
  defaultFilters?: Partial<Pick<OnDemandReportFilters,
    'departments' | 'forms' | 'agents' | 'submissionId'
    | 'topics' | 'status' | 'sessionId'>>;
  getRows: (
    filters: OnDemandReportFilters,
    user: OnDemandReportUser,
    page: OnDemandReportPage,
  ) => Promise<OnDemandReportRowsResult>;
  getXlsx: (
    filters: OnDemandReportFilters,
    user: OnDemandReportUser,
  ) => Promise<OnDemandReportXlsxResult>;
}

// ── Lazily instantiate the analytics service + repository singletons ─────────
let _analyticsRepository: MySQLAnalyticsRepository | null = null;
function getAnalyticsRepository(): MySQLAnalyticsRepository {
  if (!_analyticsRepository) _analyticsRepository = new MySQLAnalyticsRepository();
  return _analyticsRepository;
}

let _analyticsService: AnalyticsService | null = null;
function getAnalyticsService(): AnalyticsService {
  if (!_analyticsService) {
    _analyticsService = new AnalyticsService(getAnalyticsRepository(), cacheService);
  }
  return _analyticsService;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function timestampedFilename(slug: string): string {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
  return `QTIP_${slug}_${dateStr}_${timeStr}.xlsx`;
}

function isManager(user: OnDemandReportUser): boolean {
  return user.role === 'Manager' || user.role_id === 5;
}

// ── Name → ID resolvers (only fired when the filter is actually used) ────────
async function resolveDepartmentIds(names: string[] | undefined): Promise<number[]> {
  if (!names || names.length === 0) return [];
  const rows = await prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
    SELECT id FROM departments
    WHERE department_name IN (${Prisma.join(names)})
  `);
  return rows.map(r => Number(r.id));
}

async function resolveFormIds(names: string[] | undefined): Promise<number[]> {
  if (!names || names.length === 0) return [];
  const rows = await prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
    SELECT id FROM forms
    WHERE form_name IN (${Prisma.join(names)})
  `);
  return rows.map(r => Number(r.id));
}

async function resolveCsrIds(names: string[] | undefined): Promise<number[]> {
  if (!names || names.length === 0) return [];
  const csrRoleId = await getCsrRoleId();
  if (!csrRoleId) return [];
  const rows = await prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
    SELECT id FROM users
    WHERE role_id = ${csrRoleId}
      AND username IN (${Prisma.join(names)})
  `);
  return rows.map(r => Number(r.id));
}

async function resolveTopicIds(labels: string[] | undefined): Promise<number[]> {
  if (!labels || labels.length === 0) return [];
  const rows = await prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
    SELECT id FROM list_items
    WHERE list_type = 'training_topic'
      AND label IN (${Prisma.join(labels)})
  `);
  return rows.map(r => Number(r.id));
}

// ── Report: Analytics Raw Scores ─────────────────────────────────────────────
// One row per submission / category / question — matching the
// `QTIP_AnalyticsReport_*.xlsx` reference workbook.
const analyticsColumns: OnDemandReportColumn[] = [
  { key: 'submission_id', label: 'Submission ID' },
  { key: 'submission_date', label: 'Date' },
  { key: 'csr_name', label: 'CSR' },
  { key: 'form_name', label: 'Form' },
  { key: 'total_score', label: 'Form Score', align: 'right', format: 'percent' },
  { key: 'category_name', label: 'Category' },
  { key: 'category_score', label: 'Category Score', align: 'right', format: 'percent' },
  { key: 'question_text', label: 'Question' },
  { key: 'question_answer', label: 'Answer' },
  { key: 'question_value', label: 'Value' },
];

interface AnswerOption {
  text: string;
  score: number;
}

interface QuestionMeta {
  question_type: string;
  yes_value: number;
  no_value: number;
  na_value: number;
  scale_max: number | null;
  scale_min: number | null;
}

/**
 * Build per-question option lookups keyed on both option_value and option_text
 * so raw answers like "1,2" or "Tool A, Tool B" both resolve cleanly to the
 * matching `{ text, score }`.
 */
async function buildAnswerOptionLookup(
  questionIds: number[],
): Promise<Map<number, Map<string, AnswerOption>>> {
  const lookup = new Map<number, Map<string, AnswerOption>>();
  if (questionIds.length === 0) return lookup;

  const opts = await prisma.$queryRaw<{
    question_id: number;
    option_value: string;
    option_text: string;
    score: number;
  }[]>(Prisma.sql`
    SELECT question_id, option_value, option_text, score
    FROM radio_options
    WHERE question_id IN (${Prisma.join(questionIds)})
  `);

  for (const opt of opts) {
    const qid = Number(opt.question_id);
    if (!lookup.has(qid)) lookup.set(qid, new Map());
    const map = lookup.get(qid)!;
    const entry: AnswerOption = {
      text: opt.option_text,
      score: Number(opt.score) || 0,
    };
    if (opt.option_value != null) map.set(String(opt.option_value), entry);
    if (opt.option_text != null && !map.has(opt.option_text)) {
      map.set(opt.option_text, entry);
    }
  }
  return lookup;
}

/**
 * Pulls the question_type + yes/no/na/scale metadata so we can compute the
 * "Value" column for question types that don't live in radio_options (yes_no
 * scoring lives on the question, scale is just the raw numeric answer).
 */
async function buildQuestionMetaLookup(
  questionIds: number[],
): Promise<Map<number, QuestionMeta>> {
  const lookup = new Map<number, QuestionMeta>();
  if (questionIds.length === 0) return lookup;

  const rows = await prisma.$queryRaw<{
    id: number;
    question_type: string;
    yes_value: number | null;
    no_value: number | null;
    na_value: number | null;
    scale_max: number | null;
    scale_min: number | null;
  }[]>(Prisma.sql`
    SELECT id, question_type, yes_value, no_value, na_value, scale_max, scale_min
    FROM form_questions
    WHERE id IN (${Prisma.join(questionIds)})
  `);

  for (const r of rows) {
    lookup.set(Number(r.id), {
      question_type: String(r.question_type || '').toUpperCase(),
      yes_value: Number(r.yes_value ?? 0),
      no_value: Number(r.no_value ?? 0),
      na_value: Number(r.na_value ?? 0),
      scale_max: r.scale_max != null ? Number(r.scale_max) : null,
      scale_min: r.scale_min != null ? Number(r.scale_min) : null,
    });
  }
  return lookup;
}

/**
 * Resolves the raw `question_answer` (e.g. "1,2") into human-readable text
 * (e.g. "Tool A, Tool B"). Splits on commas so multi-select answers expand
 * correctly. Falls back to the original token when no match is found.
 */
function resolveAnswerText(
  questionId: number | undefined | null,
  rawAnswer: string,
  lookup: Map<number, Map<string, AnswerOption>>,
): string {
  if (!rawAnswer) return '';
  const qid = questionId != null ? Number(questionId) : NaN;
  const optMap = Number.isFinite(qid) ? lookup.get(qid) : undefined;
  if (!optMap || optMap.size === 0) return rawAnswer;

  const tokens = rawAnswer.split(',').map(t => t.trim()).filter(Boolean);
  if (tokens.length === 0) return rawAnswer;
  return tokens.map(t => optMap.get(t)?.text ?? t).join(', ');
}

/**
 * Resolves the score(s) the answer earned. For multi-select with more than one
 * selection this is a comma-separated string aligned with the Answer column
 * (so operators can see each option's worth). For all single-value cases it
 * returns a `number` so Excel stores it as a number. Non-scoring question
 * types return '' (blank).
 */
function resolveAnswerValue(
  questionId: number | undefined | null,
  rawAnswer: string,
  optionLookup: Map<number, Map<string, AnswerOption>>,
  metaLookup: Map<number, QuestionMeta>,
): number | string {
  if (rawAnswer == null || rawAnswer === '') return '';
  const qid = questionId != null ? Number(questionId) : NaN;
  const meta = Number.isFinite(qid) ? metaLookup.get(qid) : undefined;
  const optMap = Number.isFinite(qid) ? optionLookup.get(qid) : undefined;
  const trimmed = String(rawAnswer).trim();

  if (meta && (meta.question_type === 'TEXT' || meta.question_type === 'INFO_BLOCK')) {
    return '';
  }

  if (meta && meta.question_type === 'YES_NO') {
    const norm = trimmed.toLowerCase();
    if (norm === 'yes') return meta.yes_value;
    if (norm === 'no') return meta.no_value;
    if (norm === 'n/a' || norm === 'na') return meta.na_value;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : trimmed;
  }

  if (meta && meta.question_type === 'SCALE') {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : trimmed;
  }

  if (optMap && optMap.size > 0) {
    const tokens = trimmed.split(',').map(t => t.trim()).filter(Boolean);
    if (tokens.length === 0) return '';
    const scores = tokens.map(t => {
      const opt = optMap.get(t);
      return opt ? opt.score : t;
    });
    if (scores.length === 1) {
      return scores[0];
    }
    return scores.join(', ');
  }

  const n = Number(trimmed);
  return Number.isFinite(n) ? n : trimmed;
}

/**
 * Always-numeric companion to `resolveAnswerValue`. Used only by the Excel
 * download so a single column can be summed/averaged in a spreadsheet — for
 * multi-select this returns the SUM of every selected option's score.
 * Returns `null` when the question type doesn't carry a numeric score (so the
 * Excel cell stays blank rather than 0).
 */
function resolveAnswerTotalValue(
  questionId: number | undefined | null,
  rawAnswer: string,
  optionLookup: Map<number, Map<string, AnswerOption>>,
  metaLookup: Map<number, QuestionMeta>,
): number | null {
  if (rawAnswer == null || rawAnswer === '') return null;
  const qid = questionId != null ? Number(questionId) : NaN;
  const meta = Number.isFinite(qid) ? metaLookup.get(qid) : undefined;
  const optMap = Number.isFinite(qid) ? optionLookup.get(qid) : undefined;
  const trimmed = String(rawAnswer).trim();

  if (meta && (meta.question_type === 'TEXT' || meta.question_type === 'INFO_BLOCK')) {
    return null;
  }

  if (meta && meta.question_type === 'YES_NO') {
    const norm = trimmed.toLowerCase();
    if (norm === 'yes') return meta.yes_value;
    if (norm === 'no') return meta.no_value;
    if (norm === 'n/a' || norm === 'na') return meta.na_value;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }

  if (meta && meta.question_type === 'SCALE') {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }

  if (optMap && optMap.size > 0) {
    const tokens = trimmed.split(',').map(t => t.trim()).filter(Boolean);
    if (tokens.length === 0) return null;
    return tokens.reduce<number>((sum, t) => {
      const opt = optMap.get(t);
      return sum + (opt ? Number(opt.score) || 0 : 0);
    }, 0);
  }

  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Augments analytics rows in-place with the resolved `question_answer`
 * (verbiage) and a numeric `question_value` column. When `includeTotalValue`
 * is true, also tacks on `question_total_value` — an always-numeric column
 * (sum-of-scores for multi-select) used exclusively by the Excel download.
 * Lookups are batched so we never N+1 the underlying tables.
 */
async function augmentAnalyticsRowsWithAnswerText(
  rows: any[],
  options: { includeTotalValue?: boolean } = {},
): Promise<any[]> {
  const ids = new Set<number>();
  for (const r of rows) {
    const qid = Number(r.question_id);
    if (Number.isFinite(qid) && qid > 0) ids.add(qid);
  }
  const idArr = Array.from(ids);
  const [optionLookup, metaLookup] = await Promise.all([
    buildAnswerOptionLookup(idArr),
    buildQuestionMetaLookup(idArr),
  ]);

  return rows.map(r => {
    const raw = r.question_answer ?? '';
    const augmented: Record<string, unknown> = {
      ...r,
      question_answer: resolveAnswerText(r.question_id, raw, optionLookup),
      question_value: resolveAnswerValue(r.question_id, raw, optionLookup, metaLookup),
    };
    if (options.includeTotalValue) {
      augmented.question_total_value = resolveAnswerTotalValue(
        r.question_id, raw, optionLookup, metaLookup,
      );
    }
    return augmented;
  });
}

function formatAnalyticsRow(row: any): Record<string, unknown> {
  const date = row.submission_date
    ? (row.submission_date instanceof Date
        ? row.submission_date.toISOString().split('T')[0]
        : String(row.submission_date).split('T')[0])
    : '';
  return {
    submission_id: row.submission_id ?? '',
    submission_date: date,
    csr_name: row.csr_name ?? '',
    form_name: row.form_name ?? '',
    total_score: row.total_score != null ? Number(row.total_score) : null,
    category_name: row.category_name ?? '',
    category_score: row.category_score != null ? Number(row.category_score) : null,
    question_text: row.question_text ?? row.question ?? '',
    question_answer: row.question_answer ?? '',
    question_value: row.question_value !== undefined && row.question_value !== null
      ? row.question_value
      : '',
  };
}

/**
 * Resolve the analytics filter shape that gets passed into
 * `getDetailedSubmissionData`. `includeQuestionBreakdown: true` is what makes
 * the repo join through to category + question rows (otherwise we only get one
 * submission-level row).
 */
async function buildAnalyticsRepoFilters(
  filters: OnDemandReportFilters,
): Promise<Record<string, unknown>> {
  const [departmentIds, formIds, csrIds] = await Promise.all([
    resolveDepartmentIds(filters.departments),
    resolveFormIds(filters.forms),
    resolveCsrIds(filters.agents),
  ]);

  const repoFilters: Record<string, unknown> = {
    start_date: filters.start_date,
    end_date: filters.end_date,
    includeQuestionBreakdown: true,
  };
  if (departmentIds.length > 0) repoFilters.departmentIds = departmentIds;
  if (formIds.length > 0) repoFilters.formIds = formIds;
  if (csrIds.length > 0) repoFilters.csrIds = csrIds;
  return repoFilters;
}

function applySubmissionIdFilter(rows: any[], submissionId: string | undefined): any[] {
  if (!submissionId) return rows;
  const needle = String(submissionId).trim();
  if (!needle) return rows;
  return rows.filter(r => String(r.submission_id ?? '').includes(needle));
}

const analyticsRawScoresReport: OnDemandReport = {
  id: 'analytics-raw-scores',
  name: 'QA Analytics - Raw Scores',
  description:
    'Detailed quality scores for the selected date range. One row per submission/category/question, ' +
    'matching the data in the QA Analytics export workbook.',
  roles: [1, 5],
  columns: analyticsColumns,
  supportedFilters: ['period', 'departments', 'forms', 'agents', 'submissionId'],
  async getRows(filters, user, page) {
    const repoFilters = await buildAnalyticsRepoFilters(filters);
    const repo = getAnalyticsRepository();
    const allRowsRaw: any[] = await repo.getDetailedSubmissionData(
      repoFilters,
      user.user_id,
      user.role,
    );
    const filteredRaw = applySubmissionIdFilter(allRowsRaw, filters.submissionId);
    const total = filteredRaw.length;
    const start = (page.page - 1) * page.pageSize;
    // Resolve verbiage only on the visible page slice — keeps pagination snappy.
    const pageSlice = filteredRaw.slice(start, start + page.pageSize);
    const augmented = await augmentAnalyticsRowsWithAnswerText(pageSlice);
    return { rows: augmented.map(formatAnalyticsRow), total };
  },
  async getXlsx(filters, user) {
    const repoFilters = await buildAnalyticsRepoFilters(filters);
    const svc = getAnalyticsService();
    const repo = getAnalyticsRepository();

    // Always go through the row-based exporter so the workbook matches the
    // on-screen view (including the resolved Answer verbiage and Value column).
    const allRowsRaw: any[] = await repo.getDetailedSubmissionData(
      repoFilters,
      user.user_id,
      user.role,
    );
    const filtered = applySubmissionIdFilter(allRowsRaw, filters.submissionId);
    const augmented = await augmentAnalyticsRowsWithAnswerText(filtered, {
      includeTotalValue: true,
    });
    const buffer = await svc.buildComprehensiveExportFromRows(
      augmented, repoFilters, user.user_id, user.role,
    );
    return { buffer, filename: timestampedFilename('AnalyticsReport') };
  },
};

// ── Report: Coaching Sessions ────────────────────────────────────────────────
const coachingColumns: OnDemandReportColumn[] = COACHING_SESSIONS_COLUMNS.map(c => ({
  key: c.key,
  label: c.label,
}));

/**
 * Build the shared filter object passed into `coachingSessionsReport`
 * helpers. Resolves agent / department / topic NAMES to IDs so the SQL stays
 * consistent regardless of label variations. Multi-agent filtering still has
 * to happen post-fetch since the legacy helper only accepts a single csr_id.
 */
async function buildCoachingFilters(
  filters: OnDemandReportFilters,
  user: OnDemandReportUser,
  csrRoleId: number,
): Promise<{ where: any; csrIds: number[] }> {
  const [csrIds, deptIds, topicIds] = await Promise.all([
    resolveCsrIds(filters.agents),
    resolveDepartmentIds(filters.departments),
    resolveTopicIds(filters.topics),
  ]);
  const sessionId = filters.sessionId
    ? Number(String(filters.sessionId).replace(/[^0-9]/g, ''))
    : undefined;
  return {
    where: {
      csrRoleId,
      start_date: filters.start_date,
      end_date: filters.end_date,
      managerId: isManager(user) ? user.user_id : undefined,
      csr_id: csrIds.length === 1 ? csrIds[0] : undefined,
      departmentIds: deptIds.length > 0 ? deptIds : undefined,
      topicIds: topicIds.length > 0 ? topicIds : undefined,
      status: filters.status || undefined,
      id: sessionId && Number.isFinite(sessionId) ? sessionId : undefined,
    },
    csrIds,
  };
}

const coachingSessionsReport: OnDemandReport = {
  id: 'coaching-sessions',
  name: 'Coaching Sessions',
  description:
    'All coaching sessions delivered in the selected date range, including CSR, manager/trainer, ' +
    'topics, status, and notes. Mirrors the Coaching Sessions export workbook.',
  roles: [1, 5],
  columns: coachingColumns,
  supportedFilters: ['period', 'agents', 'departments', 'topics', 'status', 'sessionId'],
  defaultFilters: { status: 'CLOSED' },
  async getRows(filters, user, page) {
    const csrRoleId = await getCsrRoleId();
    if (!csrRoleId) throw new Error('CSR role not found');
    const { where, csrIds } = await buildCoachingFilters(filters, user, csrRoleId);

    const offset = (page.page - 1) * page.pageSize;
    const { sessions, totalCount } = await fetchCoachingSessionsPage(
      where,
      { limit: page.pageSize, offset },
    );

    let rows = sessions.map(s => formatCoachingSessionRow(s as any));
    if (csrIds.length > 1) {
      const idSet = new Set(csrIds.map(Number));
      rows = rows.filter(r => idSet.has(Number((r as any).csr_id)));
    }
    return { rows, total: csrIds.length > 1 ? rows.length : totalCount };
  },
  async getXlsx(filters, user) {
    const csrRoleId = await getCsrRoleId();
    if (!csrRoleId) throw new Error('CSR role not found');
    const { where, csrIds } = await buildCoachingFilters(filters, user, csrRoleId);

    let sessions = await fetchAllCoachingSessions(where);
    if (csrIds.length > 1) {
      const idSet = new Set(csrIds.map(Number));
      sessions = sessions.filter(s => idSet.has(Number((s as any).csr_id)));
    }
    const buffer = await generateCoachingSessionsXlsx(sessions);
    return { buffer, filename: timestampedFilename('CoachingSessions') };
  },
};

// ── Filter options ───────────────────────────────────────────────────────────
export interface OnDemandFilterOptions {
  departments: string[];
  forms: string[];
  agents: string[];
  /** Coaching-only: training topic labels available in the date range. */
  topics?: string[];
  /** Coaching-only: status enum values (always full enum, ordered). */
  statuses?: string[];
}

/** All coaching session statuses in display order. Mirrors the Prisma enum. */
const COACHING_SESSION_STATUSES = [
  'DRAFT', 'SCHEDULED', 'IN_PROCESS', 'AWAITING_CSR_ACTION',
  'QUIZ_PENDING', 'COMPLETED', 'FOLLOW_UP_REQUIRED', 'CLOSED',
] as const;

/**
 * Returns the values available for the dept/form/agent dropdowns inside the
 * given date range, scoped to managers' departments where applicable.
 *
 * Cross-filtered like `/insights/qc/filter-options` — selecting depts narrows
 * the form list, selecting forms narrows the dept list, etc.
 */
export async function getOnDemandFilterOptions(
  reportId: string,
  user: OnDemandReportUser,
  range: { start_date: string; end_date: string },
  selected: { departments?: string[]; forms?: string[]; agents?: string[] },
): Promise<OnDemandFilterOptions> {
  const report = getOnDemandReport(reportId);
  if (!report) {
    return { departments: [], forms: [], agents: [] };
  }
  const csrRoleId = await getCsrRoleId();
  const start = range.start_date;
  const end = `${range.end_date} 23:59:59`;
  const [deptIds, formIds, agentIds] = await Promise.all([
    resolveDepartmentIds(selected.departments),
    resolveFormIds(selected.forms),
    resolveCsrIds(selected.agents),
  ]);

  // Manager scoping — restricts every list to depts the manager owns.
  const managerDeptClause = isManager(user)
    ? Prisma.sql`AND (csr_user.department_id IN (
        SELECT DISTINCT dm.department_id FROM department_managers dm
        WHERE dm.manager_id = ${user.user_id} AND dm.is_active = 1
      ) OR csr_user.department_id IS NULL)`
    : Prisma.sql``;

  const baseJoinForSubmissions = Prisma.sql`
    submissions s
      INNER JOIN forms f ON s.form_id = f.id
      LEFT JOIN (
        SELECT sm.submission_id, sm.value
        FROM submission_metadata sm
        INNER JOIN form_metadata_fields fmf ON sm.field_id = fmf.id AND fmf.field_name = 'CSR'
      ) sm ON s.id = sm.submission_id
      LEFT JOIN users csr_user ON sm.value IS NOT NULL AND CAST(sm.value AS UNSIGNED) = csr_user.id
      LEFT JOIN departments d ON csr_user.department_id = d.id
  `;
  const baseDateClause = Prisma.sql`
    s.submitted_at BETWEEN ${start} AND ${end}
      AND s.status IN ('SUBMITTED', 'FINALIZED')
  `;

  const formClause = formIds.length > 0
    ? Prisma.sql`AND s.form_id IN (${Prisma.join(formIds)})`
    : Prisma.sql``;
  const deptClause = deptIds.length > 0
    ? Prisma.sql`AND csr_user.department_id IN (${Prisma.join(deptIds)})`
    : Prisma.sql``;
  const agentClause = agentIds.length > 0
    ? Prisma.sql`AND csr_user.id IN (${Prisma.join(agentIds)})`
    : Prisma.sql``;

  // ── Departments (scoped by selected forms + agents) ────────────────────────
  let departments: string[] = [];
  if (report.supportedFilters.includes('departments')) {
    if (reportId === 'coaching-sessions') {
      // Departments with coaching activity in this range, scoped by selected
      // agents when present.
      const agentClauseCoach = agentIds.length > 0
        ? Prisma.sql`AND u.id IN (${Prisma.join(agentIds)})`
        : Prisma.sql``;
      const rows = await prisma.$queryRaw<{ department_name: string }[]>(Prisma.sql`
        SELECT DISTINCT d.department_name
        FROM coaching_sessions cs
        INNER JOIN users u ON cs.csr_id = u.id
        INNER JOIN departments d ON u.department_id = d.id
        WHERE u.role_id = ${csrRoleId ?? 0}
          AND DATE(cs.session_date) BETWEEN ${range.start_date} AND ${range.end_date}
          ${agentClauseCoach}
          ${isManager(user)
            ? Prisma.sql`AND u.department_id IN (
                SELECT DISTINCT dm.department_id FROM department_managers dm
                WHERE dm.manager_id = ${user.user_id} AND dm.is_active = 1
              )`
            : Prisma.sql``}
          AND d.department_name IS NOT NULL
        ORDER BY d.department_name
      `);
      departments = rows.map(r => r.department_name);
    } else {
      const rows = await prisma.$queryRaw<{ department_name: string }[]>(Prisma.sql`
        SELECT DISTINCT d.department_name
        FROM ${baseJoinForSubmissions}
        WHERE ${baseDateClause}
          ${formClause}
          ${agentClause}
          ${managerDeptClause}
          AND d.department_name IS NOT NULL
        ORDER BY d.department_name
      `);
      departments = rows.map(r => r.department_name);
    }
  }

  // ── Forms (scoped by selected depts + agents) ──────────────────────────────
  let forms: string[] = [];
  if (report.supportedFilters.includes('forms')) {
    const rows = await prisma.$queryRaw<{ form_name: string }[]>(Prisma.sql`
      SELECT DISTINCT f.form_name
      FROM ${baseJoinForSubmissions}
      WHERE ${baseDateClause}
        ${deptClause}
        ${agentClause}
        ${managerDeptClause}
      ORDER BY f.form_name
    `);
    forms = rows.map(r => r.form_name);
  }

  // ── Agents — drawn from the pool that has activity for this report ────────
  let agents: string[] = [];
  if (report.supportedFilters.includes('agents')) {
    if (reportId === 'coaching-sessions') {
      // For coaching, the universe is "CSRs with sessions in this range".
      const rows = await prisma.$queryRaw<{ username: string }[]>(Prisma.sql`
        SELECT DISTINCT u.username
        FROM coaching_sessions cs
        INNER JOIN users u ON cs.csr_id = u.id
        LEFT JOIN departments d ON u.department_id = d.id
        WHERE u.role_id = ${csrRoleId ?? 0}
          AND DATE(cs.session_date) BETWEEN ${range.start_date} AND ${range.end_date}
          ${isManager(user)
            ? Prisma.sql`AND (u.department_id IN (
                SELECT DISTINCT dm.department_id FROM department_managers dm
                WHERE dm.manager_id = ${user.user_id} AND dm.is_active = 1
              ))`
            : Prisma.sql``}
        ORDER BY u.username
      `);
      agents = rows.map(r => r.username);
    } else {
      // Analytics: CSRs with submissions in this range, scoped by selected
      // depts + forms.
      const rows = await prisma.$queryRaw<{ username: string }[]>(Prisma.sql`
        SELECT DISTINCT csr_user.username AS username
        FROM ${baseJoinForSubmissions}
        WHERE ${baseDateClause}
          ${deptClause}
          ${formClause}
          ${managerDeptClause}
          AND csr_user.username IS NOT NULL
        ORDER BY csr_user.username
      `);
      agents = rows.map(r => r.username);
    }
  }

  // ── Topics + statuses (coaching-only) ──────────────────────────────────────
  let topics: string[] | undefined;
  let statuses: string[] | undefined;
  if (reportId === 'coaching-sessions') {
    if (report.supportedFilters.includes('topics')) {
      const agentClauseCoach = agentIds.length > 0
        ? Prisma.sql`AND u.id IN (${Prisma.join(agentIds)})`
        : Prisma.sql``;
      const deptClauseCoach = deptIds.length > 0
        ? Prisma.sql`AND u.department_id IN (${Prisma.join(deptIds)})`
        : Prisma.sql``;
      const rows = await prisma.$queryRaw<{ label: string }[]>(Prisma.sql`
        SELECT DISTINCT li.label
        FROM coaching_sessions cs
        INNER JOIN users u ON cs.csr_id = u.id
        INNER JOIN coaching_session_topics cst ON cst.coaching_session_id = cs.id
        INNER JOIN list_items li ON cst.topic_id = li.id AND li.list_type = 'training_topic'
        WHERE u.role_id = ${csrRoleId ?? 0}
          AND DATE(cs.session_date) BETWEEN ${range.start_date} AND ${range.end_date}
          ${agentClauseCoach}
          ${deptClauseCoach}
          ${isManager(user)
            ? Prisma.sql`AND u.department_id IN (
                SELECT DISTINCT dm.department_id FROM department_managers dm
                WHERE dm.manager_id = ${user.user_id} AND dm.is_active = 1
              )`
            : Prisma.sql``}
        ORDER BY li.label
      `);
      topics = rows.map(r => r.label);
    }
    if (report.supportedFilters.includes('status')) {
      // Static enum list — every status should always be selectable so users
      // can switch from the default (Closed) to any other state.
      statuses = [...COACHING_SESSION_STATUSES];
    }
  }

  return { departments, forms, agents, topics, statuses };
}

// ── Registry ─────────────────────────────────────────────────────────────────
export const ON_DEMAND_REPORTS: OnDemandReport[] = [
  analyticsRawScoresReport,
  coachingSessionsReport,
];

export function getOnDemandReport(id: string): OnDemandReport | undefined {
  return ON_DEMAND_REPORTS.find(r => r.id === id);
}

export function listOnDemandReportsForRole(role_id: number): OnDemandReport[] {
  return ON_DEMAND_REPORTS.filter(r => r.roles.includes(role_id));
}

/**
 * Read side of the admin Unlock Register.
 *
 * The register is the abuse-tracking surface: it answers "how many times is
 * this happening, who is driving it, and what did it do to the scores".
 * Raw SQL rather than Prisma includes because `unlocked_by` / `assigned_to`
 * deliberately carry no foreign key (users are deactivated, not deleted), so
 * the user joins have to be explicit LEFT JOINs.
 */
import prisma from '../../config/prisma';
import { Prisma } from '../../generated/prisma/client';

export interface UnlockListParams {
  page: number;
  limit: number;
  dateStart?: string;
  dateEnd?: string;
  entityType?: string;
  reasonCode?: string;
  state?: string;
  unlockedBy?: number;
  search?: string;
}

export interface UnlockRow {
  id: number;
  entity_type: string;
  entity_id: number;
  submission_id: number;
  unlocked_at: Date;
  unlocked_by: number;
  unlocked_by_name: string | null;
  reason_code: string;
  reason_note: string;
  prior_status: string;
  prior_score: number | null;
  new_status: string | null;
  new_score: number | null;
  score_delta: number | null;
  assigned_to: number | null;
  assigned_to_name: string | null;
  self_service: number;
  beyond_window: number;
  state: string;
  relock_due_at: Date;
  closed_at: Date | null;
  form_name: string | null;
  agent_name: string | null;
}

const ENTITY_TYPES = new Set(['SUBMISSION', 'DISPUTE']);
const STATES = new Set(['OPEN', 'CLOSED', 'AUTO_RELOCKED']);
const REASON_CODES = new Set([
  'SCORING_ERROR',
  'WRONG_INTERACTION',
  'CALIBRATION_CORRECTION',
  'POLICY_CHANGE',
  'TECHNICAL_ISSUE',
  'AGENT_APPEAL',
  'OTHER',
]);

function buildWhere(params: UnlockListParams): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`1 = 1`];

  if (params.dateStart) conditions.push(Prisma.sql`ru.unlocked_at >= ${params.dateStart + ' 00:00:00'}`);
  if (params.dateEnd) conditions.push(Prisma.sql`ru.unlocked_at <= ${params.dateEnd + ' 23:59:59'}`);
  if (params.entityType && ENTITY_TYPES.has(params.entityType)) {
    conditions.push(Prisma.sql`ru.entity_type = ${params.entityType}`);
  }
  if (params.reasonCode && REASON_CODES.has(params.reasonCode)) {
    conditions.push(Prisma.sql`ru.reason_code = ${params.reasonCode}`);
  }
  if (params.state && STATES.has(params.state)) {
    conditions.push(Prisma.sql`ru.state = ${params.state}`);
  }
  if (params.unlockedBy) conditions.push(Prisma.sql`ru.unlocked_by = ${params.unlockedBy}`);
  if (params.search) {
    const like = `%${params.search}%`;
    conditions.push(
      Prisma.sql`(ru.reason_note LIKE ${like} OR actor.username LIKE ${like} OR assignee.username LIKE ${like} OR f.form_name LIKE ${like})`,
    );
  }

  return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
}

/**
 * Joins shared by the rows and count queries. The CSR name comes from the
 * `CSR` metadata field, matching how qa.submissions.list.service.ts resolves
 * the agent on a submission.
 */
const BASE_FROM = Prisma.sql`
  FROM record_unlock ru
  JOIN submissions s ON ru.submission_id = s.id
  JOIN forms f ON s.form_id = f.id
  LEFT JOIN users actor ON ru.unlocked_by = actor.id
  LEFT JOIN users assignee ON ru.assigned_to = assignee.id
  LEFT JOIN (
    SELECT DISTINCT sm.submission_id, sm.value
    FROM submission_metadata sm
    JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
    WHERE fmf.field_name = 'CSR'
  ) csr_meta ON s.id = csr_meta.submission_id
  LEFT JOIN users csr ON CAST(csr_meta.value AS UNSIGNED) = csr.id
`;

export async function listUnlocks(params: UnlockListParams) {
  const where = buildWhere(params);
  const offset = (params.page - 1) * params.limit;

  const rows = await prisma.$queryRaw<UnlockRow[]>(Prisma.sql`
    SELECT
      ru.id,
      ru.entity_type,
      ru.entity_id,
      ru.submission_id,
      ru.unlocked_at,
      ru.unlocked_by,
      actor.username AS unlocked_by_name,
      ru.reason_code,
      ru.reason_note,
      ru.prior_status,
      ru.prior_score,
      ru.new_status,
      ru.new_score,
      (ru.new_score - ru.prior_score) AS score_delta,
      ru.assigned_to,
      assignee.username AS assigned_to_name,
      ru.self_service,
      ru.beyond_window,
      ru.state,
      ru.relock_due_at,
      ru.closed_at,
      f.form_name,
      csr.username AS agent_name
    ${BASE_FROM}
    ${where}
    ORDER BY ru.unlocked_at DESC
    LIMIT ${params.limit} OFFSET ${offset}
  `);

  const countResult = await prisma.$queryRaw<{ total: bigint }[]>(
    Prisma.sql`SELECT COUNT(*) AS total ${BASE_FROM} ${where}`,
  );
  const total = Number(countResult[0]?.total ?? 0);

  return {
    data: rows,
    pagination: { total, page: params.page, limit: params.limit, totalPages: Math.ceil(total / params.limit) },
  };
}

export interface UnlockStats {
  total: number;
  open: number;
  closed: number;
  auto_relocked: number;
  beyond_window: number;
  self_service: number;
  avg_score_delta: number | null;
  finalized_in_range: number;
  per_hundred_finalized: number | null;
  by_admin: Array<{ user_id: number; name: string | null; count: number; avg_score_delta: number | null }>;
  by_assignee: Array<{ user_id: number; name: string | null; count: number }>;
  by_reason: Array<{ reason_code: string; count: number }>;
}

export async function getUnlockStats(params: UnlockListParams): Promise<UnlockStats> {
  const where = buildWhere(params);

  const [totals] = await prisma.$queryRaw<
    Array<{
      total: bigint;
      open: bigint;
      closed: bigint;
      auto_relocked: bigint;
      beyond_window: bigint;
      self_service: bigint;
      avg_score_delta: number | null;
    }>
  >(Prisma.sql`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(ru.state = 'OPEN'), 0) AS open,
      COALESCE(SUM(ru.state = 'CLOSED'), 0) AS closed,
      COALESCE(SUM(ru.state = 'AUTO_RELOCKED'), 0) AS auto_relocked,
      COALESCE(SUM(ru.beyond_window = 1), 0) AS beyond_window,
      COALESCE(SUM(ru.self_service = 1), 0) AS self_service,
      AVG(ru.new_score - ru.prior_score) AS avg_score_delta
    ${BASE_FROM}
    ${where}
  `);

  // Denominator for the rate metric: reviews that actually reached a
  // finalized state in the same window. Without it, a raw reopen count says
  // nothing about whether the volume is unusual.
  const finalizedConditions: Prisma.Sql[] = [Prisma.sql`s.status = 'FINALIZED'`];
  if (params.dateStart) finalizedConditions.push(Prisma.sql`s.submitted_at >= ${params.dateStart + ' 00:00:00'}`);
  if (params.dateEnd) finalizedConditions.push(Prisma.sql`s.submitted_at <= ${params.dateEnd + ' 23:59:59'}`);
  const [finalized] = await prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
    SELECT COUNT(*) AS total FROM submissions s WHERE ${Prisma.join(finalizedConditions, ' AND ')}
  `);

  const byAdmin = await prisma.$queryRaw<
    Array<{ user_id: number; name: string | null; count: bigint; avg_score_delta: number | null }>
  >(Prisma.sql`
    SELECT ru.unlocked_by AS user_id, actor.username AS name, COUNT(*) AS count,
           AVG(ru.new_score - ru.prior_score) AS avg_score_delta
    ${BASE_FROM} ${where}
    GROUP BY ru.unlocked_by, actor.username
    ORDER BY count DESC
  `);

  const byAssignee = await prisma.$queryRaw<Array<{ user_id: number; name: string | null; count: bigint }>>(
    Prisma.sql`
      SELECT ru.assigned_to AS user_id, assignee.username AS name, COUNT(*) AS count
      ${BASE_FROM} ${where}
      AND ru.assigned_to IS NOT NULL
      GROUP BY ru.assigned_to, assignee.username
      ORDER BY count DESC
    `,
  );

  const byReason = await prisma.$queryRaw<Array<{ reason_code: string; count: bigint }>>(Prisma.sql`
    SELECT ru.reason_code, COUNT(*) AS count
    ${BASE_FROM} ${where}
    GROUP BY ru.reason_code
    ORDER BY count DESC
  `);

  const total = Number(totals?.total ?? 0);
  const finalizedInRange = Number(finalized?.total ?? 0);

  return {
    total,
    open: Number(totals?.open ?? 0),
    closed: Number(totals?.closed ?? 0),
    auto_relocked: Number(totals?.auto_relocked ?? 0),
    beyond_window: Number(totals?.beyond_window ?? 0),
    self_service: Number(totals?.self_service ?? 0),
    avg_score_delta: totals?.avg_score_delta != null ? Number(totals.avg_score_delta) : null,
    finalized_in_range: finalizedInRange,
    per_hundred_finalized: finalizedInRange > 0 ? (total / finalizedInRange) * 100 : null,
    by_admin: byAdmin.map((r) => ({
      user_id: r.user_id,
      name: r.name,
      count: Number(r.count),
      avg_score_delta: r.avg_score_delta != null ? Number(r.avg_score_delta) : null,
    })),
    by_assignee: byAssignee.map((r) => ({ user_id: r.user_id, name: r.name, count: Number(r.count) })),
    by_reason: byReason.map((r) => ({ reason_code: r.reason_code, count: Number(r.count) })),
  };
}

/** Unlock history for one record, shown inline on the submission detail page. */
export async function getUnlockHistoryForSubmission(submissionId: number) {
  return prisma.$queryRaw<UnlockRow[]>(Prisma.sql`
    SELECT
      ru.id, ru.entity_type, ru.entity_id, ru.submission_id, ru.unlocked_at,
      ru.unlocked_by, actor.username AS unlocked_by_name,
      ru.reason_code, ru.reason_note, ru.prior_status, ru.prior_score,
      ru.new_status, ru.new_score, (ru.new_score - ru.prior_score) AS score_delta,
      ru.assigned_to, assignee.username AS assigned_to_name,
      ru.self_service, ru.beyond_window, ru.state, ru.relock_due_at, ru.closed_at,
      NULL AS form_name, NULL AS agent_name
    FROM record_unlock ru
    LEFT JOIN users actor ON ru.unlocked_by = actor.id
    LEFT JOIN users assignee ON ru.assigned_to = assignee.id
    WHERE ru.submission_id = ${submissionId}
    ORDER BY ru.unlocked_at DESC
  `);
}

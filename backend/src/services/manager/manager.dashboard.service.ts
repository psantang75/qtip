/**
 * Dashboard data for manager-scoped views:
 *   - `getManagerDashboardStats`: review/dispute/coaching counts (week/month).
 *   - `getManagerCSRActivity`: per-CSR roll-up grid used on the dashboard.
 *
 * Both queries scope to the manager's owned departments (or all active
 * departments for non-Manager callers, matching the legacy behaviour).
 */
import prisma from '../../config/prisma'
import { getManagedDepartmentIds, getVisibleDepartmentIds } from './manager.access'
import type { ManagerDashboardStats, ManagerCSRActivityRow } from './manager.types'
import { withQueryTimeout } from '../../utils/queryTimeout'

const ZERO_STATS: ManagerDashboardStats = {
  reviewsCompleted: { thisWeek: 0, thisMonth: 0 },
  disputes: { thisWeek: 0, thisMonth: 0 },
  coachingSessions: { thisWeek: 0, thisMonth: 0 },
}

/** GET /api/manager/dashboard-stats */
export async function getManagerDashboardStats(userId: number): Promise<ManagerDashboardStats> {
  const departmentIds = await getManagedDepartmentIds(userId)
  if (departmentIds.length === 0) return ZERO_STATS

  const placeholders = departmentIds.map(() => '?').join(',')

  const [reviews, disputes, coaching] = await withQueryTimeout(Promise.all([
    prisma.$queryRawUnsafe<Array<{ thisWeek: bigint | number; thisMonth: bigint | number }>>(`
      SELECT
        COUNT(CASE WHEN s.submitted_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK) THEN 1 END) as thisWeek,
        COUNT(CASE WHEN s.submitted_at >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 END) as thisMonth
      FROM submissions s
      JOIN submission_metadata sm ON s.id = sm.submission_id
      JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      JOIN users u ON u.id = CAST(sm.value AS UNSIGNED)
      JOIN roles r ON u.role_id = r.id
      WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED')
        AND fmf.field_name = 'CSR'
        AND r.role_name = 'CSR'
        AND u.is_active = 1
        AND u.department_id IN (${placeholders})
    `, ...departmentIds),
    prisma.$queryRawUnsafe<Array<{ thisWeek: bigint | number; thisMonth: bigint | number }>>(`
      SELECT
        COUNT(CASE WHEN d.created_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK) THEN 1 END) as thisWeek,
        COUNT(CASE WHEN d.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 END) as thisMonth
      FROM disputes d
      JOIN submissions s ON d.submission_id = s.id
      JOIN submission_metadata sm ON s.id = sm.submission_id
      JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      JOIN users u ON u.id = CAST(sm.value AS UNSIGNED)
      JOIN roles r ON u.role_id = r.id
      WHERE fmf.field_name = 'CSR'
        AND r.role_name = 'CSR'
        AND u.is_active = 1
        AND u.department_id IN (${placeholders})
    `, ...departmentIds),
    prisma.$queryRawUnsafe<Array<{ thisWeek: bigint | number; thisMonth: bigint | number }>>(`
      SELECT
        COUNT(CASE WHEN cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 WEEK) THEN 1 END) as thisWeek,
        COUNT(CASE WHEN cs.session_date >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 END) as thisMonth
      FROM coaching_sessions cs
      JOIN users u ON cs.csr_id = u.id
      JOIN roles r ON u.role_id = r.id
      WHERE cs.status IN ('SCHEDULED', 'COMPLETED')
        AND r.role_name = 'CSR'
        AND u.is_active = 1
        AND u.department_id IN (${placeholders})
    `, ...departmentIds),
  ]), 'manager.dashboardStats')

  return {
    reviewsCompleted: {
      thisWeek: Number(reviews[0]?.thisWeek || 0),
      thisMonth: Number(reviews[0]?.thisMonth || 0),
    },
    disputes: {
      thisWeek: Number(disputes[0]?.thisWeek || 0),
      thisMonth: Number(disputes[0]?.thisMonth || 0),
    },
    coachingSessions: {
      thisWeek: Number(coaching[0]?.thisWeek || 0),
      thisMonth: Number(coaching[0]?.thisMonth || 0),
    },
  }
}

/** GET /api/manager/csr-activity */
export async function getManagerCSRActivity(
  userId: number,
  userRole: string | undefined,
): Promise<ManagerCSRActivityRow[]> {
  const departmentIds = await getVisibleDepartmentIds(userId, userRole)
  if (departmentIds.length === 0) return []

  const placeholders = departmentIds.map(() => '?').join(',')

  // Audit/dispute counters key off the CSR id stored in submission_metadata.
  // Coaching counters key directly off coaching_sessions.csr_id since that
  // table already stores the numeric user id.
  const rows = await withQueryTimeout(prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT
      u.id,
      u.username as name,
      d.department_name as department,
      COALESCE(audit_counts.audits, 0) as audits,
      COALESCE(dispute_counts.disputes, 0) as disputes,
      COALESCE(coaching_scheduled.coachingScheduled, 0) as coachingScheduled,
      COALESCE(coaching_completed.coachingCompleted, 0) as coachingCompleted,
      COALESCE(audit_counts_week.audits_week, 0) as audits_week,
      COALESCE(dispute_counts_week.disputes_week, 0) as disputes_week,
      COALESCE(audit_counts_month.audits_month, 0) as audits_month,
      COALESCE(dispute_counts_month.disputes_month, 0) as disputes_month,
      COALESCE(coaching_scheduled_week.coachingScheduled_week, 0) as coachingScheduled_week,
      COALESCE(coaching_completed_week.coachingCompleted_week, 0) as coachingCompleted_week,
      COALESCE(coaching_scheduled_month.coachingScheduled_month, 0) as coachingScheduled_month,
      COALESCE(coaching_completed_month.coachingCompleted_month, 0) as coachingCompleted_month
    FROM users u
    JOIN roles r ON u.role_id = r.id
    LEFT JOIN departments d ON u.department_id = d.id
    LEFT JOIN (
      SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(s.id) as audits
      FROM submissions s
      JOIN submission_metadata sm ON s.id = sm.submission_id
      JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED)
      JOIN roles active_role ON active_csr.role_id = active_role.id
      WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED')
        AND fmf.field_name = 'CSR' AND active_role.role_name = 'CSR'
        AND active_csr.is_active = 1 AND active_csr.department_id IN (${placeholders})
      GROUP BY sm.value
    ) audit_counts ON u.id = audit_counts.csr_id
    LEFT JOIN (
      SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(disp.id) as disputes
      FROM submissions s
      JOIN submission_metadata sm ON s.id = sm.submission_id
      JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      JOIN disputes disp ON disp.submission_id = s.id
      JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED)
      JOIN roles active_role ON active_csr.role_id = active_role.id
      WHERE fmf.field_name = 'CSR' AND active_role.role_name = 'CSR'
        AND active_csr.is_active = 1 AND active_csr.department_id IN (${placeholders})
      GROUP BY sm.value
    ) dispute_counts ON u.id = dispute_counts.csr_id
    LEFT JOIN (
      SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(s.id) as audits_week
      FROM submissions s
      JOIN submission_metadata sm ON s.id = sm.submission_id
      JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED)
      JOIN roles active_role ON active_csr.role_id = active_role.id
      WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED')
        AND fmf.field_name = 'CSR' AND active_role.role_name = 'CSR'
        AND active_csr.is_active = 1 AND active_csr.department_id IN (${placeholders})
        AND s.submitted_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK)
      GROUP BY sm.value
    ) audit_counts_week ON u.id = audit_counts_week.csr_id
    LEFT JOIN (
      SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(disp.id) as disputes_week
      FROM submissions s
      JOIN submission_metadata sm ON s.id = sm.submission_id
      JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      JOIN disputes disp ON disp.submission_id = s.id
      JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED)
      JOIN roles active_role ON active_csr.role_id = active_role.id
      WHERE fmf.field_name = 'CSR' AND active_role.role_name = 'CSR'
        AND active_csr.is_active = 1 AND active_csr.department_id IN (${placeholders})
        AND disp.created_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK)
      GROUP BY sm.value
    ) dispute_counts_week ON u.id = dispute_counts_week.csr_id
    LEFT JOIN (
      SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(s.id) as audits_month
      FROM submissions s
      JOIN submission_metadata sm ON s.id = sm.submission_id
      JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED)
      JOIN roles active_role ON active_csr.role_id = active_role.id
      WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED')
        AND fmf.field_name = 'CSR' AND active_role.role_name = 'CSR'
        AND active_csr.is_active = 1 AND active_csr.department_id IN (${placeholders})
        AND s.submitted_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
      GROUP BY sm.value
    ) audit_counts_month ON u.id = audit_counts_month.csr_id
    LEFT JOIN (
      SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(disp.id) as disputes_month
      FROM submissions s
      JOIN submission_metadata sm ON s.id = sm.submission_id
      JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      JOIN disputes disp ON disp.submission_id = s.id
      JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED)
      JOIN roles active_role ON active_csr.role_id = active_role.id
      WHERE fmf.field_name = 'CSR' AND active_role.role_name = 'CSR'
        AND active_csr.is_active = 1 AND active_csr.department_id IN (${placeholders})
        AND disp.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
      GROUP BY sm.value
    ) dispute_counts_month ON u.id = dispute_counts_month.csr_id
    LEFT JOIN (
      SELECT cs.csr_id, COUNT(cs.id) as coachingScheduled
      FROM coaching_sessions cs
      JOIN users csr_user ON cs.csr_id = csr_user.id
      WHERE cs.status = 'SCHEDULED' AND csr_user.department_id IN (${placeholders})
      GROUP BY cs.csr_id
    ) coaching_scheduled ON u.id = coaching_scheduled.csr_id
    LEFT JOIN (
      SELECT cs.csr_id, COUNT(cs.id) as coachingCompleted
      FROM coaching_sessions cs
      JOIN users csr_user ON cs.csr_id = csr_user.id
      WHERE cs.status = 'COMPLETED' AND csr_user.department_id IN (${placeholders})
      GROUP BY cs.csr_id
    ) coaching_completed ON u.id = coaching_completed.csr_id
    LEFT JOIN (
      SELECT cs.csr_id, COUNT(cs.id) as coachingScheduled_week
      FROM coaching_sessions cs
      JOIN users csr_user ON cs.csr_id = csr_user.id
      WHERE cs.status = 'SCHEDULED'
        AND cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 WEEK)
        AND csr_user.department_id IN (${placeholders})
      GROUP BY cs.csr_id
    ) coaching_scheduled_week ON u.id = coaching_scheduled_week.csr_id
    LEFT JOIN (
      SELECT cs.csr_id, COUNT(cs.id) as coachingCompleted_week
      FROM coaching_sessions cs
      JOIN users csr_user ON cs.csr_id = csr_user.id
      WHERE cs.status = 'COMPLETED'
        AND cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 WEEK)
        AND csr_user.department_id IN (${placeholders})
      GROUP BY cs.csr_id
    ) coaching_completed_week ON u.id = coaching_completed_week.csr_id
    LEFT JOIN (
      SELECT cs.csr_id, COUNT(cs.id) as coachingScheduled_month
      FROM coaching_sessions cs
      JOIN users csr_user ON cs.csr_id = csr_user.id
      WHERE cs.status = 'SCHEDULED'
        AND cs.session_date >= DATE_FORMAT(NOW(), '%Y-%m-01')
        AND csr_user.department_id IN (${placeholders})
      GROUP BY cs.csr_id
    ) coaching_scheduled_month ON u.id = coaching_scheduled_month.csr_id
    LEFT JOIN (
      SELECT cs.csr_id, COUNT(cs.id) as coachingCompleted_month
      FROM coaching_sessions cs
      JOIN users csr_user ON cs.csr_id = csr_user.id
      WHERE cs.status = 'COMPLETED'
        AND cs.session_date >= DATE_FORMAT(NOW(), '%Y-%m-01')
        AND csr_user.department_id IN (${placeholders})
      GROUP BY cs.csr_id
    ) coaching_completed_month ON u.id = coaching_completed_month.csr_id
    WHERE r.role_name = 'CSR'
      AND u.is_active = 1
      AND u.department_id IN (${placeholders})
    ORDER BY u.username
  `, ...Array<number[]>(13).fill(departmentIds).flat()), 'manager.csrActivity')

  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    department: (row.department as string) || 'No Department',
    audits: Number(row.audits),
    disputes: Number(row.disputes),
    coachingScheduled: Number(row.coachingScheduled),
    coachingCompleted: Number(row.coachingCompleted),
    audits_week: Number(row.audits_week),
    disputes_week: Number(row.disputes_week),
    audits_month: Number(row.audits_month),
    disputes_month: Number(row.disputes_month),
    coachingScheduled_week: Number(row.coachingScheduled_week),
    coachingCompleted_week: Number(row.coachingCompleted_week),
    coachingScheduled_month: Number(row.coachingScheduled_month),
    coachingCompleted_month: Number(row.coachingCompleted_month),
  }))
}

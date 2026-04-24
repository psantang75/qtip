/**
 * Per-CSR activity grid for the trainer dashboard.
 *
 * Powers `GET /api/trainer/csr-activity`. One row per active CSR with
 * audit / dispute / coaching counters at total / week / month windows.
 *
 * The month window uses `DATE_SUB(NOW(), INTERVAL 1 MONTH)` (rolling
 * 30-day) to match the legacy controller exactly. The orphaned
 * `TrainerService.getCSRActivity` (calendar-month `DATE_FORMAT(NOW(),
 * '%Y-%m-01')`) was deleted with the old TrainerService.ts during the
 * pre-production review (item #29) — both implementations existed but
 * the controller never adopted the service one, so the service version
 * was dead code with subtly different math.
 *
 * SQL is intentionally one big read with twelve correlated subqueries —
 * each subquery is a single-table count, MySQL plans them separately,
 * and splitting them across multiple round-trips inflated total latency
 * in benchmarks.
 */

import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import type { TrainerCSRActivityRow } from './trainer.types'

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function getTrainerCSRActivity(): Promise<TrainerCSRActivityRow[]> {
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT
      u.id,
      u.username                                    AS name,
      d.department_name                             AS department,
      COALESCE(audit_counts.audits,                       0) AS audits,
      COALESCE(dispute_counts.disputes,                   0) AS disputes,
      COALESCE(coaching_scheduled.coachingScheduled,      0) AS coachingScheduled,
      COALESCE(coaching_completed.coachingCompleted,      0) AS coachingCompleted,
      COALESCE(audit_counts_week.audits_week,             0) AS audits_week,
      COALESCE(dispute_counts_week.disputes_week,         0) AS disputes_week,
      COALESCE(audit_counts_month.audits_month,           0) AS audits_month,
      COALESCE(dispute_counts_month.disputes_month,       0) AS disputes_month,
      COALESCE(coaching_scheduled_week.coachingScheduled_week,   0) AS coachingScheduled_week,
      COALESCE(coaching_completed_week.coachingCompleted_week,   0) AS coachingCompleted_week,
      COALESCE(coaching_scheduled_month.coachingScheduled_month, 0) AS coachingScheduled_month,
      COALESCE(coaching_completed_month.coachingCompleted_month, 0) AS coachingCompleted_month
    FROM users u
    JOIN roles r ON u.role_id = r.id
    LEFT JOIN departments d ON u.department_id = d.id
    LEFT JOIN (
      SELECT CAST(sm.value AS UNSIGNED) AS csr_id, COUNT(s.id) AS audits
      FROM submissions s JOIN submission_metadata sm ON s.id = sm.submission_id JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED) JOIN roles active_role ON active_csr.role_id = active_role.id
      WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED') AND fmf.field_name = 'CSR' AND active_role.role_name = 'CSR' AND active_csr.is_active = 1
      GROUP BY sm.value
    ) audit_counts ON u.id = audit_counts.csr_id
    LEFT JOIN (
      SELECT CAST(sm.value AS UNSIGNED) AS csr_id, COUNT(disp.id) AS disputes
      FROM submissions s JOIN submission_metadata sm ON s.id = sm.submission_id JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      JOIN disputes disp ON disp.submission_id = s.id JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED) JOIN roles active_role ON active_csr.role_id = active_role.id
      WHERE fmf.field_name = 'CSR' AND active_role.role_name = 'CSR' AND active_csr.is_active = 1
      GROUP BY sm.value
    ) dispute_counts ON u.id = dispute_counts.csr_id
    LEFT JOIN (
      SELECT CAST(sm.value AS UNSIGNED) AS csr_id, COUNT(s.id) AS audits_week
      FROM submissions s JOIN submission_metadata sm ON s.id = sm.submission_id JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED) JOIN roles active_role ON active_csr.role_id = active_role.id
      WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED') AND fmf.field_name = 'CSR' AND active_role.role_name = 'CSR' AND active_csr.is_active = 1
        AND s.submitted_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK)
      GROUP BY sm.value
    ) audit_counts_week ON u.id = audit_counts_week.csr_id
    LEFT JOIN (
      SELECT CAST(sm.value AS UNSIGNED) AS csr_id, COUNT(disp.id) AS disputes_week
      FROM submissions s JOIN submission_metadata sm ON s.id = sm.submission_id JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      JOIN disputes disp ON disp.submission_id = s.id JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED) JOIN roles active_role ON active_csr.role_id = active_role.id
      WHERE fmf.field_name = 'CSR' AND active_role.role_name = 'CSR' AND active_csr.is_active = 1 AND disp.created_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK)
      GROUP BY sm.value
    ) dispute_counts_week ON u.id = dispute_counts_week.csr_id
    LEFT JOIN (
      SELECT CAST(sm.value AS UNSIGNED) AS csr_id, COUNT(s.id) AS audits_month
      FROM submissions s JOIN submission_metadata sm ON s.id = sm.submission_id JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED) JOIN roles active_role ON active_csr.role_id = active_role.id
      WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED') AND fmf.field_name = 'CSR' AND active_role.role_name = 'CSR' AND active_csr.is_active = 1
        AND s.submitted_at >= DATE_SUB(NOW(), INTERVAL 1 MONTH)
      GROUP BY sm.value
    ) audit_counts_month ON u.id = audit_counts_month.csr_id
    LEFT JOIN (
      SELECT CAST(sm.value AS UNSIGNED) AS csr_id, COUNT(disp.id) AS disputes_month
      FROM submissions s JOIN submission_metadata sm ON s.id = sm.submission_id JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      JOIN disputes disp ON disp.submission_id = s.id JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED) JOIN roles active_role ON active_csr.role_id = active_role.id
      WHERE fmf.field_name = 'CSR' AND active_role.role_name = 'CSR' AND active_csr.is_active = 1 AND disp.created_at >= DATE_SUB(NOW(), INTERVAL 1 MONTH)
      GROUP BY sm.value
    ) dispute_counts_month ON u.id = dispute_counts_month.csr_id
    LEFT JOIN (SELECT cs.csr_id, COUNT(cs.id) AS coachingScheduled FROM coaching_sessions cs WHERE cs.status = 'SCHEDULED' GROUP BY cs.csr_id) coaching_scheduled ON u.id = coaching_scheduled.csr_id
    LEFT JOIN (SELECT cs.csr_id, COUNT(cs.id) AS coachingCompleted FROM coaching_sessions cs WHERE cs.status = 'COMPLETED' GROUP BY cs.csr_id) coaching_completed ON u.id = coaching_completed.csr_id
    LEFT JOIN (SELECT cs.csr_id, COUNT(cs.id) AS coachingScheduled_week  FROM coaching_sessions cs WHERE cs.status = 'SCHEDULED' AND cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 WEEK)  GROUP BY cs.csr_id) coaching_scheduled_week  ON u.id = coaching_scheduled_week.csr_id
    LEFT JOIN (SELECT cs.csr_id, COUNT(cs.id) AS coachingCompleted_week  FROM coaching_sessions cs WHERE cs.status = 'COMPLETED' AND cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 WEEK)  GROUP BY cs.csr_id) coaching_completed_week  ON u.id = coaching_completed_week.csr_id
    LEFT JOIN (SELECT cs.csr_id, COUNT(cs.id) AS coachingScheduled_month FROM coaching_sessions cs WHERE cs.status = 'SCHEDULED' AND cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 MONTH) GROUP BY cs.csr_id) coaching_scheduled_month ON u.id = coaching_scheduled_month.csr_id
    LEFT JOIN (SELECT cs.csr_id, COUNT(cs.id) AS coachingCompleted_month FROM coaching_sessions cs WHERE cs.status = 'COMPLETED' AND cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 MONTH) GROUP BY cs.csr_id) coaching_completed_month ON u.id = coaching_completed_month.csr_id
    WHERE r.role_name = 'CSR'
      AND u.is_active = 1
    ORDER BY u.username
  `)

  return rows.map((row): TrainerCSRActivityRow => ({
    id:                       Number(row.id),
    name:                     row.name,
    department:               row.department || 'No Department',
    audits:                   Number(row.audits),
    disputes:                 Number(row.disputes),
    coachingScheduled:        Number(row.coachingScheduled),
    coachingCompleted:        Number(row.coachingCompleted),
    audits_week:              Number(row.audits_week),
    disputes_week:            Number(row.disputes_week),
    audits_month:             Number(row.audits_month),
    disputes_month:           Number(row.disputes_month),
    coachingScheduled_week:   Number(row.coachingScheduled_week),
    coachingCompleted_week:   Number(row.coachingCompleted_week),
    coachingScheduled_month:  Number(row.coachingScheduled_month),
    coachingCompleted_month:  Number(row.coachingCompleted_month),
  }))
}

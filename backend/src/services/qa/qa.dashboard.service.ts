/**
 * QA dashboard data sources.
 *
 * Powers `GET /api/qa/stats` and `GET /api/qa/csr-activity`. Both methods
 * are scoped to the calling QA user (the legacy controller already filtered
 * by `submitted_by = qaUserId` to avoid org-wide leakage). Stats responses
 * are cached behind the `qaFeatureFlags.isCacheEnabled()` flag through
 * `QACacheService`; CSR activity is uncached because the legacy controller
 * also did not cache it.
 *
 * Extracted from the old `controllers/qa.controller.ts` during the
 * pre-production review (item #29).
 */

import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { qaCacheService } from '../QACacheService'
import { qaFeatureFlags } from '../../config/qa.config'
import type { QAStatsResult, QACSRActivityRow } from './qa.types'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Returns true when the cached value was used (skipping the db round-trip). */
export interface CachedStats {
  stats: QAStatsResult
  source: 'cache' | 'database'
}

export async function getQAStats(qaUserId: number): Promise<CachedStats> {
  if (qaFeatureFlags.isCacheEnabled()) {
    const cached = qaCacheService.get(qaCacheService.getStatsKey(qaUserId)) as QAStatsResult | null
    if (cached) return { stats: cached, source: 'cache' }
  }

  const reviewsCompleted = await prisma.$queryRaw<{ thisWeek: bigint; thisMonth: bigint }[]>(Prisma.sql`
    SELECT
      COUNT(CASE WHEN s.submitted_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK)        THEN 1 END) AS thisWeek,
      COUNT(CASE WHEN s.submitted_at >= DATE_FORMAT(NOW(), '%Y-%m-01')          THEN 1 END) AS thisMonth
    FROM submissions s
    JOIN submission_metadata sm   ON s.id = sm.submission_id
    JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
    JOIN users u                  ON CAST(sm.value AS UNSIGNED) = u.id
    JOIN roles r                  ON u.role_id = r.id
    WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED')
      AND fmf.field_name = 'CSR'
      AND r.role_name    = 'CSR'
      AND u.is_active    = 1
      AND s.submitted_by = ${qaUserId}
  `)

  const disputes = await prisma.$queryRaw<{ thisWeek: bigint; thisMonth: bigint }[]>(Prisma.sql`
    SELECT
      COUNT(CASE WHEN d.created_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK) THEN 1 END) AS thisWeek,
      COUNT(CASE WHEN d.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')   THEN 1 END) AS thisMonth
    FROM disputes d
    JOIN submissions s ON d.submission_id = s.id
    WHERE s.submitted_by = ${qaUserId}
  `)

  const stats: QAStatsResult = {
    reviewsCompleted: {
      thisWeek:  Number(reviewsCompleted[0]?.thisWeek  ?? 0),
      thisMonth: Number(reviewsCompleted[0]?.thisMonth ?? 0),
    },
    disputes: {
      thisWeek:  Number(disputes[0]?.thisWeek  ?? 0),
      thisMonth: Number(disputes[0]?.thisMonth ?? 0),
    },
  }

  if (qaFeatureFlags.isCacheEnabled()) {
    qaCacheService.set(qaCacheService.getStatsKey(qaUserId), stats)
  }

  return { stats, source: 'database' }
}

export async function getQACSRActivity(qaUserId: number): Promise<QACSRActivityRow[]> {
  const activeCSRs = await prisma.$queryRaw<{ id: number; name: string; department: string }[]>(Prisma.sql`
    SELECT
      u.id,
      u.username                                  AS name,
      COALESCE(d.department_name, 'No Department') AS department
    FROM users u
    JOIN roles r ON u.role_id = r.id
    LEFT JOIN departments d ON u.department_id = d.id
    WHERE r.role_name = 'CSR'
      AND u.is_active = 1
    ORDER BY u.username
  `)

  if (activeCSRs.length === 0) return []

  const audits = await prisma.$queryRaw<{ csr_id: bigint; total_audits: bigint; week_audits: bigint; month_audits: bigint }[]>(Prisma.sql`
    SELECT
      u.id AS csr_id,
      COUNT(s.id)                                                                  AS total_audits,
      COUNT(CASE WHEN s.submitted_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK) THEN 1 END) AS week_audits,
      COUNT(CASE WHEN s.submitted_at >= DATE_FORMAT(NOW(), '%Y-%m-01')   THEN 1 END) AS month_audits
    FROM submissions s
    JOIN submission_metadata sm   ON s.id = sm.submission_id
    JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
    JOIN users u                  ON CAST(sm.value AS UNSIGNED) = u.id
    WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED')
      AND fmf.field_name = 'CSR'
      AND s.submitted_by = ${qaUserId}
    GROUP BY u.id
  `)

  const dispRows = await prisma.$queryRaw<{ csr_id: bigint; total_disputes: bigint; week_disputes: bigint; month_disputes: bigint }[]>(Prisma.sql`
    SELECT
      u.id AS csr_id,
      COUNT(d.id)                                                                AS total_disputes,
      COUNT(CASE WHEN d.created_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK) THEN 1 END) AS week_disputes,
      COUNT(CASE WHEN d.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')   THEN 1 END) AS month_disputes
    FROM disputes d
    JOIN submissions s            ON d.submission_id = s.id
    JOIN submission_metadata sm   ON s.id = sm.submission_id
    JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
    JOIN users u                  ON CAST(sm.value AS UNSIGNED) = u.id
    WHERE fmf.field_name = 'CSR'
      AND s.submitted_by = ${qaUserId}
    GROUP BY u.id
  `)

  const auditMap = new Map(audits.map(r => [Number(r.csr_id), {
    total: Number(r.total_audits),
    week:  Number(r.week_audits),
    month: Number(r.month_audits),
  }]))
  const disputeMap = new Map(dispRows.map(r => [Number(r.csr_id), {
    total: Number(r.total_disputes),
    week:  Number(r.week_disputes),
    month: Number(r.month_disputes),
  }]))

  return activeCSRs
    .map((csr): QACSRActivityRow => {
      const a = auditMap.get(csr.id)   ?? { total: 0, week: 0, month: 0 }
      const d = disputeMap.get(csr.id) ?? { total: 0, week: 0, month: 0 }
      return {
        id:             csr.id,
        name:           csr.name,
        department:     csr.department,
        audits:         a.total,
        disputes:       d.total,
        audits_week:    a.week,
        disputes_week:  d.week,
        audits_month:   a.month,
        disputes_month: d.month,
      }
    })
    .filter(row =>
      row.audits  > 0 || row.disputes  > 0 ||
      row.audits_week  > 0 || row.disputes_week  > 0 ||
      row.audits_month > 0 || row.disputes_month > 0,
    )
}

/**
 * Trainer report builder.
 *
 * Powers `GET /api/trainer/filters` (filter-bar options) and
 * `POST /api/trainer/reports` (filtered enrollment-based report). The
 * report is generated dynamically — there is no `/export` route any more
 * (removed in pre-production review item #24 because the legacy CSV/PDF
 * exporters returned hard-coded placeholder data).
 *
 * Extracted from the old `controllers/trainer.controller.ts` during the
 * pre-production review (item #29).
 */

import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import type {
  FilterOptions,
  ReportFilters,
  CompletionRateData,
  QuizPerformanceData,
  TraineeFeedbackData,
  ProgressTrendData,
  TrainerReportPayload,
} from './trainer.types'

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function getFilterOptions(): Promise<FilterOptions> {
  const [courses, csrs, departments] = await Promise.all([
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT id, course_name, description, created_by, created_at FROM courses WHERE is_draft = 0
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT u.id, u.username AS name, u.email, d.department_name AS department
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.role_id = 3 AND u.is_active = 1
      ORDER BY u.username
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT id, department_name AS name FROM departments WHERE is_active = 1 ORDER BY department_name
    `),
  ])

  return {
    courses:     courses     as FilterOptions['courses'],
    csrs:        csrs        as FilterOptions['csrs'],
    departments: departments as FilterOptions['departments'],
  }
}

export async function generateReport(filters: ReportFilters): Promise<TrainerReportPayload> {
  const conditions: Prisma.Sql[] = []

  if (filters.dateRange?.startDate && filters.dateRange?.endDate) {
    conditions.push(
      Prisma.sql`e.created_at BETWEEN ${filters.dateRange.startDate} AND ${filters.dateRange.endDate + ' 23:59:59'}`,
    )
  }
  if (filters.courseIds?.length     > 0) conditions.push(Prisma.sql`e.course_id     IN (${Prisma.join(filters.courseIds)})`)
  if (filters.csrIds?.length        > 0) conditions.push(Prisma.sql`e.user_id       IN (${Prisma.join(filters.csrIds)})`)
  if (filters.departmentIds?.length > 0) conditions.push(Prisma.sql`u.department_id IN (${Prisma.join(filters.departmentIds)})`)

  const whereClause = conditions.length > 0
    ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
    : Prisma.empty

  const [completionRates, quizPerformance, traineeFeedback, progressTrends] = await Promise.all([
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        c.course_name AS label,
        COUNT(*)      AS total,
        SUM(CASE WHEN e.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
        ROUND((SUM(CASE WHEN e.status = 'COMPLETED' THEN 1 ELSE 0 END) / COUNT(*)) * 100, 2) AS completionRate
      FROM enrollments e
      JOIN courses c ON e.course_id = c.id
      JOIN users   u ON e.user_id   = u.id
      ${whereClause}
      GROUP BY c.id, c.course_name
      ORDER BY completionRate DESC
    `),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        e.id,
        u.username                                                  AS csrName,
        c.course_name                                               AS courseName,
        COALESCE(q.quiz_title, CONCAT(c.course_name, ' Quiz'))      AS quizTitle,
        e.status,
        CASE WHEN e.status = 'COMPLETED' THEN 'PASS' ELSE 'FAIL' END AS passFail,
        e.created_at                                                AS completedAt
      FROM enrollments e
      JOIN courses c ON e.course_id = c.id
      JOIN users   u ON e.user_id   = u.id
      LEFT JOIN quizzes q ON c.id = q.course_id
      ${whereClause}
      ORDER BY e.created_at DESC
      LIMIT 50
    `),
    // Trainee feedback was always returned empty in the legacy controller —
    // preserved for response-shape parity until a real feedback source lands.
    Promise.resolve([] as any[]),
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        DATE(e.created_at)   AS date,
        AVG(e.progress)      AS progress,
        'Overall Progress'   AS label
      FROM enrollments e
      JOIN users u ON e.user_id = u.id
      ${whereClause}
      GROUP BY DATE(e.created_at)
      ORDER BY date ASC
      LIMIT 30
    `),
  ])

  return {
    completionRates: completionRates.map(r => ({
      ...r,
      total:     Number(r.total),
      completed: Number(r.completed),
    })) as CompletionRateData[],
    quizPerformance: quizPerformance as QuizPerformanceData[],
    traineeFeedback: traineeFeedback as TraineeFeedbackData[],
    progressTrends:  progressTrends  as ProgressTrendData[],
  }
}

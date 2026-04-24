/**
 * Shared helpers for the On-Demand Reports subsystem.
 *
 * Extracted from the original `services/onDemandReportsRegistry.ts`
 * during pre-production cleanup item #29 (god-files refactor).
 *
 * Houses:
 *  - lazy singletons for the analytics service + repository so the
 *    on-demand reports don't construct the heavy stack at import-time
 *  - filename builder for the timestamped Excel downloads
 *  - role-based manager check
 *  - name-to-id resolvers for departments / forms / CSRs / topics
 *    so per-report files can stay focused on report-shape concerns
 *  - submission-id "contains" filter shared by analytics flows
 */

import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import cacheService from '../CacheService'
import { AnalyticsService } from '../AnalyticsService'
import { MySQLAnalyticsRepository } from '../../repositories/MySQLAnalyticsRepository'
import { getCsrRoleId } from '../coachingSessionsReport'
import type { OnDemandReportUser } from './types'

let _analyticsRepository: MySQLAnalyticsRepository | null = null
export function getAnalyticsRepository(): MySQLAnalyticsRepository {
  if (!_analyticsRepository) _analyticsRepository = new MySQLAnalyticsRepository()
  return _analyticsRepository
}

let _analyticsService: AnalyticsService | null = null
export function getAnalyticsService(): AnalyticsService {
  if (!_analyticsService) {
    _analyticsService = new AnalyticsService(getAnalyticsRepository(), cacheService)
  }
  return _analyticsService
}

export function timestampedFilename(slug: string): string {
  const now = new Date()
  const dateStr = now.toISOString().split('T')[0]
  const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-')
  return `QTIP_${slug}_${dateStr}_${timeStr}.xlsx`
}

export function isManager(user: OnDemandReportUser): boolean {
  return user.role === 'Manager' || user.role_id === 5
}

export async function resolveDepartmentIds(
  names: string[] | undefined,
): Promise<number[]> {
  if (!names || names.length === 0) return []
  const rows = await prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
    SELECT id FROM departments
    WHERE department_name IN (${Prisma.join(names)})
  `)
  return rows.map(r => Number(r.id))
}

export async function resolveFormIds(names: string[] | undefined): Promise<number[]> {
  if (!names || names.length === 0) return []
  const rows = await prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
    SELECT id FROM forms
    WHERE form_name IN (${Prisma.join(names)})
  `)
  return rows.map(r => Number(r.id))
}

export async function resolveCsrIds(names: string[] | undefined): Promise<number[]> {
  if (!names || names.length === 0) return []
  const csrRoleId = await getCsrRoleId()
  if (!csrRoleId) return []
  const rows = await prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
    SELECT id FROM users
    WHERE role_id = ${csrRoleId}
      AND username IN (${Prisma.join(names)})
  `)
  return rows.map(r => Number(r.id))
}

export async function resolveTopicIds(labels: string[] | undefined): Promise<number[]> {
  if (!labels || labels.length === 0) return []
  const rows = await prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
    SELECT id FROM list_items
    WHERE list_type = 'training_topic'
      AND label IN (${Prisma.join(labels)})
  `)
  return rows.map(r => Number(r.id))
}

/**
 * Substring filter on `submission_id`. Mirrors the legacy "contains"
 * semantics rather than an exact match so users can paste partial
 * IDs from the QA queue.
 */
export function applySubmissionIdFilter(
  rows: any[],
  submissionId: string | undefined,
): any[] {
  if (!submissionId) return rows
  const needle = String(submissionId).trim()
  if (!needle) return rows
  return rows.filter(r => String(r.submission_id ?? '').includes(needle))
}

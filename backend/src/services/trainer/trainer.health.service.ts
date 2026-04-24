/**
 * Trainer subsystem health probe.
 *
 * Powers `GET /api/trainer/health` (no-auth — intentional, per the route
 * registration). Pings the three pieces of infrastructure trainer
 * endpoints depend on: Prisma, the trainer in-memory cache, and the
 * trainer logger. Returns a 503-shaped payload when any individual
 * check fails so a load-balancer can react.
 *
 * Extracted from the old `controllers/trainer.controller.ts` during the
 * pre-production review (item #29).
 */

import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { trainerCache } from '../TrainerCache'
import { trainerLogger } from '../TrainerLogger'

export interface TrainerHealthReport {
  status:    'healthy' | 'degraded' | 'unhealthy'
  timestamp: string
  service:   'TRAINER'
  checks:    { database: boolean; cache: boolean; logger: boolean }
  details:   Record<string, unknown>
  performance: Record<string, unknown>
}

export async function getTrainerHealthReport(): Promise<TrainerHealthReport> {
  const report: TrainerHealthReport = {
    status:      'healthy',
    timestamp:   new Date().toISOString(),
    service:     'TRAINER',
    checks:      { database: false, cache: false, logger: false },
    details:     {},
    performance: {},
  }

  try {
    await prisma.$queryRaw(Prisma.sql`SELECT 1`)
    report.checks.database = true
  } catch {
    report.checks.database = false
    report.details.database = 'Connection failed'
  }

  try {
    const testKey = 'health_check_test_trainer'
    trainerCache.set(testKey, 'test', 1000)
    const testValue = trainerCache.get(testKey)
    report.checks.cache = testValue === 'test'
    trainerCache.delete(testKey)
    report.performance.cache = trainerCache.getStats()
  } catch {
    report.checks.cache = false
    report.details.cache = 'Cache operation failed'
  }

  try {
    trainerLogger.operation('health_check', 0, { test: true })
    report.checks.logger = true
    report.performance.logger = trainerLogger.getPerformanceStats()
  } catch {
    report.checks.logger = false
    report.details.logger = 'Logger operation failed'
  }

  const allChecksPass = Object.values(report.checks).every(Boolean)
  report.status = allChecksPass ? 'healthy' : 'degraded'
  return report
}

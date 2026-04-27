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
import { MemoryTTLCache } from '../MemoryTTLCache'
import { trainerLogger } from '../TrainerLogger'

// Self-contained probe cache. The previous standalone `TrainerCache` wrapper
// was deleted during the pre-production review (item #74) because the
// trainer service stack stopped consuming it after the dashboard refactor;
// the only remaining caller was this health probe. A local instance keeps
// the probe self-contained without keeping the unused singleton alive.
const probeCache = new MemoryTTLCache({ name: 'TrainerHealthProbe', defaultTTLMs: 10_000 })

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
    probeCache.set(testKey, 'test', 1000)
    const testValue = probeCache.get<string>(testKey)
    report.checks.cache = testValue === 'test'
    probeCache.delete(testKey)
    report.performance.cache = probeCache.getStats()
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

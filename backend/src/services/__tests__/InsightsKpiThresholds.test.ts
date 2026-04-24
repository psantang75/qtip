/**
 * Phase 6 — kpi_thresholds end-to-end validation.
 *
 * 1. Confirms the live `ie_kpi.direction` + `ie_kpi_threshold.{goal,warning,
 *    critical}_value` rows resolve (today, dept-wide) to exactly the values
 *    documented in `docs/insights-validation/quality.md` §6.
 * 2. Re-implements the frontend's `getThresholdStatus` (kpiDefs.ts) here and
 *    pins the resulting band ('good' | 'warning' | 'critical' | 'neutral')
 *    for every Quality KPI's slice value.
 * 3. Includes the inverse-direction sanity check: flipping `dispute_rate`'s
 *    direction to UP_IS_GOOD must reclassify 10.10 from 'warning' to 'good'.
 *
 * The mirror function is a verbatim copy of
 *   frontend/src/constants/kpiDefs.ts → getThresholdStatus
 * so a regression in either place will surface here.
 */

import { afterAll, describe, expect, it } from 'vitest'
import pool, { closeDatabaseConnections } from '../../config/database'
import { RowDataPacket } from 'mysql2'
import { DB_TESTS_ENABLED } from '../../__tests__/setup'

const describeDb = describe.skipIf(!DB_TESTS_ENABLED)

type Direction = 'UP_IS_GOOD' | 'DOWN_IS_GOOD' | 'NEUTRAL'
interface ThresholdDef {
  direction: Direction
  goal: number | null
  warn: number | null
  crit: number | null
}

function getThresholdStatus(value: number, def: ThresholdDef):
  'good' | 'warning' | 'critical' | 'neutral'
{
  const { direction, goal, warn, crit } = def
  if (direction === 'NEUTRAL' || goal === null) return 'neutral'

  if (direction === 'UP_IS_GOOD') {
    if (goal !== null && value >= goal) return 'good'
    if (warn !== null && value >= warn) return 'warning'
    if (crit !== null && value <= crit) return 'critical'
    return 'warning'
  }

  // DOWN_IS_GOOD
  if (goal !== null && value <= goal) return 'good'
  if (warn !== null && value <= warn) return 'warning'
  if (crit !== null && value >= crit) return 'critical'
  return 'warning'
}

const EXPECTED: Record<string, {
  direction: Direction
  goal: number | null
  warn: number | null
  crit: number | null
  sliceValue: number | null
  expectedBand: 'good' | 'warning' | 'critical' | 'neutral'
}> = {
  avg_qa_score:                { direction: 'UP_IS_GOOD',   goal: 90, warn: 80, crit: 70, sliceValue: 94.53, expectedBand: 'good' },
  audit_completion_rate:       { direction: 'UP_IS_GOOD',   goal: 95, warn: 85, crit: 75, sliceValue: 33.00, expectedBand: 'critical' },
  quiz_pass_rate:              { direction: 'UP_IS_GOOD',   goal: 85, warn: 70, crit: 55, sliceValue: null,  expectedBand: 'neutral' },
  coaching_completion_rate:    { direction: 'UP_IS_GOOD',   goal: 92, warn: 80, crit: 65, sliceValue: null,  expectedBand: 'neutral' },
  dispute_rate:                { direction: 'DOWN_IS_GOOD', goal:  5, warn: 10, crit: 20, sliceValue: 10.10, expectedBand: 'warning' },
  // dispute_upheld_rate flipped to UP_IS_GOOD: the more disputes we uphold, the
  // better. Goal/warn/crit values are unchanged in ie_kpi_threshold; only the
  // direction (and therefore the band classification) changes.
  dispute_upheld_rate:         { direction: 'UP_IS_GOOD',   goal: 10, warn: 20, crit: 35, sliceValue: 30.00, expectedBand: 'good' },
  dispute_adjusted_rate:       { direction: 'DOWN_IS_GOOD', goal:  3, warn:  8, crit: 15, sliceValue: 70.00, expectedBand: 'critical' },
  avg_dispute_resolution_time: { direction: 'DOWN_IS_GOOD', goal:  3, warn:  7, crit: 14, sliceValue:  4.70, expectedBand: 'warning' },
  time_to_audit:               { direction: 'DOWN_IS_GOOD', goal:  3, warn:  7, crit: 14, sliceValue: null,  expectedBand: 'neutral' },
  // audits_assigned is NEUTRAL (pace target only) — banding always 'neutral'.
  audits_assigned:             { direction: 'NEUTRAL',      goal: 15, warn: 13, crit: 12, sliceValue: 300,   expectedBand: 'neutral' },
}

afterAll(async () => {
  if (DB_TESTS_ENABLED) await closeDatabaseConnections()
})

describeDb('Insights KPI thresholds — Phase 6', () => {
  it('every Quality KPI has a current dept-wide threshold row matching the report', async () => {
    const codes = Object.keys(EXPECTED)
    const placeholders = codes.map(() => '?').join(',')
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT k.kpi_code, k.direction,
              t.goal_value, t.warning_value, t.critical_value,
              t.effective_from, t.effective_to
         FROM ie_kpi k
         LEFT JOIN ie_kpi_threshold t
           ON t.kpi_id = k.id
           AND t.department_key IS NULL
           AND DATE(t.effective_from) <= CURDATE()
           AND (t.effective_to IS NULL OR DATE(t.effective_to) >= CURDATE())
        WHERE k.kpi_code IN (${placeholders})`,
      codes
    )

    const found = new Map(rows.map(r => [r.kpi_code as string, r]))
    for (const [code, exp] of Object.entries(EXPECTED)) {
      const row = found.get(code)
      expect(row, `KPI ${code} missing from ie_kpi`).toBeDefined()
      expect(row!.direction, `${code}.direction`).toBe(exp.direction)
      const goal = row!.goal_value     != null ? parseFloat(row!.goal_value as string) : null
      const warn = row!.warning_value  != null ? parseFloat(row!.warning_value as string) : null
      const crit = row!.critical_value != null ? parseFloat(row!.critical_value as string) : null
      expect(goal, `${code}.goal_value`).toBe(exp.goal)
      expect(warn, `${code}.warning_value`).toBe(exp.warn)
      expect(crit, `${code}.critical_value`).toBe(exp.crit)
    }
  })

  it.each(
    Object.entries(EXPECTED)
      .filter(([, e]) => e.sliceValue !== null)
      .map(([code, e]) => [code, e] as const)
  )(
    '%s slice value resolves to the documented band',
    (code, e) => {
      const status = getThresholdStatus(e.sliceValue!, {
        direction: e.direction,
        goal: e.goal,
        warn: e.warn,
        crit: e.crit,
      })
      expect(status, `${code} band`).toBe(e.expectedBand)
    }
  )

  it('inverse-direction sanity check: dispute_rate@10.10 flips to "good" if direction = UP_IS_GOOD', () => {
    const e = EXPECTED.dispute_rate
    const flipped = getThresholdStatus(e.sliceValue!, {
      direction: 'UP_IS_GOOD',
      goal: e.goal,
      warn: e.warn,
      crit: e.crit,
    })
    expect(flipped).toBe('good')
    // And the canonical direction still classifies it as 'warning'.
    const canonical = getThresholdStatus(e.sliceValue!, {
      direction: e.direction,
      goal: e.goal,
      warn: e.warn,
      crit: e.crit,
    })
    expect(canonical).toBe('warning')
  })

  it('boundary-equality: a value exactly at goal/warn/crit is classified per the inclusive >= / <=', () => {
    const up: ThresholdDef = { direction: 'UP_IS_GOOD', goal: 90, warn: 80, crit: 70 }
    expect(getThresholdStatus(90, up)).toBe('good')
    expect(getThresholdStatus(80, up)).toBe('warning')
    expect(getThresholdStatus(70, up)).toBe('critical')
    expect(getThresholdStatus(69.99, up)).toBe('critical')

    const dn: ThresholdDef = { direction: 'DOWN_IS_GOOD', goal: 5, warn: 10, crit: 20 }
    expect(getThresholdStatus(5, dn)).toBe('good')
    expect(getThresholdStatus(10, dn)).toBe('warning')
    expect(getThresholdStatus(20, dn)).toBe('critical')
    expect(getThresholdStatus(20.01, dn)).toBe('critical')
  })
})

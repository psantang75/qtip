/**
 * Pins the arithmetic behind the Productivity drill-down.
 *
 * The claim the page makes to a manager is that every paid minute is accounted
 * for, so the "Phone status" (time-accounting) column has to reconcile exactly —
 * a silent residual would read as a real finding about the agent rather than a
 * bug in the partition. The fixtures below stand in for the live `AgentDay` the
 * API now returns, so the model + bucket rules are pinned independent of the
 * source systems.
 */

import { describe, it, expect } from 'vitest'
import { buildDayModel } from '../productivityModel'
import { PRODUCTIVITY_KPIS } from '../productivityHeader'
import { buildPeerComparison } from '../productivityBenchmark'
import { getKpiDef } from '../../../../constants/kpiDefs'
import type { AgentDay, ProductivityRosterRow } from '../productivityTypes'

// A full day whose routing tiles the whole worked window, so the waterfall has
// nothing left "unaccounted". Clock: work 09:00–12:00 and 12:30–16:00, unpaid
// meal 12:00–12:30, paid break 16:00–16:15.
const day: AgentDay = {
  schedule: null,
  clock: [
    { start: '09:00', end: '12:00', status: 'Working' },
    { start: '12:00', end: '12:30', status: 'Meal' },
    { start: '12:30', end: '16:00', status: 'Working' },
    { start: '16:00', end: '16:15', status: 'Break' },
  ],
  routing: [
    { start: '09:00', end: '10:00', status: 'INTERACTING' },
    { start: '10:00', end: '10:30', status: 'IDLE' },
    { start: '10:30', end: '11:00', status: 'COMMUNICATING' },
    { start: '11:00', end: '11:05', status: 'NOT_RESPONDING' },
    { start: '11:05', end: '12:00', status: 'OFF_QUEUE' },
    { start: '12:30', end: '15:00', status: 'INTERACTING' },
    { start: '15:00', end: '16:15', status: 'IDLE' },
  ],
  presence: [
    { start: '11:05', end: '12:00', status: 'Meeting' },
  ],
  calls: [
    { conversationId: 'c1', start: '09:00', end: '09:20', direction: 'Inbound', answered: true, acd: true, holdMins: 2, wrapMins: 3, transferred: false },
    { conversationId: 'c2', start: '09:30', end: '09:45', direction: 'Inbound', answered: true, acd: true, holdMins: 0, wrapMins: 2, transferred: true },
    { conversationId: 'c3', start: '10:30', end: '10:50', direction: 'Outbound', answered: true, acd: false, holdMins: 0, wrapMins: 0, transferred: false },
    { conversationId: 'c4', start: '11:00', end: '11:00', direction: 'Inbound', answered: false, acd: true, holdMins: 0, wrapMins: 0, transferred: false },
  ],
  outbound: { dials: 3, connected: 1, voicemail: 1, noAnswer: 1 },
  tickets: [
    { time: '15:10', updated: 2, completed: 1, ids: [
      { itemType: 'ticket', itemId: 1, url: 'http://crm/1', subject: 'A', action: 'Updated' },
      { itemType: 'ticket', itemId: 2, url: 'http://crm/2', subject: null, action: 'Updated' },
      { itemType: 'task',   itemId: 3, url: null,           subject: 'C', action: 'Completed' },
    ] },
  ],
}

// A day with no phone identity resolved — clock only. Exercises the empty-stream
// path (no routing/calls) without breaking the partition.
const clockOnly: AgentDay = {
  schedule: null,
  clock: [{ start: '09:00', end: '12:00', status: 'Working' }],
  routing: [], presence: [], calls: [],
  outbound: { dials: 0, connected: 0, voicemail: 0, noAnswer: 0 }, tickets: [],
}

const days = [day, clockOnly]

describe('time accounting', () => {
  it('partitions paid time exactly', () => {
    days.forEach((d, i) => {
      const m = buildDayModel(d)
      const summed = m.timeAccounting.reduce((a, b) => a + b.mins, 0)
      expect(summed, `day ${i}`).toBe(m.clockedMin)
    })
  })

  it('leaves nothing material unaccounted when routing covers the day', () => {
    const m = buildDayModel(day)
    const other = m.timeAccounting.find(b => b.key === 'other')
    expect(other?.mins ?? 0).toBeLessThanOrEqual(2)
  })

  it('keeps utilization inside the clock and consistent with on-call minutes', () => {
    const m = buildDayModel(day)
    expect(m.utilizationPct).toBeLessThanOrEqual(100)
    expect(m.utilizationPct).toBe(Math.round((m.onCallMin / m.clockedMin) * 100))
    expect(m.onCallMin).toBeLessThanOrEqual(m.engagedMin)
  })

  it('derives occupancy from engaged over on-queue time', () => {
    const m = buildDayModel(day)
    expect(m.occupancyPct).toBe(Math.round((m.engagedMin / m.onQueueMin) * 100))
  })
})

describe('call handling figures', () => {
  it('derives handle time from its three parts', () => {
    const c = buildDayModel(day).callSummary
    expect(c.handleMins).toBe(c.talkMins + c.holdMins + c.wrapMins)
    expect(c.answered + c.missed).toBe(c.total)
    expect(c.transferred).toBeLessThanOrEqual(c.answered)
  })

  it('never reports more connected dials than dials placed', () => {
    const c = buildDayModel(day).callSummary
    expect(c.connected + c.voicemail + c.noAnswer).toBe(c.dials)
  })
})

describe('header KPIs', () => {
  it('exposes the five headline KPI codes in order', () => {
    expect(PRODUCTIVITY_KPIS.map(k => k.code)).toEqual([
      'aa_prod_utilization',
      'aa_prod_handle_time',
      'aa_prod_calls_per_hour',
      'aa_prod_tickets_per_hour',
      'aa_prod_missed_calls',
    ])
  })

  it('registers every headline KPI in kpiDefs so KpiTile can render it', () => {
    PRODUCTIVITY_KPIS.forEach(k => expect(getKpiDef(k.code), k.code).toBeDefined())
  })

  it('computes a finite value for every day', () => {
    days.forEach(d => {
      const m = buildDayModel(d)
      PRODUCTIVITY_KPIS.forEach(k => expect(Number.isFinite(k.value(m)), k.code).toBe(true))
    })
  })
})

describe('peer comparison', () => {
  const row = (agent: string, department: string, o: Partial<ProductivityRosterRow> = {}): ProductivityRosterRow => ({
    employeeKey: 0, agent, department,
    clockedMin: 480, utilizationPct: 40, occupancyPct: 55, callsPerHour: 8, ahtMins: 3, missedCalls: 0,
    handleMin: 200, onQueueMin: 380, ticketsTouched: 50, ...o,
  })
  const roster: ProductivityRosterRow[] = [
    row('A1', 'Billing', { handleMin: 220, onQueueMin: 400, ticketsTouched: 60, occupancyPct: 60 }),
    row('A2', 'Billing', { handleMin: 180, onQueueMin: 360, ticketsTouched: 40, occupancyPct: 50 }),
    row('A3', 'Billing', { handleMin: 90, onQueueMin: 300, ticketsTouched: 20, occupancyPct: 35 }),
    row('B1', 'Installs', { handleMin: 150, onQueueMin: 320, ticketsTouched: 30, occupancyPct: 45 }),
  ]

  it('compares an agent only against their own department', () => {
    const cmp = buildPeerComparison('A1', roster)
    expect(cmp.department).toBe('Billing')
    expect(cmp.comparable).toBe(true)
    expect(cmp.peerCount).toBe(3)
  })

  it('marks a solo department as not comparable, with nothing flagged', () => {
    const cmp = buildPeerComparison('B1', roster)
    expect(cmp.comparable).toBe(false)
    expect(cmp.peerCount).toBe(1)
    expect(cmp.flagged).toHaveLength(0)
  })

  it('renders rows in a fixed order', () => {
    const ORDER = ['phone', 'queue', 'tickets', 'occupancy']
    roster.forEach(r => {
      expect(buildPeerComparison(r.agent, roster).metrics.map(m => m.key), r.agent).toEqual(ORDER)
    })
  })

  it('brackets each agent inside the range drawn on the strip', () => {
    buildPeerComparison('A1', roster).metrics.forEach(m => {
      expect(m.peerMin).toBeLessThanOrEqual(m.median)
      expect(m.peerMax).toBeGreaterThanOrEqual(m.median)
      expect(m.q1).toBeLessThanOrEqual(m.q3)
    })
  })

  it('flags the laggard in a multi-person department', () => {
    // A3 is well below the Billing median on phone time / tickets / occupancy.
    const cmp = buildPeerComparison('A3', roster)
    expect(cmp.flagged.length).toBeGreaterThan(0)
  })
})

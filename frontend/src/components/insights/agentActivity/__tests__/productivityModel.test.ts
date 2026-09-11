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
import { buildDayModel, fmtHM } from '../productivityModel'
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
    { conversationId: 'c1', start: '09:00', direction: 'Inbound', answered: true, acd: true, talkSec: 1200, holdSec: 120, wrapSec: 180, transferred: false },
    { conversationId: 'c2', start: '09:30', direction: 'Inbound', answered: true, acd: true, talkSec: 900, holdSec: 0, wrapSec: 120, transferred: true },
    { conversationId: 'c3', start: '10:30', direction: 'Outbound', answered: true, acd: false, talkSec: 1200, holdSec: 0, wrapSec: 0, transferred: false },
    { conversationId: 'c4', start: '11:00', direction: 'Inbound', answered: false, acd: true, talkSec: 0, holdSec: 0, wrapSec: 0, transferred: false },
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

// An admin who does not take calls: Genesys records presence but never any
// routing status, so the Status row and Phone Status card must fall back to the
// presence stream (drawn as off-queue reasons) instead of going blank.
const adminNoQueue: AgentDay = {
  schedule: null,
  clock: [
    { start: '09:00', end: '12:00', status: 'Working' },
    { start: '12:00', end: '12:30', status: 'Meal' },
    { start: '12:30', end: '16:00', status: 'Working' },
  ],
  routing: [],
  presence: [
    { start: '09:00', end: '11:00', status: 'Available' },
    { start: '11:00', end: '11:15', status: 'Break' },
    { start: '11:15', end: '12:00', status: 'Available' },
    { start: '12:00', end: '12:30', status: 'Meal' },
    { start: '12:30', end: '16:00', status: 'Available' },
  ],
  calls: [],
  outbound: { dials: 0, connected: 0, voicemail: 0, noAnswer: 0 }, tickets: [],
}

// Adrian Gaston, 2026-09-10. Genesys does not return an agent to queue between
// two off-queue reasons, so a meeting that runs straight into a break is ONE
// uninterrupted OFF_QUEUE routing run (15:30–16:01) covering four presence
// states. Labelling the run as a whole reported all 31 minutes as break.
const meetingIntoBreak: AgentDay = {
  schedule: null,
  clock: [{ start: '09:04', end: '17:20', status: 'Working' }],
  routing: [
    { start: '15:27', end: '15:30', status: 'INTERACTING' },
    { start: '15:30', end: '16:01', status: 'OFF_QUEUE' },
    { start: '16:01', end: '16:05', status: 'INTERACTING' },
  ],
  presence: [
    { start: '15:14', end: '15:31', status: 'Available' },
    { start: '15:31', end: '15:44', status: 'Meeting' },
    { start: '15:44', end: '15:58', status: 'Break' },
    { start: '15:58', end: '17:20', status: 'Available' },
  ],
  calls: [],
  outbound: { dials: 0, connected: 0, voicemail: 0, noAnswer: 0 }, tickets: [],
}

// Brian Bettis, 2026-09-10, 9:45–9:50. An outbound-heavy agent making quick
// dials: the only call in that slot answered and lasted 13 real seconds. While
// the day service rounded durations to whole minutes this call was zero-length,
// which cost the slot its talk time and turned the bar red.
const shortCalls: AgentDay = {
  schedule: null,
  clock: [{ start: '09:00', end: '10:00', status: 'Working' }],
  routing: [{ start: '09:00', end: '10:00', status: 'INTERACTING' }],
  presence: [],
  calls: [
    { conversationId: 'q1', start: '09:42', direction: 'Inbound', answered: false, acd: true, talkSec: 0, holdSec: 0, wrapSec: 0, transferred: false },
    { conversationId: 'q2', start: '09:47', direction: 'Outbound', answered: true, acd: false, talkSec: 13, holdSec: 0, wrapSec: 0, transferred: false },
    { conversationId: 'q3', start: '09:52', direction: 'Inbound', answered: true, acd: true, talkSec: 24, holdSec: 5, wrapSec: 0, transferred: false },
    // Answered, but Genesys reported a zero-length Interact segment — the one
    // case left where a block holds an answered call and no talk time at all.
    // It shares its slot with a miss, so the slot must still not read as missed.
    { conversationId: 'q4', start: '09:56', direction: 'Outbound', answered: true, acd: false, talkSec: 0, holdSec: 0, wrapSec: 0, transferred: false },
    { conversationId: 'q5', start: '09:57', direction: 'Inbound', answered: false, acd: true, talkSec: 0, holdSec: 0, wrapSec: 0, transferred: false },
  ],
  outbound: { dials: 2, connected: 2, voicemail: 0, noAnswer: 0 }, tickets: [],
}

// Genesys emits presence blips too short to survive the minute resolution the
// feed is read at, which leaves a hole inside an off-queue run.
const presenceGap: AgentDay = {
  schedule: null,
  clock: [{ start: '09:00', end: '10:00', status: 'Working' }],
  routing: [{ start: '09:00', end: '09:30', status: 'OFF_QUEUE' }],
  presence: [{ start: '09:10', end: '09:20', status: 'Meeting' }],
  calls: [],
  outbound: { dials: 0, connected: 0, voicemail: 0, noAnswer: 0 }, tickets: [],
}

const days = [day, clockOnly, adminNoQueue, meetingIntoBreak, presenceGap, shortCalls]

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

describe('presence-only fallback (no phone queue)', () => {
  it('renders a Status timeline from presence when there is no routing', () => {
    const m = buildDayModel(adminNoQueue)
    expect(m.hasData).toBe(true)
    expect(m.statusSegments).toHaveLength(adminNoQueue.presence.length)
    // Every segment is an off-queue run carrying its presence status as the reason.
    expect(m.statusSegments.every(s => s.status === 'OFF_QUEUE')).toBe(true)
    expect(m.statusSegments.map(s => s.reason)).toEqual(
      adminNoQueue.presence.map(p => p.status),
    )
    expect(m.statusBlocks.length).toBeGreaterThan(0)
    expect(m.offQueueSummary.some(r => r.status === 'Available')).toBe(true)
  })

  it('reports no queue engagement for an agent who never joins a queue', () => {
    const m = buildDayModel(adminNoQueue)
    expect(m.onQueueMin).toBe(0)
    expect(m.engagedMin).toBe(0)
    expect(m.occupancyPct).toBe(0)
    expect(m.utilizationPct).toBe(0)
  })

  it('leaves the routing path untouched when any routing exists', () => {
    // The primary `day` fixture has routing, so it must NOT use the fallback.
    const m = buildDayModel(day)
    expect(m.statusSegments.some(s => s.status !== 'OFF_QUEUE')).toBe(true)
  })
})

describe('off-queue runs spanning more than one presence reason', () => {
  const at = (startMin: number) => {
    const m = buildDayModel(meetingIntoBreak)
    return m.statusBlocks.find(b => b.startMin === startMin)
  }

  it('cuts the run at the presence boundaries instead of labelling it as a whole', () => {
    const offQueue = buildDayModel(meetingIntoBreak).statusSegments.filter(s => s.status === 'OFF_QUEUE')
    expect(offQueue.map(s => [s.startMin, s.endMin, s.reason])).toEqual([
      [15 * 60 + 30, 15 * 60 + 31, 'Available'],
      [15 * 60 + 31, 15 * 60 + 44, 'Meeting'],
      [15 * 60 + 44, 15 * 60 + 58, 'Break'],
      [15 * 60 + 58, 16 * 60 + 1, 'Available'],
    ])
  })

  it('credits each reason its own minutes in the Phone Status breakdown', () => {
    const m = buildDayModel(meetingIntoBreak)
    expect(m.offQueueSummary.map(r => [r.status, r.mins])).toEqual([
      ['Available', 4], ['Meeting', 13], ['Break', 14],
    ])
  })

  it('preserves the totals — splitting moves labels, never minutes', () => {
    const m = buildDayModel(meetingIntoBreak)
    expect(m.offQueueMin).toBe(31)
    expect(m.onQueueMin).toBe(7)
    expect(m.engagedMin).toBe(7)
  })

  it('fills a bar that spans a switch from its minute slices', () => {
    // 3:40–3:45 PM is 4 minutes of meeting then 1 minute of break.
    const block = at(15 * 60 + 40)
    expect(block?.slices.map(s => [s.reason, s.leftPct, s.widthPct])).toEqual([
      ['Meeting', 0, 80],
      ['Break', 80, 20],
    ])
    // The dominant reason still names the block, for readers wanting one answer.
    expect(block?.reason).toBe('Meeting')
  })

  it('leaves a bar covered by a single status as one slice', () => {
    const block = at(15 * 60 + 45)
    expect(block?.slices.map(s => [s.reason, s.widthPct])).toEqual([['Break', 100]])
  })

  it('leaves off-queue minutes no presence covers unlabelled rather than borrowing a neighbour', () => {
    const offQueue = buildDayModel(presenceGap).statusSegments.filter(s => s.status === 'OFF_QUEUE')
    expect(offQueue.map(s => [s.startMin, s.endMin, s.reason])).toEqual([
      [9 * 60, 9 * 60 + 10, null],
      [9 * 60 + 10, 9 * 60 + 20, 'Meeting'],
      [9 * 60 + 20, 9 * 60 + 30, null],
    ])
  })
})

describe('call block tone', () => {
  const block = (startMin: number) =>
    buildDayModel(shortCalls).callBlocks.find(b => b.startMin === startMin)

  it('keeps a slot holding one short answered call in its own direction', () => {
    const b = block(9 * 60 + 45)
    // The bar has to agree with its own hover: no missed call, no missed tone.
    expect(b?.missed).toBe(0)
    expect(b?.tone).toBe('outbound')
    expect(b?.outboundMins).toBeCloseTo(13 / 60, 6)
  })

  it('credits a short call the talk time it really had', () => {
    expect(block(9 * 60 + 50)?.inboundMins).toBeCloseTo(24 / 60, 6)
    expect(block(9 * 60 + 50)?.tone).toBe('inbound')
  })

  it('falls back to the call direction when no side has any talk time', () => {
    const b = block(9 * 60 + 55)
    expect(b?.inboundMins).toBe(0)
    expect(b?.outboundMins).toBe(0)
    expect(b?.missed).toBe(1)
    expect(b?.tone).toBe('outbound')
  })

  it('still paints a slot red when every call in it was missed', () => {
    const b = block(9 * 60 + 40)
    expect(b?.missed).toBe(1)
    expect(b?.tone).toBe('missed')
  })

  it('never shows a missed tone on a block that reports no missed calls', () => {
    days.forEach((d, i) => {
      buildDayModel(d).callBlocks.forEach(b => {
        if (b.tone === 'missed') expect(b.missed, `day ${i} @ ${b.startMin}`).toBeGreaterThan(0)
      })
    })
  })
})

describe('sub-minute call durations', () => {
  const c = buildDayModel(shortCalls).callSummary

  it('sums talk time from seconds instead of dropping short calls', () => {
    // 13s + 24s + a zero-length answered leg.
    expect(c.talkMins).toBeCloseTo(37 / 60, 6)
    expect(c.holdMins).toBeCloseTo(5 / 60, 6)
  })

  it('agrees with the roster basis: handle time is talk + hold + wrap in seconds', () => {
    expect(c.handleMins).toBeCloseTo(42 / 60, 6)
  })

  it('counts a hold the agent really placed, however brief', () => {
    expect(c.heldCount).toBe(1)
  })

  it('splits calls at a true sixty seconds', () => {
    expect(c.underOneMin).toBe(3)
    expect(c.overOneMin).toBe(0)
  })

  it('reports a sub-minute total as seconds rather than collapsing it to 0m', () => {
    expect(fmtHM(13 / 60)).toBe('13s')
    expect(fmtHM(0)).toBe('0m')
    expect(fmtHM(20)).toBe('20m')
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

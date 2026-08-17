/**
 * Pins the arithmetic behind the Productivity drill-down.
 *
 * The claim the page makes to a manager is that every clocked minute is
 * accounted for, so the "Time accounting" column has to reconcile exactly — a
 * silent 40-minute residual would read as a real finding about the agent rather
 * than a bug in the partition. These run over every generated agent-day so a
 * change to the sample generator or the bucket rules cannot quietly break it.
 */

import { describe, it, expect } from 'vitest'
import { buildDayModel } from '../productivityModel'
import { PRODUCTIVITY_KPIS } from '../productivityHeader'
import { buildPeerComparison, rosterForDate } from '../productivityBenchmark'
import { SAMPLE_AGENTS } from '../placeholderData'
import { SAMPLE_DATES, getAgentDay, departmentOf, peersIn } from '../productivitySampleData'
import { getKpiDef } from '../../../../constants/kpiDefs'

const everyDay = SAMPLE_AGENTS.flatMap(agent =>
  SAMPLE_DATES.map(date => ({ agent, date, model: buildDayModel(getAgentDay(agent, date)) })),
)

describe('time accounting', () => {
  it('has a day for every agent and date', () => {
    expect(everyDay).toHaveLength(SAMPLE_AGENTS.length * SAMPLE_DATES.length)
    everyDay.forEach(({ model }) => expect(model.hasData).toBe(true))
  })

  it('partitions clocked time exactly', () => {
    everyDay.forEach(({ agent, date, model }) => {
      const summed = model.timeAccounting.reduce((a, b) => a + b.mins, 0)
      expect(summed, `${agent} ${date}`).toBe(model.clockedMin)
    })
  })

  it('leaves nothing material unaccounted', () => {
    everyDay.forEach(({ agent, date, model }) => {
      const other = model.timeAccounting.find(b => b.key === 'other')
      expect(other?.mins ?? 0, `${agent} ${date}`).toBeLessThanOrEqual(2)
    })
  })

  it('keeps utilization inside the clock and consistent with its buckets', () => {
    everyDay.forEach(({ agent, date, model }) => {
      expect(model.utilizationPct, `${agent} ${date}`).toBeLessThanOrEqual(100)
      expect(model.utilizationPct).toBe(
        Math.round(((model.onCallMin + model.deskWorkOffQueueMin) / model.clockedMin) * 100),
      )
      expect(model.onCallMin).toBeLessThanOrEqual(model.engagedMin)
    })
  })
})

describe('call handling figures', () => {
  it('derives handle time from its three parts', () => {
    everyDay.forEach(({ model }) => {
      const c = model.callSummary
      expect(c.handleMins).toBe(c.talkMins + c.holdMins + c.wrapMins)
      expect(c.answered + c.missed).toBe(c.total)
      expect(c.transferred).toBeLessThanOrEqual(c.answered)
    })
  })

  it('never reports more connected dials than dials placed', () => {
    everyDay.forEach(({ model }) => {
      const c = model.callSummary
      expect(c.connected + c.voicemail + c.noAnswer).toBe(c.dials)
      expect(c.connected).toBe(c.outbound)
    })
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
    // KpiTile reads name/format/thresholds/info from the shared registry; an
    // unregistered code would render as a bare code with no formatting.
    PRODUCTIVITY_KPIS.forEach(k => expect(getKpiDef(k.code), k.code).toBeDefined())
  })

  it('computes a finite value for every agent-day', () => {
    everyDay.forEach(({ model }) => {
      PRODUCTIVITY_KPIS.forEach(k => {
        expect(Number.isFinite(k.value(model)), k.code).toBe(true)
      })
    })
  })
})

describe('peer comparison', () => {
  it('compares an agent only against their own department', () => {
    const date = SAMPLE_DATES[0]
    SAMPLE_AGENTS.forEach(agent => {
      const cmp = buildPeerComparison(agent, date, buildDayModel(getAgentDay(agent, date)))
      expect(cmp.department).toBe(departmentOf(agent))
      expect(cmp.comparable).toBe(peersIn(departmentOf(agent)).length > 1)
    })
  })

  it('marks a solo department as not comparable, with nothing flagged', () => {
    const solo = SAMPLE_AGENTS.find(a => peersIn(departmentOf(a)).length === 1)!
    const date = SAMPLE_DATES[0]
    const cmp = buildPeerComparison(solo, date, buildDayModel(getAgentDay(solo, date)))
    expect(cmp.comparable).toBe(false)
    expect(cmp.peerCount).toBe(1)
    expect(cmp.flagged).toHaveLength(0)
  })

  it('renders rows in a fixed order and only ranks the banner worst-gap first', () => {
    const rank = { off: 0, watch: 1, inline: 2, info: 3 }
    const date = SAMPLE_DATES[0]
    // The row list is stable across agents (e.g. Time in Queue always above Idle);
    // the worst-first ranking is used only for the out-of-line banner.
    const ORDER = ['phone', 'queue', 'tickets', 'productive', 'idle']
    SAMPLE_AGENTS.forEach(agent => {
      const cmp = buildPeerComparison(agent, date, buildDayModel(getAgentDay(agent, date)))
      expect(cmp.metrics.map(m => m.key), agent).toEqual(ORDER)
      const flaggedStates = cmp.flagged.map(m => rank[m.state])
      expect([...flaggedStates].sort((a, b) => a - b)).toEqual(flaggedStates)
    })
  })

  it('brackets each agent inside the range drawn on the strip', () => {
    const date = SAMPLE_DATES[2]
    SAMPLE_AGENTS.forEach(agent => {
      buildPeerComparison(agent, date, buildDayModel(getAgentDay(agent, date))).metrics.forEach(m => {
        expect(m.peerMin).toBeLessThanOrEqual(m.median)
        expect(m.peerMax).toBeGreaterThanOrEqual(m.median)
        expect(m.q1).toBeLessThanOrEqual(m.q3)
      })
    })
  })
})

describe('roster', () => {
  const day = SAMPLE_DATES[SAMPLE_DATES.length - 1]

  it('agrees with the day it is built from', () => {
    rosterForDate(day).forEach(row => {
      const m = buildDayModel(getAgentDay(row.agent, day))
      expect(row.clockedMin).toBe(m.clockedMin)
      expect(row.utilizationPct).toBe(m.utilizationPct)
      expect(row.missedCalls).toBe(m.callSummary.missed)
      expect(row.callsPerHour).toBeCloseTo(
        m.clockedMin > 0 ? m.callSummary.answered / (m.clockedMin / 60) : 0, 5,
      )
    })
  })

  it('has a laggard in each multi-person department, so the exception path is exercised', () => {
    // Averaged over the sample days: the per-agent pace is a deliberate bias, but
    // a single noisy day can put two agents within a point, so the laggard is a
    // property of the period, not of one day.
    const meanUtil = (agent: string) => {
      const vals = SAMPLE_DATES.map(d => rosterForDate(d).find(r => r.agent === agent)!.utilizationPct)
      return vals.reduce((a, b) => a + b, 0) / vals.length
    }
    expect(meanUtil('Megan Foti')).toBeLessThan(meanUtil('Jamie Waldie'))
    expect(meanUtil('Nick Robinson')).toBeLessThan(meanUtil('Mitchell Stempowski'))
  })
})

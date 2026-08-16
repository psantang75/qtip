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
import { buildHeaderTiles } from '../productivityHeader'
import { buildPeerComparison, productivityRoster } from '../productivityBenchmark'
import { SAMPLE_AGENTS } from '../placeholderData'
import { SAMPLE_DATES, getAgentDay, departmentOf, peersIn } from '../productivitySampleData'

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

describe('header tiles', () => {
  it('always renders the same five slots', () => {
    const keys = ['utilization', 'aht', 'cph', 'acw', 'missed']
    everyDay.forEach(({ agent, date, model }) => {
      expect(buildHeaderTiles(agent, date, model).map(t => t.key)).toEqual(keys)
    })
  })

  it('draws the same period series whichever day is selected', () => {
    const [first, , third] = SAMPLE_DATES
    SAMPLE_AGENTS.forEach(agent => {
      const a = buildHeaderTiles(agent, first, buildDayModel(getAgentDay(agent, first)))
      const b = buildHeaderTiles(agent, third, buildDayModel(getAgentDay(agent, third)))
      a.forEach((tile, i) => {
        expect(tile.series).toHaveLength(SAMPLE_DATES.length)
        expect(tile.series, `${agent} ${tile.key}`).toEqual(b[i].series)
      })
    })
  })

  it('drops the benchmark on a solo department but keeps utilization on target', () => {
    // Installs is a department of one in the sample data.
    const solo = SAMPLE_AGENTS.find(a => peersIn(departmentOf(a)).length === 1)!
    const date = SAMPLE_DATES[0]
    const tiles = buildHeaderTiles(solo, date, buildDayModel(getAgentDay(solo, date)))
    tiles.forEach(t => {
      if (t.key === 'utilization') {
        expect(t.hasBenchmark).toBe(true)
        expect(t.benchmarkLabel).toMatch(/^target/)
      } else {
        expect(t.hasBenchmark, t.key).toBe(false)
        expect(t.benchmarkLabel).toBe('')
        expect(t.deltaLabel).toBe('')
      }
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

  it('orders rows worst gap first', () => {
    const rank = { off: 0, watch: 1, inline: 2, info: 3 }
    const date = SAMPLE_DATES[0]
    SAMPLE_AGENTS.forEach(agent => {
      const states = buildPeerComparison(agent, date, buildDayModel(getAgentDay(agent, date)))
        .metrics.map(m => rank[m.state])
      expect([...states].sort((a, b) => a - b)).toEqual(states)
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
  it('agrees with the days it is summed from', () => {
    productivityRoster.forEach(row => {
      const days = SAMPLE_DATES.map(d => buildDayModel(getAgentDay(row.agent, d)))
      const clocked = days.reduce((a, m) => a + m.clockedMin, 0)
      const answered = days.reduce((a, m) => a + m.callSummary.answered, 0)
      expect(row.clockedMin).toBe(clocked)
      expect(row.missedCalls).toBe(days.reduce((a, m) => a + m.callSummary.missed, 0))
      expect(row.callsPerHour).toBeCloseTo(answered / (clocked / 60), 5)
    })
  })

  it('has a laggard in each multi-person department, so the exception path is exercised', () => {
    const utilization = (agent: string) => productivityRoster.find(r => r.agent === agent)!.utilizationPct
    expect(utilization('Megan Foti')).toBeLessThan(utilization('Jamie Waldie'))
    expect(utilization('Nick Robinson')).toBeLessThan(utilization('Mitchell Stempowski'))
  })
})

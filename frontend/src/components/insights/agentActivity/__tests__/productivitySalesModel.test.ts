/**
 * Pins the Sales work rows and the Sales KPI strip of the Productivity
 * drill-down: 5-minute quantising of emails and lead touches, exact spans for
 * floor plans and demos, the day totals, and which KPI set each area gets.
 */
import { describe, it, expect } from 'vitest'
import { buildDayModel } from '../productivityModel'
import { buildSalesModel } from '../productivitySalesModel'
import { makeAxis } from '../productivitySegments'
import { PRODUCTIVITY_KPIS, SALES_PRODUCTIVITY_KPIS, kpisForArea } from '../productivityHeader'
import { getKpiDef } from '../../../../constants/kpiDefs'
import type { AgentDay, ProductivityRosterRow, SalesDay } from '../productivityTypes'

const sales: SalesDay = {
  leads: [
    { time: '09:01', leads: 2, contactManager: 0, ids: [
      { itemId: 11, kind: 'lead', url: 'http://crm/t/11', subject: 'A' },
      { itemId: 12, kind: 'lead', url: null, subject: null },
    ] },
    { time: '09:04', leads: 0, contactManager: 1, ids: [{ itemId: 13, kind: 'contact_manager', url: null, subject: 'C' }] },
    { time: '10:30', leads: 0, contactManager: 2, ids: [
      { itemId: 14, kind: 'contact_manager', url: null, subject: null },
      { itemId: 15, kind: 'contact_manager', url: null, subject: null },
    ] },
  ],
  proposals: [
    { time: '09:02', taskId: 11, url: 'http://crm/t/11', type: 'sub_player' },
    { time: '11:15', taskId: 16, url: null, type: 'audio_system' },
    { time: '11:40', taskId: 17, url: null, type: 'sub_player' },
  ],
  floorPlans: [{ start: '13:00', end: '13:45', taskId: 20, url: null, minutes: 45, players: 1, amplifiers: 1, speakers: 8, volumeControls: 2 }],
  demos: [{ start: '10:00', end: '10:30', taskId: 21, url: null, note: 'Walkthrough' }],
  emails: [
    { time: '09:10', count: 2, subjects: ['Quote', 'Follow up'] },
    { time: '09:12', count: 1, subjects: ['Re: Quote'] },
    { time: '07:00', count: 1, subjects: ['Before the axis'] },
  ],
}

const salesDay: AgentDay = {
  schedule: null,
  clock: [{ start: '09:00', end: '17:00', status: 'Working' }],
  routing: [{ start: '09:00', end: '17:00', status: 'IDLE' }],
  presence: [], calls: [],
  outbound: { dials: 0, connected: 0, voicemail: 0, noAnswer: 0 },
  tickets: [], sales,
}

const row: ProductivityRosterRow = {
  employeeKey: 1, agent: 'S1', department: 'Sales',
  clockedMin: 480, utilizationPct: 20, deskProductiveMin: 300, warehouseMin: 0, deskUtilizationPct: 62.5,
  occupancyPct: 0, callsPerHour: 0, ahtMins: 0, missedCalls: 0, handleMin: 0, onQueueMin: 480, ticketsTouched: 0,
}

describe('buildSalesModel', () => {
  const axis = makeAxis(8 * 60, 18 * 60 + 30)
  const m = buildSalesModel(axis, sales)

  it('quantises lead touches into 5-minute blocks, toned by the dominant kind', () => {
    expect(m.leadBlocks.map(b => b.startMin)).toEqual([9 * 60, 10 * 60 + 30])
    expect(m.leadBlocks[0]).toMatchObject({ leads: 2, contactManager: 1, tone: 'lead' })
    expect(m.leadBlocks[0].ids.map(i => i.itemId)).toEqual([11, 12, 13])
    expect(m.leadBlocks[1]).toMatchObject({ leads: 0, contactManager: 2, tone: 'contact_manager' })
  })

  it('buckets emails by slot and drops any that fall off the axis', () => {
    expect(m.emailBlocks).toHaveLength(1)
    expect(m.emailBlocks[0]).toMatchObject({ startMin: 9 * 60 + 10, count: 3 })
    expect(m.emailBlocks[0].subjects.map(s => s.subject)).toEqual(['Quote', 'Follow up', 'Re: Quote'])
  })

  it('places a proposal marker at its exact minute', () => {
    expect(m.proposalMarks.map(p => p.min)).toEqual([9 * 60 + 2, 11 * 60 + 15, 11 * 60 + 40])
    expect(m.proposalMarks[0].leftPct).toBeCloseTo(axis.at(9 * 60 + 2))
  })

  it('draws floor plans and demos as exact spans on one row, in time order', () => {
    expect(m.workSpans.map(w => w.kind)).toEqual(['demo', 'floor_plan'])
    expect(m.workSpans[1]).toMatchObject({ startMin: 13 * 60, endMin: 13 * 60 + 45 })
    expect(m.workSpans[1].widthPct).toBeCloseTo(axis.span(45))
  })

  it('totals the day, splitting proposals by type', () => {
    expect(m.totals).toEqual({
      leadsTouched: 2, contactManagerTouched: 3,
      proposals: 3, proposalsByType: { sub_only: 0, sub_player: 2, audio_system: 1, unclassified: 0 },
      floorPlans: 1, floorPlanMins: 45, demos: 1, demoMins: 30,
      emailsSent: 4,
    })
  })
})

describe('buildDayModel sales block', () => {
  it('is built only when the day carries a sales stream', () => {
    expect(buildDayModel(salesDay).sales).not.toBeNull()
    expect(buildDayModel({ ...salesDay, sales: undefined }).sales).toBeNull()
  })
})

describe('sales KPI strip', () => {
  const m = buildDayModel(salesDay)
  const kpi = (code: string) => SALES_PRODUCTIVITY_KPIS.find(k => k.code === code)!

  it('gives Sales its own five tiles and leaves CSR unchanged', () => {
    expect(kpisForArea('sales').map(k => k.code)).toEqual([
      'aa_prod_utilization', 'aa_prod_desk_utilization', 'aa_prod_leads_touched',
      'aa_prod_proposals_issued', 'aa_prod_emails_sent',
    ])
    expect(kpisForArea('csr')).toBe(PRODUCTIVITY_KPIS)
  })

  it('registers every Sales KPI in kpiDefs so KpiTile can render it', () => {
    SALES_PRODUCTIVITY_KPIS.forEach(k => expect(getKpiDef(k.code), k.code).toBeDefined())
  })

  it('reads the work counts off the day model', () => {
    expect(kpi('aa_prod_leads_touched').value(m, row)).toBe(5)
    expect(kpi('aa_prod_proposals_issued').value(m, row)).toBe(3)
    expect(kpi('aa_prod_emails_sent').value(m, row)).toBe(4)
  })

  it('reads desk utilization from the roster row, null when there is none', () => {
    expect(kpi('aa_prod_desk_utilization').value(m, row)).toBe(62.5)
    expect(kpi('aa_prod_desk_utilization').value(m, null)).toBeNull()
  })

  it('shows the lead and proposal splits as the tile basis', () => {
    expect(kpi('aa_prod_leads_touched').basis!(m, row)).toEqual([
      { label: 'Lead Manager', value: '2' },
      { label: 'Contact Manager', value: '3' },
    ])
    expect(kpi('aa_prod_proposals_issued').basis!(m, row)).toEqual([
      { label: 'Sub Only', value: '0' },
      { label: 'Sub + Player', value: '2' },
      { label: 'Audio System', value: '1' },
    ])
  })
})

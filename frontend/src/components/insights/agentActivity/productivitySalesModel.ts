/**
 * Sales-only derivations for the Productivity day drill-down: the Emails,
 * Leads (with proposal markers) and Floor Plans & Demos rows, plus the day
 * totals the Sales KPI tiles read. Instantaneous streams (emails, lead touches)
 * are quantised to the same 5-minute blocks as Calls and Tickets; floor plans
 * and demos have real durations, so they are drawn as exact spans.
 */
import { BLOCK_MIN, toMin, type Axis } from './productivitySegments'
import type {
  DemoSpan, FloorPlanSpan, ProposalType, SalesDay, SalesTouch,
} from './productivityTypes'

interface BlockGeom { startMin: number; leftPct: number; widthPct: number }

export interface EmailBlock extends BlockGeom { count: number; subjects: { min: number; subject: string }[] }
export interface LeadBlock extends BlockGeom {
  tone: 'lead' | 'contact_manager'; leads: number; contactManager: number; ids: SalesTouch[]
}
export interface ProposalMark { min: number; leftPct: number; type: ProposalType; taskId: number; url: string | null }
export type WorkSpan =
  | (BlockGeom & { kind: 'floor_plan'; endMin: number; item: FloorPlanSpan })
  | (BlockGeom & { kind: 'demo'; endMin: number; item: DemoSpan })

export type ProposalCounts = Record<ProposalType, number>

export interface SalesTotals {
  leadsTouched: number
  contactManagerTouched: number
  proposals: number
  proposalsByType: ProposalCounts
  floorPlans: number
  floorPlanMins: number
  demos: number
  demoMins: number
  emailsSent: number
}

export interface SalesModel {
  emailBlocks: EmailBlock[]
  leadBlocks: LeadBlock[]
  proposalMarks: ProposalMark[]
  workSpans: WorkSpan[]
  totals: SalesTotals
}

export const PROPOSAL_LABEL: Record<ProposalType, string> = {
  sub_only: 'Sub Only',
  sub_player: 'Sub + Player',
  audio_system: 'Audio System',
  unclassified: 'Unclassified',
}

const emptyCounts = (): ProposalCounts => ({ sub_only: 0, sub_player: 0, audio_system: 0, unclassified: 0 })

/** Groups instantaneous events into the 5-minute slot they fall in, dropping any off the axis. */
function bucket<E extends { time: string }>(axis: Axis, events: E[]): { geom: BlockGeom; items: E[] }[] {
  const slots = new Map<number, E[]>()
  for (const ev of events) {
    const m = toMin(ev.time)
    if (m < axis.startMin || m >= axis.endMin) continue
    const s = axis.startMin + Math.floor((m - axis.startMin) / BLOCK_MIN) * BLOCK_MIN
    slots.set(s, [...(slots.get(s) ?? []), ev])
  }
  return [...slots.entries()]
    .sort(([a], [b]) => a - b)
    .map(([s, items]) => ({ geom: { startMin: s, leftPct: axis.at(s), widthPct: axis.span(BLOCK_MIN) }, items }))
}

function span(axis: Axis, start: string, end: string): BlockGeom & { endMin: number } {
  const s = toMin(start)
  const e = Math.max(s + 1, toMin(end))
  return { startMin: s, endMin: e, leftPct: axis.at(s), widthPct: axis.span(e - s) }
}

export function buildSalesModel(axis: Axis, sales: SalesDay): SalesModel {
  const emailBlocks: EmailBlock[] = bucket(axis, sales.emails).map(({ geom, items }) => ({
    ...geom,
    count: items.reduce((a, e) => a + e.count, 0),
    subjects: items.flatMap(e => e.subjects.map(subject => ({ min: toMin(e.time), subject }))),
  }))

  const leadBlocks: LeadBlock[] = bucket(axis, sales.leads).map(({ geom, items }) => {
    const leads = items.reduce((a, e) => a + e.leads, 0)
    const contactManager = items.reduce((a, e) => a + e.contactManager, 0)
    return {
      ...geom, leads, contactManager, ids: items.flatMap(e => e.ids),
      tone: leads >= contactManager ? 'lead' : 'contact_manager',
    }
  })

  const proposalMarks: ProposalMark[] = sales.proposals.map(p => {
    const min = toMin(p.time)
    return { min, leftPct: axis.at(min), type: p.type, taskId: p.taskId, url: p.url }
  })

  const workSpans: WorkSpan[] = [
    ...sales.floorPlans.map(item => ({ ...span(axis, item.start, item.end), kind: 'floor_plan' as const, item })),
    ...sales.demos.map(item => ({ ...span(axis, item.start, item.end), kind: 'demo' as const, item })),
  ].sort((a, b) => a.startMin - b.startMin)

  const proposalsByType = emptyCounts()
  sales.proposals.forEach(p => { proposalsByType[p.type] += 1 })
  const sumBy = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0)

  return {
    emailBlocks, leadBlocks, proposalMarks, workSpans,
    totals: {
      leadsTouched: sumBy(sales.leads, e => e.leads),
      contactManagerTouched: sumBy(sales.leads, e => e.contactManager),
      proposals: sales.proposals.length,
      proposalsByType,
      floorPlans: sales.floorPlans.length,
      floorPlanMins: sumBy(sales.floorPlans, f => f.minutes),
      demos: sales.demos.length,
      demoMins: sumBy(sales.demos, d => Math.max(0, toMin(d.end) - toMin(d.start))),
      emailsSent: sumBy(sales.emails, e => e.count),
    },
  }
}

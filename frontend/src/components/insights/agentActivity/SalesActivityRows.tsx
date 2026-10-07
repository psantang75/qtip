import { fmtClock, fmtHM, type AxisTick } from './productivityModel'
import { PROPOSAL_LABEL, type SalesModel, type WorkSpan } from './productivitySalesModel'
import { EMAIL_CLS, LEAD_CLS, PROPOSAL_CLS, WORK_SPAN_CLS } from './productivityStatus'
import { Bar, TimelineRow } from './TimelinePrimitives'
import { crmLinkRow, hAt, hMuted, hText, hTime, type HoverDetail, type ShowFn } from './timelineCells'

/**
 * The Sales-only rows of the Activity Timeline, drawn between Calls and Tickets:
 *
 *   Emails         — sent emails (one per conversation), in 5-minute blocks
 *   Leads          — Lead Manager / Contact Manager tasks first touched, in
 *                    5-minute blocks, with a marker at each "Proposal Issued"
 *   Floor Plans & Demos — the real spans of uploaded floor plans (drawn back
 *                    from the upload by the minutes the agent logged) and held demos
 */

const LINK_COLS = 'auto minmax(0,1fr) auto'
const KIND_LABEL = { lead: 'Lead', contact_manager: 'Contact Manager' } as const

function workSpanDetail(w: WorkSpan): HoverDetail {
  if (w.kind === 'floor_plan') {
    const f = w.item
    return {
      title: 'Floor Plan',
      subtitle: `${fmtHM(f.minutes)} spent · uploaded ${fmtClock(w.endMin)} · Players ${f.players} · Amps ${f.amplifiers} · Speakers ${f.speakers} · Volume Controls ${f.volumeControls}`,
      gridCols: LINK_COLS,
      rows: [crmLinkRow(`Task ${f.taskId}`, 'Lead task', f.url)],
    }
  }
  const d = w.item
  return {
    title: 'Demo Held',
    subtitle: <>{hTime(w.startMin, w.endMin)} · {fmtHM(w.endMin - w.startMin)}</>,
    gridCols: LINK_COLS,
    rows: [crmLinkRow(`Task ${d.taskId}`, d.note ?? 'Meeting held', d.url)],
  }
}

export default function SalesActivityRows({ sales, ticks, onShow, onHide }: {
  sales: SalesModel; ticks: AxisTick[]; onShow: ShowFn; onHide: () => void
}) {
  return (
    <>
      <TimelineRow label="Emails" ticks={ticks}>
        {sales.emailBlocks.map(b => (
          <Bar
            key={b.startMin}
            gap
            cls={EMAIL_CLS}
            leftPct={b.leftPct}
            widthPct={b.widthPct}
            onShow={onShow}
            onHide={onHide}
            detail={{
              title: 'Emails',
              subtitle: `Sent ${b.count}`,
              gridCols: 'auto minmax(0,1fr)',
              rows: b.subjects.map(s => ({ cells: [hAt(s.min), hText(s.subject || '(no subject)')] })),
            }}
          />
        ))}
      </TimelineRow>

      <TimelineRow label="Leads" ticks={ticks}>
        {sales.leadBlocks.map(b => (
          <Bar
            key={b.startMin}
            gap
            cls={LEAD_CLS[b.tone]}
            leftPct={b.leftPct}
            widthPct={b.widthPct}
            onShow={onShow}
            onHide={onHide}
            detail={{
              title: 'Leads',
              subtitle: `Lead Manager ${b.leads} · Contact Manager ${b.contactManager}`,
              gridCols: LINK_COLS,
              rows: b.ids.map(t => crmLinkRow(`${KIND_LABEL[t.kind]} ${t.itemId}`, t.subject ?? '', t.url)),
            }}
          />
        ))}
        {sales.proposalMarks.map((p, i) => (
          <Bar
            key={`p${i}`}
            cls={`${PROPOSAL_CLS[p.type]} z-10 ring-1 ring-white`}
            leftPct={p.leftPct}
            widthPct={0}
            minPx={4}
            onShow={onShow}
            onHide={onHide}
            detail={{
              title: 'Proposal Issued',
              subtitle: <>{hAt(p.min)} · {hText(PROPOSAL_LABEL[p.type])}</>,
              gridCols: LINK_COLS,
              rows: [crmLinkRow(`Lead ${p.taskId}`, hMuted('Moved to Proposal Issued'), p.url)],
            }}
          />
        ))}
      </TimelineRow>

      <TimelineRow label="Floor Plans & Demos" ticks={ticks}>
        {sales.workSpans.map((w, i) => (
          <Bar
            key={i}
            cls={WORK_SPAN_CLS[w.kind]}
            leftPct={w.leftPct}
            widthPct={w.widthPct}
            onShow={onShow}
            onHide={onHide}
            detail={workSpanDetail(w)}
          />
        ))}
      </TimelineRow>
    </>
  )
}

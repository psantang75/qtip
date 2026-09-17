import type { ReactNode } from 'react'
import { DollarSign, FileText, ClipboardList, Layers } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { fmtUSD, fmtPct, fmtNum } from '@/components/insights/agentActivity/format'
import type { DeclinedBasisCohort, RecoverySplit } from '@/types/collections'

/**
 * The opening tiles every declined-charge report starts from.
 *
 * SHARED BECAUSE THE POPULATION IS SHARED. Campaign × Touch and Agent Performance both
 * open on the invoices the recurring run declined — Cycle Performance's own rows — and a
 * second copy of this panel is how two pages end up stating the same four facts with
 * different arithmetic behind them. One component, one `DeclinedBasisCohort`, so if the
 * tiles ever disagree it is the data that differs, never the rendering.
 */

/**
 * `info` follows the house tooltip rule: the tile itself is the hover trigger, never an
 * added info icon, and the card mirrors the "Audits Completed" KPI layout — title,
 * description, then labelled rows for the basis.
 */
export function OutcomeTile({ icon, label, value, sub, info }: {
  icon: ReactNode
  label: string
  value: string
  sub: string
  info?: { description: string; rows: Array<[string, string]> }
}) {
  const tile = (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-400">
        {icon}{label}
      </div>
      <div className="text-2xl font-semibold text-slate-900 mt-1">{value}</div>
      <div className="text-[12px] text-slate-500 mt-0.5">{sub}</div>
    </div>
  )
  if (!info) return tile

  return (
    <Tooltip>
      <TooltipTrigger asChild>{tile}</TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="max-w-[340px] rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
      >
        <div className="text-[13px] font-semibold text-slate-900">{label}</div>
        <p className="mt-1 text-[12.5px] leading-snug text-slate-600">{info.description}</p>
        <div className="mt-2 space-y-1.5">
          {info.rows.map(([k, v]) => (
            <div key={k}>
              <div className="text-[10px] uppercase tracking-wide text-slate-400">{k}</div>
              <div className="text-[12px] text-slate-700">{v}</div>
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * The cycle's opening balance sheet: what the run declined, and where those invoices,
 * their subscriptions and the tasks chasing them ended up.
 *
 * All four tiles describe ONE set of rows, so they reconcile against each other and
 * against Cycle Performance. `unattributedLabel` names what the host report was able to
 * attribute recovery to, since that differs — touch rungs on Campaign × Touch, a
 * processor on Agent Performance — while the gap itself means the same thing on both.
 */
export function StartingPoint({ c, unattributedLabel }: {
  c: DeclinedBasisCohort
  unattributedLabel?: string
}) {
  const coverage = c.tasks ? (c.tasksWithInvoice / c.tasks) * 100 : 0
  return (
    <TooltipProvider delayDuration={150}>
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/*
          A campaign with no failed charge has no declined pool, so the tile reports the
          cash it collected instead of borrowing someone else's denominator. Selecting
          Check used to show the card and ACH runs' $81,199 as its own dollars at risk.
        */}
        <OutcomeTile
          icon={<DollarSign className="h-4 w-4 text-danger" />}
          label={c.atRisk == null ? 'Collected' : 'Declined Dollars'}
          value={c.atRisk == null ? fmtUSD(c.collected) : fmtUSD(c.atRisk)}
          sub={c.atRisk == null
            ? 'No failed charge behind this campaign, so no rate'
            : `${fmtUSD(c.collected)} recovered${c.dollarRate != null ? ` · ${fmtPct(c.dollarRate)}` : ''}`}
          info={c.atRisk == null ? undefined : {
            description:
              'The recurring run\u2019s own invoices that declined on the charge \u2014 the same '
              + 'rows Cycle Performance reports, read the same way. Every tile on this row '
              + 'describes that one set, so they reconcile against each other and against '
              + 'that report.',
            rows: [
              ['Basis', `${fmtUSD(c.atRisk)} across ${fmtNum(c.invoices)} declined invoices`],
              ['Recovered against it', `${fmtUSD(c.collected)}${c.dollarRate != null ? ` · ${fmtPct(c.dollarRate)}` : ''}`],
              ['Ties to', 'Cycle Performance \u2192 Collected to Date, same campaign and window'],
              // Stated rather than smoothed away. A shortfall is cash on a basis invoice
              // that the report's own attribution could not claim, which is worth seeing.
              ...(c.unattributed !== 0
                ? [[
                  'Not attributed',
                  `${fmtUSD(c.unattributed)} \u2014 collected on these invoices, but ${
                    unattributedLabel ?? 'nothing in the recovery fact accounts for it'
                  }`,
                ] as [string, string]]
                : []),
            ],
          }}
        />
        <OutcomeTile
          icon={<FileText className="h-4 w-4 text-warning" />}
          label="Invoices" value={fmtNum(c.invoices)}
          sub={`${fmtNum(c.invoicesPaid)} paid · ${fmtNum(c.invoicesCreditMemo)} CM · ${fmtNum(c.invoicesOpen)} open`}
        />
        <OutcomeTile
          icon={<Layers className="h-4 w-4 text-success" />}
          label="Subscriptions" value={fmtNum(c.subs)}
          sub={`${fmtNum(c.subsRetained)} retained · ${fmtNum(c.subsTerminated)} CM · ${fmtNum(c.subsReactivated)} reactivated`}
        />
        <OutcomeTile
          icon={<ClipboardList className="h-4 w-4 text-primary" />}
          label="Tasks" value={fmtNum(c.tasks)}
          sub={`${fmtNum(c.recovered)} recovered${c.taskRate != null ? ` · ${fmtPct(c.taskRate)}` : ''}${c.stillOpen ? ` · ${fmtNum(c.stillOpen)} open` : ''}`}
        />
      </div>
      {/* Only a campaign with no recurring run behind it can fall short here — its tiles
          are task-anchored because it has no declined invoice to anchor on. For the four
          run campaigns every task is chasing a basis invoice by construction. */}
      {coverage < 99 && (
        <p className="text-[12px] text-slate-500">
          This campaign has no failed charge behind it, so its figures are counted from the
          tasks worked rather than from a declined invoice. Invoices — and the subscriptions
          counted from them — cover the {fmtNum(c.tasksWithInvoice)} of {fmtNum(c.tasks)} tasks
          ({fmtPct(coverage)}) that have one.
        </p>
      )}
    </div>
    </TooltipProvider>
  )
}

/**
 * The question the campaign exists to answer: did the money need an agent?
 * `preAgent` is cash that landed after the decline but before anyone called;
 * `postAgent` is cash that followed at least one attempt.
 *
 * Lives here rather than in its own file because it reads the same declined basis the
 * tiles above do — it moved across when Channel Effectiveness was retired and Agent
 * Performance became its only caller.
 */
export function SplitPanel({ split, recoveryRate }: { split: RecoverySplit; recoveryRate: number | null }) {
  const total = split.preAgent.amount + split.postAgent.amount
  const share = (v: number) => (total > 0 ? (v / total) * 100 : 0)

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SplitTile
          title="Recovered before any agent"
          amount={split.preAgent.amount}
          payments={split.preAgent.payments}
          share={share(split.preAgent.amount)}
          note="Self-served in the portal or rang in — the decline resolved itself."
          accent="text-success"
        />
        <SplitTile
          title="Recovered after an agent attempt"
          amount={split.postAgent.amount}
          payments={split.postAgent.payments}
          share={share(split.postAgent.amount)}
          note="At least one touch was logged on the task before the cash landed."
          accent="text-primary"
        />
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-600">Recovery rate</div>
          <div className="mt-1.5 text-2xl font-bold leading-none text-slate-900">
            {recoveryRate == null ? '—' : fmtPct(recoveryRate)}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">of the dollars that fell into the campaign</div>
        </div>
      </div>

      {total > 0 && (
        <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
          <div className="bg-success" style={{ width: `${share(split.preAgent.amount)}%` }} />
          <div className="bg-primary" style={{ width: `${share(split.postAgent.amount)}%` }} />
        </div>
      )}
    </div>
  )
}

function SplitTile({
  title, amount, payments, share, note, accent,
}: {
  title: string; amount: number; payments: number; share: number; note: string; accent: string
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium text-slate-600">{title}</div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-2xl font-bold leading-none text-slate-900">{fmtUSD(amount)}</span>
        <span className={`text-sm font-semibold ${accent}`}>{fmtPct(share)}</span>
      </div>
      <div className="mt-1 text-[11px] text-slate-400">{fmtNum(payments)} payments · {note}</div>
    </div>
  )
}

/**
 * Stage 3 of Cycle Performance — what came back, and which card paid.
 *
 * The three card paths answer "which instrument settled THIS invoice". They do
 * not mean the declined card was taken off file. CRM creates a new billing group
 * for a replacement and leaves the old one sitting there, so a different card
 * paying today is how next cycle's repeat decline happens unless someone retires
 * the original. `originalStillCharged` is that happening: we sent the declined
 * card again after a different card had already paid.
 */
import { TooltipProvider } from '@/components/ui/tooltip'
import { fmtUSD, fmtNum } from '@/components/insights/agentActivity/format'
import type { CycleRecoveryPath } from '@/types/collections'
import { StatCard, BarRow } from './cyclePrimitives'
import { pctOf } from './cycleFormat'

const PATH_NOTE: Record<string, string> = {
  'New Card Provided':
    'Paid with a card we had never charged before this run. CRM usually creates a new billing group to hold it. That does not retire the card that declined.',
  'Another Card on File':
    'Paid with a different card we had already charged on an earlier run. The declined card may still be the one the next cycle will try.',
  'Same Card Tried Again':
    'Paid with the same card, on the same billing group, that the run declined. Not “retired” — the original card was used again and this time it worked.',
}

export function RecoveryPathPanel({ paths }: { paths: CycleRecoveryPath[] }) {
  const invoicedTotal = paths.reduce((a, p) => a + p.invoiced, 0)
  const collectedTotal = paths.reduce((a, p) => a + p.collected, 0)

  if (paths.length === 0) {
    return <p className="text-[12.5px] text-slate-500">No declines in this run.</p>
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatCard label="Declined" value={fmtUSD(invoicedTotal)} />
        <StatCard
          label="Recovered on Those Invoices"
          value={fmtUSD(collectedTotal)}
          accent={pctOf(collectedTotal, invoicedTotal)}
        />
      </div>

      <TooltipProvider delayDuration={200}>
        <div className="space-y-2">
          {paths.map(p => (
            <BarRow
              key={p.path}
              label={p.path}
              info={PATH_NOTE[p.path]}
              detail={`${fmtNum(p.invoices)} invoices · ${fmtUSD(p.invoiced)} declined${
                p.collected > 0 ? ` · ${fmtUSD(p.collected)} back` : ''
              }${
                p.originalStillCharged > 0
                  ? ` · ${fmtNum(p.originalStillCharged)} later charged on the declined card`
                  : ''
              }`}
              value={p.invoiced}
              total={invoicedTotal}
            />
          ))}
        </div>
      </TooltipProvider>
    </div>
  )
}

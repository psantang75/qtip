/**
 * Which currency Cycle Performance is denominated in.
 *
 * The report sums money, and USD plus CAD is not a number, so every measure is scoped
 * to one currency at the query. On its own that would make the others disappear — a
 * worse failure than mixing them, because nothing on the page would say they exist.
 * This picker is the disclosure: it lists every currency in the selected period with
 * its population, so an unselected one is visibly set aside rather than dropped.
 *
 * It renders nothing when the period holds a single currency, which is the normal case.
 */
import { fmtNum } from '@/components/insights/agentActivity/format'
import { fmtMoneyCoded } from './cycleFormat'
import { optionCls } from '@/utils/forms/optionCls'
import { cn } from '@/lib/utils'
import type { CycleCurrencyTotal } from '@/types/collections'

interface Props {
  selected: string
  totals: CycleCurrencyTotal[]
  onChange: (currency: string) => void
}

export function CurrencyPicker({ selected, totals, onChange }: Props) {
  if (totals.length < 2) return null

  const other = totals.filter(t => t.currency !== selected)

  return (
    <section className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Currency
        </span>
        {totals.map(t => (
          <button
            key={t.currency || 'unknown'}
            type="button"
            disabled={!t.currency}
            onClick={() => t.currency && onChange(t.currency)}
            className={cn(
              'rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
              optionCls(t.currency === selected),
              !t.currency && 'cursor-not-allowed opacity-60',
            )}
          >
            {t.currency || 'Unresolved'} · {fmtNum(t.invoices)}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-slate-500">
        Every figure below is in {selected}. Amounts are never converted or combined.
        {other.length > 0 && (
          <>
            {' '}Also in this period:{' '}
            {other.map((t, i) => (
              <span key={t.currency || 'unknown'}>
                {i > 0 && ', '}
                {t.currency
                  ? `${fmtMoneyCoded(t.invoiced, t.currency)} across ${fmtNum(t.invoices)} invoices`
                  : `${fmtNum(t.invoices)} invoices with no currency recorded`}
              </span>
            ))}
            .
          </>
        )}
      </p>
    </section>
  )
}

export default CurrencyPicker

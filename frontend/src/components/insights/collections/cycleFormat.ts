import { fmtPct } from '@/components/insights/agentActivity/format'

/** Share of a section total, guarding the zero-denominator case every stage can hit. */
export const pctOf = (v: number, total: number) => fmtPct(total > 0 ? (v / total) * 100 : 0)

/**
 * Money on Cycle Performance, with its cents and its own currency.
 *
 * The shared `fmtUSD` rounds to whole dollars and hardcodes USD, which is fine for the
 * KPI tiles it was written for and wrong here: this page drills down to single
 * invoices, so a $32.95 invoice was being displayed as $33, and the 30 Canadian
 * invoices in August and September were rendered behind a US dollar sign. `fmtUSD` has
 * five other callers, so it is left alone and this page formats its own.
 *
 * The currency is passed in rather than defaulted so a caller cannot forget it and
 * silently reintroduce the mislabelling. An empty code means the source never recorded
 * one, which is shown as an unresolved amount rather than being assumed to be dollars.
 */
export const fmtMoney = (v: number, currency: string): string => {
  if (!currency) return `${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (currency unknown)`
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * The same amount with its ISO code spelled out, for anywhere two currencies can appear
 * side by side — a bare "$" cannot distinguish USD from CAD.
 */
export const fmtMoneyCoded = (v: number, currency: string): string =>
  currency ? `${fmtMoney(v, currency)} ${currency}` : fmtMoney(v, currency)

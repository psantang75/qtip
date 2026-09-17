/**
 * Stage 1 of Cycle Performance — what the recurring run did.
 *
 * The leading card is everything the run invoiced; the rest break that total down by
 * what the gateway said. They always add back to it, which is what makes the page
 * checkable against CRM.
 */
import { fmtUSD, fmtNum } from '@/components/insights/agentActivity/format'
import type { CycleOutcome } from '@/types/collections'
import { StatCard } from './cyclePrimitives'
import { pctOf } from './cycleFormat'

/**
 * Outcome order and colour, read as a story: green processed → amber declined → our
 * two own-goals in red → the two never-attempted buckets → slate ACH still unknown.
 *
 * OUR FAILURES ARE ADJACENT AND BOTH RED. An ERROR is a malformed request of ours
 * (one $53,540.93 "Validation Error" on an account that bills $30.95/month was 54% of
 * one day's declined dollars). NO_RESPONSE is a charge we put on the wire that was
 * never answered. Neither is a customer failing to pay, and grouping them is what
 * makes the size of our own contribution legible at a glance.
 *
 * NO_RESPONSE WAS ORIGINALLY FILED UNDER "NEVER ATTEMPTED", WHICH WAS FALSE. Invoice
 * 1922467 has a gateway request row at 04:04:07 for $1,149.93 on last4 1008 and no
 * answer; it settled untouched on that same card three days later. We attempted it.
 * On 2026-08-01 that is 17 invoices, all submitted between 04:03:58 and 04:04:07.
 *
 * WHAT IS LEFT IS GENUINELY NEVER ATTEMPTED, and splits by whose problem it is. An
 * expired card is a card we should never have run. Everything else never reached the
 * gateway — including the run's last two invoices that day, stamped 04:04:09 and
 * 04:04:10, where CRM began the payment step and the run died before submitting.
 *
 * PENDING_ACH is separate again. ACH results land days after the run, so an ACH
 * invoice with no gateway row is not "never attempted" — the 2026-09-01 run had 671
 * of 679 ACH invoices unanswered on 09-10 against 45 of 8,049 for card. Folding those
 * in made settlement lag the largest apparent failure on the page.
 *
 * BUT IT IS NOT A BANK STATUS, and it used to read like one. The bucket is inferred
 * from the ABSENCE of a gateway row; nobody asked the bank anything. All 672 of
 * September's carry pay_request_state UNSUBMITTED, meaning CRM began the payment step
 * and nothing reached the gateway, which is not the same claim as "in flight at the
 * bank" — and only one of the 672 has settled since. The label says what we actually
 * know, which is that no result was recorded.
 *
 * IN_FLIGHT IS AN ANSWER THAT IS NOT FINAL, and it is the only bucket here that will
 * empty itself. A captured card is waiting on the batch; an ACH debit is in the network.
 * Both used to be counted as declines, which made the morning after a run look like a
 * mass failure — the 2026-09-16 card run showed 6,082 declines, of which 5,801 were
 * captures awaiting settlement. It sits next to DECLINED so the two are read together
 * and nobody chases an account whose money is already on its way.
 *
 * ALREADY_SETTLED explains an absent charge instead of describing it. The invoice was
 * paid or written off on an earlier day, so there was no debt to collect and skipping
 * it was right. Seven invoices across the 15-month window, worth 8,209.40, and one of
 * them was being reported as an expired-card miss for 415.17 — true about the card,
 * irrelevant to an invoice already at zero.
 */
const RESULT_META: Record<string, { label: string; note: string; accent: string; dot: string }> = {
  OK: {
    label: 'Processed',
    note: 'the run settled on the first attempt',
    accent: 'text-success',
    dot: 'bg-success',
  },
  DECLINED: {
    label: 'Declined',
    note: 'campaign intake — the customer’s card or bank said no',
    accent: 'text-warning',
    dot: 'bg-warning',
  },
  ERROR: {
    label: 'Submission Error',
    note: 'our request was malformed — not a customer failure, falls out',
    accent: 'text-destructive',
    dot: 'bg-destructive',
  },
  VOIDED: {
    label: 'Charged Then Voided',
    note: 'the gateway took the sale and it was reversed — usually a corrected amount',
    accent: 'text-warning',
    dot: 'bg-warning',
  },
  IN_FLIGHT: {
    label: 'Awaiting Settlement',
    note: 'the gateway accepted it and the result is not final yet — no decision to read',
    accent: 'text-neutral-700',
    dot: 'bg-slate-300',
  },
  NO_CHARGE_EXPIRED: {
    label: 'Never Attempted · Expired Card',
    note: 'the card on file had already lapsed when the run charged it',
    accent: 'text-destructive',
    dot: 'bg-destructive',
  },
  NO_RESPONSE: {
    label: 'Attempted · No Response',
    note: 'charge went to the gateway and no response was ever recorded',
    accent: 'text-destructive',
    dot: 'bg-destructive',
  },
  NO_CHARGE: {
    label: 'Never Attempted · No Request Sent',
    note: 'the charge never reached the gateway for this invoice',
    accent: 'text-neutral-700',
    dot: 'bg-slate-400',
  },
  PENDING_ACH: {
    label: 'ACH · No Result Recorded',
    note: 'no gateway answer for this ACH invoice — inferred from its absence, not confirmed with the bank',
    accent: 'text-neutral-700',
    dot: 'bg-slate-300',
  },
  ALREADY_SETTLED: {
    label: 'Already Settled',
    note: 'paid or written off before the run — there was nothing left to charge',
    accent: 'text-success',
    dot: 'bg-success',
  },
}
const RESULT_ORDER = [
  'OK', 'DECLINED', 'IN_FLIGHT', 'VOIDED', 'NO_RESPONSE',
  'NO_CHARGE_EXPIRED', 'NO_CHARGE', 'ERROR', 'ALREADY_SETTLED', 'PENDING_ACH',
]

export function CycleOutcomeCards({
  invoiced,
  outcomes,
}: {
  invoiced: { invoices: number; amount: number }
  outcomes: CycleOutcome[]
}) {
  const by = new Map(outcomes.map(o => [o.result, o]))

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Invoiced on the Run"
        value={fmtUSD(invoiced.amount)}
        note={`${fmtNum(invoiced.invoices)} recurring invoices`}
      />

      {RESULT_ORDER.map(key => {
        const row = by.get(key)
        const meta = RESULT_META[key]
        return (
          <StatCard
            key={key}
            dot={meta.dot}
            label={meta.label}
            value={fmtUSD(row?.amount ?? 0)}
            accent={pctOf(row?.amount ?? 0, invoiced.amount)}
            accentClass={meta.accent}
            note={`${fmtNum(row?.invoices ?? 0)} invoices · ${meta.note}`}
          />
        )
      })}
    </div>
  )
}

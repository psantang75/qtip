/**
 * Data behind the "Failed Charge Invoices by Agent" on-demand report.
 *
 * The same population as Insights → Collections → Failed Charge Invoices: it calls
 * that page's own service (pinned to DECLINED, cached per scope) rather than a second
 * copy of the query, so the report and the page can never disagree on a row. The
 * values the grid stacks into one cell (result + reason, recovered + paid date, card
 * + billing group, processor + type) are split into separate columns here.
 */
import { getFailedChargeInvoices, type CycleInvoiceRow } from '../insightsCollectionsCycle.service'
import { resolveInsightsScope } from '../insightsScope'
import { resolveTaskCrmUrls } from '../insights/missedOpportunities/crmLinkResolve'
import { buildCrmTaskUrl } from '../../utils/crmLinks'
import { createAuthorizationError, createValidationError } from '../../utils/errorHandler'
import type { CollectionsFilters } from '../insightsCollections.shared'
import type {
  OnDemandFilterOptions, OnDemandReportColumn, OnDemandReportFilters, OnDemandReportUser,
} from './types'

export const FAILED_CHARGES_REPORT_ID = 'failed-charge-invoices-by-agent'
/** The Failed Charge Invoices page grant — the report sees exactly what the page may. */
export const FAILED_CHARGES_PAGE_KEY = 'collections_failed_charges'
export const UNASSIGNED_REP = 'Unassigned'
/** The page service's own ceiling on one read. */
export const MAX_FAILED_CHARGE_ROWS = 5000
export const FAILED_CHARGE_CURRENCIES = ['USD', 'CAD']

/** Rep first, Task Link last; everything the grid stacks is its own column. */
export const FAILED_CHARGE_COLUMNS: OnDemandReportColumn[] = [
  { key: 'rep_name', label: 'Rep Name' },
  { key: 'repeat_issue', label: 'Repeat Issue' },
  { key: 'invoice_number', label: 'Invoice #' },
  { key: 'customer_id', label: 'Customer ID' },
  { key: 'invoice_date', label: 'Invoice Date', format: 'date' },
  { key: 'invoiced', label: 'Invoiced', align: 'right', format: 'number' },
  { key: 'campaign', label: 'Campaign' },
  { key: 'run_result', label: 'Run Result' },
  { key: 'decline_reason', label: 'Decline Reason' },
  { key: 'recovery_path', label: 'Recovery Path' },
  { key: 'recovered', label: 'Recovered', align: 'right', format: 'number' },
  { key: 'paid_on', label: 'Paid On', format: 'date' },
  { key: 'card_last4', label: 'Card Last 4' },
  { key: 'billing_group', label: 'Billing Group' },
  { key: 'outstanding', label: 'Outstanding', align: 'right', format: 'number' },
  { key: 'processed_by', label: 'Processed By' },
  { key: 'processor_type', label: 'Processor Type' },
  { key: 'task_link', label: 'Task Link', format: 'link' },
]

// Same wording as frontend/src/components/insights/collections/cycleLabels.ts.
const RESULT_LABEL: Record<string, string> = { DECLINED: 'Declined', ERROR: 'Submission Error' }
const PAYER_LABEL: Record<string, string> = {
  AGENT: 'Internal agent', PORTAL: 'Portal user', SYSTEM: 'Automatic run',
}

export interface FailedChargeRow extends Record<string, unknown> {
  rep_name: string
  repeat_issue: 'Yes' | 'No'
  invoice_number: number
  customer_id: number | null
  invoice_date: string
  invoiced: number
  campaign: string
  run_result: string
  decline_reason: string
  recovery_path: string
  recovered: number
  paid_on: string
  card_last4: string
  billing_group: number | null
  outstanding: number
  processed_by: string
  processor_type: string
  task_link: string
}

export function toFailedChargeRow(r: CycleInvoiceRow, taskUrl: string | null): FailedChargeRow {
  return {
    rep_name: r.taskAgentName ?? UNASSIGNED_REP,
    repeat_issue: r.isRepeat ? 'Yes' : 'No',
    invoice_number: r.orderId,
    customer_id: r.customerId,
    invoice_date: r.orderDate,
    invoiced: r.amount,
    campaign: r.campaign,
    run_result: RESULT_LABEL[r.result] ?? r.result,
    decline_reason: r.declineReason ?? '',
    recovery_path: r.recoveryPath,
    recovered: r.collected,
    paid_on: r.collected > 0 ? (r.paidOn ?? '') : '',
    card_last4: r.chargeLast4 ?? '',
    billing_group: r.chargeBillingGroupId,
    outstanding: r.openBalance,
    processed_by: r.processor ?? '',
    processor_type: r.processorClass ? (PAYER_LABEL[r.processorClass] ?? r.processorClass) : '',
    task_link: taskUrl ?? '',
  }
}

/** The page grant, or a 403. Returns the scope the page's own controller would pass. */
async function requirePageScope(user: OnDemandReportUser) {
  const result = await resolveInsightsScope(user.user_id, user.role, FAILED_CHARGES_PAGE_KEY)
  if (!result.ok) throw createAuthorizationError('Access denied for Failed Charge Invoices')
  return result.scope
}

function currencyOf(filters: Pick<OnDemandReportFilters, 'currency'>): string {
  const code = (filters.currency ?? 'USD').toUpperCase()
  if (!FAILED_CHARGE_CURRENCIES.includes(code)) throw createValidationError('Unsupported currency')
  return code
}

async function readPage(filters: OnDemandReportFilters, user: OnDemandReportUser) {
  const scope = await requirePageScope(user)
  const collections: CollectionsFilters = {
    period: 'custom',
    customStart: filters.start_date,
    customEnd: filters.end_date,
    campaign: filters.campaign || undefined,
    selfEmployeeKey: scope.selfEmployeeKey,
    departmentKeys: scope.departmentKeys,
  }
  return getFailedChargeInvoices(collections, {
    reason: filters.declineReason || undefined,
    limit: MAX_FAILED_CHARGE_ROWS,
    offset: 0,
    currency: currencyOf(filters),
  })
}

export interface FailedChargeSelection {
  rows: FailedChargeRow[]
  /** Declined invoices matching the filters before the row ceiling. */
  matched: number
}

/** Every declined invoice for the filters, shaped for display and download, rep then date. */
export async function loadFailedChargeRows(
  filters: OnDemandReportFilters,
  user: OnDemandReportUser,
): Promise<FailedChargeSelection> {
  const page = await readPage(filters, user)
  const invoices = (page.rows as CycleInvoiceRow[]) ?? []
  const taskIds = invoices.map(r => r.taskId).filter((id): id is number => id != null)
  const urls = await resolveTaskCrmUrls(taskIds)

  const reps = filters.agents?.length ? new Set(filters.agents) : null
  const rows = invoices
    .map(r => toFailedChargeRow(r, r.taskId == null
      ? null
      : (urls.get(r.taskId) ?? buildCrmTaskUrl({ taskId: r.taskId, newScreen: null }))))
    .filter(r => !reps || reps.has(r.rep_name))
    // Stable sort, so each rep keeps the service's newest-first order.
    .sort((a, b) => compareReps(a.rep_name, b.rep_name))
  return { rows, matched: page.total }
}

/** Alphabetical by rep with Unassigned last. */
export function compareReps(a: string, b: string): number {
  if (a === b) return 0
  if (a === UNASSIGNED_REP) return 1
  if (b === UNASSIGNED_REP) return -1
  return a.localeCompare(b)
}

/** One-line context next to the result count when the ceiling trimmed the cycle. */
export function buildFailedChargeNotice(matched: number, fetched: number): string | undefined {
  if (matched <= fetched) return undefined
  return `${matched.toLocaleString()} declined invoices match — showing the newest `
    + `${fetched.toLocaleString()}. Narrow the billing cycle or campaign to see the rest.`
}

/** Campaign / decline reason / rep / currency choices for the selected billing cycle. */
export async function failedChargeFilterOptions(
  filters: OnDemandReportFilters,
  user: OnDemandReportUser,
): Promise<OnDemandFilterOptions> {
  // Every reason in the cycle, so picking one never hides the others from the list.
  const page = await readPage({ ...filters, declineReason: undefined }, user)
  const invoices = (page.rows as CycleInvoiceRow[]) ?? []
  const reps = [...new Set(invoices.map(r => r.taskAgentName ?? UNASSIGNED_REP))]
    .sort(compareReps)
  return {
    departments: [],
    forms: [],
    agents: reps,
    campaigns: (page.campaigns as string[] | undefined) ?? [],
    declineReasons: page.declineReasons.map(r => r.reason),
    currencies: FAILED_CHARGE_CURRENCIES,
  }
}

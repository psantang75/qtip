/**
 * "Failed Charge Invoices by Agent" on-demand report.
 *
 * The declined invoices of a billing cycle, grouped by the rep assigned to the AR
 * task that chased each one, with that task's CRM link. Downloads as one complete
 * sheet, one rep's sheet, or a workbook with a tab per rep.
 */
import { timestampedFilename } from './helpers'
import {
  FAILED_CHARGES_REPORT_ID,
  FAILED_CHARGE_COLUMNS,
  buildFailedChargeNotice,
  loadFailedChargeRows,
} from './failedCharges.data'
import { buildFailedChargesWorkbook } from './failedCharges.xlsx'
import type { OnDemandReport } from './types'

/** Same billing-cycle choices as the Failed Charge Invoices page (CAMPAIGN_START_OPTIONS). */
const BILLING_CYCLE_OPTIONS = [
  'Current Month', 'Prior Month', 'Current Quarter', 'Prior Quarter', 'Current Year', 'Custom',
] as const

/** Filename-safe slug of a rep name. */
const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'Rep'

export const failedChargesReport: OnDemandReport = {
  id: FAILED_CHARGES_REPORT_ID,
  name: 'Failed Charge Invoices by Agent',
  description:
    'Every declined invoice in the billing cycle, grouped by the rep assigned to its collections task, '
    + 'with the task link. Download one rep, the complete report, or every rep on its own tab.',
  roles: [1, 5],
  columns: FAILED_CHARGE_COLUMNS,
  supportedFilters: ['period', 'campaign', 'declineReason', 'currency', 'agents'],
  defaultFilters: { campaign: 'All Declined', currency: 'USD' },
  periodLabel: 'Billing Cycle',
  periodOptions: BILLING_CYCLE_OPTIONS,
  groupBy: { key: 'rep_name', label: 'Rep Name' },

  async getRows(filters, user) {
    const { rows, matched } = await loadFailedChargeRows(filters, user)
    return { rows, total: rows.length, notice: buildFailedChargeNotice(matched, rows.length) }
  },

  async getDownload(filters, user, opts = {}) {
    const { rows } = await loadFailedChargeRows(filters, user)
    if (opts.group) {
      const repRows = rows.filter(r => r.rep_name === opts.group)
      return {
        buffer: await buildFailedChargesWorkbook(repRows, { sheetName: opts.group }),
        filename: timestampedFilename(`FailedChargeInvoices_${slug(opts.group)}`),
      }
    }
    if (opts.split === 'tabs') {
      return {
        buffer: await buildFailedChargesWorkbook(rows, { split: 'tabs' }),
        filename: timestampedFilename('FailedChargeInvoices_ByAgent'),
      }
    }
    return {
      buffer: await buildFailedChargesWorkbook(rows),
      filename: timestampedFilename('FailedChargeInvoices'),
    }
  },
}

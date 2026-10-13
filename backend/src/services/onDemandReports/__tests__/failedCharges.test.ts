import { describe, it, expect, vi, beforeEach } from 'vitest'
import ExcelJS from 'exceljs'

const { getFailedChargeInvoices, resolveInsightsScope, resolveTaskCrmUrls } = vi.hoisted(() => ({
  getFailedChargeInvoices: vi.fn(),
  resolveInsightsScope: vi.fn(),
  resolveTaskCrmUrls: vi.fn(),
}))

vi.mock('../../insightsCollectionsCycle.service', () => ({ getFailedChargeInvoices }))
vi.mock('../../insightsScope', () => ({ resolveInsightsScope }))
vi.mock('../../insights/missedOpportunities/crmLinkResolve', () => ({ resolveTaskCrmUrls }))

import {
  FAILED_CHARGE_COLUMNS, UNASSIGNED_REP, failedChargeFilterOptions, loadFailedChargeRows, toFailedChargeRow,
} from '../failedCharges.data'
import { buildFailedChargesWorkbook, uniqueSheetName } from '../failedCharges.xlsx'
import { failedChargesReport } from '../failedCharges.report'
import type { CycleInvoiceRow } from '../../insightsCollectionsCycle.service'

const user = { user_id: 9, role: 'Manager', role_id: 5 }
const filters = { start_date: '2026-09-01', end_date: '2026-09-30', campaign: 'All Declined', currency: 'USD' }

const invoice = (over: Partial<CycleInvoiceRow>): CycleInvoiceRow => ({
  orderId: 1, customerId: 10, orderDate: '2026-09-01', campaign: 'Declined CC (1st)', amount: 100, currency: 'USD',
  result: 'DECLINED', declineReason: 'Insufficient Funds', isRepeat: false, chargeBillingGroupId: 55,
  chargeLast4: '4242', taskId: null, taskStatus: null, taskAgent: null, taskAgentName: null, taskLinkSource: null,
  touches: 0, touchesLifetime: 0, touchesSameSecond: 0, recoveryPath: 'Still Outstanding', collected: 0,
  paidOn: null, processor: null, processorClass: null, creditMemoAmount: 0, openBalance: 100,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  resolveInsightsScope.mockResolvedValue({
    ok: true, scope: { selfEmployeeKey: null, departmentKeys: [], pageDepartmentKeys: [] },
  })
  resolveTaskCrmUrls.mockResolvedValue(new Map([[700, 'https://crm.example/TaskManager/X?TaskID=700']]))
  getFailedChargeInvoices.mockResolvedValue({
    rows: [
      invoice({ orderId: 3, taskId: 701, taskAgentName: 'Zed' }),
      invoice({ orderId: 1 }),
      invoice({ orderId: 2, taskId: 700, taskAgentName: 'Amy' }),
    ],
    total: 3,
    declineReasons: [{ reason: 'Insufficient Funds' }, { reason: 'Expired Card' }],
    campaigns: ['All Declined', 'Declined CC (1st)'],
  })
})

describe('failed charge columns', () => {
  it('puts Rep Name first and Task Link last', () => {
    expect(FAILED_CHARGE_COLUMNS[0].key).toBe('rep_name')
    expect(FAILED_CHARGE_COLUMNS[FAILED_CHARGE_COLUMNS.length - 1].key).toBe('task_link')
  })

  it('splits the values the grid stacks into separate columns', () => {
    const row = toFailedChargeRow(invoice({
      isRepeat: true, collected: 40, paidOn: '2026-09-04', processor: 'Ann', processorClass: 'AGENT',
    }), null)
    expect(row).toMatchObject({
      repeat_issue: 'Yes', run_result: 'Declined', decline_reason: 'Insufficient Funds',
      recovered: 40, paid_on: '2026-09-04', card_last4: '4242', billing_group: 55,
      processed_by: 'Ann', processor_type: 'Internal agent', rep_name: UNASSIGNED_REP, task_link: '',
    })
  })

  it('blanks the paid date when nothing was recovered', () => {
    expect(toFailedChargeRow(invoice({ collected: 0, paidOn: '2026-09-04' }), null).paid_on).toBe('')
  })
})

describe('loadFailedChargeRows', () => {
  it('reads the page service pinned to the selected cycle, reason and currency', async () => {
    await loadFailedChargeRows({ ...filters, declineReason: 'Expired Card' }, user)
    const [collections, opts] = getFailedChargeInvoices.mock.calls[0]
    expect(collections).toMatchObject({
      period: 'custom', customStart: '2026-09-01', customEnd: '2026-09-30', campaign: 'All Declined',
    })
    expect(opts).toMatchObject({ reason: 'Expired Card', currency: 'USD', limit: 5000, offset: 0 })
  })

  it('sorts reps alphabetically with Unassigned last', async () => {
    const { rows } = await loadFailedChargeRows(filters, user)
    expect(rows.map(r => r.rep_name)).toEqual(['Amy', 'Zed', UNASSIGNED_REP])
  })

  it('links each task, falling back to the default AR layout when CRM has no row', async () => {
    const { rows } = await loadFailedChargeRows(filters, user)
    expect(rows[0].task_link).toBe('https://crm.example/TaskManager/X?TaskID=700')
    expect(rows[1].task_link).toContain('TaskID=701')
    expect(rows[2].task_link).toBe('')
    expect(resolveTaskCrmUrls).toHaveBeenCalledWith([701, 700])
  })

  it('narrows to the selected reps', async () => {
    const { rows } = await loadFailedChargeRows({ ...filters, agents: ['Zed'] }, user)
    expect(rows.map(r => r.invoice_number)).toEqual([3])
  })

  it('refuses a viewer without the Failed Charge Invoices grant', async () => {
    resolveInsightsScope.mockResolvedValueOnce({ ok: false, error: 'Access denied' })
    await expect(loadFailedChargeRows(filters, user)).rejects.toThrow(/Access denied/)
    expect(resolveInsightsScope).toHaveBeenCalledWith(9, 'Manager', 'collections_failed_charges')
    expect(getFailedChargeInvoices).not.toHaveBeenCalled()
  })

  it('rejects an unsupported currency rather than showing USD', async () => {
    await expect(loadFailedChargeRows({ ...filters, currency: 'EUR' }, user)).rejects.toThrow(/currency/i)
  })
})

describe('failedChargeFilterOptions', () => {
  it('offers campaigns, every reason in the cycle, and reps with Unassigned last', async () => {
    const opts = await failedChargeFilterOptions({ ...filters, declineReason: 'Expired Card' }, user)
    expect(opts.campaigns).toEqual(['All Declined', 'Declined CC (1st)'])
    expect(opts.declineReasons).toEqual(['Insufficient Funds', 'Expired Card'])
    expect(opts.agents).toEqual(['Amy', 'Zed', UNASSIGNED_REP])
    expect(getFailedChargeInvoices.mock.calls[0][1].reason).toBeUndefined()
  })
})

describe('workbook', () => {
  it('sanitizes sheet names to Excel rules and keeps them unique', () => {
    const taken = new Set<string>()
    expect(uniqueSheetName('A/B: [C]*?', taken)).toBe('A B C')
    expect(uniqueSheetName('x'.repeat(40), taken)).toHaveLength(31)
    expect(uniqueSheetName('a b c', taken)).toBe('a b c (2)')
    expect(uniqueSheetName('', taken)).toBe('Sheet')
  })

  async function sheetsOf(buffer: Buffer) {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as unknown as ArrayBuffer)
    return wb.worksheets
  }

  it('builds one tab per rep with hyperlinked task links', async () => {
    const { rows } = await loadFailedChargeRows(filters, user)
    const sheets = await sheetsOf(await buildFailedChargesWorkbook(rows, { split: 'tabs' }))
    expect(sheets.map(s => s.name)).toEqual(['Amy', 'Zed', UNASSIGNED_REP])
    const amy = sheets[0]
    expect(amy.getRow(1).getCell(1).value).toBe('Rep Name')
    expect(amy.getRow(2).getCell(FAILED_CHARGE_COLUMNS.length).value).toMatchObject({
      hyperlink: 'https://crm.example/TaskManager/X?TaskID=700',
    })
  })

  it("downloads only the chosen rep's rows", async () => {
    const { buffer, filename } = await failedChargesReport.getDownload(filters, user, { group: 'Zed' })
    const [sheet] = await sheetsOf(buffer)
    expect(sheet.name).toBe('Zed')
    expect(sheet.rowCount).toBe(2)
    expect(filename).toContain('FailedChargeInvoices_Zed')
  })

  it('downloads the complete report on one sheet', async () => {
    const { buffer } = await failedChargesReport.getDownload(filters, user)
    const sheets = await sheetsOf(buffer)
    expect(sheets).toHaveLength(1)
    expect(sheets[0].rowCount).toBe(4)
  })
})

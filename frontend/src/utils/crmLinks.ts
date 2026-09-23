const CRM_HOST = 'https://crm.dm-us.com'

/**
 * Task types whose record lives on the CRM Jobs page rather than TaskManager
 * (Install / Messaging / Music Curation). Mirror of the CASE in
 * `backend/src/workers/sql/task_open.extract.sql`.
 */
const JOB_TASK_TYPE_IDS = new Set([14, 42, 46])

export interface CrmTaskRef {
  taskId: number
  /**
   * `tblTaskType.NewScreen` — the URL segment that selects the CRM layout. Used
   * verbatim (some values legitimately carry an `.aspx` suffix), matching the
   * warehouse extract. NOT every task is AccountsReceivableManager.
   */
  newScreen: string | null
  taskTypeId?: number | null
  /** `tblJobs.JobID` — only needed for job-typed tasks (14/42/46). */
  jobId?: number | null
}

/**
 * Deep-link URL into the CRM for a task, choosing the layout segment from its
 * task type's `NewScreen`.
 *
 * Single source of truth for the task URL on the frontend — the Quality
 * ticket/task panel and the Insights Missed Opportunities findings both link to
 * the same records. The layout segment (`.../TaskManager/<segment>`) is what the
 * CRM uses to render the right screen, so it must come from the task type, not a
 * hardcoded constant. Mirrors `task_open.extract.sql` / `insightsTouchDetail`.
 */
export function buildCrmTaskUrl(ref: CrmTaskRef): string {
  // Fallback only when the task type carried no NewScreen; the warehouse passes
  // it through verbatim, so a resolved value is used exactly as-is.
  const screen = (ref.newScreen ?? '').trim() || 'AccountsReceivableManager'
  if (ref.taskTypeId != null && JOB_TASK_TYPE_IDS.has(ref.taskTypeId) && ref.jobId) {
    return `${CRM_HOST}/Jobs/${screen}?JobID=${ref.jobId}`
  }
  return `${CRM_HOST}/TaskManager/${screen}?TaskID=${ref.taskId}`
}

/**
 * Deep-link to a CRM ticket. CustomerID/JobID are populated server-side from the
 * ticket once it loads, so passing 0 for both is the canonical entry URL.
 */
export function buildCrmTicketUrl(ticketId: number): string {
  return `${CRM_HOST}/Tickets/Edit?CustomerID=0&JobID=0&TicketID=${ticketId}`
}

/**
 * Deep-link to an invoice's Order/Detail page in CRM.
 *
 * The Order/Detail page keys on BOTH the customer account and the order, so a
 * collections invoice row can only build this link when the warehouse carried the
 * customer id. Returns null when it did not, so the caller renders the invoice number
 * as plain text rather than a link that would land on the wrong account.
 */
export function buildCrmOrderUrl(customerId: number | null, orderId: number): string | null {
  if (!customerId) return null
  return `https://crm.dm-us.com/Order/Detail?CustomerID=${customerId}&OrderID=${orderId}`
}

/**
 * CRM deep-link builders (backend).
 *
 * Mirror of `frontend/src/utils/crmLinks.ts` and the SQL CASE in
 * `workers/sql/task_open.extract.sql` / `insightsTouchDetail.service.ts`: the
 * task layout segment comes from the task type's `NewScreen`, so NOT every task
 * is `AccountsReceivableManager`. Keep the three copies in sync — they exist
 * because the rule is needed in a browser bundle, a checked-in .sql file, and
 * here in Node, which cannot share one function.
 */
const CRM_HOST = 'https://crm.dm-us.com';

/** Task types whose record lives on the Jobs page rather than TaskManager. */
const JOB_TASK_TYPE_IDS = new Set([14, 42, 46]);

export interface CrmTaskRef {
  taskId: number;
  /** `tblTaskType.NewScreen` — used verbatim (some values carry an `.aspx` suffix). */
  newScreen: string | null;
  taskTypeId?: number | null;
  /** `tblJobs.JobID` — only needed for job-typed tasks (14/42/46). */
  jobId?: number | null;
}

/** Deep-link to a CRM task, choosing the layout segment from its task type. */
export function buildCrmTaskUrl(ref: CrmTaskRef): string {
  const screen = (ref.newScreen ?? '').trim() || 'AccountsReceivableManager';
  if (ref.taskTypeId != null && JOB_TASK_TYPE_IDS.has(ref.taskTypeId) && ref.jobId) {
    return `${CRM_HOST}/Jobs/${screen}?JobID=${ref.jobId}`;
  }
  return `${CRM_HOST}/TaskManager/${screen}?TaskID=${ref.taskId}`;
}

/** Deep-link to a CRM ticket (layout is always the Edit page). */
export function buildCrmTicketUrl(ticketId: number): string {
  return `${CRM_HOST}/Tickets/Edit?CustomerID=0&JobID=0&TicketID=${ticketId}`;
}

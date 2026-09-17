/**
 * Note-thread loaders for crmLink. Split out so crmLink stays inside the
 * file-size limit once lead + Contact Manager threads are merged.
 *
 * EVERY READ IS BOUNDED AT THE CALL'S DAY. The thread is the account's history,
 * and history means what existed when the call happened — a re-grade of a day
 * three weeks ago would otherwise read notes written since and judge the rep
 * against outcomes they could not have known. The bound is the END of the call's
 * day rather than the call's timestamp on purpose: the rep's own post-call note
 * (the dated next step, the quote they logged afterwards) is the evidence the
 * follow-through rules turn on, and it is written minutes after they hang up.
 * That matches the same-day window crmActivity already uses for day scope.
 */
import { executeQuery } from '../../../utils/databaseUtils';
import { stripHtmlToPlaintext } from '../../../utils/htmlText';
import logger from '../../../config/logger';
import { AUTO_NOTE_RE, MAX_CRM_NOTE_CHARS } from './crmActivity';
import { CrmDayActivity, CrmRefKind, crmRefToken } from './types';

const MAX_THREAD_ROWS = 25;

/**
 * Last instant of a call's local calendar day, as the CRM expects to compare it
 * (`YYYY-MM-DD HH:MM:SS`). Built from local components per the project's
 * date-handling convention — `toISOString` would shift the boundary a day west
 * of Greenwich and silently cut the evening's notes.
 */
export function endOfCallDay(callStartedAt: Date): string {
  const y = callStartedAt.getFullYear();
  const m = String(callStartedAt.getMonth() + 1).padStart(2, '0');
  const d = String(callStartedAt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d} 23:59:59`;
}

export interface SalesTaskRow {
  TaskID: number;
  CustomerLeadID: number | null;
  CompletedOn: Date | string | null;
  taskType: string | null;
  accountName: string | null;
  lastActionOn: Date | string | null;
}

/**
 * Render one record's note thread (most-recent MAX_THREAD_ROWS, chronological),
 * bounded at `notAfter` so the model only reads history the call could have had.
 */
export async function loadThread(
  kind: CrmRefKind,
  id: number,
  label: string,
  notAfter: string,
): Promise<CrmDayActivity> {
  const ref = crmRefToken(kind, id);
  const base: CrmDayActivity = { notes: '', refs: [ref], scope: 'record', recordLabel: label };
  try {
    const rows = kind === 'TASK'
      ? await executeQuery<{ Note: string | null; at: Date | string | null; meta: string | null }>(
        `SELECT a.Note, COALESCE(a.CompletedOn, a.CreatedOn) AS at, ar.Title AS meta
           FROM tblAction a
           LEFT JOIN tblActionResult ar ON ar.ActionResultID = a.ActionResultID
          WHERE a.TaskID = ? AND TRIM(COALESCE(a.Note, '')) <> ''
            AND COALESCE(a.CompletedOn, a.CreatedOn) <= ?
          ORDER BY at DESC LIMIT ${MAX_THREAD_ROWS + 1}`,
        [id, notAfter], 'crm',
      )
      : await executeQuery<{ Note: string | null; at: Date | string | null; meta: string | null }>(
        `SELECT tn.Note, tn.CreatedOn AS at, tn.NoteTitle AS meta
           FROM tblTicketNote tn
          WHERE tn.TicketID = ? AND TRIM(COALESCE(tn.Note, '')) <> ''
            AND tn.CreatedOn <= ?
          ORDER BY at DESC LIMIT ${MAX_THREAD_ROWS + 1}`,
        [id, notAfter], 'crm',
      );

    const lines: string[] = [];
    let chars = 0;
    let truncated = rows.length > MAX_THREAD_ROWS;
    // Keep the newest notes before rendering chronologically: the old loop
    // filled the budget with old research and silently dropped today's outcome.
    for (const r of rows.slice(0, MAX_THREAD_ROWS)) {
      const body = stripHtmlToPlaintext(r.Note ?? '').trim();
      if (!body || AUTO_NOTE_RE.test(body)) continue;
      const at = r.at instanceof Date ? r.at : r.at ? new Date(String(r.at)) : null;
      const when = at && !Number.isNaN(at.getTime())
        ? `${endOfCallDay(at).slice(0, 10)} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
        : 'date unknown';
      const head = [ref, when, r.meta].filter(Boolean).join(' · ');
      const line = `[${head}] ${body}`;
      if (chars + line.length + 1 > MAX_CRM_NOTE_CHARS) {
        truncated = true;
        if (!lines.length) lines.push(`${line.slice(0, MAX_CRM_NOTE_CHARS - 25)} [NOTE TRUNCATED]`);
        break;
      }
      lines.push(line);
      chars += line.length + 1;
    }
    return { ...base, notes: lines.reverse().join('\n'), ...(truncated ? { truncated: true } : {}) };
  } catch (err) {
    logger.warn(`[MISSED OPPS] thread load failed for ${ref}: ${(err as Error).message}`);
    return { ...base, unavailable: true };
  }
}

/**
 * The lead-task plus any Contact Manager on the SAME lead, concatenated so the
 * model sees research already done. Two different leads on the same phone
 * stay unmerged — that is the weak-match case and mixing them invents history.
 */
export async function loadSalesThreads(
  best: SalesTaskRow,
  all: SalesTaskRow[],
  notAfter: string,
): Promise<{ cited: number; crm: CrmDayActivity }> {
  const sameLead = all.filter((t) =>
    t.TaskID === best.TaskID
    || (best.CustomerLeadID != null && t.CustomerLeadID === best.CustomerLeadID),
  );
  const ordered: SalesTaskRow[] = [];
  const seen = new Set<number>();
  for (const t of [best, ...sameLead]) {
    if (seen.has(t.TaskID)) continue;
    seen.add(t.TaskID);
    ordered.push(t);
  }
  const parts: CrmDayActivity[] = [];
  for (const t of ordered) {
    const label = `TASK ${t.TaskID} — ${[t.taskType, t.accountName].filter(Boolean).join(' / ') || 'lead task'}`;
    parts.push(await loadThread('TASK', t.TaskID, label, notAfter));
  }
  const notes = parts
    .map((p, i) => (i === 0 || !p.notes ? p.notes : `--- ${p.recordLabel} ---\n${p.notes}`))
    .filter(Boolean)
    .join('\n');
  const cited = (ordered.find((t) => /lead/i.test(t.taskType ?? '')) ?? best).TaskID;
  return {
    cited,
    crm: {
      notes,
      refs: parts.flatMap((p) => p.refs),
      scope: 'record',
      recordLabel: parts[0]?.recordLabel,
      ...(parts.some((p) => p.unavailable) ? { unavailable: true } : {}),
      ...(parts.some((p) => p.truncated) ? { truncated: true } : {}),
    },
  };
}

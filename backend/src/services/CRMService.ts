import { executeQuery } from '../utils/databaseUtils';
import logger from '../config/logger';
import { stripHtmlToPlaintext } from '../utils/htmlText';
import {
  fetchTicketCore,
  attachPrimarySiteSafe,
  attachTicketRollupsSafe,
  type TicketHeader,
} from './crmTicketHeader';

/**
 * CRM Service for read-only access to the external CRM database
 * (`dmcms_prod` on Blazer). Uses the 'crm' database pool — Q-Tip never
 * writes here. Mirrors the structural pattern of `PhoneSystemService.ts`.
 *
 * Q-Tip stores only the *reference* to a ticket/task (see the
 * `submission_ticket_tasks` table). All header / notes data is fetched
 * live from this service every time the section is rendered, so reopens,
 * status flips and follow-up notes appear automatically without any
 * cache-invalidation logic.
 *
 * User resolution: numeric CreatedBy / AssignedTo* IDs in tblAction /
 * tblTask / tblTicket / tblTicketNote refer to `tblSalesPeople.UserID`
 * (NOT `SalesPersonID`). One UserID can map to several SalesPeople
 * "display profiles"; the canonical one is the row with
 * `isDisplayInCRM = 1`. We match the CRM UI's behaviour by joining on
 * `sp.UserID = <id> AND sp.isDisplayInCRM = 1` — for example UserID 12
 * has both `SalesPersonID 0 = "System"` (displayed) and
 * `SalesPersonID 2 = "Recurring Service"` (hidden) and therefore
 * resolves to "System" rather than the legacy `Morris Wilson` row at
 * `SalesPersonID = 12` (which is keyed off the wrong column).
 * Unresolved IDs fall through and the UI renders "User #<id>".
 *
 * Note parsing caveat:
 *   - Status-after / next-contact-date are encoded inside the note text
 *     of `tblAction` rows, not in dedicated columns. We pull them out
 *     with regex; on parse failure we leave the field null and still
 *     render the raw note so nothing is lost.
 */

export type TicketTaskKind = 'TICKET' | 'TASK';

export interface TaskHeader {
  task_id: number;
  task_type: string | null;
  /** tblTaskType.TaskTypeID — selects the Jobs-vs-TaskManager URL base. */
  task_type_id: number | null;
  /** tblTaskType.NewScreen — the layout segment used to build the CRM deep link. */
  new_screen: string | null;
  /** tblJobs.JobID — only present/needed for job-typed tasks (14/42/46). */
  job_id: number | null;
  task_status: string | null;
  assigned_to_id: number | null;
  /** Best-effort display name; null if no resolution available. */
  assigned_to_name: string | null;
  customer_id: number | null;
  created_on: Date | null;
  due_on: Date | null;
  completed_on: Date | null;
}

export type { TicketHeader } from './crmTicketHeader';

export interface CRMNote {
  id: number;
  /** ISO string; serializable across HTTP. */
  created_on: string | null;
  /** Numeric CRM user ID. */
  created_by: number | null;
  /** Best-effort name. Parsed from note text for tasks; null for tickets. */
  created_by_name: string | null;
  note: string;
  /** For task notes only — destination status name parsed from note text. */
  status_after: string | null;
  /** For task notes only — next-contact date if expressed as `Mon 4/13` etc. */
  next_contact_date: string | null;
  /** True if this note's CreatedOn is strictly after the audit's submitted_at. */
  is_after_audit: boolean;
}

class CRMService {
  /**
   * Fetch the header card for a CRM Task. Returns null when the task ID
   * doesn't exist on the CRM. Throws on database errors.
   */
  async getTaskHeader(taskId: number): Promise<TaskHeader | null> {
    try {
      const rows = await executeQuery<{
        TaskID: number;
        TaskTypeID: number | null;
        NewScreen: string | null;
        JobID: number | null;
        TaskType: string | null;
        TaskStatus: string | null;
        AssignedTo: number | null;
        AssignedToName: string | null;
        CustomerID: number | null;
        CreatedOn: Date | null;
        DueOn: Date | null;
        CompletedOn: Date | null;
      }>(
        `
          SELECT
            t.TaskID,
            t.TaskTypeID,
            tt.NewScreen   AS NewScreen,
            (SELECT jj.JobID FROM tblJobs jj WHERE jj.TaskID = t.TaskID LIMIT 1) AS JobID,
            tt.Title       AS TaskType,
            ts.Title       AS TaskStatus,
            t.AssignedTo,
            sp.SalesPersonName AS AssignedToName,
            t.CustomerID,
            t.CreatedOn,
            t.DueOn,
            t.CompletedOn
          FROM tblTask t
          LEFT JOIN tblTaskType     tt ON tt.TaskTypeID   = t.TaskTypeID
          LEFT JOIN tblTaskStatus   ts ON ts.TaskStatusID = t.TaskStatusID
          LEFT JOIN tblSalesPeople  sp ON sp.UserID = t.AssignedTo AND sp.isDisplayInCRM = 1
          WHERE t.TaskID = ?
          LIMIT 1
        `,
        [taskId],
        'crm'
      );

      if (rows.length === 0) return null;

      const r = rows[0];
      return {
        task_id: r.TaskID,
        task_type: r.TaskType,
        task_type_id: r.TaskTypeID == null ? null : Number(r.TaskTypeID),
        new_screen: r.NewScreen,
        job_id: r.JobID == null ? null : Number(r.JobID),
        task_status: r.TaskStatus,
        assigned_to_id: r.AssignedTo,
        assigned_to_name: r.AssignedToName,
        customer_id: r.CustomerID,
        created_on: this.normalizeDate(r.CreatedOn),
        due_on: this.normalizeDate(r.DueOn),
        completed_on: this.normalizeDate(r.CompletedOn),
      };
    } catch (error) {
      logger.error(`[CRM SERVICE] Failed to fetch task header for ${taskId}`, { error: (error as Error).message });
      throw new Error(`Failed to retrieve task ${taskId}`);
    }
  }

  /**
   * Fetch all action/notes for a Task ordered by CreatedOn ascending.
   * Sets `is_after_audit` based on `auditSubmittedAt` (when provided).
   * Empty-note rows (system follow-up scheduler entries) are dropped to
   * avoid cluttering the timeline with rows the user has nothing to read.
   */
  async getTaskNotes(taskId: number, auditSubmittedAt?: Date | null): Promise<CRMNote[]> {
    try {
      // A `tblAction` row is CREATED when the follow-up is scheduled and
      // COMPLETED when the agent actually works it and writes the note — on
      // these self-chained tasks a row's CreatedOn equals the prior row's
      // CompletedOn. The CRM UI dates and attributes each note by its
      // completion, so we mirror that: use CompletedOn / CompletedBy, falling
      // back to CreatedOn / CreatedBy only for a row with no completion stamp
      // (the CRM's "0001-01-01" sentinel / a 0 actor). Ordering the same way
      // keeps the newest-worked note on top and the before/after-audit split
      // honest.
      const EFFECTIVE_ON = `CASE WHEN a.CompletedOn > '1970-01-01' THEN a.CompletedOn ELSE a.CreatedOn END`;
      const EFFECTIVE_BY = `COALESCE(NULLIF(a.CompletedBy, 0), a.CreatedBy)`;
      const rows = await executeQuery<{
        ActionID: number;
        Note: string | null;
        EffectiveOn: Date | null;
        EffectiveBy: number | null;
        CreatedByName: string | null;
        StatusAfter: string | null;
      }>(
        `
          SELECT
            a.ActionID,
            a.Note,
            ${EFFECTIVE_ON} AS EffectiveOn,
            ${EFFECTIVE_BY} AS EffectiveBy,
            sp.SalesPersonName AS CreatedByName,
            ts.Title AS StatusAfter
          FROM tblAction a
          LEFT JOIN tblTaskStatus  ts ON ts.TaskStatusID  = a.TaskStatusID
          LEFT JOIN tblSalesPeople sp ON sp.UserID = ${EFFECTIVE_BY} AND sp.isDisplayInCRM = 1
          WHERE a.TaskID = ?
          ORDER BY EffectiveOn DESC, a.ActionID DESC
        `,
        [taskId],
        'crm'
      );

      const auditMs = auditSubmittedAt ? new Date(auditSubmittedAt).getTime() : null;

      return rows
        .filter((r) => (r.Note ?? '').trim().length > 0)
        .map((r) => {
          const noteText = r.Note ?? '';
          // Parse against the RAW text first — the system-generated
          // `Task Status Changed from [X] to [Y] by [Name]` strings rely
          // on bracket positions that HTML-strip wouldn't touch but we
          // don't want to take the chance. The cleaned body is what we
          // surface to the AI / UI.
          const parsed = this.parseTaskNoteText(noteText);
          const effectiveDate = this.normalizeDate(r.EffectiveOn);
          const createdMs = effectiveDate ? effectiveDate.getTime() : null;
          return {
            id: r.ActionID,
            created_on: effectiveDate?.toISOString() ?? null,
            created_by: r.EffectiveBy,
            // Prefer the joined SalesPeople name; only fall back to the
            // bracketed `[Display Name]` parsed out of the note text when
            // the user isn't in tblSalesPeople (deleted / system author).
            created_by_name: r.CreatedByName ?? parsed.createdByName,
            note: stripHtmlToPlaintext(noteText),
            status_after: r.StatusAfter ?? parsed.statusAfter,
            next_contact_date: parsed.nextContactDate,
            is_after_audit: auditMs != null && createdMs != null && createdMs > auditMs,
          };
        });
    } catch (error) {
      logger.error(`[CRM SERVICE] Failed to fetch task notes for ${taskId}`, { error: (error as Error).message });
      throw new Error(`Failed to retrieve task notes for ${taskId}`);
    }
  }

  /**
   * Fetch the header card for a CRM Ticket. Core header + cheap primary
   * site are isolated from the AI-only site/device GROUP_CONCAT rollups
   * (`includeRollups`) so a fat or sentinel-dated ticket still loads on
   * the audit form. Returns null when not found.
   */
  async getTicketHeader(
    ticketId: number,
    opts?: { includeRollups?: boolean },
  ): Promise<TicketHeader | null> {
    try {
      const core = await fetchTicketCore(ticketId);
      if (!core) return null;
      const withSite = await attachPrimarySiteSafe(core);
      if (!opts?.includeRollups) return withSite;
      return await attachTicketRollupsSafe(withSite);
    } catch (error) {
      logger.error(`[CRM SERVICE] Failed to fetch ticket header for ${ticketId}`, { error: (error as Error).message });
      throw new Error(`Failed to retrieve ticket ${ticketId}`);
    }
  }

  /**
   * Fetch all notes for a Ticket ordered by CreatedOn ascending. Sets
   * `is_after_audit` based on `auditSubmittedAt` (when provided). Ticket
   * notes have a structured `NoteTitle` and `Note` body — no status-after /
   * next-contact-date parsing needed here.
   */
  async getTicketNotes(ticketId: number, auditSubmittedAt?: Date | null): Promise<CRMNote[]> {
    try {
      const rows = await executeQuery<{
        TicketNoteID: number;
        Note: string | null;
        NoteTitle: string | null;
        CreatedOn: Date | null;
        CreatedBy: number | null;
        CreatedByName: string | null;
      }>(
        `
          SELECT
            tn.TicketNoteID,
            tn.Note,
            tn.NoteTitle,
            tn.CreatedOn,
            tn.CreatedBy,
            sp.SalesPersonName AS CreatedByName
          FROM tblTicketNote tn
          LEFT JOIN tblSalesPeople sp ON sp.UserID = tn.CreatedBy AND sp.isDisplayInCRM = 1
          WHERE tn.TicketID = ?
          ORDER BY tn.CreatedOn DESC, tn.TicketNoteID DESC
        `,
        [ticketId],
        'crm'
      );

      const auditMs = auditSubmittedAt ? new Date(auditSubmittedAt).getTime() : null;

      return rows.map((r) => {
        // Some CRM rows have an empty-string NoteTitle (not NULL) with the
        // real text in Note; the prior `title && body` check treated "" as
        // falsy and dropped the body. Trim both sides and join with a blank
        // line whenever both are present, otherwise return whichever has
        // content.
        // Same HTML-entity / tag normalization as the ticket Description:
        // ticket notes commonly carry pasted-email bodies (`<strong>FROM:</strong>`,
        // `&quot;`, `&#39;`, etc.), and we want the AI reviewer + the timeline
        // UI to see plain text rather than markup.
        const title = stripHtmlToPlaintext((r.NoteTitle ?? '').trim());
        const text  = stripHtmlToPlaintext((r.Note ?? '').trim());
        const body  = title && text ? `${title}\n\n${text}` : title || text;
        const createdMs = r.CreatedOn ? new Date(r.CreatedOn).getTime() : null;
        return {
          id: r.TicketNoteID,
          created_on: this.normalizeDate(r.CreatedOn)?.toISOString() ?? null,
          created_by: r.CreatedBy,
          created_by_name: r.CreatedByName,
          note: body,
          status_after: null,
          next_contact_date: null,
          is_after_audit: auditMs != null && createdMs != null && createdMs > auditMs,
        };
      });
    } catch (error) {
      logger.error(`[CRM SERVICE] Failed to fetch ticket notes for ${ticketId}`, { error: (error as Error).message });
      throw new Error(`Failed to retrieve ticket notes for ${ticketId}`);
    }
  }

  /**
   * Returns the active playbook links assigned to a ticket via its
   * sub-classification (tblTicket.ClassificationID -> tblTicketClassificationPlayBook
   * -> tblPlayBook -> tblPlayBookLink). Each link is typically a URL into the
   * BookStack KB pointing at the documented troubleshooting/process page the
   * agent is supposed to follow on this kind of ticket. Empty array if the
   * ticket has no classification or its classification has no active playbook.
   */
  async getTicketPlaybookLinks(ticketId: number): Promise<{
    playbook_id: number;
    playbook_title: string | null;
    link_title: string | null;
    link_url: string;
  }[]> {
    try {
      const rows = await executeQuery<{
        PlayBookID: number;
        Title: string | null;
        LinkTitle: string | null;
        LinkURL: string | null;
      }>(
        `
          SELECT
            pb.PlayBookID,
            pb.Title,
            pbl.LinkTitle,
            pbl.LinkURL
          FROM tblTicket t
          JOIN tblTicketClassificationPlayBook tcpb
            ON tcpb.ClassificationID = t.ClassificationID AND tcpb.Active = 1
          JOIN tblPlayBook pb
            ON pb.PlayBookID = tcpb.PlayBookID AND pb.Active = 1
          JOIN tblPlayBookLink pbl
            ON pbl.PlayBookID = pb.PlayBookID AND pbl.Active = 1
          WHERE t.TicketID = ?
            AND pbl.LinkURL IS NOT NULL AND pbl.LinkURL <> ''
        `,
        [ticketId],
        'crm'
      );
      return rows.map((r) => ({
        playbook_id: r.PlayBookID,
        playbook_title: (r.Title ?? '').trim().replace(/^"|"$/g, '') || null,
        link_title: r.LinkTitle ?? null,
        link_url: String(r.LinkURL ?? '').trim(),
      }));
    } catch (error) {
      logger.warn(
        `[CRM SERVICE] Failed to fetch playbook links for ticket ${ticketId}: ${(error as Error).message}`
      );
      return [];
    }
  }

  /**
   * Best-effort parse of a `tblAction.Note` body to surface the structured
   * fields the UI wants (status name, author name, next-contact date).
   *
   * The CRM's own UI writes notes with a deterministic preamble:
   *   "Task Status Changed from [Old] to [New] by [Display Name]\r\n..."
   *   "...Next step is to follow up Mon 4/13 to confirm..."
   *
   * Parsing is forgiving — any field that doesn't match is left null and
   * the raw note still gets shown verbatim above it.
   */
  private parseTaskNoteText(text: string): {
    statusAfter: string | null;
    createdByName: string | null;
    nextContactDate: string | null;
  } {
    const statusMatch = text.match(/Task Status Changed from \[[^\]]+\] to \[([^\]]+)\] by \[([^\]]+)\]/);
    const nextStepMatch = text.match(/Next step (?:is to )?(?:follow up|touch on)?\s*([A-Za-z]{3,9}\.?\s*\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i);

    return {
      statusAfter: statusMatch ? statusMatch[1].trim() : null,
      createdByName: statusMatch ? statusMatch[2].trim() : null,
      nextContactDate: nextStepMatch ? nextStepMatch[1].trim() : null,
    };
  }

  /**
   * Coerce mysql2 Date values into native Date objects. Returns null for
   * the CRM's "0001-01-01 05:00:00" sentinel rows so the UI doesn't
   * render a meaningless date for completed_on / next_contact fields.
   */
  private normalizeDate(value: Date | string | null | undefined): Date | null {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return null;
    if (d.getUTCFullYear() < 1970) return null;
    return d;
  }
}

export const crmService = new CRMService();
export default crmService;

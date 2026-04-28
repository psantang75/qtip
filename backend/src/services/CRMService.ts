import { executeQuery } from '../utils/databaseUtils';
import logger from '../config/logger';

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
 * User resolution: numeric CreatedBy / AssignedTo* IDs join to
 * `tblSalesPeople.SalesPersonID` to surface the human name
 * (`SalesPersonName`). When a row's user is missing from that table the
 * UI falls back to "User #<id>" rather than failing.
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
  task_status: string | null;
  assigned_to_id: number | null;
  /** Best-effort display name; null if no resolution available. */
  assigned_to_name: string | null;
  customer_id: number | null;
  created_on: Date | null;
  due_on: Date | null;
  completed_on: Date | null;
}

export interface TicketHeader {
  ticket_id: number;
  /** Top-level classification (e.g. "Tech Support"). */
  class_name: string | null;
  /** Leaf classification (e.g. "Music Content Questions - SXM Internet"). */
  subclass_name: string | null;
  classification_id: number | null;
  /** Current status — derived from the latest tblTicketStatusHistory row. */
  status: string | null;
  /** Resolution text (separate concept from status; populated when set). */
  resolution: string | null;
  assigned_to_id: number | null;
  assigned_to_name: string | null;
  customer_id: number | null;
  created_on: Date | null;
  modified_on: Date | null;
  description: string | null;
}

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
          LEFT JOIN tblSalesPeople  sp ON sp.SalesPersonID = t.AssignedTo
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
      const rows = await executeQuery<{
        ActionID: number;
        Note: string | null;
        CreatedOn: Date | null;
        CreatedBy: number | null;
        CreatedByName: string | null;
        StatusAfter: string | null;
      }>(
        `
          SELECT
            a.ActionID,
            a.Note,
            a.CreatedOn,
            a.CreatedBy,
            sp.SalesPersonName AS CreatedByName,
            ts.Title AS StatusAfter
          FROM tblAction a
          LEFT JOIN tblTaskStatus  ts ON ts.TaskStatusID  = a.TaskStatusID
          LEFT JOIN tblSalesPeople sp ON sp.SalesPersonID = a.CreatedBy
          WHERE a.TaskID = ?
          ORDER BY a.CreatedOn ASC, a.ActionID ASC
        `,
        [taskId],
        'crm'
      );

      const auditMs = auditSubmittedAt ? new Date(auditSubmittedAt).getTime() : null;

      return rows
        .filter((r) => (r.Note ?? '').trim().length > 0)
        .map((r) => {
          const noteText = r.Note ?? '';
          const parsed = this.parseTaskNoteText(noteText);
          const createdMs = r.CreatedOn ? new Date(r.CreatedOn).getTime() : null;
          return {
            id: r.ActionID,
            created_on: this.normalizeDate(r.CreatedOn)?.toISOString() ?? null,
            created_by: r.CreatedBy,
            // Prefer the joined SalesPeople name; only fall back to the
            // bracketed `[Display Name]` parsed out of the note text when
            // the user isn't in tblSalesPeople (deleted / system author).
            created_by_name: r.CreatedByName ?? parsed.createdByName,
            note: noteText,
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
   * Fetch the header card for a CRM Ticket. Joins `tblTicketClassification`
   * recursively (one parent step) to surface "Class / Subclass" as a flat
   * path string. Returns null when not found.
   */
  async getTicketHeader(ticketId: number): Promise<TicketHeader | null> {
    try {
      // Current ticket status lives in tblTicketStatusHistory (the ticket
      // table itself has no status column). Latest row by CreatedOn DESC,
      // tie-broken by TicketStatusHistoryID. ResolutionID is a separate
      // concept and is surfaced as `resolution`.
      const rows = await executeQuery<{
        TicketID: number;
        ClassificationID: number | null;
        ClassificationName: string | null;
        ParentName: string | null;
        Status: string | null;
        Resolution: string | null;
        AssignedToUserID: number | null;
        AssignedToName: string | null;
        CustomerID: number | null;
        CreatedOn: Date | null;
        ModifiedOn: Date | null;
        Description: string | null;
      }>(
        `
          SELECT
            t.TicketID,
            t.ClassificationID,
            tc.ClassificationName,
            parent.ClassificationName AS ParentName,
            (
              SELECT s.StatusText
                FROM tblTicketStatusHistory h
                JOIN tblTicketStatus s ON s.StatusID = h.StatusID
               WHERE h.TicketID = t.TicketID
            ORDER BY h.CreatedOn DESC, h.TicketStatusHistoryID DESC
               LIMIT 1
            ) AS Status,
            tr.ResolutionText AS Resolution,
            t.AssignedToUserID,
            sp.SalesPersonName AS AssignedToName,
            t.CustomerID,
            t.CreatedOn,
            t.ModifiedOn,
            t.Description
          FROM tblTicket t
          LEFT JOIN tblTicketClassification tc     ON tc.ClassificationID = t.ClassificationID
          LEFT JOIN tblTicketClassification parent ON parent.ClassificationID = tc.ParentID
          LEFT JOIN tblTicketResolution     tr     ON tr.ResolutionID     = t.ResolutionID
          LEFT JOIN tblSalesPeople          sp     ON sp.SalesPersonID    = t.AssignedToUserID
          WHERE t.TicketID = ?
          LIMIT 1
        `,
        [ticketId],
        'crm'
      );

      if (rows.length === 0) return null;

      const r = rows[0];

      // When a leaf has a parent, parent = class and leaf = subclass.
      // When the row IS a top-level entry, treat it as the class with no
      // subclass rather than collapsing one field into the other.
      const className    = r.ParentName ?? r.ClassificationName ?? null;
      const subclassName = r.ParentName ? r.ClassificationName : null;

      return {
        ticket_id: r.TicketID,
        class_name: className,
        subclass_name: subclassName,
        classification_id: r.ClassificationID,
        status: r.Status,
        resolution: r.Resolution,
        assigned_to_id: r.AssignedToUserID,
        assigned_to_name: r.AssignedToName,
        customer_id: r.CustomerID,
        created_on: this.normalizeDate(r.CreatedOn),
        modified_on: this.normalizeDate(r.ModifiedOn),
        description: r.Description,
      };
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
          LEFT JOIN tblSalesPeople sp ON sp.SalesPersonID = tn.CreatedBy
          WHERE tn.TicketID = ?
          ORDER BY tn.CreatedOn ASC, tn.TicketNoteID ASC
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
        const title = (r.NoteTitle ?? '').trim();
        const text  = (r.Note ?? '').trim();
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

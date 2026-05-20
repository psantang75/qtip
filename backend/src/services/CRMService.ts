import { executeQuery } from '../utils/databaseUtils';
import logger from '../config/logger';
import { stripHtmlToPlaintext } from '../utils/htmlText';

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

  // Joined detail fields used by the AI Reviewer's ticket-detail rubrics
  // (8.9 Site, 8.10 Contact, 8.13 administrative fields, 8.18 Device Type,
  // 8.19 Device ID, 8.23 Order, 8.26 Job). All nullable — a LEFT JOIN
  // miss or an unset FK simply leaves the field blank in the prompt.
  site_id: number | null;
  site_name: string | null;
  /**
   * Single-line street address built from `tblSites.ShipAddress1` plus
   * `ShipAddress2` (joined with `, ` when both present). Null when both
   * address columns are blank or the site row itself is missing.
   */
  site_address: string | null;
  site_city: string | null;
  site_state: string | null;
  contact_id: number | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  contact_email: string | null;
  job_id: number | null;
  job_partner_number: string | null;
  order_id: number | null;
  order_number: string | null;
  po_number: string | null;
  /** Dropdown id from `tblTicket.DeviceTypeID` — 0 means "unset". */
  device_type_id: number | null;
  /** Human-readable dropdown name from `tblTicketDeviceType.DeviceTypeName` (e.g. "PlayerOne"). */
  device_type_name: string | null;
  /**
   * Device ID(s) / username(s) — the actual serial number (hardware) or
   * username (internet device). Prefers `tblTicket.RadioIDNum` when set,
   * otherwise comma-joins every Active row in `tblTicketRadio` so multi-
   * device tickets surface every unit (the direct column is left blank on
   * modern tickets — the per-device data lives in the assoc table).
   */
  device_id: string | null;
  /**
   * Every Active site row on `tblTicketSite` rendered as a single,
   * semicolon-separated string — `<Name> - <Address1>, <City> <State> <Zip> [SiteID N]`.
   * Multi-site tickets (e.g. one ticket spanning three Tim Hortons
   * locations) need this so the AI can match the customer's spoken
   * location to any one of the linked sites instead of guessing from
   * the single "primary" row. Null when no Active site rows exist
   * AND `tblTicket.SiteID` itself is unset.
   */
  sites_all: string | null;
  /**
   * Devices grouped to their site — `<RadioIDNum> @ <SiteName> (<Address1>)`,
   * comma-separated. Lets the AI tie a device serial back to a specific
   * location on multi-device tickets. Falls back to bare RadioIDNum
   * when the per-radio SiteID can't be resolved. Null when no devices.
   */
  devices_all_with_site: string | null;
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
          LEFT JOIN tblSalesPeople sp ON sp.UserID = a.CreatedBy AND sp.isDisplayInCRM = 1
          WHERE a.TaskID = ?
          ORDER BY a.CreatedOn DESC, a.ActionID DESC
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
          const createdMs = r.CreatedOn ? new Date(r.CreatedOn).getTime() : null;
          return {
            id: r.ActionID,
            created_on: this.normalizeDate(r.CreatedOn)?.toISOString() ?? null,
            created_by: r.CreatedBy,
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
        EffectiveSiteID: number | null;
        SiteName: string | null;
        SiteAddress1: string | null;
        SiteAddress2: string | null;
        SiteCity: string | null;
        SiteState: string | null;
        SiteZip: string | null;
        ContactID: number | null;
        ContactFirstName: string | null;
        ContactLastName: string | null;
        ContactEmail: string | null;
        JobID: number | null;
        JobPartnerNumber: string | null;
        OrderID: number | null;
        OrderNumber: string | null;
        PONumber: string | null;
        DeviceTypeID: number | null;
        DeviceTypeName: string | null;
        EffectiveDeviceIDNum: string | null;
        SitesAll: string | null;
        DevicesAllWithSite: string | null;
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
            t.Description,
            -- Site is sometimes stored directly on tblTicket.SiteID, but on
            -- modern tickets the actual selection lives in tblTicketSite as
            -- an Active association row (the direct column is left as 0).
            -- Prefer the direct column when it's non-zero so we stay back-
            -- compat with legacy rows, otherwise fall back to the most-
            -- recent Active assoc row.
            COALESCE(NULLIF(t.SiteID, 0), (
              SELECT ts.SiteID
                FROM tblTicketSite ts
               WHERE ts.TicketID = t.TicketID AND ts.Active = 1 AND ts.SiteID <> 0
            ORDER BY ts.CreatedOn DESC, ts.TicketSiteID DESC
               LIMIT 1
            )) AS EffectiveSiteID,
            s.Name         AS SiteName,
            s.ShipAddress1 AS SiteAddress1,
            s.ShipAddress2 AS SiteAddress2,
            s.ShipCity     AS SiteCity,
            s.ShipState    AS SiteState,
            s.ShipZip      AS SiteZip,
            t.ContactID,
            c.FirstName AS ContactFirstName,
            c.LastName  AS ContactLastName,
            c.EMail     AS ContactEmail,
            t.JobID,
            j.PartnerJobNumber AS JobPartnerNumber,
            t.OrderID,
            o.OrderNumber,
            o.PONumber,
            t.DeviceTypeID,
            dt.DeviceTypeName,
            -- Same pattern as Site: tblTicket.RadioIDNum is usually blank on
            -- modern tickets; the actual device ID(s) live as Active rows in
            -- tblTicketRadio. GROUP_CONCAT surfaces every Active device when
            -- a single ticket legitimately covers multiple units (install
            -- tickets often do).
            COALESCE(NULLIF(TRIM(t.RadioIDNum), ''), (
              SELECT GROUP_CONCAT(tr2.RadioIDNum ORDER BY tr2.CreatedOn DESC SEPARATOR ', ')
                FROM tblTicketRadio tr2
               WHERE tr2.TicketID = t.TicketID AND tr2.Active = 1
                 AND tr2.RadioIDNum IS NOT NULL AND TRIM(tr2.RadioIDNum) <> ''
            )) AS EffectiveDeviceIDNum,
            -- Multi-site rollup: every Active site joined to its tblSites row,
            -- rendered as one human-readable line per site so the AI prompt
            -- can see ALL linked locations (not just the LIMIT 1 winner).
            -- Multi-site tickets are common when one ticket spans every
            -- store on an account; q99340 (Site captured) must accept any
            -- one of the linked sites as a match for the customer's stated
            -- location.
            (
              SELECT GROUP_CONCAT(
                CONCAT(
                  COALESCE(sAll.Name, '(unknown)'),
                  ' - ',
                  COALESCE(NULLIF(TRIM(sAll.ShipAddress1), ''), '(no address)'),
                  CASE WHEN sAll.ShipCity IS NOT NULL AND TRIM(sAll.ShipCity) <> ''
                       THEN CONCAT(', ', sAll.ShipCity) ELSE '' END,
                  CASE WHEN sAll.ShipState IS NOT NULL AND TRIM(sAll.ShipState) <> ''
                       THEN CONCAT(' ', sAll.ShipState) ELSE '' END,
                  CASE WHEN sAll.ShipZip IS NOT NULL AND TRIM(sAll.ShipZip) <> ''
                       THEN CONCAT(' ', sAll.ShipZip) ELSE '' END,
                  ' [SiteID ', sAll.SiteID, ']'
                )
                ORDER BY tsAll.CreatedOn ASC, tsAll.TicketSiteID ASC
                SEPARATOR '; '
              )
                FROM tblTicketSite tsAll
                LEFT JOIN tblSites sAll ON sAll.SiteID = tsAll.SiteID
               WHERE tsAll.TicketID = t.TicketID
                 AND tsAll.Active = 1
                 AND tsAll.SiteID <> 0
            ) AS SitesAll,
            -- Per-device-with-site rollup: pairs each Active RadioIDNum
            -- with its own SiteID so the AI can match a serial back to
            -- a specific location. Falls back to bare RadioIDNum when
            -- the per-radio site can't be resolved.
            (
              SELECT GROUP_CONCAT(
                CASE
                  WHEN sDev.Name IS NOT NULL OR sDev.ShipAddress1 IS NOT NULL THEN
                    CONCAT(
                      trDev.RadioIDNum, ' @ ',
                      COALESCE(sDev.Name, '(unknown)'),
                      CASE WHEN sDev.ShipAddress1 IS NOT NULL AND TRIM(sDev.ShipAddress1) <> ''
                           THEN CONCAT(' (', sDev.ShipAddress1, ')') ELSE '' END
                    )
                  ELSE trDev.RadioIDNum
                END
                ORDER BY trDev.CreatedOn ASC, trDev.TicketRadioID ASC
                SEPARATOR ', '
              )
                FROM tblTicketRadio trDev
                LEFT JOIN tblSites sDev ON sDev.SiteID = trDev.SiteID
               WHERE trDev.TicketID = t.TicketID
                 AND trDev.Active = 1
                 AND trDev.RadioIDNum IS NOT NULL
                 AND TRIM(trDev.RadioIDNum) <> ''
            ) AS DevicesAllWithSite
          FROM tblTicket t
          LEFT JOIN tblTicketClassification tc     ON tc.ClassificationID = t.ClassificationID
          LEFT JOIN tblTicketClassification parent ON parent.ClassificationID = tc.ParentID
          LEFT JOIN tblTicketResolution     tr     ON tr.ResolutionID     = t.ResolutionID
          LEFT JOIN tblSalesPeople          sp     ON sp.UserID = t.AssignedToUserID AND sp.isDisplayInCRM = 1
          LEFT JOIN tblSites                s      ON s.SiteID = COALESCE(NULLIF(t.SiteID, 0), (
              SELECT ts.SiteID
                FROM tblTicketSite ts
               WHERE ts.TicketID = t.TicketID AND ts.Active = 1 AND ts.SiteID <> 0
            ORDER BY ts.CreatedOn DESC, ts.TicketSiteID DESC
               LIMIT 1
          ))
          LEFT JOIN tblContacts             c      ON c.ContactID = t.ContactID
          LEFT JOIN tblJobs                 j      ON j.JobID = t.JobID
          LEFT JOIN tblOrders               o      ON o.OrderID = t.OrderID
          LEFT JOIN tblTicketDeviceType     dt     ON dt.DeviceTypeID = t.DeviceTypeID
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

      // CRM stores `0` as the "unset" sentinel for FK columns rather than
      // NULL. Normalize 0 → null so downstream consumers can treat
      // "no site / no contact / no job / no order / no device type" as
      // absent without special-casing each field.
      const nullIfZero = (v: number | null): number | null => (v == null || v === 0 ? null : v);
      const blankToNull = (v: string | null): string | null => {
        if (v == null) return null;
        const trimmed = v.trim();
        return trimmed.length === 0 ? null : trimmed;
      };

      const siteId = nullIfZero(r.EffectiveSiteID);
      const contactId = nullIfZero(r.ContactID);
      const jobId = nullIfZero(r.JobID);
      const orderId = nullIfZero(r.OrderID);
      const deviceTypeId = nullIfZero(r.DeviceTypeID);

      // Combine ShipAddress1 + ShipAddress2 into a single street-address
      // line so the AI prompt renders one clean entry rather than two
      // separate fields. Both columns are nullable and frequently blank.
      const addr1 = siteId != null ? blankToNull(r.SiteAddress1) : null;
      const addr2 = siteId != null ? blankToNull(r.SiteAddress2) : null;
      const siteAddress = [addr1, addr2].filter((s): s is string => !!s).join(', ') || null;

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
        // Decode HTML entities (`&quot;`, `&amp;`, etc.) and strip any stray
        // tags so the AI prompt — and the human-facing ticket panel — read
        // clean text like `Contact is having error "please log in"` instead
        // of `Contact is having error &quot;please log in&quot;`. CRM stores
        // descriptions in whatever encoding the entry path used (web form,
        // email-to-ticket, manual paste), so this is the single point of
        // normalization.
        description: r.Description ? stripHtmlToPlaintext(r.Description) : null,

        site_id: siteId,
        site_name: siteId != null ? blankToNull(r.SiteName) : null,
        site_address: siteAddress,
        site_city: siteId != null ? blankToNull(r.SiteCity) : null,
        site_state: siteId != null ? blankToNull(r.SiteState) : null,
        contact_id: contactId,
        contact_first_name: contactId != null ? blankToNull(r.ContactFirstName) : null,
        contact_last_name: contactId != null ? blankToNull(r.ContactLastName) : null,
        contact_email: contactId != null ? blankToNull(r.ContactEmail) : null,
        job_id: jobId,
        job_partner_number: jobId != null ? blankToNull(r.JobPartnerNumber) : null,
        order_id: orderId,
        order_number: orderId != null ? blankToNull(r.OrderNumber) : null,
        po_number: orderId != null ? blankToNull(r.PONumber) : null,
        device_type_id: deviceTypeId,
        device_type_name: deviceTypeId != null ? blankToNull(r.DeviceTypeName) : null,
        device_id: blankToNull(r.EffectiveDeviceIDNum),
        sites_all: blankToNull(r.SitesAll),
        devices_all_with_site: blankToNull(r.DevicesAllWithSite),
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

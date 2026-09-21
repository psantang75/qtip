/**
 * Isolated CRM ticket-header reads.
 *
 * The audit-form Add button used to run the AI-reviewer rollup query
 * (every Active site + every Active device via GROUP_CONCAT). That query
 * throws or times out on a handful of real tickets (old sentinel dates,
 * chain-wide site lists). Those failures were shown as "can't reach the CRM"
 * even though the ticket row was sitting in tblTicket.
 *
 * Split:
 *   1. `fetchTicketCore` — cheap header + 1:1 joins. Dates CAST to CHAR so
 *      mysql2 never parses CRM `0000-00-00` sentinels.
 *   2. `attachPrimarySite` — one fallback SiteID + one tblSites row.
 *   3. `attachTicketRollups` — GROUP_CONCAT extras for the AI prompt only.
 *      Failures here must never take down (1) or (2).
 */
import { executeQuery } from '../utils/databaseUtils';
import logger from '../config/logger';
import { stripHtmlToPlaintext } from '../utils/htmlText';

export interface TicketHeader {
  ticket_id: number;
  class_name: string | null;
  subclass_name: string | null;
  classification_id: number | null;
  status: string | null;
  resolution: string | null;
  assigned_to_id: number | null;
  assigned_to_name: string | null;
  customer_id: number | null;
  created_on: Date | null;
  modified_on: Date | null;
  description: string | null;
  site_id: number | null;
  site_name: string | null;
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
  device_type_id: number | null;
  device_type_name: string | null;
  device_id: string | null;
  sites_all: string | null;
  devices_all_with_site: string | null;
}

const CORE_SQL = `
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
    CAST(t.CreatedOn AS CHAR) AS CreatedOn,
    CAST(t.ModifiedOn AS CHAR) AS ModifiedOn,
    t.Description,
    t.SiteID,
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
    t.RadioIDNum
  FROM tblTicket t
  LEFT JOIN tblTicketClassification tc     ON tc.ClassificationID = t.ClassificationID
  LEFT JOIN tblTicketClassification parent ON parent.ClassificationID = tc.ParentID
  LEFT JOIN tblTicketResolution     tr     ON tr.ResolutionID     = t.ResolutionID
  LEFT JOIN tblSalesPeople          sp     ON sp.UserID = t.AssignedToUserID AND sp.isDisplayInCRM = 1
  LEFT JOIN tblContacts             c      ON c.ContactID = t.ContactID
  LEFT JOIN tblJobs                 j      ON j.JobID = t.JobID
  LEFT JOIN tblOrders               o      ON o.OrderID = t.OrderID
  LEFT JOIN tblTicketDeviceType     dt     ON dt.DeviceTypeID = t.DeviceTypeID
  WHERE t.TicketID = ?
  LIMIT 1
`;

const FALLBACK_SITE_SQL = `
  SELECT ts.SiteID
    FROM tblTicketSite ts
   WHERE ts.TicketID = ? AND ts.Active = 1 AND ts.SiteID <> 0
ORDER BY ts.CreatedOn DESC, ts.TicketSiteID DESC
   LIMIT 1
`;

const SITE_SQL = `
  SELECT SiteID, Name, ShipAddress1, ShipAddress2, ShipCity, ShipState
    FROM tblSites
   WHERE SiteID = ?
   LIMIT 1
`;

const ROLLUP_SQL = `
  SELECT
    COALESCE(NULLIF(TRIM(?), ''), (
      SELECT GROUP_CONCAT(tr2.RadioIDNum ORDER BY tr2.CreatedOn DESC SEPARATOR ', ')
        FROM tblTicketRadio tr2
       WHERE tr2.TicketID = ? AND tr2.Active = 1
         AND tr2.RadioIDNum IS NOT NULL AND TRIM(tr2.RadioIDNum) <> ''
    )) AS EffectiveDeviceIDNum,
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
       WHERE tsAll.TicketID = ?
         AND tsAll.Active = 1
         AND tsAll.SiteID <> 0
    ) AS SitesAll,
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
       WHERE trDev.TicketID = ?
         AND trDev.Active = 1
         AND trDev.RadioIDNum IS NOT NULL
         AND TRIM(trDev.RadioIDNum) <> ''
    ) AS DevicesAllWithSite
`;

interface CoreRow {
  TicketID: number;
  ClassificationID: number | null;
  ClassificationName: string | null;
  ParentName: string | null;
  Status: string | null;
  Resolution: string | null;
  AssignedToUserID: number | null;
  AssignedToName: string | null;
  CustomerID: number | null;
  CreatedOn: string | Date | null;
  ModifiedOn: string | Date | null;
  Description: string | null;
  SiteID: number | null;
  ContactID: number | null;
  ContactFirstName: string | null;
  ContactLastName: string | null;
  ContactEmail: string | null;
  JobID: number | null;
  // Numeric in the CRM source DB — mysql2 returns these as `number`.
  JobPartnerNumber: string | number | null;
  OrderID: number | null;
  OrderNumber: string | number | null;
  PONumber: string | number | null;
  DeviceTypeID: number | null;
  DeviceTypeName: string | null;
  RadioIDNum: string | number | null;
}

function nullIfZero(v: number | null | undefined): number | null {
  return v == null || v === 0 ? null : v;
}

function blankToNull(v: string | number | null | undefined): string | null {
  if (v == null) return null;
  // CRM columns like tblOrders.OrderNumber / PONumber and PartnerJobNumber are
  // numeric in the source DB, so mysql2 hands us a `number`. Coerce before
  // trimming so a number never triggers `v.trim is not a function`.
  const trimmed = String(v).trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** CRM sentinel dates (`0000-00-00`, `0001-01-01`) become null, not a throw. */
export function toCrmDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  // CAST AS CHAR yields `0001-01-01 05:00:00`; `new Date(...)` in JS reads
  // that year as 2001. Reject the CRM sentinels from the raw string first.
  if (typeof value === 'string' && /^000[01]-/.test(value.trim())) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  if (d.getUTCFullYear() < 1970) return null;
  return d;
}

function emptyRollups(): Pick<TicketHeader, 'sites_all' | 'devices_all_with_site'> {
  return { sites_all: null, devices_all_with_site: null };
}

export function mapTicketCore(r: CoreRow): TicketHeader {
  const className = r.ParentName ?? r.ClassificationName ?? null;
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
    created_on: toCrmDate(r.CreatedOn),
    modified_on: toCrmDate(r.ModifiedOn),
    description: r.Description ? stripHtmlToPlaintext(r.Description) : null,
    site_id: nullIfZero(r.SiteID),
    site_name: null,
    site_address: null,
    site_city: null,
    site_state: null,
    contact_id: nullIfZero(r.ContactID),
    contact_first_name: nullIfZero(r.ContactID) != null ? blankToNull(r.ContactFirstName) : null,
    contact_last_name: nullIfZero(r.ContactID) != null ? blankToNull(r.ContactLastName) : null,
    contact_email: nullIfZero(r.ContactID) != null ? blankToNull(r.ContactEmail) : null,
    job_id: nullIfZero(r.JobID),
    job_partner_number: nullIfZero(r.JobID) != null ? blankToNull(r.JobPartnerNumber) : null,
    order_id: nullIfZero(r.OrderID),
    order_number: nullIfZero(r.OrderID) != null ? blankToNull(r.OrderNumber) : null,
    po_number: nullIfZero(r.OrderID) != null ? blankToNull(r.PONumber) : null,
    device_type_id: nullIfZero(r.DeviceTypeID),
    device_type_name: nullIfZero(r.DeviceTypeID) != null ? blankToNull(r.DeviceTypeName) : null,
    device_id: blankToNull(r.RadioIDNum),
    ...emptyRollups(),
  };
}

export async function fetchTicketCore(ticketId: number): Promise<TicketHeader | null> {
  const rows = await executeQuery<CoreRow>(CORE_SQL, [ticketId], 'crm');
  if (rows.length === 0) return null;
  return mapTicketCore(rows[0]);
}

export async function attachPrimarySite(header: TicketHeader): Promise<TicketHeader> {
  let siteId = header.site_id;
  if (siteId == null) {
    const found = await executeQuery<{ SiteID: number }>(FALLBACK_SITE_SQL, [header.ticket_id], 'crm');
    siteId = found[0]?.SiteID ?? null;
  }
  if (siteId == null) return header;

  const sites = await executeQuery<{
    SiteID: number;
    Name: string | null;
    ShipAddress1: string | null;
    ShipAddress2: string | null;
    ShipCity: string | null;
    ShipState: string | null;
  }>(SITE_SQL, [siteId], 'crm');
  const s = sites[0];
  if (!s) return { ...header, site_id: siteId };

  const addr1 = blankToNull(s.ShipAddress1);
  const addr2 = blankToNull(s.ShipAddress2);
  return {
    ...header,
    site_id: siteId,
    site_name: blankToNull(s.Name),
    site_address: [addr1, addr2].filter((v): v is string => !!v).join(', ') || null,
    site_city: blankToNull(s.ShipCity),
    site_state: blankToNull(s.ShipState),
  };
}

export async function attachPrimarySiteSafe(header: TicketHeader): Promise<TicketHeader> {
  try {
    return await attachPrimarySite(header);
  } catch (error) {
    logger.warn(`[CRM SERVICE] Ticket ${header.ticket_id} site lookup failed; returning core header`, {
      error: (error as Error).message,
    });
    return header;
  }
}

export async function attachTicketRollups(header: TicketHeader): Promise<TicketHeader> {
  const rows = await executeQuery<{
    EffectiveDeviceIDNum: string | null;
    SitesAll: string | null;
    DevicesAllWithSite: string | null;
  }>(ROLLUP_SQL, [header.device_id ?? '', header.ticket_id, header.ticket_id, header.ticket_id], 'crm');
  const r = rows[0];
  if (!r) return header;
  return {
    ...header,
    device_id: blankToNull(r.EffectiveDeviceIDNum) ?? header.device_id,
    sites_all: blankToNull(r.SitesAll),
    devices_all_with_site: blankToNull(r.DevicesAllWithSite),
  };
}

export async function attachTicketRollupsSafe(header: TicketHeader): Promise<TicketHeader> {
  try {
    return await attachTicketRollups(header);
  } catch (error) {
    logger.warn(`[CRM SERVICE] Ticket ${header.ticket_id} rollups failed; returning header without site/device lists`, {
      error: (error as Error).message,
    });
    return header;
  }
}

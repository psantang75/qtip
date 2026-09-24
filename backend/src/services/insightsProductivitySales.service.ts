/**
 * Insights → Productivity (Sales only): the work a salesperson produces beyond
 * calls and tickets, read live for ONE agent on ONE day (never warehoused):
 *   - leads touched   → the Lead / Contact Manager rows of the CRM touch detail
 *   - proposals       → the "Proposal Issued" status stamp on a lead, typed from
 *                       the lead's proposal document (tblAgreement) line items
 *   - floor plans     → tblLeadTaskSpeakerPlan (upload time + minutes spent)
 *   - demos           → tblLeadTaskTeamsMeeting logged as "Meeting held"
 *   - emails sent     → phone DB tblEmailStats, one per conversation like the
 *                       Email Activity report
 * Every stream degrades to empty rather than failing the day.
 */
import mysql from 'mysql2/promise';
import { RowDataPacket } from 'mysql2';
import { getDatabasePool } from '../config/database';
import { phoneDatabaseConfig } from '../config/environment';
import { buildCrmTaskUrl } from '../utils/crmLinks';
import { openCrmConnection } from './insights/crmAgentConnection';
import {
  classifyProposal, hmMinus, isProposalTransition, salesTouchKind,
  type ProposalType, type QuotePartFlags, type SalesTouchKind,
} from './insights/salesWorkClassify';
import type { TouchDetailResult } from './insightsTouchDetail.service';

export interface SalesTouch { itemId: number; kind: SalesTouchKind; url: string | null; subject: string | null }
/** A one-minute bucket of distinct leads / contact manager tasks first touched then. */
export interface SalesTouchEvent { time: string; leads: number; contactManager: number; ids: SalesTouch[] }
export interface ProposalEvent { time: string; taskId: number; url: string | null; type: ProposalType }
export interface FloorPlanSpan {
  start: string; end: string; taskId: number; url: string | null; minutes: number;
  players: number; amplifiers: number; speakers: number; volumeControls: number;
}
export interface DemoSpan { start: string; end: string; taskId: number; url: string | null; note: string | null }
export interface EmailEvent { time: string; count: number; subjects: string[] }
export interface SalesDay {
  leads: SalesTouchEvent[];
  proposals: ProposalEvent[];
  floorPlans: FloorPlanSpan[];
  demos: DemoSpan[];
  emails: EmailEvent[];
}

const hmOf = (dt: string) => String(dt).slice(11, 16) || '00:00';
const inList = (n: number) => Array.from({ length: n }, () => '?').join(',');

/** Distinct lead / CM items per first-touch minute; machine notes are skipped like Tickets. */
export function buildLeadEvents(rows: TouchDetailResult['rows']): SalesTouchEvent[] {
  const seen = new Set<number>();
  const byMinute = new Map<string, SalesTouchEvent>();
  for (const r of rows) {
    const kind = salesTouchKind(r);
    if (!kind || r.isSystem || seen.has(r.itemId)) continue;
    seen.add(r.itemId);
    const time = hmOf(r.occurredAt);
    const ev = byMinute.get(time) ?? { time, leads: 0, contactManager: 0, ids: [] };
    if (kind === 'lead') ev.leads += 1; else ev.contactManager += 1;
    ev.ids.push({ itemId: r.itemId, kind, url: r.crmUrl, subject: r.subject });
    byMinute.set(time, ev);
  }
  return [...byMinute.values()].sort((a, b) => (a.time < b.time ? -1 : 1));
}

/**
 * Types each proposal from the lead's latest agreement created by the end of
 * the day after the stamp (agents often build the document just after moving
 * the status), using its base-package quote(s) — or every quote on it when none
 * is flagged base.
 */
async function loadProposals(crm: mysql.Connection, touches: TouchDetailResult['rows'], date: string): Promise<ProposalEvent[]> {
  const stamps = touches.filter((r) => isProposalTransition(r));
  if (stamps.length === 0) return [];
  const taskIds = [...new Set(stamps.map((s) => s.itemId))];

  const [agreements] = await crm.query<mysql.RowDataPacket[]>(
    `SELECT t.TaskID AS taskId, ag.AgreementID AS agreementId
     FROM tblTask t
     JOIN tblAgreement ag ON ag.CustomerLeadID = t.CustomerLeadID AND t.CustomerLeadID > 0
     WHERE t.TaskID IN (${inList(taskIds.length)}) AND ag.CreatedOn < DATE_ADD(?, INTERVAL 2 DAY)
     ORDER BY ag.CreatedOn DESC`,
    [...taskIds, date],
  );
  const agreementByTask = new Map<number, number>();
  for (const a of agreements) {
    if (!agreementByTask.has(Number(a.taskId))) agreementByTask.set(Number(a.taskId), Number(a.agreementId));
  }

  const flagsByAgreement = new Map<number, { base: QuotePartFlags[]; all: QuotePartFlags[] }>();
  const agreementIds = [...new Set(agreementByTask.values())];
  if (agreementIds.length) {
    const [parts] = await crm.query<mysql.RowDataPacket[]>(
      `SELECT asl.AgreementID AS agreementId, MAX(asl.BasePackage = 1) AS base,
              MAX(sp.ServiceRequired = 1 AND COALESCE(p.NotASub, 0) = 0) AS hasSub,
              MAX(sp.RadioRequired = 1 AND sp.Shippable = 1) AS hasPlayer,
              MAX(sp.Shippable = 1 AND sp.RadioRequired = 0 AND sp.PartName NOT LIKE '%Fee') AS hasHardware,
              MAX(sp.DMModelNumber IN ('PROFIN', 'PRO-INSTALL')) AS hasInstall
       FROM tblAgreementSale asl
       JOIN tblSaleParts sp ON sp.SaleID = asl.SaleID
       LEFT JOIN tblParts p ON p.PartID = sp.PartID
       WHERE asl.AgreementID IN (${inList(agreementIds.length)})
       GROUP BY asl.AgreementID, asl.SaleID`,
      agreementIds,
    );
    for (const r of parts) {
      const id = Number(r.agreementId);
      const flags: QuotePartFlags = {
        hasSub: Number(r.hasSub) === 1, hasPlayer: Number(r.hasPlayer) === 1,
        hasHardware: Number(r.hasHardware) === 1, hasInstall: Number(r.hasInstall) === 1,
      };
      const entry = flagsByAgreement.get(id) ?? { base: [], all: [] };
      entry.all.push(flags);
      if (Number(r.base) === 1) entry.base.push(flags);
      flagsByAgreement.set(id, entry);
    }
  }

  return stamps.map((s) => {
    const agreementId = agreementByTask.get(s.itemId);
    const quotes = agreementId != null ? flagsByAgreement.get(agreementId) : undefined;
    const type = quotes ? classifyProposal(quotes.base.length ? quotes.base : quotes.all) : 'unclassified';
    return { time: hmOf(s.occurredAt), taskId: s.itemId, url: s.crmUrl, type };
  });
}

async function loadFloorPlans(crm: mysql.Connection, userIds: number[], date: string): Promise<FloorPlanSpan[]> {
  const [rows] = await crm.query<mysql.RowDataPacket[]>(
    `SELECT sp.TaskID AS taskId, sp.TimeSpentMinutes AS minutes, sp.CreatedOn AS createdOn,
            sp.MusicPlayerCount AS players, sp.AmplifierCount AS amplifiers,
            sp.SpeakerCount AS speakers, sp.VolumeControlCount AS volumeControls,
            t.TaskTypeID AS taskTypeId, tt.NewScreen AS newScreen
     FROM tblLeadTaskSpeakerPlan sp
     JOIN tblTask t      ON t.TaskID = sp.TaskID
     JOIN tblTaskType tt ON tt.TaskTypeID = t.TaskTypeID
     WHERE sp.Status = 1 AND sp.CreatedBy IN (${inList(userIds.length)}) AND DATE(sp.CreatedOn) = ?
     ORDER BY sp.CreatedOn`,
    [...userIds, date],
  );
  return rows.map((r) => {
    const end = hmOf(r.createdOn);
    const minutes = Number(r.minutes) || 0;
    return {
      start: hmMinus(end, minutes), end, taskId: Number(r.taskId), minutes,
      url: buildCrmTaskUrl({ taskId: Number(r.taskId), newScreen: r.newScreen, taskTypeId: Number(r.taskTypeId) }),
      players: Number(r.players) || 0, amplifiers: Number(r.amplifiers) || 0,
      speakers: Number(r.speakers) || 0, volumeControls: Number(r.volumeControls) || 0,
    };
  });
}

/** Held demos only (outcome 1), keyed by the meeting's salesperson or its creator. */
async function loadDemos(crm: mysql.Connection, userIds: number[], date: string): Promise<DemoSpan[]> {
  const ph = inList(userIds.length);
  const [rows] = await crm.query<mysql.RowDataPacket[]>(
    `SELECT tm.TaskID AS taskId, TIME_FORMAT(tm.ActualStartTime, '%H:%i') AS s, TIME_FORMAT(tm.ActualStopTime, '%H:%i') AS e,
            LEFT(tm.ResultNote, 300) AS note, t.TaskTypeID AS taskTypeId, tt.NewScreen AS newScreen
     FROM tblLeadTaskTeamsMeeting tm
     JOIN tblTask t      ON t.TaskID = tm.TaskID
     JOIN tblTaskType tt ON tt.TaskTypeID = t.TaskTypeID
     WHERE tm.Status = 1 AND tm.TeamsMeetingOutcomeID = 1 AND tm.ActualDate = ?
       AND (tm.CreatedBy IN (${ph})
            OR tm.SalesPersonID IN (SELECT SalesPersonID FROM tblSalesPeople WHERE UserID IN (${ph})))
     ORDER BY tm.ActualStartTime`,
    [date, ...userIds, ...userIds],
  );
  return rows
    .filter((r) => r.s && r.e && r.s < r.e)
    .map((r) => ({
      start: String(r.s), end: String(r.e), taskId: Number(r.taskId),
      url: buildCrmTaskUrl({ taskId: Number(r.taskId), newScreen: r.newScreen, taskTypeId: Number(r.taskTypeId) }),
      note: (r.note as string | null) || null,
    }));
}

/** Sent emails, one per conversation at its first send, bucketed per minute. */
async function loadEmails(email: string, dayStart: string, dayEnd: string): Promise<EmailEvent[]> {
  if (!phoneDatabaseConfig) return [];
  const [rows] = await getDatabasePool('phone').query<RowDataPacket[]>(
    `SELECT TIME_FORMAT(MIN(es.EmailDate), '%H:%i') AS t, MAX(es.SubjectLine) AS subject
     FROM tblEmailStats es
     WHERE es.MailBoxName = ? AND es.EmailDirection = 'Outbound'
       AND es.SubjectLine NOT LIKE '%Automatic reply%'
       AND es.EmailDate >= ? AND es.EmailDate < ?
     GROUP BY es.ConversationID
     ORDER BY t`,
    [email, dayStart, dayEnd],
  );
  const byMinute = new Map<string, EmailEvent>();
  for (const r of rows) {
    const time = String(r.t);
    const ev = byMinute.get(time) ?? { time, count: 0, subjects: [] };
    ev.count += 1;
    if (r.subject) ev.subjects.push(String(r.subject));
    byMinute.set(time, ev);
  }
  return [...byMinute.values()];
}

export async function loadSalesDay(
  touch: TouchDetailResult, email: string | null, date: string, dayStart: string, dayEnd: string,
): Promise<SalesDay> {
  const leads = buildLeadEvents(touch.rows);
  const emails = email ? await loadEmails(email, dayStart, dayEnd) : [];
  const day: SalesDay = { leads, proposals: [], floorPlans: [], demos: [], emails };
  if (touch.crmUserIds.length === 0) return day;

  const crm = await openCrmConnection();
  if (!crm) return day;
  try {
    day.proposals = await loadProposals(crm, touch.rows, date);
    day.floorPlans = await loadFloorPlans(crm, touch.crmUserIds, date);
    day.demos = await loadDemos(crm, touch.crmUserIds, date);
  } finally {
    await crm.end().catch(() => { /* socket already gone */ });
  }
  return day;
}

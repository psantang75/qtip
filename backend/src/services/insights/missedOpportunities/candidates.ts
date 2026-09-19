/**
 * Phone-side candidate selection for the Missed Opportunities analyzer.
 *
 * `selectCandidateCalls` reads the day's connected Sales calls from the phone
 * pool, using the same participant/session/metric join shape as
 * workers/sql/call_activity.extract.sql, narrowed to DeptID = 'Sales' and to
 * calls with real talk time. Short dials (voicemail drops, misdials) are not
 * worth a model call, hence the talk-time floor.
 *
 * Transcripts come from `phoneSystemService.getTranscriptByConversationId` and
 * are rendered with the shared `formatTranscriptContent`, so a call reads
 * identically here and in the AI Reviewer.
 *
 * The CRM half of a call's material lives in `crmActivity.ts`.
 */
import { executeQuery } from '../../../utils/databaseUtils';
import { formatTranscriptContent } from '../../transcriptRender';
import phoneSystemService from '../../PhoneSystemService';
import logger from '../../../config/logger';
import { CallAttribution, CallCandidate, CallMaterial, CrmDayActivity } from './types';

/** Transcripts beyond this are truncated; a 40k-char call is a model-cost trap. */
const MAX_TRANSCRIPT_CHARS = 24000;

interface PhoneCallRow {
  conversation_id: string;
  agent_name: string;
  email: string | null;
  phone_user_id: string | null;
  started_at: Date | string;
  direction: string | null;
  talk_secs: number | string;
  remote_party: string | null;
  wrap_up_code: string | null;
}

/**
 * One row per (conversation, agent). Talk seconds come from the `tTalkComplete`
 * metric in milliseconds — note this uses the raw value rather than the extract
 * SQL's `% 60` minute arithmetic, which is a reporting artifact of that legacy
 * proc and would mangle any call over an hour.
 *
 * The inner select is shared by the single-day analyzer path and the date-range
 * miner path; only the date predicate and outer filter differ, so both are
 * parameters here rather than a copied query.
 */
const buildCandidatesSql = (datePredicate: string, extraOuter: string) => `
SELECT
  x.conversation_id,
  x.agent_name,
  x.email,
  x.phone_user_id,
  x.started_at,
  x.direction,
  x.talk_secs,
  x.remote_party,
  x.wrap_up_code
FROM (
  SELECT
    c.ConversationID                    AS conversation_id,
    u.Name                              AS agent_name,
    ANY_VALUE(u.Email)                  AS email,
    ANY_VALUE(u.PhoneUserID)            AS phone_user_id,
    MIN(c.ConversationStart_ET)         AS started_at,
    ANY_VALUE(s.Direction)              AS direction,
    ROUND(MAX(CASE WHEN m.Name = 'tTalkComplete' THEN COALESCE(m.Value, 0) ELSE 0 END) / 1000) AS talk_secs,
    -- Phone-side label for the far end. Genesys reports a geo string
    -- ("Sappington MO") for most outbound prospect dials rather than a
    -- business name, so this is a fallback only — the real customer name is
    -- read out of the transcript by the analyzer.
    ANY_VALUE(NULLIF(TRIM(COALESCE(s.RemoteNameDisplayable, s.Remote, s.ANI, '')), '')) AS remote_party,
    ANY_VALUE(seg.WrapUpCode)           AS wrap_up_code
  FROM tblParticipants p
  INNER JOIN tblConversations c ON c.ConversationID = p.ConversationID
  INNER JOIN tblPhoneUser u ON u.PhoneUserID = p.UserID
  INNER JOIN tblSessions s ON s.ParticipantID = p.ParticipantID AND s.ConversationID = p.ConversationID
  INNER JOIN tblMetrics m ON m.SessionID = s.SessionID
  INNER JOIN tblSegments seg ON seg.SessionID = s.SessionID
  WHERE p.purpose IN ('Agent', 'User')
    AND m.Name = 'tTalkComplete'
    AND seg.SegmentType IN ('Interact', 'Wrapup', 'Contacting')
    AND ${datePredicate}
    AND u.DeptID = 'Sales'
  GROUP BY c.ConversationID, u.Name
) x
WHERE x.talk_secs >= ?${extraOuter}
ORDER BY x.agent_name, x.started_at
`;

const CANDIDATES_SQL = buildCandidatesSql('DATE(c.ConversationStart_ET) = ?', '');

export interface SelectCandidatesArgs {
  /** Business day to analyze, YYYY-MM-DD. */
  runDate: string;
  minTalkSecs: number;
  /** Agent display names to skip (BDRs whose dials are not consultative). */
  excludedAgents: readonly string[];
  /** Safety ceiling; the busiest agents are kept because rows are name-ordered. */
  maxCalls: number;
}

export async function selectCandidateCalls(args: SelectCandidatesArgs): Promise<CallCandidate[]> {
  const rows = await executeQuery<PhoneCallRow>(
    CANDIDATES_SQL,
    [args.runDate, Math.trunc(args.minTalkSecs)],
    'phone',
  );

  // Exclusion is applied here rather than in SQL so the list can be edited in
  // ie_config without rebuilding a parameterized NOT IN clause per run.
  const excluded = new Set(args.excludedAgents.map((n) => n.trim().toLowerCase()).filter(Boolean));
  const dateKey = Number(args.runDate.replace(/-/g, ''));

  const kept: CallCandidate[] = [];
  for (const r of rows) {
    if (excluded.has((r.agent_name ?? '').trim().toLowerCase())) continue;
    const startedAt = r.started_at instanceof Date ? r.started_at : new Date(String(r.started_at));
    if (Number.isNaN(startedAt.getTime())) continue;
    kept.push({
      conversationId: r.conversation_id,
      agentName: (r.agent_name ?? '').trim(),
      agentEmail: r.email?.trim() || null,
      phoneUserId: r.phone_user_id?.trim() || null,
      startedAt,
      dateKey,
      direction: r.direction?.trim() || null,
      talkSecs: Math.trunc(Number(r.talk_secs) || 0),
      remoteParty: r.remote_party?.trim() || null,
      wrapUpCode: r.wrap_up_code?.trim() || null,
    });
    if (kept.length >= args.maxCalls) break;
  }
  return kept;
}

export interface SelectRangeArgs {
  /** Inclusive start business day, YYYY-MM-DD. */
  startDate: string;
  /** Inclusive end business day, YYYY-MM-DD. */
  endDate: string;
  minTalkSecs: number;
  /** Agent display names to INCLUDE (the plays-miner roster). Empty -> no rows. */
  roster: readonly string[];
  /** Safety ceiling on rows returned. */
  maxCalls: number;
}

function toCandidate(r: PhoneCallRow): CallCandidate | null {
  const startedAt = r.started_at instanceof Date ? r.started_at : new Date(String(r.started_at));
  if (Number.isNaN(startedAt.getTime())) return null;
  return {
    conversationId: r.conversation_id,
    agentName: (r.agent_name ?? '').trim(),
    agentEmail: r.email?.trim() || null,
    phoneUserId: r.phone_user_id?.trim() || null,
    startedAt,
    dateKey: Number(String(startedAt.toISOString().slice(0, 10)).replace(/-/g, '')),
    direction: r.direction?.trim() || null,
    talkSecs: Math.trunc(Number(r.talk_secs) || 0),
    remoteParty: r.remote_party?.trim() || null,
    wrapUpCode: r.wrap_up_code?.trim() || null,
  };
}

/**
 * Connected Sales calls over a date range, restricted to a roster of agents.
 * Used by the monthly plays miner, which learns from a bounded window of the
 * current sales team's calls rather than a single day. Mirrors
 * `selectCandidateCalls` but includes (not excludes) by name, in SQL, since the
 * roster is small and stable.
 *
 * When the window has more calls than `maxCalls`, the cut is taken ROUND-ROBIN
 * across reps (each rep's calls stay chronological) rather than by the SQL's
 * name order — so hitting the ceiling still yields a balanced sample instead of
 * dropping whoever sorts last. A 90-day backfill of a busy team is exactly the
 * case this guards.
 */
export async function selectCandidateCallsInRange(args: SelectRangeArgs): Promise<CallCandidate[]> {
  const roster = args.roster.map((n) => n.trim().toLowerCase()).filter(Boolean);
  if (roster.length === 0) return [];

  const placeholders = roster.map(() => '?').join(', ');
  const sql = buildCandidatesSql(
    'DATE(c.ConversationStart_ET) BETWEEN ? AND ?',
    ` AND LOWER(x.agent_name) IN (${placeholders})`,
  );
  const rows = await executeQuery<PhoneCallRow>(
    sql,
    [args.startDate, args.endDate, Math.trunc(args.minTalkSecs), ...roster],
    'phone',
  );

  // Group by agent, preserving the SQL's per-agent chronological order.
  const byAgent = new Map<string, CallCandidate[]>();
  for (const r of rows) {
    const c = toCandidate(r);
    if (!c) continue;
    const key = c.agentName.toLowerCase();
    const q = byAgent.get(key);
    if (q) q.push(c);
    else byAgent.set(key, [c]);
  }

  // Round-robin drain: one call from each rep per pass until the cap is hit or
  // every queue is empty. Under the cap this returns everything; over it, the
  // sample is even across reps.
  const queues = [...byAgent.values()];
  const cursor = new Array(queues.length).fill(0);
  const kept: CallCandidate[] = [];
  let progressed = true;
  while (kept.length < args.maxCalls && progressed) {
    progressed = false;
    for (let a = 0; a < queues.length; a++) {
      if (cursor[a] < queues[a].length) {
        kept.push(queues[a][cursor[a]++]);
        progressed = true;
        if (kept.length >= args.maxCalls) break;
      }
    }
  }
  return kept;
}

/**
 * Sales reps as the exclusion list must name them.
 *
 * Read from `tblPhoneUser.Name` deliberately: that is the exact column
 * `CANDIDATES_SQL` returns and `selectCandidateCalls` compares the exclusion
 * list against, so a name picked here always matches. Sourcing the picker from
 * `ie_dim_employee` instead would let a spelling difference silently fail to
 * exclude anyone.
 */
export async function listSalesAgentNames(): Promise<string[]> {
  try {
    const rows = await executeQuery<{ name: string | null }>(
      `SELECT DISTINCT TRIM(Name) AS name
         FROM tblPhoneUser
        WHERE DeptID = 'Sales' AND TRIM(COALESCE(Name, '')) <> ''
        ORDER BY name`,
      [],
      'phone',
    );
    return rows.map((r) => (r.name ?? '').trim()).filter(Boolean);
  } catch (err) {
    // The Settings tab must still open when the phone DB is unreachable (dev,
    // test). An empty roster degrades the picker, it does not break the page.
    logger.warn(`[MISSED OPPS] sales roster unavailable: ${(err as Error).message}`);
    return [];
  }
}

/**
 * Keep the OPENING and the CLOSE of an over-long transcript, not just the
 * opening.
 *
 * A plain `slice(0, cap)` drops the end of the call, which is where the close
 * lives — so the rules that turn on what happened at the end (did the rep ask
 * for the order, was a next step agreed) were graded against a transcript with
 * exactly that part removed, biasing them toward false positives. The marker is
 * explained to the model in the prompt contract so it can say plainly that the
 * middle was not available rather than treat the gap as silence.
 */
export function clampTranscript(transcript: string, max = MAX_TRANSCRIPT_CHARS): string {
  if (transcript.length <= max) return transcript;
  const headChars = Math.floor(max * 0.6);
  const tailChars = max - headChars;
  return [
    transcript.slice(0, headChars),
    '[...MIDDLE OF THIS TRANSCRIPT OMITTED FOR LENGTH — you are reading the opening and the close, not the whole call...]',
    transcript.slice(transcript.length - tailChars),
  ].join('\n');
}

export interface TranscriptLoad {
  /** Rendered dialogue; '' when the call genuinely has none. */
  text: string;
  /** True when the phone DB errored, so '' must not be read as "no recording". */
  unavailable: boolean;
}

/**
 * Fetch and render a conversation's transcript, capped for model cost.
 *
 * The two empty outcomes are kept apart: a call with no recording consent is
 * nothing to judge (a legitimate skip), while a phone-DB error is a review that
 * could not be performed. Collapsing both to '' is what let an outage report as
 * a day of clean calls. Shared by the analyzer's material loader and the plays
 * miner.
 */
export async function loadTranscript(conversationId: string): Promise<TranscriptLoad> {
  try {
    const rows = await phoneSystemService.getTranscriptByConversationId(conversationId);
    const raw = (rows ?? [])
      .map((t) => t.transcript ?? '')
      .filter((s) => s.trim().length > 0)
      .join('\n\n---\n\n');
    return { text: clampTranscript(formatTranscriptContent(raw)), unavailable: false };
  } catch (err) {
    logger.warn(
      `[MISSED OPPS] transcript load failed for ${conversationId}: ${(err as Error).message}`,
    );
    return { text: '', unavailable: true };
  }
}

/**
 * Attach the transcript and the agent's day activity to a candidate. Callers
 * pass a per-day cache keyed by agent name so the CRM is read once per agent
 * rather than once per call — that applies to `leadsCreated` too, which is the
 * rendered block from crmCreated.ts and is likewise per agent per day. A null
 * `leadsCreated` means that lookup failed and the prompt must not assert the
 * agent created nothing.
 *
 * `attribution` comes from the resolver's session read (crmLink). It defaults to
 * "not established", which is the only safe default: it withholds credit for
 * internal transcript lines rather than assuming every "Agent" turn is this
 * salesperson's.
 */
export async function loadCallMaterial(
  candidate: CallCandidate,
  crm: CrmDayActivity,
  leadsCreated: string | null = '',
  attribution: CallAttribution = { internalPartyCount: null, soleInternalParty: false },
): Promise<CallMaterial> {
  const loaded = await loadTranscript(candidate.conversationId);
  return {
    ...candidate,
    transcript: loaded.text,
    transcriptUnavailable: loaded.unavailable,
    crm,
    leadsCreated,
    attribution,
  };
}

/**
 * Data layer for the "Call Transcripts (Long Calls)" on-demand report.
 *
 * Pulls the long support calls the Call Length report counts, then fetches
 * their transcripts from the phone system so an analyst can hand the text to
 * an AI tool of their choosing. Nothing is analyzed here.
 *
 * Two deliberate constraints:
 *
 *  - Only the 10-20 and 20 min+ bands are offered. Short calls are not where
 *    handle time goes, and offering them would invite a request big enough to
 *    exhaust the phone pool.
 *  - Hard cap on calls per download, applied as `ORDER BY handle_secs DESC
 *    LIMIT n`, so an over-wide request returns the LONGEST calls rather than an
 *    arbitrary slice. Transcripts live only in the phone system — there is no
 *    warehouse copy — so every call in the file costs a remote read.
 */
import type { RowDataPacket } from 'mysql2';
import pool from '../../config/database';
import phoneSystemService from '../PhoneSystemService';
import { formatTranscriptContent } from '../transcriptRender';
import { OVER_10_BANDS, bandRangeSql } from '../insights/callLength/bands';
import { supportCallScope, whereSql } from '../insights/callLength/scope';

/** Length choices the report offers, in display order. */
export const TRANSCRIPT_BAND_OPTIONS = [
  { value: 'all', label: 'All long calls (10 min+)' },
  { value: 'm10_20', label: '10-20 min' },
  { value: 'o20', label: '20 min+' },
] as const;

export const DEFAULT_TRANSCRIPT_BAND = 'all';

/** Max calls in one download. See the file header for why a cap exists. */
export const MAX_TRANSCRIPT_CALLS = 250;

/**
 * Transcripts are LONGTEXT and average ~82KB of Genesys JSON (up to 1MB), so
 * they are fetched in small batches — one `IN (...)` over all 250 would build a
 * result set tens of MB wide in a single round trip.
 */
const TRANSCRIPT_FETCH_CHUNK = 25;

/**
 * Chunk fetches in flight. Four leaves most of the read-only phone pool
 * (`PHONE_DB_CONNECTION_LIMIT`, default 10) free for the live call screens that
 * share it, while keeping a full-cap export well inside the download deadline.
 */
const TRANSCRIPT_FETCH_CONCURRENCY = 4;

/** Availability probe selects the id column only, so it can use wider chunks. */
const AVAILABILITY_CHUNK = 200;

export interface TranscriptCall {
  conversationId: string;
  agentName: string;
  agentEmail: string | null;
  department: string;
  callDate: string;
  startedOn: Date | null;
  direction: string;
  talkSecs: number;
  holdSecs: number;
  wrapSecs: number;
  handleSecs: number;
  wrapUpCode: string | null;
  transferred: boolean;
  hasTranscript: boolean;
}

export interface TranscriptCallSelection {
  /** Calls that will be in the file, longest first, already capped. */
  calls: TranscriptCall[];
  /** How many calls matched before the cap — may exceed `calls.length`. */
  matched: number;
  /** Whether the cap trimmed the selection. */
  capped: boolean;
}

/** `bandKey` → the bucket keys it covers. */
export function bandKeysFor(bandKey: string | undefined): string[] {
  if (!bandKey || bandKey === 'all') return OVER_10_BANDS;
  return OVER_10_BANDS.includes(bandKey) ? [bandKey] : OVER_10_BANDS;
}

export function bandLabelFor(bandKey: string | undefined): string {
  const hit = TRANSCRIPT_BAND_OPTIONS.find((b) => b.value === (bandKey || DEFAULT_TRANSCRIPT_BAND));
  return hit?.label ?? TRANSCRIPT_BAND_OPTIONS[0].label;
}

const toNum = (v: unknown): number => Number(v ?? 0);

export interface TranscriptCallFilters {
  fromKey: number;
  toKey: number;
  bandKey?: string;
  departments?: string[];
  users?: string[];
  cap?: number;
}

/**
 * The capped set of long calls, longest first, plus the pre-cap match count.
 * Scope comes from `supportCallScope`, so this can never surface a call the
 * Call Length page wouldn't count.
 */
export async function selectTranscriptCalls(
  f: TranscriptCallFilters,
): Promise<TranscriptCallSelection> {
  const scope = supportCallScope({
    fromKey: f.fromKey,
    toKey: f.toKey,
    departments: f.departments,
    users: f.users,
  });
  const bandSql = bandRangeSql(bandKeysFor(f.bandKey));
  const where = `${whereSql(scope.layered)} AND ${bandSql}`;
  const cap = Math.max(1, Math.min(MAX_TRANSCRIPT_CALLS, f.cap ?? MAX_TRANSCRIPT_CALLS));

  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM ie_fact_support_call f ${scope.joins} ${where}`,
    scope.layered.params,
  );
  const matched = toNum(countRows[0]?.n);

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT f.conversation_id, f.agent_name, f.agent_email, dpt.department_name,
            f.started_on, f.direction, f.talk_secs, f.hold_secs, f.wrap_secs,
            f.handle_secs, f.wrap_up_code, f.transferred, f.date_key
     FROM ie_fact_support_call f
     ${scope.joins}
     ${where}
     ORDER BY f.handle_secs DESC, f.conversation_id
     LIMIT ${cap}`,
    scope.layered.params,
  );

  const calls: TranscriptCall[] = rows.map((r) => ({
    conversationId: String(r.conversation_id),
    agentName: (r.agent_name as string) ?? '',
    agentEmail: (r.agent_email as string) ?? null,
    department: (r.department_name as string) ?? '',
    callDate: String(r.date_key).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'),
    startedOn: (r.started_on as Date) ?? null,
    direction: (r.direction as string) ?? '',
    talkSecs: toNum(r.talk_secs),
    holdSecs: toNum(r.hold_secs),
    wrapSecs: toNum(r.wrap_secs),
    handleSecs: toNum(r.handle_secs),
    wrapUpCode: (r.wrap_up_code as string) ?? null,
    transferred: toNum(r.transferred) === 1,
    hasTranscript: false,
  }));

  return { calls, matched, capped: matched > calls.length };
}

/**
 * Stamp `hasTranscript` on each call. Selects the id column only — never the
 * LONGTEXT — so the preview stays cheap even at the cap.
 */
export async function markTranscriptAvailability(calls: TranscriptCall[]): Promise<number> {
  if (calls.length === 0) return 0;
  const available = new Set<string>();

  for (let i = 0; i < calls.length; i += AVAILABILITY_CHUNK) {
    const ids = calls.slice(i, i + AVAILABILITY_CHUNK).map((c) => c.conversationId);
    try {
      const rows = await phoneSystemService.getTranscriptIdsByConversationIds(ids);
      for (const id of rows) available.add(id);
    } catch {
      // A phone-system outage must not fail the preview: leave the flag false
      // and let the notice under-report rather than blocking the whole run.
    }
  }

  for (const c of calls) c.hasTranscript = available.has(c.conversationId);
  return calls.filter((c) => c.hasTranscript).length;
}

/**
 * Agent + department choices for this report's dropdowns, read from the same
 * population as the rows so a selectable value always has calls behind it.
 * Reads the BASE predicate, so picking one agent doesn't empty the list.
 */
export async function transcriptFilterOptions(
  fromKey: number,
  toKey: number,
): Promise<{ departments: string[]; agents: string[] }> {
  const scope = supportCallScope({ fromKey, toKey });
  const where = `${whereSql(scope.base)} AND ${bandRangeSql(OVER_10_BANDS)}`;

  const [deptRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT dpt.department_name AS name FROM ie_fact_support_call f
     ${scope.joins} ${where} ORDER BY dpt.department_name`,
    scope.base.params,
  );
  const [agentRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT f.agent_name AS name FROM ie_fact_support_call f
     ${scope.joins} ${where} ORDER BY f.agent_name`,
    scope.base.params,
  );

  return {
    departments: deptRows.map((r) => r.name as string).filter(Boolean),
    agents: agentRows.map((r) => r.name as string).filter(Boolean),
  };
}

/**
 * Transcript text per conversation id, already parsed to readable
 * `[mm:ss — Agent] …` lines by the shared renderer the LLM pipelines use.
 * Conversations with multiple legs are joined the same way Missed
 * Opportunities joins them.
 */
export async function fetchTranscriptTexts(
  conversationIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (conversationIds.length === 0) return out;

  const chunks: string[][] = [];
  for (let i = 0; i < conversationIds.length; i += TRANSCRIPT_FETCH_CHUNK) {
    chunks.push(conversationIds.slice(i, i + TRANSCRIPT_FETCH_CHUNK));
  }

  // Same worker-pool shape as MissedOpportunitiesWorker: N workers pulling from
  // a shared cursor. Fetched sequentially, a full 250-call export took ~51s
  // against the framework's 60s download deadline — too little headroom.
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const idx = next++;
      if (idx >= chunks.length) return;
      const rows = await phoneSystemService.getTranscriptsByConversationIds(chunks[idx]);

      // A conversation can hold several transcript legs (transfers, reconnects);
      // joined the same way the Missed Opportunities analyzer joins them.
      const legs = new Map<string, string[]>();
      for (const row of rows) {
        const raw = (row.transcript ?? '').trim();
        if (!raw) continue;
        const list = legs.get(row.conversation_id) ?? [];
        list.push(raw);
        legs.set(row.conversation_id, list);
      }
      for (const [id, list] of legs) {
        const formatted = formatTranscriptContent(list.join('\n\n---\n\n')).trim();
        if (formatted) out.set(id, formatted);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(TRANSCRIPT_FETCH_CONCURRENCY, chunks.length) }, worker),
  );
  return out;
}

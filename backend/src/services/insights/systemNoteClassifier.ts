/**
 * System-note classifier — the SINGLE source of truth for deciding whether a
 * CRM task action / ticket note is a machine-written stamp ("system" work) or a
 * genuine human touch.
 *
 * Why this exists: the "Touched" productivity metric counts distinct tickets/
 * tasks an agent had a NOTED action on that day. The CRM writes a large volume
 * of automated notes (status stamps, auto-closes, lead-creation records, ticket
 * status transitions) under a human's or the house account's id, which inflate
 * Touched far above real effort. Until IT adds an `IsSystemGenerated` column to
 * `tblAction` / `tblTicketNote`, we detect these by their note text.
 *
 * Three code paths must agree exactly or the drill-down stops reconciling to the
 * stored number, so both consumers derive from ONE pattern list:
 *   1. Daily capture   — `buildSystemNoteExclusionSql` in touchedSql
 *   2. History backfill — `buildSystemNoteExclusionSql` when staging bf_tt_*
 *   3. Drill-down       — `isSystemNote` per row (badge + exclude from count)
 *
 * Matching contract (identical in JS and SQL):
 *   - Compare on LOWER(TRIM(note)) — leading/trailing space and case are ignored.
 *   - Each pattern is a MySQL LIKE pattern (`%` = any run incl. newlines, `_` =
 *     any single char). A note is "system" if it matches ANY pattern in full.
 *   - Patterns are deliberately ANCHORED at the start of the note (a leading
 *     stamp) and only trail with `%`, so a status stamp with a real human note
 *     appended is still KEPT unless the whole note is the stamp.
 *
 * Deliberately NOT included (they frequently carry appended human work and are
 * same-actor lead progressions that already count the item once): the bracketed
 * "Task Status Changed from [X] to [Y] by [Name] <note>" family. The weekly
 * drift monitor surfaces new high-frequency prefixes for human review before any
 * pattern is added here.
 *
 * End state: when the CRM exposes a source flag, delete the pattern list and the
 * predicate collapses to `WHERE IsSystemGenerated = 0`.
 */

/** ie_config key that toggles the exclusion off without a redeploy (default on). */
export const TOUCHED_EXCLUDE_SYSTEM_FLAG = 'touched_exclude_system_notes';

/**
 * Lowercase MySQL LIKE patterns for machine-written notes, curated from the real
 * 30-day CRM corpus. KEEP THIS THE ONLY LIST — both the SQL predicate and the JS
 * classifier are generated from it.
 *
 * Two shapes, chosen to never drop real work:
 *   - Trailing `%` (prefix) is used ONLY where the leading text is unmistakably
 *     machine-written and a human note would never begin with it, so tolerating a
 *     variable tail (id / reason / date) is safe.
 *   - No `%` (EXACT full-note) is used for short generic phrases a human might
 *     legitimately START a real note with (e.g. "Ticket is closed, cx confirmed
 *     …"). Exact matching keeps those, so only the bare stamp is dropped.
 */
export const SYSTEM_NOTE_LIKE_PATTERNS: readonly string[] = [
  // Machine-only leading text — safe to match a variable tail with `%`.
  'closed by it%',
  'active lead is closed%',
  'sales ar task is closed%',
  'task closed because a new lead was created%',
  'radio activation task was closed by%',
  'ticket was opened and closed immediately%',
  'next contact date has been updated%',
  'reassigned to unassigned user%',
  'moved by tier 3 to match 1st touch%',
  'created order flow manager task%',
  'created activation task%',
  'created lead with existing customer%',
  'created lead -%',
  'from:% to:%',
  'lead added to sales queue%',
  'auto reply%',
  // Generic phrases a human might open a real note with — EXACT match only, so a
  // note that merely STARTS this way but continues with human text is KEPT.
  'ticket is closed',
  'added a lead',
];

/** Escape a literal char for use inside a RegExp source. */
function escapeRegExpChar(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Convert a MySQL LIKE pattern to an anchored, full-string RegExp that mirrors
 * LIKE semantics (`%` -> any run incl. newlines, `_` -> any single char). Case
 * is handled by the caller lowercasing the input, so no `i` flag is needed.
 */
function likeToRegExp(like: string): RegExp {
  let body = '';
  for (const ch of like) {
    if (ch === '%') body += '[\\s\\S]*';
    else if (ch === '_') body += '[\\s\\S]';
    else body += escapeRegExpChar(ch);
  }
  return new RegExp(`^${body}$`);
}

const SYSTEM_NOTE_REGEXES: readonly RegExp[] = SYSTEM_NOTE_LIKE_PATTERNS.map(likeToRegExp);

/**
 * True when the note is a machine-written stamp (should NOT count as a human
 * touch). Empty/blank notes are not "system" — the callers already require a
 * non-empty note, so a blank here is simply "no match".
 */
export function isSystemNote(note: string | null | undefined): boolean {
  if (!note) return false;
  const norm = note.trim().toLowerCase();
  if (!norm) return false;
  return SYSTEM_NOTE_REGEXES.some((re) => re.test(norm));
}

/**
 * MySQL predicate that is TRUE for HUMAN notes (rows to KEEP), i.e. it excludes
 * system rows. `col` is the raw note column expression (e.g. `a.Note`). Safe to
 * inline: the patterns contain no single quotes or backslashes, so they need no
 * escaping and add no bind parameters.
 */
export function buildSystemNoteExclusionSql(col: string): string {
  const norm = `LOWER(TRIM(${col}))`;
  const clauses = SYSTEM_NOTE_LIKE_PATTERNS.map((p) => `${norm} NOT LIKE '${p}'`);
  return `(${clauses.join(' AND ')})`;
}

/**
 * Resolve the ie_config toggle. Default ON; only an explicit falsey value
 * ('0'/'false'/'off'/'no') disables the exclusion for instant rollback.
 */
export function systemExclusionEnabled(configValue: string | null | undefined): boolean {
  if (configValue == null) return true;
  const v = String(configValue).trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
}

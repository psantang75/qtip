/**
 * Guards on the Call Length after-call split (Follow-Up Extended / Wrap Pending),
 * which lives entirely in support_call.extract.sql and so has no other cover.
 * Each of these can regress without any error: the extract still runs, the
 * page still renders, and the hours are silently wrong.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../../..');
/** Line endings are normalised so an assertion spanning two lines is not CRLF-sensitive. */
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

const extract = read('src/workers/sql/support_call.extract.sql');
const transform = read('src/workers/sql/support_call.transform.sql');
const createMigration = read('prisma/migrations/20260910120000_create_support_call_facts/migration.sql');
const wrapMigration = read('prisma/migrations/20261119190000_support_call_wrap_buckets/migration.sql');

/** The same comment strip + split the worker applies before running the file. */
const code = (sql: string) =>
  sql.replace(/\/\*(?!\+)[\s\S]*?\*\//g, ' ').replace(/--[^\n]*$/gm, '');
const statements = code(extract)
  .split(/;\s*(?:\r?\n|$)/)
  .map((s) => s.trim())
  .filter(Boolean);
const finalSelect = statements[statements.length - 1];

/** Output column names of a SELECT, split on top-level commas only. */
function outputColumns(select: string): string[] {
  const list = select.slice(select.indexOf('*/') + 2, select.search(/\nFROM /));
  const items: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { items.push(cur); cur = ''; } else cur += ch;
  }
  items.push(cur);
  return items.map((i) => (i.match(/\bAS\s+(\w+)\s*$/) ?? i.match(/\.(\w+)\s*$/))![1]);
}

/** Staging columns still loaded; wrap_secs stays in the table but is no longer filled. */
function stagingColumns(): string[] {
  const create = createMigration.slice(
    createMigration.indexOf('CREATE TABLE IF NOT EXISTS `ie_stg_support_call`'),
  );
  const body = create.slice(0, create.indexOf(') ENGINE'));
  const created = [...body.matchAll(/^\s+`(\w+)`\s+[A-Z]/gm)].map((m) => m[1]);
  const added = [...wrapMigration.matchAll(/ALTER TABLE `ie_stg_support_call` ADD COLUMN `(\w+)`/g)]
    .map((m) => m[1]);
  return [...created, ...added].filter((c) => c !== 'wrap_secs');
}

describe('support_call extract: after-call split', () => {
  it('loads exactly the staging columns, including both status parts', () => {
    // The worker inserts the final result set into staging by column name.
    const staging = stagingColumns();
    expect(staging).toContain('wrap_extended_secs');
    expect(staging).toContain('wrap_pending_secs');
    expect(outputColumns(finalSelect).sort()).toEqual([...staging].sort());
  });

  it('finds the two statuses by name, never by presence id', () => {
    expect(extract).toContain("sp.LabelName IN ('Wrap Pending', 'Follow-Up Extended')");
    expect(extract).not.toMatch(/6b3768eb|29f75f7e/i);
  });

  it('ties a status to the most recent call that ended within 2 minutes of it', () => {
    expect(extract).toContain('SELECT st.PresenceID, st.UserID, MAX(l.talk_start)');
    expect(extract).toContain('AND st.StartTime_ET >= l.talk_start');
    expect(extract).toContain('AND st.StartTime_ET <= l.after_start + INTERVAL 120 SECOND');
    expect(extract).toContain('GREATEST(x.call_end, IFNULL(x.wrap_end, x.call_end))');
  });

  it('counts both statuses from the call end and stops at the agent\'s next call', () => {
    expect(extract).toContain(
      'GREATEST(0, TIMESTAMPDIFF(SECOND, GREATEST(st.StartTime_ET, l.call_end),\n'
      + '                              LEAST(st.EndTime_ET, IFNULL(nx.next_start, st.EndTime_ET)))) AS secs',
    );
    expect(extract).toContain('AND n.talk_start > a.talk_start');
  });

  it('never counts the Genesys Wrapup segment toward handle time', () => {
    expect(code(extract)).not.toMatch(/wrap_secs|wrap_covered/);
    expect(code(extract)).not.toMatch(/SUM\(CASE WHEN seg\.SegmentType = 'Wrapup'/);
    expect(finalSelect).toContain(
      'l.talk_secs + l.hold_secs\n'
      + '    + IFNULL(a.wrap_extended_secs, 0)\n'
      + '    + IFNULL(a.wrap_pending_secs, 0)                           AS handle_secs',
    );
  });

  it('is a procedure-style extract that never reopens a temp table in one statement', () => {
    expect(extract).toContain('SET SESSION max_execution_time');
    expect(extract).toContain('SET @pFrom := :pFromDate');
    expect(finalSelect).toMatch(/^SELECT/);
    const temps = [...extract.matchAll(/CREATE TEMPORARY TABLE (\w+)\(/g)].map((m) => m[1]);
    expect(temps.length).toBeGreaterThan(1);
    for (const t of temps) {
      expect(extract.indexOf(`DROP TEMPORARY TABLE IF EXISTS ${t};`))
        .toBeLessThan(extract.indexOf(`CREATE TEMPORARY TABLE ${t}(`));
      // MySQL error 1137: a TEMPORARY table cannot be opened twice in one statement.
      for (const s of statements) {
        const opens = s.match(new RegExp(`\\b(FROM|JOIN)\\s+${t}\\b`, 'g')) ?? [];
        expect(opens.length).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('support_call transform: after-call split', () => {
  it('carries both status parts into the fact and no longer loads wrap_secs', () => {
    expect(transform).toContain('hold_secs, wrap_extended_secs,\n   wrap_pending_secs, handle_secs');
    expect(transform).toContain('IFNULL(s.wrap_extended_secs, 0),\n  IFNULL(s.wrap_pending_secs, 0),');
    expect(code(transform)).not.toContain('wrap_secs,');
    expect(code(transform)).not.toContain('s.wrap_secs');
  });
});

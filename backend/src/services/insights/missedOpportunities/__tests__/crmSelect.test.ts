/**
 * Pure selection logic — no SQL, so open-state and record-choice rules are
 * testable against fixtures.
 *
 * DEFECT 1 REGRESSION. `tblTaskStatus.Closed` is a BIT column; the mysql2 driver
 * hands a BIT back as a Buffer (`<Buffer 00>` / `<Buffer 01>`), and the old code
 * read it with `Number(row.statusClosed) === 0`. `Number(Buffer.from([0]))` is
 * `NaN`, so every open lead fell through to closed and the resolver graded
 * against the wrong record. The query now casts the flag to an integer, and
 * `closedFlag` reads a Buffer by its byte as defence-in-depth — both forms are
 * pinned here, alongside the numeric/string/unknown cases.
 */
import { describe, it, expect } from 'vitest';
import { closedFlag, openStateOf } from '../crmSelect';
import type { TaskCandidateRow } from '../crmDiscover';

/** A lead-task row with the open `1-1-1` CompletedOn sentinel a real open task carries. */
const row = (over: Partial<TaskCandidateRow> = {}): TaskCandidateRow => ({
  TaskID: 500,
  TaskTypeID: 11,
  taskType: 'Lead Manager',
  statusTitle: 'Working',
  statusClosed: 0,
  ContactID: 10,
  CustomerID: 200,
  CustomerLeadID: 100,
  accountName: 'Lakeland Imaging',
  completedOn: '0001-01-01 05:00:00',
  createdOn: '2026-08-20 09:00:00',
  dueOn: '2026-09-18 00:00:00',
  AssignedTo: 7,
  ownerName: 'Jane Rep',
  lastActionOn: '2026-09-01 10:00:00',
  actionCount: 2,
  ...over,
});

describe('closedFlag — every shape the flag can arrive in', () => {
  it('reads a driver BIT Buffer by its byte, not by Number()', () => {
    // The exact bug: Number(Buffer.from([0])) is NaN, so the old === 0 was false.
    expect(Number(Buffer.from([0]))).toBeNaN();
    expect(closedFlag(Buffer.from([0]))).toBe(0);
    expect(closedFlag(Buffer.from([1]))).toBe(1);
  });

  it('reads numeric and string forms', () => {
    expect(closedFlag(0)).toBe(0);
    expect(closedFlag(1)).toBe(1);
    expect(closedFlag('0')).toBe(0);
    expect(closedFlag('1')).toBe(1);
  });

  it('reads booleans', () => {
    expect(closedFlag(true)).toBe(1);
    expect(closedFlag(false)).toBe(0);
  });

  it('is null for anything unparseable, never silently open or closed', () => {
    expect(closedFlag(null)).toBeNull();
    expect(closedFlag(undefined)).toBeNull();
    expect(closedFlag('')).toBeNull();
    expect(closedFlag('   ')).toBeNull();
    expect(closedFlag('abc')).toBeNull();
    expect(closedFlag(Buffer.alloc(0))).toBeNull();
    expect(closedFlag(Number.NaN)).toBeNull();
  });
});

describe('openStateOf — the flag drives open state even as a Buffer', () => {
  it('treats an open-status Buffer plus the sentinel completion as open', () => {
    expect(openStateOf(row({ statusClosed: Buffer.from([0]) as unknown as number }))).toBe('open');
  });

  it('treats a closed-status Buffer as closed', () => {
    expect(openStateOf(row({
      statusClosed: Buffer.from([1]) as unknown as number, statusTitle: 'Sold',
    }))).toBe('closed');
  });

  it('honours the one Contact Past Due exception even from a Buffer', () => {
    expect(openStateOf(row({
      statusClosed: Buffer.from([1]) as unknown as number, statusTitle: 'Contact Past Due',
    }))).toBe('open');
  });

  it('still reads the cast integer the query now returns', () => {
    expect(openStateOf(row({ statusClosed: 0 }))).toBe('open');
    expect(openStateOf(row({ statusClosed: 1, statusTitle: 'Closed' }))).toBe('closed');
  });

  it('a real completion is closed regardless of the flag', () => {
    expect(openStateOf(row({ completedOn: '2026-08-30 16:00:00', statusClosed: 0 }))).toBe('closed');
  });

  it('an unreadable completion date is unknown, never promoted to open', () => {
    expect(openStateOf(row({ completedOn: 'not-a-date', statusClosed: null }))).toBe('unknown');
  });

  it('a null flag on an open-sentinel task is unknown, not open', () => {
    expect(openStateOf(row({ statusClosed: null }))).toBe('unknown');
  });
});

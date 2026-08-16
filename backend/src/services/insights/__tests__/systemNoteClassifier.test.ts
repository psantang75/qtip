import { describe, it, expect } from 'vitest';
import {
  isSystemNote,
  buildSystemNoteExclusionSql,
  systemExclusionEnabled,
  SYSTEM_NOTE_LIKE_PATTERNS,
} from '../systemNoteClassifier';

// Machine-written notes observed in the real 30-day CRM corpus. Every one of
// these must be classified as "system" so it never inflates Touched.
const DROP_CORPUS: string[] = [
  'CLOSED BY IT',
  'CLOSED BY IT - duplicate ticket',
  'Ticket is Closed',
  'Active Lead is Closed',
  'Sales AR Task is closed',
  'Task Closed Because A New Lead Was Created',
  'Radio Activation Task was closed by System',
  'Ticket was opened and closed immediately by workflow',
  'Next Contact Date has been updated',
  'Reassigned to Unassigned User',
  'Moved by Tier 3 to match 1st touch agent',
  'Created Order Flow Manager Task',
  'Created Activation Task - Ops Task',
  'Created Activation Task - Sales Task',
  'Created Lead With Existing Customer',
  'Created Lead -',
  'Created Lead - Acme Corp',
  'From: Assigned To: Closed',
  'From: New Lead To: Active Lead',
  'lead added to sales queue',
  'added a lead',
  'Auto Reply: out of office',
  // case / whitespace insensitivity
  '  ticket is closed  ',
  'TICKET IS CLOSED',
];

// Genuine human work that must be KEPT (counts toward Touched).
const KEEP_CORPUS: string[] = [
  '<html><body><p>Called the customer and confirmed the signal is back.</p></body></html>',
  'Cx had no further questions, ticket resolved after walking through the reset steps.',
  'Task Status Changed from [Lead Received] to [Verbal Contact] by [Steven Selley] spoke with the customer and set a follow up',
  'Followed the SXBR2 playbook - reaimed the antenna, signal now at 82%.',
  'Ticket is closed but only after I called them back three times to confirm', // real note that merely starts similarly — still human
  'Spoke with customer re: closed ticket, added a lead note for the rep', // contains "added a lead" mid-sentence, not a leading stamp
  '',
  '   ',
];

describe('isSystemNote', () => {
  it.each(DROP_CORPUS)('classifies as system: %s', (note) => {
    expect(isSystemNote(note)).toBe(true);
  });

  it.each(KEEP_CORPUS)('keeps as human: %s', (note) => {
    expect(isSystemNote(note)).toBe(false);
  });

  it('treats null/undefined as not-system', () => {
    expect(isSystemNote(null)).toBe(false);
    expect(isSystemNote(undefined)).toBe(false);
  });
});

describe('buildSystemNoteExclusionSql', () => {
  it('emits one normalized NOT LIKE clause per pattern, no bind params', () => {
    const sql = buildSystemNoteExclusionSql('a.Note');
    expect(sql.startsWith('(')).toBe(true);
    expect(sql.endsWith(')')).toBe(true);
    // one clause per pattern
    expect(sql.split(' AND ').length).toBe(SYSTEM_NOTE_LIKE_PATTERNS.length);
    // normalized on LOWER(TRIM(col)) and never introduces a placeholder
    expect(sql).toContain("LOWER(TRIM(a.Note)) NOT LIKE 'closed by it%'"); // prefix form
    expect(sql).toContain("LOWER(TRIM(a.Note)) NOT LIKE 'ticket is closed'"); // exact form
    expect(sql).not.toContain('?');
  });

  it('patterns carry no chars that would need SQL escaping', () => {
    for (const p of SYSTEM_NOTE_LIKE_PATTERNS) {
      expect(p).not.toContain("'");
      expect(p).not.toContain('\\');
      expect(p).toBe(p.toLowerCase());
    }
  });
});

describe('systemExclusionEnabled', () => {
  it('defaults ON when unset', () => {
    expect(systemExclusionEnabled(null)).toBe(true);
    expect(systemExclusionEnabled(undefined)).toBe(true);
    expect(systemExclusionEnabled('1')).toBe(true);
    expect(systemExclusionEnabled('true')).toBe(true);
  });

  it('only an explicit falsey value disables it', () => {
    expect(systemExclusionEnabled('0')).toBe(false);
    expect(systemExclusionEnabled('false')).toBe(false);
    expect(systemExclusionEnabled('off')).toBe(false);
    expect(systemExclusionEnabled('no')).toBe(false);
    expect(systemExclusionEnabled(' 0 ')).toBe(false);
  });
});

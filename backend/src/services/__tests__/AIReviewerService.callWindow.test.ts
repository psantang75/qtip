/**
 * Call-window note scoping (Workstream A).
 *
 * When the AI Reviewer audits a CALL-primary case with an attached
 * ticket, only notes created during or shortly after the call should
 * flow into the synthesis prompt. Notes added later by another agent
 * (re-opens, supervisor edits, follow-up activity) describe what was
 * eventually learned — they're hindsight evidence the original agent
 * could not have used, and letting them through produces unfair
 * "should have known X" grades (the 99076 regression).
 *
 * These tests pin:
 *   1. `filterPostAuditNotes` drops `is_after_audit` rows and logs the
 *      count.
 *   2. The cutoff helper honours the env override and falls back to the
 *      60-min default.
 *   3. The header scope line carries the cutoff ISO timestamp and the
 *      explicit instruction not to fault the agent for filtered notes.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { _internal } from '../AIReviewerService';
import type { CRMNote } from '../CRMService';

const { filterPostAuditNotes, resolvePostCallDocWindowMs, renderAuditScopeLine } = _internal;

function makeNote(
  id: number,
  createdOnIso: string,
  isAfterAudit: boolean,
  body = `Note #${id}`
): CRMNote {
  return {
    id,
    note: body,
    created_on: new Date(createdOnIso),
    created_by: 7,
    created_by_name: 'Agent Beth',
    status_after: null,
    next_contact_date: null,
    is_after_audit: isAfterAudit,
  };
}

describe('filterPostAuditNotes (A3)', () => {
  it('drops notes flagged is_after_audit when a cutoff is set', () => {
    const cutoff = new Date('2026-04-28T13:14:00Z');
    const notes = [
      makeNote(1, '2026-04-28T13:00:00Z', false, 'inside window — kept'),
      makeNote(2, '2026-04-28T14:30:00Z', true, 'after window — dropped'),
      makeNote(3, '2026-04-28T13:10:00Z', false, 'inside window — kept'),
    ];
    const out = filterPostAuditNotes(notes, cutoff, { sourceKind: 'TICKET', sourceId: 99076 });
    expect(out).toHaveLength(2);
    expect(out.map((n) => n.id)).toEqual([1, 3]);
  });

  it('returns notes untouched when cutoff is null (TICKET/TASK primary review)', () => {
    const notes = [
      makeNote(1, '2026-04-28T13:00:00Z', false),
      makeNote(2, '2026-04-28T14:30:00Z', true, 'after-call note — kept on ticket-primary'),
    ];
    const out = filterPostAuditNotes(notes, null, { sourceKind: 'TICKET', sourceId: 99076 });
    expect(out).toEqual(notes);
  });

  it('returns notes untouched when cutoff is undefined', () => {
    const notes = [makeNote(1, '2026-04-28T13:00:00Z', false)];
    const out = filterPostAuditNotes(notes, undefined, { sourceKind: 'TASK', sourceId: 42 });
    expect(out).toEqual(notes);
  });

  it('returns an empty array when ALL notes are after the audit cutoff', () => {
    const cutoff = new Date('2026-04-28T13:14:00Z');
    const notes = [
      makeNote(1, '2026-04-28T15:00:00Z', true),
      makeNote(2, '2026-04-28T15:30:00Z', true),
    ];
    const out = filterPostAuditNotes(notes, cutoff, { sourceKind: 'TICKET', sourceId: 1 });
    expect(out).toHaveLength(0);
  });
});

describe('resolvePostCallDocWindowMs (A2)', () => {
  const originalEnv = process.env.AI_REVIEWER_POST_CALL_DOC_WINDOW_MIN;

  beforeEach(() => {
    if (originalEnv == null) {
      delete process.env.AI_REVIEWER_POST_CALL_DOC_WINDOW_MIN;
    } else {
      process.env.AI_REVIEWER_POST_CALL_DOC_WINDOW_MIN = originalEnv;
    }
  });

  it('defaults to 60 minutes when env is unset', () => {
    delete process.env.AI_REVIEWER_POST_CALL_DOC_WINDOW_MIN;
    expect(resolvePostCallDocWindowMs()).toBe(60 * 60 * 1000);
  });

  it('honours the env override (positive integer minutes)', () => {
    process.env.AI_REVIEWER_POST_CALL_DOC_WINDOW_MIN = '15';
    expect(resolvePostCallDocWindowMs()).toBe(15 * 60 * 1000);
  });

  it('falls back to default when env is non-numeric garbage', () => {
    process.env.AI_REVIEWER_POST_CALL_DOC_WINDOW_MIN = 'not-a-number';
    expect(resolvePostCallDocWindowMs()).toBe(60 * 60 * 1000);
  });

  it('allows zero (no grace window) when explicitly configured', () => {
    process.env.AI_REVIEWER_POST_CALL_DOC_WINDOW_MIN = '0';
    expect(resolvePostCallDocWindowMs()).toBe(0);
  });
});

describe('renderAuditScopeLine (A4)', () => {
  it('renders the cutoff ISO timestamp and the do-not-fault instruction', () => {
    const cutoff = new Date('2026-04-28T14:14:00.000Z');
    const line = renderAuditScopeLine(cutoff);
    expect(line).toContain('2026-04-28T14:14:00.000Z');
    expect(line).toContain('OUT OF SCOPE');
    expect(line).toContain('do not fault the agent');
  });
});

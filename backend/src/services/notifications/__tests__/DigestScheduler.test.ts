/**
 * Behaviour tests for the digest drain.
 *
 * The emphasis is on the ways a group can END. Every exit from `processGroup`
 * has to mark its rows processed, because a row left unprocessed comes back on
 * the next tick — forever. A missing template used to do exactly that: four
 * queued attendance alerts spun in the log every five minutes because the
 * template key had no row and no file behind it.
 *
 * The other focus is payload shape. Two unrelated event shapes share this queue
 * (QA submissions, attendance thresholds) and the mapping between them is easy
 * to break in a way no type error catches.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  queueFindMany: vi.fn(),
  // The `_args` parameters are load-bearing for typing: without them the mock
  // infers an empty argument tuple and `mock.calls[0][0]` fails to compile.
  queueUpdateMany: vi.fn(async (_args: any) => ({ count: 0 })),
  userFindUnique: vi.fn(),
  templateFindUnique: vi.fn(async (_args?: any) => null),
  renderTemplate: vi.fn(),
  isConfigured: vi.fn(() => true),
  send: vi.fn(async () => ({ ok: true, messageId: 'm-1' })),
  logEmail: vi.fn(async () => undefined),
}));

vi.mock('../../../config/prisma', () => ({
  default: {
    notificationQueueEntry: { findMany: mocks.queueFindMany, updateMany: mocks.queueUpdateMany },
    user: { findUnique: mocks.userFindUnique },
    emailTemplate: { findUnique: mocks.templateFindUnique },
  },
}));

vi.mock('../../../config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../config/environment', () => ({
  mailConfig: {
    timezone: 'America/New_York',
    appBaseUrl: 'http://localhost:5173',
    dryRun: true,
  },
}));

vi.mock('../../email/EmailService', () => ({
  default: { isConfigured: mocks.isConfigured, send: mocks.send },
}));

vi.mock('../../email/TemplateRenderer', () => ({
  renderTemplate: mocks.renderTemplate,
}));

vi.mock('../../email/EmailLogger', () => ({
  logEmail: mocks.logEmail,
}));

import logger from '../../../config/logger';
import { runOnce, _internalForTest } from '../DigestScheduler';

const { buildDigestItem, passesFilter } = _internalForTest;

/** One queued attendance threshold crossing, as attendance.notify writes it. */
function attendanceRow(id = 1, userId = 5) {
  return {
    id,
    user_id: userId,
    template_key: 'attendance_threshold_reached',
    payload: { level: 'Coaching', levelKey: 'coaching', points: 3.25, asOf: '2026-08-03', threshold: 3 },
    scheduled_for: new Date('2026-08-04T18:42:32Z'),
    dedupe_key: `attendance_level:${userId}:coaching`,
  };
}

const ACTIVE_USER = { id: 5, username: 'sample.user', email: 'sample@example.com', is_active: true };

const RENDERED = {
  subject: 'Attendance Points — Coaching Threshold Reached',
  html: '<p>body</p>',
  cadence: 'IMMEDIATE', isEnabled: true, isLocked: false, digestFilter: 'ALL', source: 'file',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queueUpdateMany.mockResolvedValue({ count: 0 } as any);
  mocks.templateFindUnique.mockResolvedValue(null as any);
  mocks.userFindUnique.mockResolvedValue(ACTIVE_USER as any);
  mocks.isConfigured.mockReturnValue(true);
  mocks.send.mockResolvedValue({ ok: true, messageId: 'm-1' } as any);
});

describe('runOnce — a template that does not exist', () => {
  beforeEach(() => {
    mocks.queueFindMany.mockResolvedValue([attendanceRow()] as any);
    mocks.renderTemplate.mockResolvedValue(null as any);
  });

  it('discards the rows instead of retrying them on every tick forever', async () => {
    await runOnce();

    // The whole point: the rows are marked processed even though nothing was sent.
    expect(mocks.queueUpdateMany).toHaveBeenCalledTimes(1);
    const call = mocks.queueUpdateMany.mock.calls[0][0] as any;
    expect(call.where.id.in).toEqual([1]);
    expect(call.data.processed_at).toBeInstanceOf(Date);
  });

  it('reports the discard at error level, since the fix is a code change', async () => {
    await runOnce();

    const calls = vi.mocked(logger.error).mock.calls as unknown as unknown[][];
    expect(calls.some(c => String(c[0]).includes('no such template'))).toBe(true);
    expect(calls[0][1]).toMatchObject({ templateKey: 'attendance_threshold_reached', discarded: 1 });
  });

  it('sends nothing and writes no email log row', async () => {
    await runOnce();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.logEmail).not.toHaveBeenCalled();
  });
});

describe('runOnce — attendance threshold crossings', () => {
  beforeEach(() => {
    mocks.queueFindMany.mockResolvedValue([attendanceRow()] as any);
    mocks.renderTemplate.mockResolvedValue(RENDERED as any);
  });

  it('renders under its own key, not a QA digest key', async () => {
    await runOnce();
    const input = mocks.renderTemplate.mock.calls[0][0] as any;
    expect(input.templateKey).toBe('attendance_threshold_reached');
  });

  it('lands the CTA on the attendance page rather than the generic dashboard', async () => {
    await runOnce();
    const input = mocks.renderTemplate.mock.calls[0][0] as any;
    expect(input.data.deepLinkPath).toBe('/app/insights/csr-attendance');
  });

  it('passes the level, points and threshold through to the template', async () => {
    await runOnce();
    const input = mocks.renderTemplate.mock.calls[0][0] as any;
    expect(input.data.items[0]).toMatchObject({ level: 'Coaching', points: 3.25, threshold: 3 });
  });

  it('surfaces the audience role so the copy can address the subject directly', async () => {
    // Without this the admin copy would read "Your attendance points…" to a
    // recipient the event is not about.
    const row = attendanceRow();
    row.payload = { ...row.payload, forRole: 'admins' } as any;
    mocks.queueFindMany.mockResolvedValue([row] as any);

    await runOnce();

    const input = mocks.renderTemplate.mock.calls[0][0] as any;
    expect(input.data.recipient.matchedRole).toBe('admins');
  });

  it('marks the rows processed once sent, so the alert cannot repeat', async () => {
    await runOnce();
    expect(mocks.queueUpdateMany).toHaveBeenCalledTimes(1);
    expect((mocks.queueUpdateMany.mock.calls[0][0] as any).where.id.in).toEqual([1]);
  });
});

describe('buildDigestItem', () => {
  it('formats an attendance date as MM-DD-YYYY without shifting the day', () => {
    // formatDate would read '2026-08-03' as UTC midnight and print Aug 2 in ET.
    const item = buildDigestItem({ level: 'Coaching', points: 3, asOf: '2026-08-03', threshold: 3 });
    expect(item.asOf).toBe('08-03-2026');
  });

  it('leaves the QA fields empty for an attendance payload instead of faking them', () => {
    const item = buildDigestItem({ level: 'Written', levelKey: 'written', points: 7, threshold: 7 });
    expect(item.formName).toBeNull();
    expect(item.score).toBeNull();
    expect(item.status).toBeNull();
  });

  it('still maps a QA submission payload the way it always did', () => {
    const item = buildDigestItem({
      form: { form_name: 'Phone QA' },
      csr: { username: 'a.user' },
      submission: { total_score: 92, status: 'finalized' },
    });
    expect(item).toMatchObject({ formName: 'Phone QA', csrName: 'a.user', score: 92, status: 'finalized' });
    expect(item.level).toBeNull();
  });

  it('falls back to placeholders for a QA payload with nothing in it', () => {
    const item = buildDigestItem({});
    expect(item).toMatchObject({ formName: 'Unknown form', csrName: 'Unknown', score: '—' });
  });
});

describe('passesFilter', () => {
  const attendance = { formName: null, csrName: 'a', score: null, status: null, level: 'Coaching', points: 3, threshold: 3, asOf: null };

  it('keeps an unscored item under a score-based filter rather than dropping it', () => {
    // Number(null) is 0, which would otherwise read as "below threshold".
    expect(passesFilter(attendance as any, 'BELOW_THRESHOLD')).toBe(true);
  });

  it('still filters scored items on the threshold', () => {
    const scored = { ...attendance, score: 92 };
    const failing = { ...attendance, score: 71 };
    expect(passesFilter(scored as any, 'BELOW_THRESHOLD')).toBe(false);
    expect(passesFilter(failing as any, 'BELOW_THRESHOLD')).toBe(true);
  });
});

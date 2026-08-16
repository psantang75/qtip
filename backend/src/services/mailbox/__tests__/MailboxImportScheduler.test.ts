/**
 * Behaviour tests for the inbound-import tick, against a faked mail client.
 *
 * What matters here is not that a good file imports — it is that a bad one does
 * not, and that a good one cannot import twice. So the emphasis is on the
 * refusal paths and on call ordering: mark-read has to happen before the import
 * or a crash mid-run re-imports the same rows on the next tick.
 *
 * Real `detectDataType` and real `isSenderAllowed` run here; only the mailbox,
 * the DB reads and the import itself are faked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from '@e965/xlsx';

vi.mock('../../../config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../config/environment', () => ({
  config: { MAX_FILE_SIZE: 5_242_880 },
  mailboxImportConfig: {
    enabled: true,
    ewsUrl: 'https://mail.example.com/EWS/Exchange.asmx',
    user: 'DM\\qtip',
    password: 'x',
    mailbox: 'qtip@example.com',
    pollMinutes: 10,
    dryRun: false,
    importedByUserId: 7,
    ignoreBefore: '',
  },
}));

vi.mock('../ExchangeMailClient', () => ({
  ExchangeMailClient: { fromConfig: vi.fn() },
}));

vi.mock('../../imports/runImport', () => ({
  runImport: vi.fn(async () => ({
    import_log_id: 1, rows_total: 3, rows_imported: 3,
    rows_skipped: 0, rows_errored: 0, warnings: [],
  })),
}));

vi.mock('../senderAllowlist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../senderAllowlist')>();
  return {
    ...actual,
    loadAllowedSenders: vi.fn(async () => new Set(['reports@paychex.example'])),
    resolveImporter: vi.fn(async () => 7),
  };
});

vi.mock('../../notifications/ingestionAlerts', () => ({
  notifyIngestionFailure: vi.fn(async () => {}),
}));

import { ExchangeMailClient } from '../ExchangeMailClient';
import { runImport } from '../../imports/runImport';
import { notifyIngestionFailure } from '../../notifications/ingestionAlerts';
import { authVerdict, runOnce } from '../MailboxImportScheduler';

// A workbook the real detector will call punch_data.
const PUNCH_BOOK = (() => {
  const sheet = XLSX.utils.json_to_sheet([{
    'Post ID': 1, 'Alert Email': 'a@b.com',
    'Actual Date/Time In': '2026-08-03 09:00', 'Regular Duration': 8,
  }]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'S1');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
})();

const UNKNOWN_BOOK = (() => {
  const sheet = XLSX.utils.json_to_sheet([{ Widget: 1, Sprocket: 2 }]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'S1');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
})();

interface FakeOptions {
  from?: string;
  attachments?: Array<{ name: string; content: Buffer }>;
  authenticationResults?: string | null;
  ignored?: string[];
}

/** A client holding one message, recording the order of what we do to it. */
function fakeClient(options: FakeOptions = {}) {
  const calls: string[] = [];
  const client = {
    calls,
    findUnread: vi.fn(async () => [{
      id: 'msg-1',
      from: options.from ?? 'reports@paychex.example',
      subject: 'Your Report employee_time_cards is ready',
      receivedAt: new Date('2026-08-03T10:00:00Z'),
    }]),
    loadDetail: vi.fn(async () => ({
      authenticationResults: options.authenticationResults ?? null,
      attachments: options.attachments ?? [{ name: 'employee_time_cards.xlsx', content: PUNCH_BOOK }],
      ignored: options.ignored ?? [],
    })),
    markRead: vi.fn(async () => { calls.push('markRead'); }),
    moveToFolder: vi.fn(async (_id: string, folder: string) => { calls.push(`move:${folder}`); }),
  };
  vi.mocked(ExchangeMailClient.fromConfig).mockReturnValue(client as any);
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runImport).mockResolvedValue({
    import_log_id: 1, rows_total: 3, rows_imported: 3,
    rows_skipped: 0, rows_errored: 0, warnings: [],
  });
});

describe('runOnce', () => {
  it('imports a recognised file from an allowed sender and files it as Processed', async () => {
    const client = fakeClient();
    const summary = await runOnce();

    expect(summary).toMatchObject({ examined: 1, imported: 1, rejected: 0 });
    expect(runImport).toHaveBeenCalledTimes(1);
    const [dataType, , fileName, importedBy, source] = vi.mocked(runImport).mock.calls[0];
    expect(dataType).toBe('punch_data');
    expect(fileName).toBe('employee_time_cards.xlsx');
    expect(importedBy).toBe(7);
    expect(source).toMatchObject({ kind: 'mailbox', from: 'reports@paychex.example' });
    expect(client.calls).toContain('move:QTIP Processed');
  });

  it('claims the message by marking it read BEFORE importing', async () => {
    // If this order ever flips, a crash mid-import re-imports the same rows.
    const client = fakeClient();
    vi.mocked(runImport).mockImplementation(async () => {
      client.calls.push('import');
      return {
        import_log_id: 1, rows_total: 1, rows_imported: 1,
        rows_skipped: 0, rows_errored: 0, warnings: [],
      };
    });

    await runOnce();

    expect(client.calls.indexOf('markRead')).toBeLessThan(client.calls.indexOf('import'));
  });

  it('refuses a sender that is not on the allowlist, without reading the attachment', async () => {
    const client = fakeClient({ from: 'attacker@example.com' });
    const summary = await runOnce();

    expect(summary).toMatchObject({ imported: 0, rejected: 1 });
    expect(client.loadDetail).not.toHaveBeenCalled();
    expect(runImport).not.toHaveBeenCalled();
    expect(client.calls).toContain('move:QTIP Failed');
  });

  it('refuses a message whose attachment matches no known import type', async () => {
    const client = fakeClient({ attachments: [{ name: 'mystery.xlsx', content: UNKNOWN_BOOK }] });
    const summary = await runOnce();

    expect(summary).toMatchObject({ imported: 0, rejected: 1 });
    expect(runImport).not.toHaveBeenCalled();
    expect(client.calls).toContain('move:QTIP Failed');
  });

  it('refuses a message with no spreadsheet attachment', async () => {
    const client = fakeClient({ attachments: [], ignored: ['report.pdf'] });
    const summary = await runOnce();

    expect(summary).toMatchObject({ imported: 0, rejected: 1 });
    expect(client.calls).toContain('move:QTIP Failed');
  });

  it('never marks a rejected message read, so it stays visibly unhandled', async () => {
    const client = fakeClient({ from: 'attacker@example.com' });
    await runOnce();
    expect(client.markRead).not.toHaveBeenCalled();
  });

  it('imports nothing when one of two attachments is unrecognised', async () => {
    // Half-loading a message is worse than refusing it: the good half would be
    // in the warehouse with no record that the rest was dropped.
    const client = fakeClient({
      attachments: [
        { name: 'employee_time_cards.xlsx', content: PUNCH_BOOK },
        { name: 'mystery.xlsx', content: UNKNOWN_BOOK },
      ],
    });
    const summary = await runOnce();

    expect(summary).toMatchObject({ imported: 0, rejected: 1 });
    expect(runImport).not.toHaveBeenCalled();
    expect(client.calls).toContain('move:QTIP Failed');
  });

  it('does nothing at all when the mailbox is not configured', async () => {
    vi.mocked(ExchangeMailClient.fromConfig).mockReturnValue(null);
    const summary = await runOnce();
    expect(summary).toMatchObject({ examined: 0, imported: 0, rejected: 0 });
    expect(runImport).not.toHaveBeenCalled();
  });

  it('alerts admins when it rejects a live message', async () => {
    fakeClient({ from: 'attacker@example.com' });
    await runOnce();

    expect(notifyIngestionFailure).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyIngestionFailure).mock.calls[0][0]).toMatchObject({
      channel: 'email',
      source: 'attacker@example.com',
    });
  });

  it('does not alert when a message imports cleanly', async () => {
    fakeClient();
    await runOnce();
    expect(notifyIngestionFailure).not.toHaveBeenCalled();
  });
});

/**
 * The heartbeat counter lives at module scope, so each case here loads a fresh
 * copy of the module with the clock already set — otherwise the hour would be
 * measured from whenever the suite happened to start.
 */
async function freshScheduler(now: string) {
  vi.resetModules();
  vi.setSystemTime(new Date(now));

  const idleClient = {
    findUnread: vi.fn(async () => []),
    loadDetail: vi.fn(),
    markRead: vi.fn(),
    moveToFolder: vi.fn(),
  };
  const { ExchangeMailClient: Fresh } = await import('../ExchangeMailClient');
  vi.mocked(Fresh.fromConfig).mockReturnValue(idleClient as any);

  const { runOnce: tick } = await import('../MailboxImportScheduler');
  const log = (await import('../../../config/logger')).default;
  const beats = () => vi.mocked(log.info as any).mock.calls
    .map((call: unknown[]) => String(call[0]))
    .filter((line: string) => line.includes('[MAILBOX] alive'));

  return { tick, beats, idleClient };
}

describe('hourly heartbeat', () => {
  it('stays quiet on an idle tick, then reports alive once the hour is up', async () => {
    vi.useFakeTimers();
    try {
      const { tick, beats } = await freshScheduler('2026-08-04T10:00:00Z');

      await tick();
      expect(beats()).toHaveLength(0);

      vi.setSystemTime(new Date('2026-08-04T11:01:00Z'));
      await tick();

      const lines = beats();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('2 check(s)');
      expect(lines[0]).toContain('none since startup');

      // Window resets, so the next tick is quiet again rather than logging every time.
      await tick();
      expect(beats()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts what it imported and when, so the line is worth reading', async () => {
    vi.useFakeTimers();
    try {
      const { tick, idleClient } = await freshScheduler('2026-08-04T06:00:00Z');
      idleClient.findUnread.mockResolvedValueOnce([{
        id: 'msg-1',
        from: 'reports@paychex.example',
        subject: 'Your Report employee_time_cards is ready',
        receivedAt: new Date('2026-08-04T06:00:00Z'),
      }] as any);
      idleClient.loadDetail.mockResolvedValueOnce({
        authenticationResults: null,
        attachments: [{ name: 'employee_time_cards.xlsx', content: PUNCH_BOOK }],
        ignored: [],
      } as any);

      await tick();

      vi.setSystemTime(new Date('2026-08-04T07:00:01Z'));
      await tick();

      const log = (await import('../../../config/logger')).default;
      const line = vi.mocked(log.info as any).mock.calls
        .map((call: unknown[]) => String(call[0]))
        .find((l: string) => l.includes('[MAILBOX] alive'));

      expect(line).toContain('1 imported');
      expect(line).toContain('0 rejected');
      expect(line).toContain('Last import: 2026-08-04T06:00:00');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not count a tick that could not even reach the mailbox', async () => {
    vi.useFakeTimers();
    try {
      const { tick, beats } = await freshScheduler('2026-08-04T10:00:00Z');
      const { ExchangeMailClient: Fresh } = await import('../ExchangeMailClient');
      vi.mocked(Fresh.fromConfig).mockReturnValue(null);

      await tick();
      vi.setSystemTime(new Date('2026-08-04T11:01:00Z'));
      await tick();

      expect(beats()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('authVerdict', () => {
  it('allows mail through when the gateway stamps no verdict, since none is not a failure', async () => {
    expect(authVerdict(null).ok).toBe(true);
  });

  it('accepts an explicit pass', () => {
    expect(authVerdict('spf=pass smtp.mailfrom=paychex.com; dkim=pass').ok).toBe(true);
    expect(authVerdict('dmarc=pass action=none').ok).toBe(true);
  });

  it('refuses an explicit failure once the gateway is stamping verdicts', () => {
    const verdict = authVerdict('spf=fail; dkim=fail; dmarc=fail');
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/did not pass/i);
  });

  it('refuses a softfail or none rather than reading it optimistically', () => {
    expect(authVerdict('spf=softfail').ok).toBe(false);
    expect(authVerdict('dmarc=none').ok).toBe(false);
  });
});

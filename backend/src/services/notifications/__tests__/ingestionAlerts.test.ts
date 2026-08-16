import { describe, it, expect, vi, beforeEach } from 'vitest';

const notify = vi.fn((..._args: any[]) => Promise.resolve({ attempted: 1, sent: 1, queued: 0, skipped: 0, failed: 0 }));

vi.mock('../NotificationService', () => ({
  default: { notify: (...args: unknown[]) => notify(...args) },
}));

vi.mock('../../../config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { notifyIngestionFailure } from '../ingestionAlerts';

beforeEach(() => vi.clearAllMocks());

describe('notifyIngestionFailure', () => {
  it('fires the system.ingestion_failed template with a per-day dedupe key', async () => {
    await notifyIngestionFailure({
      channel: 'sql',
      name: 'Call Activity',
      code: 'call_activity',
      reason: 'extract timed out',
      occurredAt: new Date('2026-08-13T14:30:00Z'),
    });

    expect(notify).toHaveBeenCalledTimes(1);
    const [event, payload, ctx] = notify.mock.calls[0] as unknown as [string, any, any];
    expect(event).toBe('system.ingestion_failed');
    expect(payload).toMatchObject({
      channel: 'sql',
      channelLabel: 'Report ingestion',
      name: 'Call Activity',
      code: 'call_activity',
      reason: 'extract timed out',
    });
    expect(ctx).toMatchObject({
      entityType: 'ingestion_failure',
      entityId: 'sql:call_activity:2026-08-13',
      deepLinkPath: '/app/admin/insights/ingestion',
    });
  });

  it('never throws when the notification pipeline fails', async () => {
    notify.mockRejectedValueOnce(new Error('smtp down'));
    await expect(notifyIngestionFailure({
      channel: 'email', name: 'x', code: 'y', reason: 'z',
    })).resolves.toBeUndefined();
  });
});

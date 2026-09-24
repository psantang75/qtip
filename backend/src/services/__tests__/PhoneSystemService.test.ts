/**
 * Unit tests for PhoneSystemService recording de-duplication.
 *
 * Genesys writes one recording file per recorded participant leg. On a normal
 * call the agent and customer legs share the same Interact time window, so their
 * files are duplicate audio; only a genuine transfer/hold produces legs with
 * distinct windows. `getRecordingsForConversation` collapses the duplicates via
 * the session/segment data. The external DB is mocked here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/databaseUtils', () => ({
  executeQuery: vi.fn(),
}));

vi.mock('../../config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { executeQuery } from '../../utils/databaseUtils';
import phoneSystemService from '../PhoneSystemService';

const mockedQuery = executeQuery as unknown as ReturnType<typeof vi.fn>;

function recordingRow(id: string, createdOn: string) {
  return {
    ConversationRecordingID: `cr-${id}`,
    ConversationID: 'conv-1',
    RecordingID: id,
    RecordingPath: `\\\\share\\${id}.mp3`,
    OriginalFileName: `${id}.mp3`,
    CreatedOn: createdOn,
    Status: 'Completed',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getRecordingsForConversation — leg de-duplication', () => {
  it('returns the single recording untouched (no leg lookup needed)', async () => {
    mockedQuery.mockResolvedValueOnce([recordingRow('a', '2026-09-22 16:03:01')]);

    const result = await phoneSystemService.getRecordingsForConversation('conv-1');

    expect(result).toHaveLength(1);
    expect(result[0].recording_id).toBe('a');
    // Only the recordings query runs; the dedup lookup is skipped.
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it('collapses duplicate legs that share one Interact window to the newest leg', async () => {
    mockedQuery
      .mockResolvedValueOnce([
        recordingRow('a', '2026-09-22 16:03:01'),
        recordingRow('b', '2026-09-22 16:03:34'),
      ])
      .mockResolvedValueOnce([{ distinct_windows: 1 }]);

    const result = await phoneSystemService.getRecordingsForConversation('conv-1');

    expect(result).toHaveLength(1);
    // Ordered CreatedOn ASC, so the newest (agent) leg is the last one, 'b'.
    expect(result[0].recording_id).toBe('b');
  });

  it('keeps every leg when the Interact windows differ (real transfer)', async () => {
    mockedQuery
      .mockResolvedValueOnce([
        recordingRow('a', '2026-08-13 12:00:00'),
        recordingRow('b', '2026-08-13 12:00:05'),
        recordingRow('c', '2026-08-13 12:00:10'),
      ])
      .mockResolvedValueOnce([{ distinct_windows: 3 }]);

    const result = await phoneSystemService.getRecordingsForConversation('conv-1');

    expect(result.map(r => r.recording_id)).toEqual(['a', 'b', 'c']);
  });

  it('fails open (keeps all legs) when there is no segment data to judge by', async () => {
    mockedQuery
      .mockResolvedValueOnce([
        recordingRow('a', '2026-09-22 16:03:01'),
        recordingRow('b', '2026-09-22 16:03:34'),
      ])
      .mockResolvedValueOnce([{ distinct_windows: 0 }]);

    const result = await phoneSystemService.getRecordingsForConversation('conv-1');

    expect(result).toHaveLength(2);
  });

  it('fails open (keeps all legs) when the leg lookup throws', async () => {
    mockedQuery
      .mockResolvedValueOnce([
        recordingRow('a', '2026-09-22 16:03:01'),
        recordingRow('b', '2026-09-22 16:03:34'),
      ])
      .mockRejectedValueOnce(new Error('phone db down'));

    const result = await phoneSystemService.getRecordingsForConversation('conv-1');

    expect(result).toHaveLength(2);
  });
});

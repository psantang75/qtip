/**
 * Controller/HTTP-layer tests for the phone-system controller (Phase 2.2
 * error-envelope migration). JSON handlers moved onto `asyncHandler` + thrown
 * `AppError`; the health endpoint's deliberate 200/503 payload and the streaming
 * handler's 416/range + mid-stream on('error') paths were left verbatim, while
 * the pre-stream 400/404/502 guards became throws. The service is mocked, so
 * these run without the external PhoneSystem database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/PhoneSystemService', () => ({
  default: {
    getAudioUrlByConversationId: vi.fn(),
    getAudioUrlsByConversationIds: vi.fn(),
    getAllRecordings: vi.fn(),
    getTranscriptByConversationId: vi.fn(),
    getRecordingsForConversation: vi.fn(),
    getRecordingPathById: vi.fn(),
    getAudioAndTranscriptByConversationId: vi.fn(),
    testConnection: vi.fn(),
    getDatabaseStats: vi.fn(),
  },
}));

import phoneSystemService from '../../services/PhoneSystemService';
import { AppError, ErrorType } from '../../utils/errorHandler';
import {
  getAudioUrlByConversationId,
  getAudioUrlsByConversationIds,
  getAllRecordings,
  getTranscriptByConversationId,
  getRecordingsForConversation,
  streamRecording,
} from '../phoneSystem.controller';

const svc = phoneSystemService as unknown as {
  getAudioUrlByConversationId: ReturnType<typeof vi.fn>;
  getTranscriptByConversationId: ReturnType<typeof vi.fn>;
  getRecordingPathById: ReturnType<typeof vi.fn>;
};

function mockRes() {
  const res: { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  return res;
}

async function runExpectError(
  handler: (req: never, res: never, next: never) => unknown,
  req: Record<string, unknown>,
): Promise<AppError> {
  const res = mockRes();
  const next = vi.fn();
  await handler(req as never, res as never, next as never);
  expect(next).toHaveBeenCalledTimes(1);
  expect(res.json).not.toHaveBeenCalled();
  const err = next.mock.calls[0][0];
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getAudioUrlByConversationId', () => {
  it('400 when conversationId is missing', async () => {
    const err = await runExpectError(getAudioUrlByConversationId, { params: {} });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Conversation ID is required');
  });

  it('404 when no recording exists', async () => {
    svc.getAudioUrlByConversationId.mockResolvedValueOnce(null);
    const err = await runExpectError(getAudioUrlByConversationId, { params: { conversationId: 'abc' } });
    expect(err.statusCode).toBe(404);
    expect(err.type).toBe(ErrorType.NOT_FOUND_ERROR);
    expect(err.message).toBe('No recording found for conversation ID: abc');
  });
});

describe('getAudioUrlsByConversationIds', () => {
  it('400 when the ids array is empty/missing', async () => {
    const err = await runExpectError(getAudioUrlsByConversationIds, { body: { conversationIds: [] } });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Conversation IDs array is required');
  });
});

describe('getAllRecordings', () => {
  it('400 when limit is out of range', async () => {
    const err = await runExpectError(getAllRecordings, { query: { limit: '9999' } });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Limit must be a number between 1 and 1000');
  });
});

describe('getTranscriptByConversationId', () => {
  it('400 when conversationId is missing', async () => {
    const err = await runExpectError(getTranscriptByConversationId, { params: {} });
    expect(err.statusCode).toBe(400);
  });

  it('404 when no transcript exists', async () => {
    svc.getTranscriptByConversationId.mockResolvedValueOnce(null);
    const err = await runExpectError(getTranscriptByConversationId, { params: { conversationId: 'abc' } });
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('No transcript found for conversation ID: abc');
  });
});

describe('getRecordingsForConversation', () => {
  it('400 when conversationId is missing', async () => {
    const err = await runExpectError(getRecordingsForConversation, { params: {} });
    expect(err.statusCode).toBe(400);
  });
});

describe('streamRecording — pre-stream guards', () => {
  it('400 when recordingId is missing', async () => {
    const err = await runExpectError(streamRecording, { params: {}, headers: {} });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Recording ID is required');
  });

  it('404 when no recording row exists', async () => {
    svc.getRecordingPathById.mockResolvedValueOnce(null);
    const err = await runExpectError(streamRecording, { params: { recordingId: 'r1' }, headers: {} });
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('No recording found for ID: r1');
  });

  it('502 when the file is unreachable on the share', async () => {
    svc.getRecordingPathById.mockResolvedValueOnce({ path: '/no/such/file.mp3', originalFilename: 'x.mp3' });
    const err = await runExpectError(streamRecording, { params: { recordingId: 'r1' }, headers: {} });
    expect(err.statusCode).toBe(502);
    expect(err.type).toBe(ErrorType.EXTERNAL_SERVICE_ERROR);
    expect(err.message).toBe('Recording file is unreachable on the PhoneSystem share');
  });
});

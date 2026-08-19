import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import phoneSystemService from '../services/PhoneSystemService';
import logger from '../config/logger';
import { config } from '../config/environment';
import {
  asyncHandler,
  createValidationError,
  createNotFoundError,
  AppError,
  ErrorType,
} from '../utils/errorHandler';

/**
 * Resolve a `RecordingPath` value from `tblConversationRecording` into
 * an actual filesystem path the Node process can open. Windows UNC
 * paths work as-is on a Windows host with share access; on other
 * platforms (or any host that mounts the share locally) set
 * `PHONE_RECORDING_BASE_PATH` to the mount root and we'll rewrite the
 * leading UNC root to it.
 */
const PHONE_UNC_ROOT_RE = /^\\\\[^\\]+\\[^\\]+\\[^\\]+\\/;
function resolveRecordingPath(rawPath: string): string {
  const override = (config.PHONE_RECORDING_BASE_PATH || '').trim();
  if (!override) return rawPath;
  const cleanOverride = override.replace(/[\\/]+$/, '');
  const rewritten = rawPath.replace(PHONE_UNC_ROOT_RE, `${cleanOverride}/`);
  // Normalize backslashes for non-Windows fs.
  return path.sep === '/' ? rewritten.replace(/\\/g, '/') : rewritten;
}

/**
 * Get audio URL by conversation ID
 * @route GET /api/phone-system/recording/:conversationId
 */
export const getAudioUrlByConversationId = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { conversationId } = req.params;

    if (!conversationId) {
      throw createValidationError('Conversation ID is required');
    }

    logger.info(`[PHONE SYSTEM CONTROLLER] Getting audio URL for conversation ID: ${conversationId}`);

    const recording = await phoneSystemService.getAudioUrlByConversationId(conversationId);

    if (!recording) {
      throw createNotFoundError(`No recording found for conversation ID: ${conversationId}`);
    }

    res.status(200).json({
      success: true,
      data: recording
    });
});

/**
 * Get multiple audio URLs by conversation IDs
 * @route POST /api/phone-system/recordings/batch
 */
export const getAudioUrlsByConversationIds = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { conversationIds } = req.body;

    if (!conversationIds || !Array.isArray(conversationIds) || conversationIds.length === 0) {
      throw createValidationError('Conversation IDs array is required');
    }

    logger.info(`[PHONE SYSTEM CONTROLLER] Getting audio URLs for ${conversationIds.length} conversation IDs`);

    const recordings = await phoneSystemService.getAudioUrlsByConversationIds(conversationIds);

    res.status(200).json({
      success: true,
      data: recordings,
      count: recordings.length
    });
});

/**
 * Get all recordings (since date filtering is not available)
 * @route GET /api/phone-system/recordings
 */
export const getAllRecordings = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { limit = 100 } = req.query;

    const limitNum = parseInt(limit as string, 10);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 1000) {
      throw createValidationError('Limit must be a number between 1 and 1000');
    }

    logger.info(`[PHONE SYSTEM CONTROLLER] Getting all recordings (limit: ${limitNum})`);

    const recordings = await phoneSystemService.getAllRecordings(limitNum);

    res.status(200).json({
      success: true,
      data: recordings,
      count: recordings.length,
      filters: {
        limit: limitNum
      }
    });
});

/**
 * Test PhoneSystem database connection
 * @route GET /api/phone-system/health
 */
export const testPhoneSystemConnection = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    logger.info('[PHONE SYSTEM CONTROLLER] Testing PhoneSystem database connection');

    const isConnected = await phoneSystemService.testConnection();

    // Health endpoint: the 200/503 pair is a deliberate status payload (the
    // client reads `status`), not an error envelope — left verbatim.
    if (isConnected) {
      res.status(200).json({
        success: true,
        message: 'PhoneSystem database connection is healthy',
        status: 'connected'
      });
    } else {
      res.status(503).json({
        success: false,
        message: 'PhoneSystem database connection failed',
        status: 'disconnected'
      });
    }
});

/**
 * Get PhoneSystem database statistics
 * @route GET /api/phone-system/stats
 */
export const getPhoneSystemStats = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    logger.info('[PHONE SYSTEM CONTROLLER] Getting PhoneSystem database statistics');

    const stats = await phoneSystemService.getDatabaseStats();

    res.status(200).json({
      success: true,
      data: stats
    });
}); 

/**
 * Get transcript by conversation ID
 * @route GET /api/phone-system/transcript/:conversationId
 */
export const getTranscriptByConversationId = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { conversationId } = req.params;

    if (!conversationId) {
      throw createValidationError('Conversation ID is required');
    }

    logger.info(`[PHONE SYSTEM CONTROLLER] Getting transcript for conversation ID: ${conversationId}`);

    const transcript = await phoneSystemService.getTranscriptByConversationId(conversationId);

    if (!transcript) {
      throw createNotFoundError(`No transcript found for conversation ID: ${conversationId}`);
    }

    res.status(200).json({
      success: true,
      data: transcript
    });
});

/**
 * List every recording for a conversation (one per communication leg).
 * @route GET /api/phone-system/recordings/conversation/:conversationId
 */
export const getRecordingsForConversation = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { conversationId } = req.params;

    if (!conversationId) {
      throw createValidationError('Conversation ID is required');
    }

    const recordings = await phoneSystemService.getRecordingsForConversation(conversationId);

    res.status(200).json({ success: true, data: recordings, count: recordings.length });
});

/**
 * Stream a recording's MP3 file from the PhoneSystem file share with
 * HTTP Range support so `<audio controls>` can seek without buffering
 * the whole file. The `RecordingPath` stored in the DB is a Windows
 * UNC path (`\\server\share\<RecordingID>.mp3`) — the Node process
 * needs read access to that share for this to work.
 *
 * @route GET /api/phone-system/audio/:recordingId
 */
export const streamRecording = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { recordingId } = req.params;
    if (!recordingId) {
      throw createValidationError('Recording ID is required');
    }

    const record = await phoneSystemService.getRecordingPathById(recordingId);
    if (!record) {
      throw createNotFoundError(`No recording found for ID: ${recordingId}`);
    }

    const filePath = resolveRecordingPath(record.path);

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(filePath);
    } catch (err) {
      logger.error(`[PHONE SYSTEM CONTROLLER] Recording file unreachable on disk: ${filePath}`, err);
      throw new AppError(
        'Recording file is unreachable on the PhoneSystem share',
        ErrorType.EXTERNAL_SERVICE_ERROR,
        502,
      );
    }

    const ext = (record.originalFilename || filePath).toLowerCase();
    const contentType = ext.endsWith('.wav') ? 'audio/wav'
      : ext.endsWith('.m4a') ? 'audio/mp4'
      : 'audio/mpeg';
    const downloadName = record.originalFilename || path.basename(filePath) || `${recordingId}.mp3`;

    const range = req.headers.range;
    const fileSize = stat.size;

    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m) {
        res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
        return;
      }
      const startStr = m[1];
      const endStr = m[2];
      const start = startStr ? parseInt(startStr, 10) : 0;
      const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= fileSize) {
        res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
        return;
      }
      const chunkSize = end - start + 1;
      res.status(206).set({
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${downloadName}"`,
        'Cache-Control': 'private, max-age=3600',
      });
      fs.createReadStream(filePath, { start, end })
        .on('error', (err) => {
          logger.error(`[PHONE SYSTEM CONTROLLER] Stream error for ${recordingId}:`, err);
          if (!res.headersSent) res.status(500).end();
          else res.end();
        })
        .pipe(res);
      return;
    }

    res.status(200).set({
      'Accept-Ranges': 'bytes',
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${downloadName}"`,
      'Cache-Control': 'private, max-age=3600',
    });
    fs.createReadStream(filePath)
      .on('error', (err) => {
        logger.error(`[PHONE SYSTEM CONTROLLER] Stream error for ${recordingId}:`, err);
        if (!res.headersSent) res.status(500).end();
        else res.end();
      })
      .pipe(res);
});

/**
 * Get both audio URL and transcript by conversation ID
 * @route GET /api/phone-system/audio-transcript/:conversationId
 */
export const getAudioAndTranscriptByConversationId = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { conversationId } = req.params;

    if (!conversationId) {
      throw createValidationError('Conversation ID is required');
    }

    logger.info(`[PHONE SYSTEM CONTROLLER] Getting audio and transcript for conversation ID: ${conversationId}`);

    const result = await phoneSystemService.getAudioAndTranscriptByConversationId(conversationId);

    // Return success even if one or both are null, as this is expected behavior
    res.status(200).json({
      success: true,
      data: result,
      found: {
        audio: !!result.audio,
        transcript: result.transcript ? result.transcript.length > 0 : false
      }
    });
}); 
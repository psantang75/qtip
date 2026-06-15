import express from 'express';
import { authenticate, authorizeRecordingAccess } from '../middleware/auth';
import {
  getAudioUrlByConversationId,
  getAudioUrlsByConversationIds,
  getAllRecordings,
  testPhoneSystemConnection,
  getPhoneSystemStats,
  getTranscriptByConversationId,
  getAudioAndTranscriptByConversationId,
  getRecordingsForConversation,
  streamRecording,
} from '../controllers/phoneSystem.controller';

const router = express.Router();

/**
 * PhoneSystem API Routes
 * 
 * These routes provide access to call recording data from the PhoneSystem database
 * using the secondary database connection.
 */

// Apply authentication middleware to all routes
router.use(authenticate);

// Recording endpoints are forbidden for CSRs/Agents (role_id=3). They can
// see call metadata + transcripts on their own audit-detail page, but the
// underlying audio (and any URL that resolves to it) is restricted to QA
// reviewers and supervisors. Frontend hides the audio player for the same
// roles; this middleware is the real enforcement so direct API calls
// (curl, DevTools) also get rejected.
router.use(authorizeRecordingAccess);

/**
 * @route GET /api/phone-system/recording/:conversationId
 * @desc Get the most recent audio URL by conversation ID
 * @access Private (QA Analyst, Manager, Director)
 */
router.get('/recording/:conversationId', getAudioUrlByConversationId);

/**
 * @route GET /api/phone-system/recordings/conversation/:conversationId
 * @desc List every recording for a conversation (one per communication leg)
 * @access Private (QA Analyst, Manager, Director)
 */
router.get('/recordings/conversation/:conversationId', getRecordingsForConversation);

/**
 * @route GET /api/phone-system/audio/:recordingId
 * @desc Stream a recording's MP3 file (supports HTTP Range for seeking)
 * @access Private (QA Analyst, Manager, Director)
 */
router.get('/audio/:recordingId', streamRecording);

/**
 * @route POST /api/phone-system/recordings/batch
 * @desc Get multiple audio URLs by conversation IDs
 * @access Private (QA Analyst, Manager, Director)
 */
router.post('/recordings/batch', getAudioUrlsByConversationIds);

/**
 * @route GET /api/phone-system/recordings
 * @desc Get all recordings (since date filtering is not available)
 * @access Private (QA Analyst, Manager, Director)
 */
router.get('/recordings', getAllRecordings);

/**
 * @route GET /api/phone-system/health
 * @desc Test PhoneSystem database connection
 * @access Private (Admin, Manager, Director)
 */
router.get('/health', testPhoneSystemConnection);

/**
 * @route GET /api/phone-system/transcript/:conversationId
 * @desc Get transcript by conversation ID
 * @access Private (QA Analyst, Manager, Director)
 */
router.get('/transcript/:conversationId', getTranscriptByConversationId);

/**
 * @route GET /api/phone-system/audio-transcript/:conversationId
 * @desc Get both audio URL and transcript by conversation ID
 * @access Private (QA Analyst, Manager, Director)
 */
router.get('/audio-transcript/:conversationId', getAudioAndTranscriptByConversationId);

/**
 * @route GET /api/phone-system/stats
 * @desc Get PhoneSystem database statistics
 * @access Private (Admin, Manager, Director)
 */
router.get('/stats', getPhoneSystemStats);

export default router; 
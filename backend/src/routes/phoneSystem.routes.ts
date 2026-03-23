import express from 'express';
import { authenticate } from '../middleware/auth';
import {
  getAudioUrlByConversationId,
  getAudioUrlsByConversationIds,
  getAllRecordings,
  testPhoneSystemConnection,
  getPhoneSystemStats,
  getTranscriptByConversationId,
  getAudioAndTranscriptByConversationId
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

/**
 * @route GET /api/phone-system/recording/:conversationId
 * @desc Get audio URL by conversation ID
 * @access Private (QA Analyst, Manager, Director)
 */
router.get('/recording/:conversationId', getAudioUrlByConversationId);

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
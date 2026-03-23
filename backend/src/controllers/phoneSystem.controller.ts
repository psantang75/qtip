import { Request, Response } from 'express';
import phoneSystemService from '../services/PhoneSystemService';

/**
 * Get audio URL by conversation ID
 * @route GET /api/phone-system/recording/:conversationId
 */
export const getAudioUrlByConversationId = async (req: Request, res: Response): Promise<void> => {
  try {
    const { conversationId } = req.params;
    
    if (!conversationId) {
      res.status(400).json({ 
        success: false, 
        message: 'Conversation ID is required' 
      });
      return;
    }
    
    console.log(`[PHONE SYSTEM CONTROLLER] Getting audio URL for conversation ID: ${conversationId}`);
    
    const recording = await phoneSystemService.getAudioUrlByConversationId(conversationId);
    
    if (!recording) {
      res.status(404).json({ 
        success: false, 
        message: `No recording found for conversation ID: ${conversationId}` 
      });
      return;
    }
    
    res.status(200).json({
      success: true,
      data: recording
    });
  } catch (error) {
    console.error('[PHONE SYSTEM CONTROLLER] Error getting audio URL:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to retrieve audio URL',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Get multiple audio URLs by conversation IDs
 * @route POST /api/phone-system/recordings/batch
 */
export const getAudioUrlsByConversationIds = async (req: Request, res: Response): Promise<void> => {
  try {
    const { conversationIds } = req.body;
    
    if (!conversationIds || !Array.isArray(conversationIds) || conversationIds.length === 0) {
      res.status(400).json({ 
        success: false, 
        message: 'Conversation IDs array is required' 
      });
      return;
    }
    
    console.log(`[PHONE SYSTEM CONTROLLER] Getting audio URLs for ${conversationIds.length} conversation IDs`);
    
    const recordings = await phoneSystemService.getAudioUrlsByConversationIds(conversationIds);
    
    res.status(200).json({
      success: true,
      data: recordings,
      count: recordings.length
    });
  } catch (error) {
    console.error('[PHONE SYSTEM CONTROLLER] Error getting audio URLs:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to retrieve audio URLs',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Get all recordings (since date filtering is not available)
 * @route GET /api/phone-system/recordings
 */
export const getAllRecordings = async (req: Request, res: Response): Promise<void> => {
  try {
    const { limit = 100 } = req.query;
    
    const limitNum = parseInt(limit as string, 10);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 1000) {
      res.status(400).json({ 
        success: false, 
        message: 'Limit must be a number between 1 and 1000' 
      });
      return;
    }
    
    console.log(`[PHONE SYSTEM CONTROLLER] Getting all recordings (limit: ${limitNum})`);
    
    const recordings = await phoneSystemService.getAllRecordings(limitNum);
    
    res.status(200).json({
      success: true,
      data: recordings,
      count: recordings.length,
      filters: {
        limit: limitNum
      }
    });
  } catch (error) {
    console.error('[PHONE SYSTEM CONTROLLER] Error getting recordings:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get recordings',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Test PhoneSystem database connection
 * @route GET /api/phone-system/health
 */
export const testPhoneSystemConnection = async (req: Request, res: Response): Promise<void> => {
  try {
    console.log('[PHONE SYSTEM CONTROLLER] Testing PhoneSystem database connection');
    
    const isConnected = await phoneSystemService.testConnection();
    
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
  } catch (error) {
    console.error('[PHONE SYSTEM CONTROLLER] Error testing connection:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to test PhoneSystem database connection',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Get PhoneSystem database statistics
 * @route GET /api/phone-system/stats
 */
export const getPhoneSystemStats = async (req: Request, res: Response): Promise<void> => {
  try {
    console.log('[PHONE SYSTEM CONTROLLER] Getting PhoneSystem database statistics');
    
    const stats = await phoneSystemService.getDatabaseStats();
    
    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('[PHONE SYSTEM CONTROLLER] Error getting statistics:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get PhoneSystem database statistics',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}; 

/**
 * Get transcript by conversation ID
 * @route GET /api/phone-system/transcript/:conversationId
 */
export const getTranscriptByConversationId = async (req: Request, res: Response): Promise<void> => {
  try {
    const { conversationId } = req.params;
    
    if (!conversationId) {
      res.status(400).json({ 
        success: false, 
        message: 'Conversation ID is required' 
      });
      return;
    }
    
    console.log(`[PHONE SYSTEM CONTROLLER] Getting transcript for conversation ID: ${conversationId}`);
    
    const transcript = await phoneSystemService.getTranscriptByConversationId(conversationId);
    
    if (!transcript) {
      res.status(404).json({ 
        success: false, 
        message: `No transcript found for conversation ID: ${conversationId}` 
      });
      return;
    }
    
    res.status(200).json({
      success: true,
      data: transcript
    });
  } catch (error) {
    console.error('[PHONE SYSTEM CONTROLLER] Error getting transcript:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to retrieve transcript',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Get both audio URL and transcript by conversation ID
 * @route GET /api/phone-system/audio-transcript/:conversationId
 */
export const getAudioAndTranscriptByConversationId = async (req: Request, res: Response): Promise<void> => {
  try {
    const { conversationId } = req.params;
    
    if (!conversationId) {
      res.status(400).json({ 
        success: false, 
        message: 'Conversation ID is required' 
      });
      return;
    }
    
    console.log(`[PHONE SYSTEM CONTROLLER] Getting audio and transcript for conversation ID: ${conversationId}`);
    
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
  } catch (error) {
    console.error('[PHONE SYSTEM CONTROLLER] Error getting audio and transcript:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to retrieve audio and transcript',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}; 
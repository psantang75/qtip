import express, { Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import { Call } from '../models/Call';
import phoneSystemService from '../services/PhoneSystemService';
import logger from '../config/logger';

const router = express.Router();

// Apply authentication to all call routes
router.use(authenticate);

// Search calls endpoint
router.get('/search', async (req: Request, res: Response) => {
  try {
    const { 
      csr_id, 
      date_start, 
      date_end, 
      customer_id, 
      external_id,
      search,
      page = 1,
      limit = 20
    } = req.query;

    // If searching by external_id (conversation ID), first verify it exists in PhoneSystem
    if (external_id) {
      logger.info(`[CALLS ROUTE] Searching for conversation ID: ${external_id}`);
      
      const phoneSystemData = await phoneSystemService.getAudioAndTranscriptByConversationId(external_id as string);
      
      if (!phoneSystemData.audio && (!phoneSystemData.transcript || phoneSystemData.transcript.length === 0)) {
        logger.info(`[CALLS ROUTE] Conversation ID ${external_id} not found in PhoneSystem`);
        return res.json([]);
      }
      
      logger.info(`[CALLS ROUTE] Conversation ID ${external_id} found in PhoneSystem`);
    }

    const conditions: Prisma.Sql[] = [];

    if (csr_id) {
      conditions.push(Prisma.sql`c.csr_id = ${parseInt(csr_id as string)}`);
    }

    if (date_start && date_end) {
      conditions.push(Prisma.sql`DATE(c.call_date) BETWEEN ${date_start as string} AND ${date_end as string}`);
    }

    if (customer_id) {
      conditions.push(Prisma.sql`c.customer_id = ${customer_id as string}`);
    }

    if (external_id) {
      conditions.push(Prisma.sql`c.call_id = ${external_id as string}`);
    }

    if (search) {
      const searchTerm = `%${search}%`;
      conditions.push(
        Prisma.sql`(c.call_id LIKE ${searchTerm} OR c.customer_id LIKE ${searchTerm} OR u.username LIKE ${searchTerm})`
      );
    }

    const whereClause = conditions.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;

    const limitNum = parseInt(limit as string);
    const offsetNum = (parseInt(page as string) - 1) * limitNum;

    const rows = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          c.id,
          c.call_id,
          c.csr_id,
          c.department_id,
          c.customer_id,
          c.call_date,
          c.duration,
          c.recording_url,
          c.transcript,
          c.metadata,
          c.created_at,
          c.updated_at,
          u.username as csr_name,
          d.department_name
        FROM calls c
        LEFT JOIN users u ON c.csr_id = u.id
        LEFT JOIN departments d ON c.department_id = d.id
        ${whereClause}
        ORDER BY c.call_date DESC
        LIMIT ${limitNum} OFFSET ${offsetNum}
      `
    );

    logger.info('[CALLS ROUTE] Search results from main DB:', rows);

    const calls = rows.map(row => ({
      id: row.id,
      call_id: row.call_id,
      csr_id: row.csr_id,
      customer_id: row.customer_id,
      call_date: row.call_date,
      duration: row.duration,
      recording_url: row.recording_url,
      transcript: row.transcript,
      csr_name: row.csr_name,
      department_name: row.department_name
    }));

    // If searching by external_id and no results in main DB, create a virtual call record
    if (external_id && calls.length === 0) {
      logger.info(`[CALLS ROUTE] Creating virtual call record for conversation ID: ${external_id}`);
      
      const phoneSystemData = await phoneSystemService.getAudioAndTranscriptByConversationId(external_id as string);
      
      const virtualCall = {
        id: -1,
        call_id: external_id as string,
        csr_id: 0,
        customer_id: null,
        call_date: new Date(),
        duration: 0,
        recording_url: phoneSystemData.audio?.audio_url || null,
        transcript: phoneSystemData.transcript && phoneSystemData.transcript.length > 0 
          ? phoneSystemData.transcript.map(t => {
              try {
                const transcriptData = JSON.parse(t.transcript);
                if (transcriptData.transcripts && Array.isArray(transcriptData.transcripts)) {
                  return transcriptData.transcripts
                    .map((transcript: any) => transcript.phrases?.map((phrase: any) => {
                      const prefix = phrase.participantPurpose === 'external' ? '<span class="font-bold">Customer:</span> ' : '<span class="font-bold">Agent:</span> ';
                      return prefix + phrase.text;
                    }).join('\n') || '')
                    .join('\n\n---\n\n');
                }
                return t.transcript;
              } catch (error) {
                logger.warn('[CALLS ROUTE] Failed to parse transcript JSON:', error);
                return t.transcript;
              }
            }).join('\n\n---\n\n')
          : null,
        csr_name: 'Unknown',
        department_name: 'Unknown'
      };
      
      calls.push(virtualCall);
    }

    res.json(calls);

  } catch (error) {
    logger.error('[CALLS ROUTE] Error searching calls:', error);
    res.status(500).json({ 
      error: 'Failed to search calls',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get call by ID endpoint
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // If it's a virtual call (negative ID), get from PhoneSystem
    if (parseInt(id) < 0) {
      const conversationId = id.substring(1);
      logger.info(`[CALLS ROUTE] Getting virtual call for conversation ID: ${conversationId}`);
      
      const phoneSystemData = await phoneSystemService.getAudioAndTranscriptByConversationId(conversationId);
      
      if (!phoneSystemData.audio && (!phoneSystemData.transcript || phoneSystemData.transcript.length === 0)) {
        return res.status(404).json({ error: 'Call not found' });
      }
      
      const virtualCall = {
        id: parseInt(id),
        call_id: conversationId,
        csr_id: 0,
        customer_id: null,
        call_date: new Date().toISOString(),
        duration: 0,
        recording_url: phoneSystemData.audio?.audio_url || null,
        transcript: phoneSystemData.transcript && phoneSystemData.transcript.length > 0 
          ? phoneSystemData.transcript.map((t: any) => {
              try {
                const transcriptData = JSON.parse(t.transcript);
                if (transcriptData.transcripts && Array.isArray(transcriptData.transcripts)) {
                  return transcriptData.transcripts
                    .map((transcript: any) => transcript.phrases?.map((phrase: any) => {
                      const prefix = phrase.participantPurpose === 'external' ? '<span class="font-bold">Customer:</span> ' : '<span class="font-bold">Agent:</span> ';
                      return prefix + phrase.text;
                    }).join('\n') || '')
                    .join('\n\n---\n\n');
                }
                return t.transcript;
              } catch (error) {
                logger.warn('[CALLS ROUTE] Failed to parse transcript JSON:', error);
                return t.transcript;
              }
            }).join('\n\n---\n\n')
          : null,
        csr_name: 'Unknown',
        department_name: 'Unknown'
      };
      
      return res.json(virtualCall);
    }

    // Regular call lookup from main database
    const rows = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          c.id,
          c.call_id,
          c.csr_id,
          c.department_id,
          c.customer_id,
          c.call_date,
          c.duration,
          c.recording_url,
          c.transcript,
          c.metadata,
          c.created_at,
          c.updated_at,
          u.username as csr_name,
          d.department_name
        FROM calls c
        LEFT JOIN users u ON c.csr_id = u.id
        LEFT JOIN departments d ON c.department_id = d.id
        WHERE c.id = ${parseInt(id)}
      `
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Call not found' });
    }

    const call = rows[0];
    const transformedCall = {
      id: call.id,
      call_id: call.call_id,
      csr_id: call.csr_id,
      customer_id: call.customer_id,
      call_date: call.call_date,
      duration: call.duration,
      recording_url: call.recording_url,
      transcript: call.transcript,
      csr_name: call.csr_name,
      department_name: call.department_name
    };

    res.json(transformedCall);

  } catch (error) {
    logger.error('[CALLS ROUTE] Error fetching call:', error);
    res.status(500).json({ 
      error: 'Failed to fetch call',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Debug endpoint to list available calls (for testing)
router.get('/debug/list', async (req: Request, res: Response) => {
  try {
    const rows = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          c.id,
          c.call_id,
          c.csr_id,
          c.customer_id,
          c.call_date,
          c.duration,
          u.username as csr_name
        FROM calls c
        LEFT JOIN users u ON c.csr_id = u.id
        ORDER BY c.call_date DESC
        LIMIT 20
      `
    );

    const phoneSystemRecordings = await phoneSystemService.getAllRecordings(10);

    logger.info('[CALLS ROUTE] Available calls from main DB:', rows);
    logger.info('[CALLS ROUTE] Available conversation IDs from PhoneSystem:', phoneSystemRecordings);

    res.json({
      message: 'Available calls in both databases',
      mainDatabase: {
        count: rows.length,
        calls: rows
      },
      phoneSystem: {
        count: phoneSystemRecordings.length,
        conversationIds: phoneSystemRecordings.map(r => r.conversation_id)
      }
    });

  } catch (error) {
    logger.error('[CALLS ROUTE] Error listing calls:', error);
    res.status(500).json({ 
      error: 'Failed to list calls',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Check if conversation ID is already used in any submission
router.get('/check-submission/:conversationId', async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.params;
    
    logger.info(`[CALLS ROUTE] Checking if conversation ID ${conversationId} is used in any submission`);
    
    const rows = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          sc.submission_id,
          s.status,
          s.submitted_at,
          f.form_name
        FROM submission_calls sc
        JOIN calls c ON sc.call_id = c.id
        JOIN submissions s ON sc.submission_id = s.id
        JOIN forms f ON s.form_id = f.id
        WHERE c.call_id = ${conversationId}
        ORDER BY s.submitted_at DESC
      `
    );
    
    logger.info(`[CALLS ROUTE] Found ${rows.length} submissions using conversation ID ${conversationId}`);
    
    if (rows.length > 0) {
      res.json({
        exists: true,
        submissions: rows.map(row => ({
          submission_id: row.submission_id,
          status: row.status,
          submitted_at: row.submitted_at,
          form_name: row.form_name
        }))
      });
    } else {
      res.json({
        exists: false,
        submissions: []
      });
    }
    
  } catch (error) {
    logger.error('[CALLS ROUTE] Error checking conversation ID usage:', error);
    res.status(500).json({ 
      error: 'Failed to check conversation ID usage',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;

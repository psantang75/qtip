import { Request, Response } from 'express';
import {
  importCallActivity,
  importSalesMargin,
  importLeadSalesMargin,
  importLeadSource,
  importTicketTask,
  importEmailStats,
  previewImport,
} from '../services/importService';
import prisma from '../config/prisma';

const VALID_DATA_TYPES = [
  'call_activity',
  'sales_margin',
  'lead_sales_margin',
  'lead_source',
  'ticket_task',
  'email_stats',
] as const;

type DataType = typeof VALID_DATA_TYPES[number];

function getImportHandler(dataType: DataType) {
  const handlers: Record<DataType, Function> = {
    call_activity:     importCallActivity,
    sales_margin:      importSalesMargin,
    lead_sales_margin: importLeadSalesMargin,
    lead_source:       importLeadSource,
    ticket_task:       importTicketTask,
    email_stats:       importEmailStats,
  };
  return handlers[dataType];
}

/**
 * POST /api/imports/upload
 * Accepts multipart/form-data with:
 *   - file: the Excel file
 *   - data_type: one of the valid data type strings
 */
export const uploadImport = async (req: Request, res: Response): Promise<void> => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ message: 'No file uploaded. Attach an Excel file as "file".' });
      return;
    }

    const dataType = req.body?.data_type as DataType;
    if (!dataType || !VALID_DATA_TYPES.includes(dataType)) {
      res.status(400).json({
        message: `Invalid or missing data_type. Must be one of: ${VALID_DATA_TYPES.join(', ')}`,
      });
      return;
    }

    const userId = (req as any).user?.user_id;
    if (!userId) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const handler = getImportHandler(dataType);
    const result = await handler(file.buffer, file.originalname, userId);

    res.status(200).json({
      message: 'Import completed',
      ...result,
    });
  } catch (error: any) {
    console.error('[IMPORT CONTROLLER] uploadImport error:', error);
    res.status(500).json({
      message: error?.message || 'Import failed',
    });
  }
};

/**
 * POST /api/imports/preview
 * Parses the file and returns first 10 rows + validation info without inserting.
 * Accepts same multipart payload as uploadImport.
 */
export const previewImportHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ message: 'No file uploaded. Attach an Excel file as "file".' });
      return;
    }

    const dataType = req.body?.data_type as DataType;
    if (!dataType || !VALID_DATA_TYPES.includes(dataType)) {
      res.status(400).json({
        message: `Invalid or missing data_type. Must be one of: ${VALID_DATA_TYPES.join(', ')}`,
      });
      return;
    }

    const result = await previewImport(file.buffer, dataType);

    res.status(200).json(result);
  } catch (error: any) {
    console.error('[IMPORT CONTROLLER] previewImport error:', error);
    res.status(500).json({
      message: error?.message || 'Preview failed',
    });
  }
};

/**
 * GET /api/imports/history
 * Returns all ImportLog records, most recent first.
 * Supports optional query param ?data_type= to filter by type.
 */
export const getImportHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const dataType = req.query.data_type as string | undefined;
    const page = Math.max(1, parseInt(String(req.query.page ?? 1), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? 50), 10)));

    const where = dataType ? { data_type: dataType } : {};

    const [total, logs] = await prisma.$transaction([
      prisma.importLog.count({ where }),
      prisma.importLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          importer: { select: { id: true, username: true, email: true } },
        },
      }),
    ]);

    res.status(200).json({
      data: logs,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    console.error('[IMPORT CONTROLLER] getImportHistory error:', error);
    res.status(500).json({ message: 'Failed to load import history' });
  }
};

/**
 * GET /api/imports/:id
 * Returns a single ImportLog with full details.
 */
export const getImportById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ message: 'Invalid import ID' });
      return;
    }

    const log = await prisma.importLog.findUnique({
      where: { id },
      include: {
        importer: { select: { id: true, username: true, email: true } },
      },
    });

    if (!log) {
      res.status(404).json({ message: 'Import log not found' });
      return;
    }

    res.status(200).json(log);
  } catch (error: any) {
    console.error('[IMPORT CONTROLLER] getImportById error:', error);
    res.status(500).json({ message: 'Failed to load import log' });
  }
};

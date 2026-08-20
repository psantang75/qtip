import { Request, Response } from 'express';
import {
  DATA_TYPES,
  previewImport,
  resolveAllowedDataTypes,
  type DataType,
} from '../services/importService';
import { isDataType, runImport } from '../services/imports/runImport';
import { config } from '../config/environment';
import prisma from '../config/prisma';
import logger from '../config/logger';

/**
 * Report types the manual Import Center may ingest when nothing is configured.
 * Only the Paychex punch feed is safe to (re)upload by hand — it self-heals on
 * `post_id`. The six non-punch `*_raw` datasets have no unique grain and are fed
 * automatically (warehouse sync -> `ie_fact_*`), so hand-uploading them would
 * only inject duplicate rows into the Data Explorer. Override with a
 * comma-separated `IMPORT_ALLOWED_TYPES` (a config edit, not a code change).
 */
const DEFAULT_IMPORT_TYPES: readonly DataType[] = ['punch_data'];

/**
 * Validate the request's `data_type` against the format list AND the ingestion
 * allowlist, writing the 400 response itself on failure. Shared by the upload
 * and preview handlers so both gate identically. Returns the type on success.
 */
function resolveRequestedType(req: Request, res: Response): DataType | null {
  const dataType = req.body?.data_type;
  if (!isDataType(dataType)) {
    res.status(400).json({
      message: `Invalid or missing data_type. Must be one of: ${DATA_TYPES.join(', ')}`,
    });
    return null;
  }
  const allowed = resolveAllowedDataTypes(config.IMPORT_ALLOWED_TYPES, DEFAULT_IMPORT_TYPES);
  if (!allowed.includes(dataType)) {
    res.status(400).json({
      message: `Manual upload of "${dataType}" is disabled. Allowed types: ${allowed.join(', ')}.`,
    });
    return null;
  }
  return dataType;
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

    const dataType = resolveRequestedType(req, res);
    if (!dataType) return;

    const userId = req.user?.user_id;
    if (!userId) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const result = await runImport(dataType, file.buffer, file.originalname, userId);

    res.status(200).json({ message: 'Import completed', ...result });
  } catch (error: any) {
    logger.error('[IMPORT CONTROLLER] uploadImport error:', error);
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

    const dataType = resolveRequestedType(req, res);
    if (!dataType) return;

    const result = await previewImport(file.buffer, dataType);

    res.status(200).json(result);
  } catch (error: any) {
    logger.error('[IMPORT CONTROLLER] previewImport error:', error);
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
    logger.error('[IMPORT CONTROLLER] getImportHistory error:', error);
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
    logger.error('[IMPORT CONTROLLER] getImportById error:', error);
    res.status(500).json({ message: 'Failed to load import log' });
  }
};

import express, { RequestHandler } from 'express';
import { authenticate } from '../middleware/auth';
import {
  listReports,
  getReport,
  getReportData,
  downloadReport,
  getFilterOptions,
} from '../controllers/onDemandReports.controller';

const router = express.Router();

/**
 * @route GET /api/on-demand-reports
 * @desc List all on-demand reports the current user can run.
 * @access Private (Admin + Manager)
 */
router.get('/',
  authenticate as unknown as RequestHandler,
  listReports as unknown as RequestHandler,
);

/**
 * @route GET /api/on-demand-reports/:id
 * @desc Get metadata for a single report.
 * @access Private (Admin + Manager)
 */
router.get('/:id',
  authenticate as unknown as RequestHandler,
  getReport as unknown as RequestHandler,
);

/**
 * @route POST /api/on-demand-reports/:id/data
 * @desc Run a report for a date range and return paginated rows for in-browser viewing.
 * @access Private (Admin + Manager)
 */
router.post('/:id/data',
  authenticate as unknown as RequestHandler,
  getReportData as unknown as RequestHandler,
);

/**
 * @route POST /api/on-demand-reports/:id/download
 * @desc Run a report for a date range and stream it back as an xlsx file.
 * @access Private (Admin + Manager)
 */
router.post('/:id/download',
  authenticate as unknown as RequestHandler,
  downloadReport as unknown as RequestHandler,
);

/**
 * @route POST /api/on-demand-reports/:id/filter-options
 * @desc Return the available department / form / agent values for the
 *       requested period (cross-filtered by other current selections).
 * @access Private (Admin + Manager)
 */
router.post('/:id/filter-options',
  authenticate as unknown as RequestHandler,
  getFilterOptions as unknown as RequestHandler,
);

export default router;

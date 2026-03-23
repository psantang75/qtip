import { Router, RequestHandler, Request, Response, NextFunction } from 'express';
import { authenticate, authorizeAdmin } from '../middleware/auth';
import {
  getReportsHandler,
  getNavReportsHandler,
  getReportByIdHandler,
  createReportHandler,
  updateReportHandler,
  deleteReportHandler,
  duplicateReportHandler,
} from '../controllers/reportController';

const router = Router();

/** Require Director or Admin role. */
const authorizeDirectorOrAdmin = (req: Request, res: Response, next: NextFunction): void => {
  const role = (req as any).user?.role;
  if (role === 'Admin' || role === 'Director') return next();
  res.status(403).json({ error: 'FORBIDDEN', message: 'Director or Admin role required' });
};

// GET /api/reports — all authenticated users
router.get('/',
  authenticate as unknown as RequestHandler,
  getReportsHandler as unknown as RequestHandler,
);

// GET /api/reports/nav — all authenticated users
router.get('/nav',
  authenticate as unknown as RequestHandler,
  getNavReportsHandler as unknown as RequestHandler,
);

// GET /api/reports/:id — all authenticated users
router.get('/:id',
  authenticate as unknown as RequestHandler,
  getReportByIdHandler as unknown as RequestHandler,
);

// POST /api/reports — Director or Admin
router.post('/',
  authenticate as unknown as RequestHandler,
  authorizeDirectorOrAdmin as unknown as RequestHandler,
  createReportHandler as unknown as RequestHandler,
);

// PUT /api/reports/:id — Director or Admin
router.put('/:id',
  authenticate as unknown as RequestHandler,
  authorizeDirectorOrAdmin as unknown as RequestHandler,
  updateReportHandler as unknown as RequestHandler,
);

// DELETE /api/reports/:id — Admin only
router.delete('/:id',
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  deleteReportHandler as unknown as RequestHandler,
);

// POST /api/reports/:id/duplicate — Director or Admin
router.post('/:id/duplicate',
  authenticate as unknown as RequestHandler,
  authorizeDirectorOrAdmin as unknown as RequestHandler,
  duplicateReportHandler as unknown as RequestHandler,
);

export default router;

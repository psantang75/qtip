import { Router, RequestHandler } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getTablesHandler,
  getSchemaHandler,
  queryDataHandler,
  exportDataHandler,
} from '../controllers/rawDataController';

const router = Router();

// GET /api/raw-data/tables — authenticated, all roles
router.get('/tables',
  authenticate as unknown as RequestHandler,
  getTablesHandler as unknown as RequestHandler,
);

// GET /api/raw-data/:table/schema — authenticated, all roles
router.get('/:table/schema',
  authenticate as unknown as RequestHandler,
  getSchemaHandler as unknown as RequestHandler,
);

// POST /api/raw-data/:table/query — authenticated, role-scoped in service
router.post('/:table/query',
  authenticate as unknown as RequestHandler,
  queryDataHandler as unknown as RequestHandler,
);

// POST /api/raw-data/:table/export — authenticated, role-scoped in service
router.post('/:table/export',
  authenticate as unknown as RequestHandler,
  exportDataHandler as unknown as RequestHandler,
);

export default router;

import express, { Request, Response, RequestHandler } from 'express';
import prisma from '../config/prisma';
import { authenticate } from '../middleware/auth';

const router = express.Router();

// Protect all role routes with authentication
router.use(authenticate as unknown as RequestHandler);

/**
 * Get all roles
 * Simple service-based implementation replacing controller
 */
const getRolesHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    console.log('[ROLE SERVICE] Getting all roles');

    const rows = await prisma.role.findMany({
      orderBy: { role_name: 'asc' },
      select: { id: true, role_name: true }
    });

    const roles = rows.map(row => ({
      id: row.id,
      role_name: row.role_name,
      description: null,
      permissions: [],
      created_at: null,
      updated_at: null
    }));

    console.log(`[ROLE SERVICE] Found ${roles.length} roles`);
    res.status(200).json({ data: roles, total: roles.length });
  } catch (error) {
    console.error('[ROLE SERVICE] Error fetching roles:', error);
    res.status(500).json({ 
      message: 'Failed to fetch roles',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Internal server error'
    });
  }
};

/**
 * @route GET /api/roles
 * @desc Get all active roles
 * @access Public (for testing)
 */
router.get('/', getRolesHandler as unknown as RequestHandler);

export default router;

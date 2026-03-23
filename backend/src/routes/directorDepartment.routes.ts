import { Router, RequestHandler } from 'express';
import {
  getDirectorDepartments,
  getDirectorDepartmentsById,
  createDirectorDepartment,
  createBulkDirectorDepartments,
  deleteDirectorDepartment
} from '../controllers/directorDepartment.controller';
import { authenticate } from '../middleware/auth';
import { authorizeAdmin } from '../middleware/auth';

const router = Router();

// Test route to verify the router is mounted
router.get('/test', (req, res) => {
  res.json({ message: 'Director department routes are working!' });
});

// Get all director-department assignments with pagination and filters
router.get('/',
  authenticate as unknown as RequestHandler,
  getDirectorDepartments as unknown as RequestHandler
);

// Get assignments for a specific director
router.get('/:directorId',
  authenticate as unknown as RequestHandler,
  getDirectorDepartmentsById as unknown as RequestHandler
);

// Create a new director-department assignment - admin only
router.post('/',
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  createDirectorDepartment as unknown as RequestHandler
);

// Create multiple director-department assignments - admin only
router.post('/bulk',
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  createBulkDirectorDepartments as unknown as RequestHandler
);

// Delete a director-department assignment - admin only
router.delete('/:id',
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  deleteDirectorDepartment as unknown as RequestHandler
);

export default router; 
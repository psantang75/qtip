import { Router, RequestHandler } from 'express';
import { authenticate } from '../middleware/auth';
import { authorizeAdmin } from '../middleware/auth';
import { 
  createDepartment,
  getDepartments,
  getDepartmentById,
  updateDepartment,
  toggleDepartmentStatus,
  deleteDepartment,
  assignUsers,
  getAssignableUsers,
  getDepartmentDescendants
} from '../controllers/department.controller';

const router = Router();

// Routes using the controller

// Get all departments — authenticated users only
router.get('/',
  authenticate as unknown as RequestHandler,
  getDepartments as unknown as RequestHandler
);

// Get users eligible for assignment to departments
router.get('/users/assignable', 
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  getAssignableUsers as unknown as RequestHandler
);

// Get descendant IDs for circular reference prevention
router.get('/:id/descendants',
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  getDepartmentDescendants as unknown as RequestHandler
);

// Get a single department — authenticated users only
router.get('/:id',
  authenticate as unknown as RequestHandler,
  getDepartmentById as unknown as RequestHandler
);

// Create a new department - admin only
router.post('/', 
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  createDepartment as unknown as RequestHandler
);

// Update a department - admin only
router.put('/:id', 
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  updateDepartment as unknown as RequestHandler
);

// Toggle department status - admin only
router.put('/:id/status', 
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  toggleDepartmentStatus as unknown as RequestHandler
);

// Delete a department - admin only
router.delete('/:id', 
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  deleteDepartment as unknown as RequestHandler
);

// Assign users to a department - admin only
router.post('/:id/users', 
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  assignUsers as unknown as RequestHandler
);

export default router; 
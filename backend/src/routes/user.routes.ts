import express, { RequestHandler } from 'express';
import { authenticate } from '../middleware/auth';
import { 
  getUsers, 
  getUserById, 
  createUser, 
  updateUser, 
  deleteUser, 
  toggleUserStatus, 
  changePassword,
  getManagers, 
  getDirectors 
} from '../controllers/user.controller';

const router = express.Router();

// Protect all user management routes with authentication only
router.use(authenticate as unknown as RequestHandler);

// User management routes
router.get('/', getUsers as unknown as RequestHandler);
router.get('/managers', getManagers as unknown as RequestHandler);
router.get('/directors', getDirectors as unknown as RequestHandler);
router.get('/:id', getUserById as unknown as RequestHandler);
router.post('/', createUser as unknown as RequestHandler);
router.put('/change-password', changePassword as unknown as RequestHandler);
router.put('/:id', updateUser as unknown as RequestHandler);
router.put('/:id/status', toggleUserStatus as unknown as RequestHandler);
router.delete('/:id', deleteUser as unknown as RequestHandler);

export default router; 
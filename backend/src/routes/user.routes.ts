import express from 'express';
import { authenticate, authorizeAdmin } from '../middleware/auth';
import { rh } from '../utils/routeHandler';
import { 
  getUsers, 
  getUserById, 
  createUser, 
  updateUser, 
  deleteUser, 
  toggleUserStatus, 
  changePassword,
  getManagers, 
  getDirectors,
  getMyDepartments,
} from '../controllers/user.controller';

const router = express.Router();

// All user routes require authentication
router.use(rh(authenticate));

// Read routes — all authenticated users
router.get('/',                rh(getUsers));
router.get('/managers',        rh(getManagers));
router.get('/directors',       rh(getDirectors));
router.get('/my-departments',  rh(getMyDepartments));
router.get('/:id',             rh(getUserById));

// Self-service — any authenticated user can change their own password
router.put('/change-password', rh(changePassword));

// Write routes — Admin only
router.post('/',               rh(authorizeAdmin), rh(createUser));
router.put('/:id',             rh(authorizeAdmin), rh(updateUser));
router.put('/:id/status',      rh(authorizeAdmin), rh(toggleUserStatus));
router.delete('/:id',          rh(authorizeAdmin), rh(deleteUser));

export default router; 
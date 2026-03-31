import express, { RequestHandler } from 'express';
import { authenticate, authorizeAdmin } from '../middleware/auth';
import {
  getListItems, createListItem, updateListItem,
  toggleListItemStatus, reorderListItems, deleteListItem,
} from '../controllers/list.controller';

const router = express.Router();
const auth  = authenticate as unknown as RequestHandler;
const admin = authorizeAdmin as unknown as RequestHandler;

// Public read (authenticated) — form pages need to fetch lists
router.get('/', auth, getListItems as unknown as RequestHandler);

// Admin-only write
router.post('/',               auth, admin, createListItem      as unknown as RequestHandler);
router.put('/:id',             auth, admin, updateListItem      as unknown as RequestHandler);
router.patch('/:id/status',    auth, admin, toggleListItemStatus as unknown as RequestHandler);
router.delete('/:id',          auth, admin, deleteListItem       as unknown as RequestHandler);
router.post('/reorder',        auth, admin, reorderListItems    as unknown as RequestHandler);

export default router;

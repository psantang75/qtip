import { Router, RequestHandler } from 'express';
import { authenticate } from '../middleware/auth';
import { authorizeAdmin } from '../middleware/auth';
import {
  getTopics,
  getTopicById,
  createTopic,
  updateTopic,
  toggleTopicStatus,
  updateSortOrder
} from '../controllers/topic.controller';

const router = Router();

// Get all topics with pagination and filtering
router.get('/', getTopics as unknown as RequestHandler);

// Get a single topic by ID
router.get('/:id', getTopicById as unknown as RequestHandler);

// Create a new topic - admin only
router.post('/',
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  createTopic as unknown as RequestHandler
);

// Update a topic - admin only
router.put('/:id',
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  updateTopic as unknown as RequestHandler
);

// Toggle topic status - admin only
router.put('/:id/status',
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  toggleTopicStatus as unknown as RequestHandler
);

// Update sort order for multiple topics - admin only
router.put('/sort-order',
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
  updateSortOrder as unknown as RequestHandler
);

export default router;

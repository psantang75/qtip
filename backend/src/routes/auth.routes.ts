import express, { RequestHandler } from 'express';
import { login, validateToken, refreshToken, logout, getSessionStatus } from '../controllers/auth.controller';

const router = express.Router();

// Public routes
router.post('/login', login as unknown as RequestHandler);
router.post('/logout', logout as unknown as RequestHandler);

// Authentication endpoints
router.post('/validate-token', validateToken as unknown as RequestHandler);
router.post('/refresh-token', refreshToken as unknown as RequestHandler);
router.get('/session-status', getSessionStatus as unknown as RequestHandler);

export default router; 
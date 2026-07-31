/**
 * Error-mapping helper shared by every scheduling controller. Translates
 * ScheduleServiceError into the documented `{ success: false, message }`
 * envelope at its status code; anything else is a redacted 500.
 *
 * ScheduleServiceError carries a `.code` (e.g. CONFIRM_ELAPSED, OVERLAP, LOCKED)
 * so the client can branch — those are forwarded alongside the message.
 */
import { Response } from 'express';
import { ScheduleServiceError } from '../../services/scheduling';
import logger from '../../config/logger';

export function respondWithError(res: Response, label: string, error: unknown): Response {
  if (error instanceof ScheduleServiceError) {
    return res.status(error.statusCode).json({ success: false, message: error.message, code: error.code });
  }
  logger.error(`[SCHEDULING] ${label} error:`, error);
  return res.status(500).json({ success: false, message: 'Internal server error' });
}

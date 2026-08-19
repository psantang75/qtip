import express, { RequestHandler } from 'express';
import { authenticate, authorizeAdmin } from '../middleware/auth';
import emailTemplatesController from '../controllers/admin/emailTemplates.controller';

/**
 * Admin routes.
 *
 * The legacy admin dashboard/coaching endpoints (`/stats`, `/csr-activity`,
 * `/completed-forms*`, `/coaching-sessions*`, `/csrs`) were removed as dead code:
 * their only frontend caller (`services/adminService.ts`) was orphaned, and the
 * Training → Coaching area now serves every role via `/api/trainer/*`
 * (`coaching.controller.ts`) instead. Email templates are the only live admin
 * feature that still lives here.
 */
const router = express.Router();

const adminAuth = [
  authenticate as unknown as RequestHandler,
  authorizeAdmin as unknown as RequestHandler,
];

// Email templates admin endpoints. All require Admin.
router.get('/email-templates',                ...adminAuth, emailTemplatesController.listTemplates    as unknown as RequestHandler);
router.get('/email-templates/_health',        ...adminAuth, emailTemplatesController.getEmailHealth   as unknown as RequestHandler);
router.get('/email-templates/_recent-sends',  ...adminAuth, emailTemplatesController.getRecentSends   as unknown as RequestHandler);
router.post('/email-templates/_resend/:logId',...adminAuth, emailTemplatesController.resendLogged     as unknown as RequestHandler);
router.get('/email-templates/_queue',         ...adminAuth, emailTemplatesController.getQueue        as unknown as RequestHandler);
router.post('/email-templates/_queue/discard',...adminAuth, emailTemplatesController.discardQueued   as unknown as RequestHandler);
router.get('/email-templates/:id',            ...adminAuth, emailTemplatesController.getTemplate      as unknown as RequestHandler);
router.put('/email-templates/:id',            ...adminAuth, emailTemplatesController.updateTemplate   as unknown as RequestHandler);
router.post('/email-templates/:id/preview',   ...adminAuth, emailTemplatesController.previewTemplate  as unknown as RequestHandler);
router.post('/email-templates/:id/test-send', ...adminAuth, emailTemplatesController.testSendTemplate as unknown as RequestHandler);
router.post('/email-templates/:id/reset',     ...adminAuth, emailTemplatesController.resetTemplate    as unknown as RequestHandler);
router.post('/email-templates/:id/rollback',  ...adminAuth, emailTemplatesController.rollbackTemplate as unknown as RequestHandler);

export default router;

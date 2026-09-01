import { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import {
  DisputeListItem,
  PaginatedResponse
} from '../types/dispute.types';
import { getDisputeScoreHistory } from '../utils/disputeScoreHistory';
import prisma from '../config/prisma';
import { Prisma, DisputeStatus as PrismaDisputeStatus, DisputeScoreHistoryType } from '../generated/prisma/client';
import logger from '../config/logger';
import cacheService from '../services/CacheService';
import { parsePagination } from '../validation/common';
import {
  asyncHandler,
  createValidationError,
  createNotFoundError,
  createAuthorizationError,
  AppError,
  ErrorType,
} from '../utils/errorHandler';
import { stripHtmlToPlaintext } from '../utils/htmlText';

// The dispute reason is authored in the TipTap rich-text editor, so the stored
// value is HTML. The 1000-character limit is a plain-text business rule, not a
// storage constraint (the column is TEXT), so it must be measured against the
// visible text — otherwise markup (<p>, <strong>, list items, entities) counts
// toward the cap and a normal-length reason is rejected. See stripHtmlToPlaintext.
// 5000 visible chars (~1 page) is generous for a substantive dispute; the column
// is TEXT so this is a business rule, not a storage limit.
const MAX_REASON_PLAINTEXT_LENGTH = 5000;

// These handlers throw `AppError` (rendered by the global error middleware as
// the canonical envelope) instead of the legacy `res.status(n).json({ message })`
// shape. Success payloads and status codes are unchanged, and the frontend's
// shared `getBackendMessage`/`getErrorMessage` already reads the `AppError`
// envelope, so the migration is transparent to callers.
const unauthorized = () => new AppError('Unauthorized', ErrorType.AUTHORIZATION_ERROR, 401);

// NOTE: getCSRAudits used to live here (mounted at GET /api/disputes/audits)
// but it was a parallel implementation of the same product feature served by
// csrAudit.controller.getCSRAudits at /api/csr/audits. The frontend never
// called this variant; it was removed during the pre-production review
// (item #13) so there is exactly one CSR-audit list contract.

/**
 * Get audit details for dispute submission
 * @route GET /api/disputes/audit/:submission_id
 */
export const getAuditDetails = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { submission_id } = req.params;
    const user_id = req.user?.user_id;

    if (!user_id) {
      throw unauthorized();
    }

    const submissionRows = await prisma.$queryRaw<any[]>`
      SELECT s.*, f.form_name
      FROM submissions s
      JOIN forms f ON s.form_id = f.id
      JOIN submission_metadata sm ON s.id = sm.submission_id
      JOIN form_metadata_fields fmf ON sm.field_id = fmf.id AND fmf.field_name = 'CSR'
      WHERE s.id = ${parseInt(submission_id)} AND sm.value = ${user_id.toString()}
    `;

    if (submissionRows.length === 0) {
      throw createNotFoundError('Audit not found or not accessible');
    }

    const callRows = await prisma.$queryRaw<{ transcript: string | null; audio_url: string | null }[]>`
      SELECT c.transcript, c.recording_url as audio_url
      FROM calls c
      JOIN submission_calls sc ON c.id = sc.call_id
      WHERE sc.submission_id = ${parseInt(submission_id)}
    `;

    const callData = callRows.length > 0 ? {
      transcript: callRows[0].transcript,
      audio_url: callRows[0].audio_url
    } : { transcript: null, audio_url: null };

    const disputeRows = await prisma.$queryRaw<{ id: number }[]>`
      SELECT id FROM disputes WHERE submission_id = ${parseInt(submission_id)}
    `;

    if (disputeRows.length > 0) {
      throw createValidationError('Audit already has an active dispute');
    }

    const answerRows = await prisma.$queryRaw<any[]>`
      SELECT
        sa.*,
        fq.question_text,
        fc.category_name
      FROM submission_answers sa
      JOIN form_questions fq ON sa.question_id = fq.id
      JOIN form_categories fc ON fq.category_id = fc.id
      WHERE sa.submission_id = ${parseInt(submission_id)}
    `;

    const submission = submissionRows[0];
    const answers = answerRows.map((row: any) => ({
      id: row.id,
      question_id: row.question_id,
      question_text: row.question_text,
      category_name: row.category_name,
      answer: row.answer,
      notes: row.notes
    }));

    res.status(200).json({
      submission_id: submission.id,
      form_id: submission.form_id,
      form_name: submission.form_name,
      score: submission.total_score,
      submitted_at: submission.submitted_at,
      transcript: callData.transcript,
      audio_url: callData.audio_url,
      answers
    });
});

/**
 * Submit a dispute for an audit
 * @route POST /api/disputes
 */
export const submitDispute = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const submission_id = parseInt(req.body.submission_id);
    const reason = req.body.reason;
    const attachment = req.file;

    const user_id = req.user?.user_id;

    if (!user_id) {
      throw unauthorized();
    }

    if (!submission_id || isNaN(submission_id)) {
      throw createValidationError('Valid submission_id is required');
    }

    if (!reason || reason.trim() === '') {
      throw createValidationError('Reason is required');
    }

    const submissionRows = await prisma.$queryRaw<{ id: number; status: string; total_score: any }[]>`
      SELECT s.id, s.status, s.total_score
      FROM submissions s
      JOIN submission_metadata sm ON s.id = sm.submission_id
      JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      WHERE s.id = ${submission_id} AND fmf.field_name = 'CSR' AND sm.value = ${user_id.toString()}
    `;

    if (submissionRows.length === 0) {
      throw createNotFoundError('Submission not found or not accessible');
    }

    const disputeRows = await prisma.$queryRaw<{ id: number }[]>`
      SELECT id FROM disputes WHERE submission_id = ${submission_id}
    `;

    if (disputeRows.length > 0) {
      throw createValidationError('Audit already has an active dispute');
    }

    if (stripHtmlToPlaintext(reason).length > MAX_REASON_PLAINTEXT_LENGTH) {
      throw createValidationError(`Dispute reason must be less than ${MAX_REASON_PLAINTEXT_LENGTH} characters`);
    }

    const attachmentUrl = attachment ? `/uploads/disputes/${attachment.filename}` : null;
    const previousScore = Number(submissionRows[0].total_score ?? 0);

    const dispute = await prisma.$transaction(async (tx) => {
      await tx.submission.update({ where: { id: submission_id }, data: { status: 'DISPUTED' } });

      const newDispute = await tx.dispute.create({
        data: {
          submission_id: submission_id,
          disputed_by: user_id,
          status: PrismaDisputeStatus.OPEN,
          reason,
          attachment_url: attachmentUrl
        }
      });

      await tx.disputeScoreHistory.create({
        data: {
          dispute_id: newDispute.id,
          submission_id: submission_id,
          score_type: DisputeScoreHistoryType.PREVIOUS,
          score: previousScore,
          recorded_by: user_id,
          notes: 'Score captured when dispute was created'
        }
      });

      await tx.auditLog.create({
        data: {
          user_id: user_id,
          action: 'Created dispute',
          target_id: newDispute.id,
          target_type: 'DISPUTE',
          details: JSON.stringify({
            submission_id: submission_id,
            reason: reason.substring(0, 100) + (reason.length > 100 ? '...' : '')
          })
        }
      });

      return newDispute;
    });

    // The review just moved SUBMITTED/FINALIZED -> DISPUTED. The reviewee's
    // audit list is cached in-memory (csr:audits:<id>:*), so without this the
    // list keeps showing the pre-dispute status until the 2-min TTL expires.
    cacheService.invalidateCSRCache(user_id);

    // Notify QA + manager. Wrapped so a mail failure can't break the dispute.
    try {
      const submissionFull = await prisma.submission.findUnique({
        where: { id: submission_id },
        include: { form: { select: { form_name: true, id: true } } },
      });
      const csr = await prisma.user.findUnique({
        where: { id: user_id }, select: { id: true, username: true, email: true },
      });
      const { default: notificationService } = await import('../services/notifications/NotificationService');
      await notificationService.notify(
        'dispute.opened',
        {
          form: submissionFull?.form ?? null,
          submission: { id: submission_id, total_score: previousScore },
          dispute: { reason, status: 'OPEN', created_at: new Date() },
          csr,
          originalScore: previousScore,
          originalQaId: submissionFull?.submitted_by ?? 0,
        },
        { entityType: 'dispute', entityId: dispute.id, deepLinkPath: `/app/quality/disputes` },
      );
    } catch (mailErr) {
      logger.warn('[dispute.opened] notify failed (dispute still saved)', mailErr);
    }

    res.status(201).json({
      message: 'Dispute submitted successfully',
      dispute_id: dispute.id
    });
});

/**
 * Get dispute history for the current CSR
 * @route GET /api/disputes/history
 * @route GET /api/csr/disputes/history
 */
export const getDisputeHistory = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const user_id = req.user?.user_id;
    // `parsePagination` reads the `perPage`/`limit` aliases and applies the
    // shared `MAX_PAGE_SIZE` cap (pre-production review item #40).
    const { page, limit: perPage, skip: offset } = parsePagination(req.query, { defaultLimit: 10 });

    const start_date = req.query.start_date as string;
    const end_date = req.query.end_date as string;
    const form_id = req.query.form_id ? parseInt(req.query.form_id as string) : null;
    const status = req.query.status as string;
    const searchTerm = req.query.searchTerm as string;

    const conditions: Prisma.Sql[] = [Prisma.sql`d.disputed_by = ${user_id}`];

    if (status && status !== '') conditions.push(Prisma.sql`d.status = ${status}`);
    if (start_date) conditions.push(Prisma.sql`DATE(d.created_at) >= ${start_date}`);
    if (end_date) conditions.push(Prisma.sql`DATE(d.created_at) <= ${end_date}`);
    if (form_id) conditions.push(Prisma.sql`s.form_id = ${form_id}`);
    if (searchTerm && searchTerm !== '') {
      conditions.push(Prisma.sql`(d.id LIKE ${'%' + searchTerm + '%'} OR f.form_name LIKE ${'%' + searchTerm + '%'})`);
    }

    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    const [countResult, rows] = await Promise.all([
      prisma.$queryRaw<{ total: bigint }[]>`
        SELECT COUNT(*) as total
        FROM disputes d
        JOIN submissions s ON d.submission_id = s.id
        JOIN forms f ON s.form_id = f.id
        ${whereClause}
      `,
      prisma.$queryRaw<any[]>`
        SELECT
          d.id as dispute_id,
          d.submission_id as audit_id,
          f.form_name,
          s.total_score as score,
          (
            SELECT dsh.score
            FROM dispute_score_history dsh
            WHERE dsh.dispute_id = d.id AND dsh.score_type = 'PREVIOUS'
            ORDER BY dsh.created_at ASC, dsh.id ASC
            LIMIT 1
          ) as previous_score,
          (
            SELECT dsh.score
            FROM dispute_score_history dsh
            WHERE dsh.dispute_id = d.id AND dsh.score_type = 'ADJUSTED'
            ORDER BY dsh.created_at DESC, dsh.id DESC
            LIMIT 1
          ) as adjusted_score,
          d.status,
          d.created_at,
          d.resolution_notes
        FROM disputes d
        JOIN submissions s ON d.submission_id = s.id
        JOIN forms f ON s.form_id = f.id
        ${whereClause}
        ORDER BY d.created_at DESC
        LIMIT ${Number(perPage)} OFFSET ${Number(offset)}
      `
    ]);

    const total = Number(countResult[0].total);
    const totalPages = Math.ceil(total / perPage);

    const disputes: DisputeListItem[] = rows.map((row: any) => ({
      dispute_id: row.dispute_id,
      audit_id: row.audit_id,
      form_name: row.form_name,
      score: row.score,
      previous_score: row.previous_score,
      adjusted_score: row.adjusted_score,
      status: row.status,
      created_at: row.created_at,
      resolution_notes: row.resolution_notes
    }));

    const response: PaginatedResponse<DisputeListItem> = { data: disputes, total, page, perPage, totalPages };
    res.status(200).json(response);
});

/**
 * Get dispute details by ID
 * @route GET /api/disputes/:disputeId
 */
export const getDisputeDetails = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { disputeId } = req.params;
    const user_id = req.user?.user_id;

    const rows = await prisma.$queryRaw<any[]>`
      SELECT
        d.*,
        s.total_score as score,
        s.submitted_at,
        f.form_name,
        u.username as resolved_by_name
      FROM disputes d
      JOIN submissions s ON d.submission_id = s.id
      JOIN forms f ON s.form_id = f.id
      LEFT JOIN users u ON d.resolved_by = u.id
      WHERE d.id = ${parseInt(disputeId)} AND (d.disputed_by = ${user_id} OR ${user_id} IN (
        SELECT u2.id FROM users u2
        JOIN roles r ON u2.role_id = r.id
        WHERE r.role_name IN ('Admin', 'QA', 'Manager', 'Director')
      ))
    `;

    if (rows.length === 0) {
      throw createNotFoundError('Dispute not found or not accessible');
    }

    const dispute = rows[0];
    const scoreHistory = await getDisputeScoreHistory(null, Number(dispute.id));
    const previousScore =
      scoreHistory.find((entry) => entry.score_type === 'PREVIOUS')?.score ?? null;
    const adjustedScore =
      [...scoreHistory].reverse().find((entry) => entry.score_type === 'ADJUSTED')?.score ?? null;

    res.status(200).json({
      id: dispute.id,
      submission_id: dispute.submission_id,
      score: dispute.score,
      previous_score: previousScore,
      adjusted_score: adjustedScore,
      submitted_at: dispute.submitted_at,
      form_name: dispute.form_name,
      disputed_by: dispute.disputed_by,
      resolved_by: dispute.resolved_by,
      resolved_by_name: dispute.resolved_by_name,
      created_at: dispute.created_at,
      resolved_at: dispute.resolved_at,
      status: dispute.status,
      reason: dispute.reason,
      resolution_notes: dispute.resolution_notes,
      attachment_url: dispute.attachment_url,
      score_history: scoreHistory
    });
});

/**
 * Update a dispute (reason and/or attachment)
 * @route PUT /api/disputes/:disputeId
 */
export const updateDispute = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  let newAttachmentPath: string | null = null;
  let oldAttachmentPath: string | null = null;

  const cleanupNewFile = () => {
    if (newAttachmentPath && fs.existsSync(newAttachmentPath)) {
      try {
        fs.unlinkSync(newAttachmentPath);
      } catch (error) {
        logger.error('Error cleaning up uploaded file:', error);
      }
    }
  };

  try {
    const { disputeId } = req.params;
    const reason = req.body.reason;
    const attachment = req.file;
    const user_id = req.user?.user_id;

    if (attachment) {
      newAttachmentPath = path.join(process.cwd(), 'uploads', 'disputes', attachment.filename);
    }

    if (!user_id) {
      throw unauthorized();
    }

    if (!disputeId || isNaN(Number(disputeId))) {
      throw createValidationError('Valid dispute ID is required');
    }

    if (reason && stripHtmlToPlaintext(reason).length > MAX_REASON_PLAINTEXT_LENGTH) {
      throw createValidationError(`Dispute reason must be less than ${MAX_REASON_PLAINTEXT_LENGTH} characters`);
    }

    const disputeRows = await prisma.dispute.findFirst({
      where: {
        id: parseInt(disputeId),
        disputed_by: user_id,
        status: 'OPEN',
        resolved_by: null
      },
      select: { id: true, attachment_url: true, disputed_by: true }
    });

    if (!disputeRows) {
      throw createNotFoundError('Dispute not found, not accessible, or cannot be edited');
    }

    const hasReasonUpdate = reason !== undefined;
    const hasAttachmentUpdate = !!attachment;

    if (!hasReasonUpdate && !hasAttachmentUpdate) {
      throw createValidationError('At least one field (reason or attachment) must be provided for update');
    }

    let reasonUpdated = false;
    let attachmentUpdated = false;

    if (hasReasonUpdate) {
      if (!reason || reason.trim() === '') {
        throw createValidationError('Reason cannot be empty');
      }
    }

    if (hasAttachmentUpdate && disputeRows.attachment_url) {
      oldAttachmentPath = disputeRows.attachment_url.startsWith('/')
        ? path.join(process.cwd(), disputeRows.attachment_url.substring(1))
        : path.join(process.cwd(), disputeRows.attachment_url);
    }

    await prisma.$transaction(async (tx) => {
      if (hasReasonUpdate) {
        await tx.dispute.update({
          where: { id: parseInt(disputeId) },
          data: { reason }
        });
        reasonUpdated = true;
      }

      if (hasAttachmentUpdate) {
        const attachmentUrl = `/uploads/disputes/${attachment!.filename}`;
        await tx.dispute.update({
          where: { id: parseInt(disputeId) },
          data: { attachment_url: attachmentUrl }
        });
        attachmentUpdated = true;
      }

      await tx.auditLog.create({
        data: {
          user_id: user_id,
          action: 'Updated dispute',
          target_id: parseInt(disputeId),
          target_type: 'DISPUTE',
          details: JSON.stringify({ reason_updated: reasonUpdated, attachment_updated: attachmentUpdated })
        }
      });
    });

    newAttachmentPath = null;

    if (oldAttachmentPath && fs.existsSync(oldAttachmentPath)) {
      try {
        fs.unlinkSync(oldAttachmentPath);
      } catch (error) {
        logger.error('Error deleting old attachment after commit:', error);
      }
    }

    res.status(200).json({ message: 'Dispute updated successfully' });
  } catch (error) {
    // Preserve the file-cleanup guarantee for every failure path (validation
    // throws included), then let the global handler render the envelope.
    cleanupNewFile();
    throw error;
  }
});

/**
 * Download dispute attachment
 * @route GET /api/disputes/:disputeId/attachment
 */
export const downloadDisputeAttachment = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const disputeId = parseInt(req.params.disputeId);
  const user_id = req.user?.user_id;

  if (!user_id) {
    throw unauthorized();
  }

  if (!disputeId || isNaN(disputeId)) {
    throw createValidationError('Invalid dispute ID');
  }

  const disputes = await prisma.$queryRaw<{ attachment_url: string | null; disputed_by: number; submitted_by: number }[]>`
    SELECT d.attachment_url, d.disputed_by, s.submitted_by
    FROM disputes d
    JOIN submissions s ON d.submission_id = s.id
    WHERE d.id = ${disputeId}
  `;

  if (disputes.length === 0) {
    throw createNotFoundError('Dispute not found');
  }

  const dispute = disputes[0];

  const userRole = req.user?.role;
  const isCSR = dispute.disputed_by === user_id;
  const isQAReviewer = dispute.submitted_by === user_id;
  const isManager = userRole === 'Manager';
  const isAdmin = userRole === 'Admin';
  const isTrainer = userRole === 'Trainer';

  if (!isCSR && !isQAReviewer && !isManager && !isAdmin && !isTrainer) {
    throw createAuthorizationError('Access denied');
  }

  if (!dispute.attachment_url) {
    throw createNotFoundError('No attachment found for this dispute');
  }

  const filePath = dispute.attachment_url.startsWith('/')
    ? path.join(process.cwd(), dispute.attachment_url.substring(1))
    : path.join(process.cwd(), dispute.attachment_url);

  if (!fs.existsSync(filePath)) {
    throw createNotFoundError('Attachment file not found on server');
  }

  const fileName = path.basename(filePath);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Type', 'application/octet-stream');

  const fileStream = fs.createReadStream(filePath);

  // Stream errors happen mid-response (headers likely already flushed), so the
  // global envelope can't help here — keep the direct terminal 500.
  fileStream.on('error', () => {
    if (!res.headersSent) {
      res.status(500).json({ message: 'Error reading attachment file' });
    }
  });

  fileStream.pipe(res);
});

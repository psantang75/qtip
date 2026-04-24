import { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import {
  CreateDisputeDTO,
  DisputeListItem,
  DisputeStatus,
  PaginatedResponse
} from '../types/dispute.types';
import { getDisputeScoreHistory, recordDisputeScore } from '../utils/disputeScoreHistory';
import prisma from '../config/prisma';
import { Prisma, DisputeStatus as PrismaDisputeStatus, DisputeScoreHistoryType } from '../generated/prisma/client';

// NOTE: getCSRAudits used to live here (mounted at GET /api/disputes/audits)
// but it was a parallel implementation of the same product feature served by
// csrAudit.controller.getCSRAudits at /api/csr/audits. The frontend never
// called this variant; it was removed during the pre-production review
// (item #13) so there is exactly one CSR-audit list contract.

/**
 * Get audit details for dispute submission
 * @route GET /api/disputes/audit/:submission_id
 */
export const getAuditDetails = async (req: Request, res: Response): Promise<void> => {
  try {
    const { submission_id } = req.params;
    const user_id = req.user?.user_id;

    if (!user_id) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
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
      res.status(404).json({ message: 'Audit not found or not accessible' });
      return;
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
      res.status(400).json({ message: 'Audit already has an active dispute' });
      return;
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
  } catch (error) {
    console.error('Error fetching audit details:', error);
    res.status(500).json({ message: 'Failed to retrieve audit details' });
  }
};

/**
 * Submit a dispute for an audit
 * @route POST /api/disputes
 */
export const submitDispute = async (req: Request, res: Response): Promise<void> => {
  try {
    const submission_id = parseInt(req.body.submission_id);
    const reason = req.body.reason;
    const attachment = req.file;

    const user_id = req.user?.user_id;

    if (!user_id) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    if (!submission_id || isNaN(submission_id)) {
      res.status(400).json({ message: 'Valid submission_id is required' });
      return;
    }

    if (!reason || reason.trim() === '') {
      res.status(400).json({ message: 'Reason is required' });
      return;
    }

    const submissionRows = await prisma.$queryRaw<{ id: number; status: string; total_score: any }[]>`
      SELECT s.id, s.status, s.total_score
      FROM submissions s
      JOIN submission_metadata sm ON s.id = sm.submission_id
      JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      WHERE s.id = ${submission_id} AND fmf.field_name = 'CSR' AND sm.value = ${user_id.toString()}
    `;

    if (submissionRows.length === 0) {
      res.status(404).json({ message: 'Submission not found or not accessible' });
      return;
    }

    const disputeRows = await prisma.$queryRaw<{ id: number }[]>`
      SELECT id FROM disputes WHERE submission_id = ${submission_id}
    `;

    if (disputeRows.length > 0) {
      res.status(400).json({ message: 'Audit already has an active dispute' });
      return;
    }

    if (reason.length > 1000) {
      res.status(400).json({ message: 'Dispute reason must be less than 1000 characters' });
      return;
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

    res.status(201).json({
      message: 'Dispute submitted successfully',
      dispute_id: dispute.id
    });
  } catch (error) {
    console.error('Error submitting dispute:', error);
    res.status(500).json({ message: 'Failed to submit dispute' });
  }
};

/**
 * Get dispute history for the current CSR
 * @route GET /api/disputes/history
 * @route GET /api/csr/disputes/history
 */
export const getDisputeHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const user_id = req.user?.user_id;
    const page = parseInt(req.query.page as string) || 1;
    // Cap matches `MAX_PAGE_SIZE` in `validation/common.ts`. See item #40
    // of the pre-production review for the reasoning behind the 1,000 cap.
    const perPage = Math.min(1000, parseInt(req.query.perPage as string) || parseInt(req.query.limit as string) || 10);
    const offset = (page - 1) * perPage;

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
  } catch (error) {
    console.error('Error fetching dispute history:', error);
    res.status(500).json({ message: 'Failed to retrieve dispute history' });
  }
};

/**
 * Get dispute details by ID
 * @route GET /api/disputes/:disputeId
 */
export const getDisputeDetails = async (req: Request, res: Response): Promise<void> => {
  try {
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
      res.status(404).json({ message: 'Dispute not found or not accessible' });
      return;
    }

    const dispute = rows[0];
    const scoreHistory = await getDisputeScoreHistory(null, Number(dispute.id));
    const previousScore =
      scoreHistory.find((entry) => entry.score_type === 'PREVIOUS')?.score ?? null;
    const adjustedScore =
      [...scoreHistory].reverse().find((entry) => entry.score_type === 'ADJUSTED')?.score ?? null;

    console.log('Dispute details for ID', disputeId, ':', {
      id: dispute.id,
      attachment_url: dispute.attachment_url,
      has_attachment_url: !!dispute.attachment_url
    });

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
  } catch (error) {
    console.error('Error fetching dispute details:', error);
    res.status(500).json({ message: 'Failed to retrieve dispute details' });
  }
};

/**
 * Update a dispute (reason and/or attachment)
 * @route PUT /api/disputes/:disputeId
 */
export const updateDispute = async (req: Request, res: Response): Promise<void> => {
  let newAttachmentPath: string | null = null;
  let oldAttachmentPath: string | null = null;

  const cleanupNewFile = () => {
    if (newAttachmentPath && fs.existsSync(newAttachmentPath)) {
      try {
        fs.unlinkSync(newAttachmentPath);
      } catch (error) {
        console.error('Error cleaning up uploaded file:', error);
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
      cleanupNewFile();
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    if (!disputeId || isNaN(Number(disputeId))) {
      cleanupNewFile();
      res.status(400).json({ message: 'Valid dispute ID is required' });
      return;
    }

    if (reason && reason.length > 1000) {
      cleanupNewFile();
      res.status(400).json({ message: 'Dispute reason must be less than 1000 characters' });
      return;
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
      cleanupNewFile();
      res.status(404).json({ message: 'Dispute not found, not accessible, or cannot be edited' });
      return;
    }

    const hasReasonUpdate = reason !== undefined;
    const hasAttachmentUpdate = !!attachment;

    if (!hasReasonUpdate && !hasAttachmentUpdate) {
      cleanupNewFile();
      res.status(400).json({
        message: 'At least one field (reason or attachment) must be provided for update'
      });
      return;
    }

    let reasonUpdated = false;
    let attachmentUpdated = false;

    if (hasReasonUpdate) {
      if (!reason || reason.trim() === '') {
        cleanupNewFile();
        res.status(400).json({ message: 'Reason cannot be empty' });
        return;
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
        console.error('Error deleting old attachment after commit:', error);
      }
    }

    res.status(200).json({ message: 'Dispute updated successfully' });
  } catch (error) {
    cleanupNewFile();
    console.error('Error updating dispute:', error);
    res.status(500).json({ message: 'Failed to update dispute' });
  }
};

/**
 * Download dispute attachment
 * @route GET /api/disputes/:disputeId/attachment
 */
export const downloadDisputeAttachment = async (req: Request, res: Response): Promise<void> => {
  try {
    const disputeId = parseInt(req.params.disputeId);
    const user_id = req.user?.user_id;

    if (!user_id) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    if (!disputeId || isNaN(disputeId)) {
      res.status(400).json({ message: 'Invalid dispute ID' });
      return;
    }

    const disputes = await prisma.$queryRaw<{ attachment_url: string | null; disputed_by: number; submitted_by: number }[]>`
      SELECT d.attachment_url, d.disputed_by, s.submitted_by
      FROM disputes d
      JOIN submissions s ON d.submission_id = s.id
      WHERE d.id = ${disputeId}
    `;

    if (disputes.length === 0) {
      res.status(404).json({ message: 'Dispute not found' });
      return;
    }

    const dispute = disputes[0];

    const userRole = req.user?.role;
    const isCSR = dispute.disputed_by === user_id;
    const isQAReviewer = dispute.submitted_by === user_id;
    const isManager = userRole === 'Manager';
    const isAdmin = userRole === 'Admin';
    const isTrainer = userRole === 'Trainer';

    if (!isCSR && !isQAReviewer && !isManager && !isAdmin && !isTrainer) {
      res.status(403).json({ message: 'Access denied' });
      return;
    }

    if (!dispute.attachment_url) {
      res.status(404).json({ message: 'No attachment found for this dispute' });
      return;
    }

    const filePath = dispute.attachment_url.startsWith('/')
      ? path.join(process.cwd(), dispute.attachment_url.substring(1))
      : path.join(process.cwd(), dispute.attachment_url);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ message: 'Attachment file not found on server' });
      return;
    }

    const fileName = path.basename(filePath);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    const fileStream = fs.createReadStream(filePath);

    fileStream.on('error', () => {
      if (!res.headersSent) {
        res.status(500).json({ message: 'Error reading attachment file' });
      }
    });

    fileStream.pipe(res);
  } catch (error) {
    console.error('Error downloading dispute attachment:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Failed to download attachment' });
    }
  }
};

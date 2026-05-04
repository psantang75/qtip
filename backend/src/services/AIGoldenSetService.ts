/**
 * AIGoldenSetService
 *
 * Read + write API for ai_golden_set rows. Auto-seeded by
 * AIGoldenSetSeeder; manual entries come from the "Mark as golden"
 * button on the submission detail page. The eval runner consumes the
 * "active set" (non-archived rows) for a form.
 */

import prisma from '../config/prisma';
import logger from '../config/logger';

export class AIGoldenSetServiceError extends Error {
  constructor(message: string, public code: string, public statusCode: number = 400) {
    super(message);
    this.name = 'AIGoldenSetServiceError';
  }
}

export interface GoldenSetRow {
  id: number;
  form_id: number;
  submission_id: number;
  source: 'auto_seed' | 'manual';
  marked_by: number | null;
  marked_at: Date;
  notes: string | null;
  archived_at: Date | null;
}

export interface GoldenSetWithMeta extends GoldenSetRow {
  total_score: number | null;
  ai_overall_confidence: number | null;
  submitted_at: Date | null;
  ticket_id: number | null;
}

class AIGoldenSetService {
  /**
   * Active golden set for a form (non-archived rows, newest first),
   * enriched with the submission's score and ticket reference so the
   * UI can render a useful list without N+1 queries.
   */
  async getActiveSet(formId: number): Promise<GoldenSetWithMeta[]> {
    if (!Number.isInteger(formId) || formId <= 0) {
      throw new AIGoldenSetServiceError('Invalid form id', 'INVALID_FORM_ID', 400);
    }
    const rows = await prisma.aiGoldenSet.findMany({
      where: { form_id: formId, archived_at: null },
      orderBy: { marked_at: 'desc' },
    });
    if (rows.length === 0) return [];
    const submissionIds = rows.map((r) => r.submission_id);
    const submissions = await prisma.submission.findMany({
      where: { id: { in: submissionIds } },
      select: {
        id: true,
        total_score: true,
        ai_overall_confidence: true,
        submitted_at: true,
        submission_ticket_tasks: { select: { external_id: true } },
      },
    });
    const byId = new Map(submissions.map((s) => [s.id, s]));
    return rows.map((r) => {
      const s = byId.get(r.submission_id);
      return {
        id: r.id,
        form_id: r.form_id,
        submission_id: r.submission_id,
        source: r.source as 'auto_seed' | 'manual',
        marked_by: r.marked_by,
        marked_at: r.marked_at,
        notes: r.notes,
        archived_at: r.archived_at,
        total_score: s?.total_score != null ? Number(s.total_score) : null,
        ai_overall_confidence: s?.ai_overall_confidence != null ? Number(s.ai_overall_confidence) : null,
        submitted_at: s?.submitted_at ?? null,
        ticket_id: s?.submission_ticket_tasks[0] ? Number(s.submission_ticket_tasks[0].external_id) : null,
      };
    });
  }

  /**
   * Manually mark a submission as golden. Idempotent on submission_id
   * (the unique key catches duplicates). Inserts the user id so we
   * know who curated each row. If the row already exists but was
   * archived, un-archive it (manual mark beats prior archive).
   */
  async markManual(args: { submissionId: number; userId: number; notes?: string | null }): Promise<GoldenSetRow> {
    if (!Number.isInteger(args.submissionId) || args.submissionId <= 0) {
      throw new AIGoldenSetServiceError('Invalid submission id', 'INVALID_SUBMISSION_ID', 400);
    }
    if (!Number.isInteger(args.userId) || args.userId <= 0) {
      throw new AIGoldenSetServiceError('Invalid user id', 'INVALID_USER_ID', 400);
    }
    const submission = await prisma.submission.findUnique({
      where: { id: args.submissionId },
      select: { id: true, form_id: true },
    });
    if (!submission) {
      throw new AIGoldenSetServiceError('Submission not found', 'SUBMISSION_NOT_FOUND', 404);
    }

    const existing = await prisma.aiGoldenSet.findUnique({
      where: { submission_id: args.submissionId },
    });
    if (existing) {
      const updated = await prisma.aiGoldenSet.update({
        where: { id: existing.id },
        data: {
          archived_at: null,
          source: 'manual',
          marked_by: args.userId,
          notes: args.notes ?? existing.notes,
        },
      });
      logger.info(
        `[AI GOLDEN] re-activated submission_id=${args.submissionId} form_id=${submission.form_id} by user=${args.userId}`
      );
      return this.toRow(updated);
    }
    const created = await prisma.aiGoldenSet.create({
      data: {
        form_id: submission.form_id,
        submission_id: args.submissionId,
        source: 'manual',
        marked_by: args.userId,
        notes: args.notes ?? null,
      },
    });
    logger.info(
      `[AI GOLDEN] manually added submission_id=${args.submissionId} form_id=${submission.form_id} by user=${args.userId}`
    );
    return this.toRow(created);
  }

  /**
   * Soft-archive a golden row. Doesn't delete — historical eval runs
   * remain reproducible because they store their golden_set_count and
   * results_json snapshot.
   */
  async archive(args: { id: number; reason?: string | null }): Promise<GoldenSetRow> {
    if (!Number.isInteger(args.id) || args.id <= 0) {
      throw new AIGoldenSetServiceError('Invalid id', 'INVALID_ID', 400);
    }
    const existing = await prisma.aiGoldenSet.findUnique({ where: { id: args.id } });
    if (!existing) {
      throw new AIGoldenSetServiceError('Golden row not found', 'GOLDEN_NOT_FOUND', 404);
    }
    const updated = await prisma.aiGoldenSet.update({
      where: { id: args.id },
      data: {
        archived_at: new Date(),
        notes: args.reason ? `[ARCHIVED] ${args.reason}` : existing.notes,
      },
    });
    logger.info(`[AI GOLDEN] archived id=${args.id} submission_id=${existing.submission_id}`);
    return this.toRow(updated);
  }

  /**
   * Undo an archive. Inverse of `archive` for accidental archives.
   */
  async restore(id: number): Promise<GoldenSetRow> {
    if (!Number.isInteger(id) || id <= 0) {
      throw new AIGoldenSetServiceError('Invalid id', 'INVALID_ID', 400);
    }
    const existing = await prisma.aiGoldenSet.findUnique({ where: { id } });
    if (!existing) {
      throw new AIGoldenSetServiceError('Golden row not found', 'GOLDEN_NOT_FOUND', 404);
    }
    const updated = await prisma.aiGoldenSet.update({
      where: { id },
      data: { archived_at: null },
    });
    return this.toRow(updated);
  }

  /**
   * Returns the golden status for a submission so the submission
   * detail UI can render the right "Mark as golden" button state.
   */
  async getStatusForSubmission(submissionId: number): Promise<{
    is_golden: boolean;
    is_archived: boolean;
    source: 'auto_seed' | 'manual' | null;
    marked_at: Date | null;
  }> {
    const row = await prisma.aiGoldenSet.findUnique({ where: { submission_id: submissionId } });
    if (!row) {
      return { is_golden: false, is_archived: false, source: null, marked_at: null };
    }
    return {
      is_golden: row.archived_at == null,
      is_archived: row.archived_at != null,
      source: row.source as 'auto_seed' | 'manual',
      marked_at: row.marked_at,
    };
  }

  private toRow(row: any): GoldenSetRow {
    return {
      id: row.id,
      form_id: row.form_id,
      submission_id: row.submission_id,
      source: row.source as 'auto_seed' | 'manual',
      marked_by: row.marked_by,
      marked_at: row.marked_at,
      notes: row.notes,
      archived_at: row.archived_at,
    };
  }
}

const aiGoldenSetService = new AIGoldenSetService();
export default aiGoldenSetService;

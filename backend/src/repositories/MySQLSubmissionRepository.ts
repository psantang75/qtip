/**
 * MySQLSubmissionRepository - Data access layer for submission operations using Prisma
 */

import prisma from '../config/prisma';
import { Prisma, SubmissionStatus as PrismaSubmissionStatus } from '../generated/prisma/client';
import type { QuestionType } from '../models/Form';
import {
  FormWithCategories,
  FlagSubmissionDTO,
  CreateSubmissionDTO,
  Submission,
  SubmissionStatus,
} from '../models';
import logger from '../config/logger';

export interface CallWithForm {
  call: any;
  form: any;
  existingSubmission?: any;
}

/**
 * Phase C (C4): build a `<KIND>:<external_id>` case id from the link
 * payload of a submission about to be inserted. Mirrors the SQL
 * backfill so historical and new submissions share the same key.
 *
 * Order:
 *   1. ticket_tasks[0] → "TICKET:<id>" or "TASK:<id>"
 *   2. call_ids[0] / call_id → "CALL:<conversation_id>" (preferred)
 *      or "CALL:<internal_id>" if the Genesys id can't be looked up.
 */
async function deriveCaseId(
  tx: Prisma.TransactionClient,
  submissionData: CreateSubmissionDTO & { submitted_by: number }
): Promise<string | null> {
  const ticketRef = submissionData.ticket_tasks?.[0];
  if (ticketRef) {
    const kind = ticketRef.kind === 'TASK' ? 'TASK' : 'TICKET';
    return `${kind}:${ticketRef.external_id}`;
  }

  const internalCallId =
    submissionData.call_ids?.find((id) => id > 0) ?? submissionData.call_id ?? null;
  if (internalCallId && internalCallId > 0) {
    const call = await tx.call.findUnique({
      where: { id: internalCallId },
      select: { call_id: true },
    });
    return `CALL:${call?.call_id ?? internalCallId}`;
  }

  // New call upserts (negative ids) carry the Genesys conversation id
  // in call_data. Use that directly so the case_id matches the upsert.
  const newCall = submissionData.call_data?.find((c) => c?.call_id);
  if (newCall?.call_id) {
    return `CALL:${newCall.call_id}`;
  }

  return null;
}

export class MySQLSubmissionRepository {

  constructor(_connectionPool?: any) {
    // pool parameter kept for backward compatibility
  }

  getConnection(): any {
    return prisma;
  }

  async getCallWithForm(call_id: number, form_id: number): Promise<CallWithForm> {
    try {
      const callData = await prisma.call.findUnique({
        where: { id: call_id },
        include: {
          csr: { select: { username: true } },
          department: { select: { department_name: true } },
        },
      });

      const formData = await prisma.form.findFirst({
        where: { id: form_id, is_active: true },
        include: {
          form_categories: {
            orderBy: { sort_order: 'asc' },
            include: {
              form_questions: {
                orderBy: { sort_order: 'asc' },
              },
            },
          },
        },
      });

      if (!formData) throw new Error('Form not found');

      const formWithCategories: FormWithCategories = {
        id: formData.id,
        form_name: formData.form_name,
        interaction_type: formData.interaction_type,
        version: formData.version || 1,
        created_by: formData.created_by,
        created_at: formData.created_at,
        is_active: formData.is_active,
        categories: formData.form_categories.map((cat) => ({
          id: cat.id,
          category_name: cat.category_name,
          description: cat.description ?? undefined,
          weight: Number(cat.weight),
          sort_order: cat.sort_order,
          questions: cat.form_questions.map((q) => ({
            id: q.id,
            question_text: q.question_text,
            question_type: q.question_type as unknown as QuestionType,
            weight: Number(q.weight),
            is_na_allowed: q.is_na_allowed,
            scale_min: q.scale_min ?? undefined,
            scale_max: q.scale_max ?? undefined,
            yes_value: q.yes_value,
            no_value: q.no_value,
            na_value: q.na_value,
            sort_order: q.sort_order,
          })),
        })),
      };

      const existingSubmission = await prisma.submission.findFirst({
        where: { call_id: call_id, form_id: form_id },
      });

      const callResult = callData
        ? {
            ...callData,
            csr_name: callData.csr.username,
            department_name: callData.department?.department_name,
          }
        : { id: call_id, status: 'placeholder' };

      return { call: callResult, form: formWithCategories, existingSubmission };
    } catch (error) {
      logger.error('Error fetching call with form:', error);
      throw new Error('Failed to fetch call with form data');
    }
  }

  async createSubmission(
    submissionData: CreateSubmissionDTO & { submitted_by: number; status: SubmissionStatus; submitted_at?: Date | null }
  ): Promise<number> {
    const submission_id = await prisma.$transaction(async (tx) => {
      // Phase C (C4): derive a case_id from the link payload so the
      // inbox / calibration code can group multi-source submissions.
      // Format mirrors the backfill in
      // 20260507120000_add_submission_case_id: prefer TICKET, then
      // TASK, then CALL (Genesys conversation id when available, else
      // the internal calls.id).
      const derivedCaseId = await deriveCaseId(tx, submissionData);

      // Snapshot the form's access_mode onto the submission at creation. This
      // fixes the submission's visibility for life (an Internal submission stays
      // hidden from agents/standard surfaces even if the form is later made
      // Active), and lets every consumer filter on `s.access_mode` without a
      // forms join. See backend/src/utils/formScope.ts.
      const parentForm = await tx.form.findUnique({
        where: { id: submissionData.form_id },
        select: { access_mode: true },
      });

      const submission = await tx.submission.create({
        data: {
          form_id: submissionData.form_id,
          call_id: submissionData.call_id ?? null,
          case_id: submissionData.case_id ?? derivedCaseId,
          ai_provider: submissionData.ai_provider ?? null,
          submitted_by: submissionData.submitted_by,
          status: submissionData.status as PrismaSubmissionStatus,
          access_mode: parentForm?.access_mode ?? null,
          submitted_at: submissionData.submitted_at ?? undefined,
          ai_overall_confidence:
            submissionData.ai_overall_confidence == null
              ? null
              : (submissionData.ai_overall_confidence as any),
          ai_calibrated_confidence:
            submissionData.ai_calibrated_confidence == null
              ? null
              : (submissionData.ai_calibrated_confidence as any),
          ai_extras: (submissionData.ai_extras as any) ?? undefined,
        },
      });

      if (submissionData.answers && submissionData.answers.length > 0) {
        await tx.submissionAnswer.createMany({
          data: submissionData.answers.map((a) => ({
            submission_id: submission.id,
            question_id: a.question_id,
            answer: a.answer ?? null,
            notes: a.notes ?? null,
            ai_confidence: a.ai_confidence == null ? null : (a.ai_confidence as any),
          })),
        });
      }

      if (submissionData.metadata && submissionData.metadata.length > 0) {
        await tx.submissionMetadata.createMany({
          data: submissionData.metadata.map((m) => ({
            submission_id: submission.id,
            field_id: Number(m.field_id),
            value: m.value ?? null,
          })),
        });
      }

      if (submissionData.call_ids && submissionData.call_ids.length > 0) {
        for (let i = 0; i < submissionData.call_ids.length; i++) {
          let call_id = submissionData.call_ids[i];

          if (call_id < 0) {
            const callData = submissionData.call_data?.[i];
            if (callData) {
              // Use the CSR resolved from the form metadata by the frontend,
              // falling back to the submitter (QA reviewer) to satisfy the FK constraint.
              const csr_id = submissionData.csr_id ?? submissionData.submitted_by;

              // Upsert: if a call with this conversation ID already exists (e.g. from
              // a previous failed attempt), reuse it rather than failing on the unique constraint.
              const upsertedCall = await tx.call.upsert({
                where: { call_id: callData.call_id },
                create: {
                  call_id: callData.call_id,
                  csr_id: csr_id,
                  department_id: callData.department_id ?? null,
                  customer_id: null,
                  call_date: callData.call_date ? new Date(callData.call_date) : new Date(),
                  duration: callData.duration || 0,
                  recording_url: callData.recording_url ?? null,
                  transcript: callData.transcript ?? null,
                  metadata: callData.metadata ? JSON.stringify(callData.metadata) : null,
                },
                update: {},
              });

              call_id = upsertedCall.id;
            }
          }

          await tx.submissionCall.upsert({
            where: { unique_submission_call: { submission_id: submission.id, call_id: call_id } },
            create: { submission_id: submission.id, call_id: call_id, sort_order: i },
            update: { sort_order: i },
          });
        }
      }

      // Linked CRM tickets/tasks. Reference-only persistence: we store
      // {kind, external_id, sort_order} and live-fetch all body data
      // from the CRM at view time. Upsert keeps double-submits idempotent.
      if (submissionData.ticket_tasks && submissionData.ticket_tasks.length > 0) {
        for (let i = 0; i < submissionData.ticket_tasks.length; i++) {
          const ref = submissionData.ticket_tasks[i];
          await tx.submissionTicketTask.upsert({
            where: {
              unique_submission_ticket_task: {
                submission_id: submission.id,
                kind: ref.kind,
                external_id: BigInt(ref.external_id),
              },
            },
            create: {
              submission_id: submission.id,
              kind: ref.kind,
              external_id: BigInt(ref.external_id),
              sort_order: i,
            },
            update: { sort_order: i },
          });
        }
      }

      return submission.id;
    });

    return submission_id;
  }

  async updateSubmissionScore(submission_id: number, total_score: number): Promise<void> {
    try {
      await prisma.submission.update({
        where: { id: submission_id },
        data: { total_score: total_score },
      });
    } catch (error) {
      logger.error('Error updating submission score:', error);
      throw new Error('Failed to update submission score');
    }
  }

  async getExistingDraft(
    call_id: number | null,
    form_id: number,
    submitted_by: number,
    case_id?: string | null,
    ai_provider?: string | null
  ): Promise<Submission | null> {
    try {
      // When a case_id is provided we MUST key dedup off the case (not just
      // call_id), otherwise multi-source runs (which leave the legacy call_id
      // column null and instead link via submission_calls/submission_ticket_tasks)
      // silently clobber an unrelated stale DRAFT row that happens to share
      // (form_id, submitted_by, call_id IS NULL). See AIReviewerService.reviewCase.
      //
      // `ai_provider` is the per-AI-provider tag (anthropic / openai). When
      // supplied, the lookup discriminates on it so compare-mode runs
      // (Claude vs ChatGPT on the same case + form + ai_user) land in TWO
      // distinct DRAFT rows instead of clobbering each other. When omitted
      // (legacy callers, human saves), the lookup behaves exactly as it did
      // before this column existed and matches any provider tag.
      const baseWhere: Prisma.SubmissionWhereInput =
        case_id !== undefined && case_id !== null && case_id !== ''
          ? {
              form_id,
              submitted_by,
              status: 'DRAFT',
              case_id,
            }
          : {
              form_id,
              submitted_by,
              status: 'DRAFT',
              call_id: call_id ?? null,
            };
      const where: Prisma.SubmissionWhereInput =
        ai_provider !== undefined
          ? { ...baseWhere, ai_provider: ai_provider ?? null }
          : baseWhere;
      const sub = await prisma.submission.findFirst({ where });
      return sub as unknown as Submission | null;
    } catch (error) {
      logger.error('Error fetching existing draft:', error);
      throw new Error('Failed to fetch existing draft');
    }
  }

  async updateSubmission(
    submission_id: number,
    submissionData: CreateSubmissionDTO & { submitted_by: number; status: SubmissionStatus; submitted_at?: Date | null }
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.submission.update({
        where: { id: submission_id },
        data: {
          status: submissionData.status as PrismaSubmissionStatus,
          submitted_at: submissionData.submitted_at ?? undefined,
          // Only overwrite AI side outputs when the new payload supplies
          // them; otherwise leave whatever was there. (Lets human edits
          // to a draft preserve the original AI-emitted timeline/etc.)
          ...(submissionData.ai_overall_confidence !== undefined
            ? { ai_overall_confidence: submissionData.ai_overall_confidence as any }
            : {}),
          ...(submissionData.ai_calibrated_confidence !== undefined
            ? { ai_calibrated_confidence: submissionData.ai_calibrated_confidence as any }
            : {}),
          ...(submissionData.ai_extras !== undefined
            ? { ai_extras: submissionData.ai_extras as any }
            : {}),
          ...(submissionData.ai_provider !== undefined
            ? { ai_provider: submissionData.ai_provider ?? null }
            : {}),
        },
      });

      await tx.submissionAnswer.deleteMany({ where: { submission_id: submission_id } });

      if (submissionData.answers && submissionData.answers.length > 0) {
        await tx.submissionAnswer.createMany({
          data: submissionData.answers.map((a) => ({
            submission_id: submission_id,
            question_id: a.question_id,
            answer: a.answer ?? null,
            notes: a.notes ?? null,
            ai_confidence: a.ai_confidence == null ? null : (a.ai_confidence as any),
          })),
        });
      }

      await tx.submissionMetadata.deleteMany({ where: { submission_id: submission_id } });

      if (submissionData.metadata && submissionData.metadata.length > 0) {
        await tx.submissionMetadata.createMany({
          data: submissionData.metadata.map((m) => ({
            submission_id: submission_id,
            field_id: Number(m.field_id),
            value: m.value ?? null,
          })),
        });
      }

      // Replace linked CRM tickets/tasks. Without this, a draft that gets
      // re-saved for a different ticket (e.g. a second AI Reviewer manual
      // run that reuses the same DRAFT row found by getExistingDraft) would
      // keep the stale ticket linkage from the original save while the
      // answers/metadata reflect the new ticket — producing a draft whose
      // header points at one ticket and whose review narrative is about
      // another. Mirror the answers/metadata replace-all semantics.
      await tx.submissionTicketTask.deleteMany({ where: { submission_id: submission_id } });

      if (submissionData.ticket_tasks && submissionData.ticket_tasks.length > 0) {
        for (let i = 0; i < submissionData.ticket_tasks.length; i++) {
          const ref = submissionData.ticket_tasks[i];
          await tx.submissionTicketTask.create({
            data: {
              submission_id: submission_id,
              kind: ref.kind,
              external_id: BigInt(ref.external_id),
              sort_order: i,
            },
          });
        }
      }

      // Replace linked calls for the same reason. Reuse the same virtual-call
      // upsert path from createSubmission so PhoneSystem-only conversations
      // (negative call_id) still resolve to a real calls row.
      await tx.submissionCall.deleteMany({ where: { submission_id: submission_id } });

      if (submissionData.call_ids && submissionData.call_ids.length > 0) {
        for (let i = 0; i < submissionData.call_ids.length; i++) {
          let call_id = submissionData.call_ids[i];

          if (call_id < 0) {
            const callData = submissionData.call_data?.[i];
            if (callData) {
              const csr_id = submissionData.csr_id ?? submissionData.submitted_by;
              const upsertedCall = await tx.call.upsert({
                where: { call_id: callData.call_id },
                create: {
                  call_id: callData.call_id,
                  csr_id: csr_id,
                  department_id: callData.department_id ?? null,
                  customer_id: null,
                  call_date: callData.call_date ? new Date(callData.call_date) : new Date(),
                  duration: callData.duration || 0,
                  recording_url: callData.recording_url ?? null,
                  transcript: callData.transcript ?? null,
                  metadata: callData.metadata ? JSON.stringify(callData.metadata) : null,
                },
                update: {},
              });

              call_id = upsertedCall.id;
            }
          }

          await tx.submissionCall.create({
            data: { submission_id: submission_id, call_id: call_id, sort_order: i },
          });
        }
      }
    });
  }

  async getSubmissionById(submission_id: number): Promise<Submission | null> {
    try {
      const sub = await prisma.submission.findUnique({ where: { id: submission_id } });
      return sub as unknown as Submission | null;
    } catch (error) {
      logger.error('Error fetching submission by ID:', error);
      throw new Error('Failed to fetch submission');
    }
  }

  async flagSubmission(flagData: FlagSubmissionDTO, user_id: number): Promise<void> {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.submission.update({
          where: { id: flagData.submission_id },
          data: { status: 'DISPUTED' },
        });

        await tx.dispute.create({
          data: {
            submission_id: flagData.submission_id,
            disputed_by: user_id,
            reason: flagData.reason,
            status: 'OPEN',
          },
        });
      });
    } catch (error) {
      logger.error('Error flagging submission:', error);
      throw new Error('Failed to flag submission');
    }
  }
}

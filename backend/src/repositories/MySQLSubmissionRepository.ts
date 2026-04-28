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

export interface AssignedAudit {
  assignment_id: number;
  call_id: number;
  call_external_id: string;
  form_id: number;
  form_name: string;
  call_date: string;
  call_duration: number;
  csr_name: string;
  department_name: string;
  submission_id: number;
  status: string;
}

export interface CallWithForm {
  call: any;
  form: any;
  existingSubmission?: any;
}

export class MySQLSubmissionRepository {

  constructor(_connectionPool?: any) {
    // pool parameter kept for backward compatibility
  }

  getConnection(): any {
    return prisma;
  }

  async getAssignedAudits(qa_id: number, limit: number, offset: number): Promise<{ audits: AssignedAudit[]; total: number }> {
    try {
      const total = await prisma.auditAssignment.count({
        where: { qa_id: qa_id, is_active: true },
      });

      const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT 
          aa.id as assignment_id,
          aa.target_id as call_id,
          CONCAT('CALL-', COALESCE(aa.target_id, 0)) as call_external_id,
          aa.form_id,
          f.form_name,
          DATE(NOW()) as call_date,
          0 as call_duration,
          'N/A' as csr_name,
          'N/A' as department_name,
          0 as submission_id,
          'NOT_STARTED' as status
        FROM audit_assignments aa
        JOIN forms f ON aa.form_id = f.id
        WHERE aa.qa_id = ${qa_id} AND aa.is_active = 1
        ORDER BY aa.start_date ASC
        LIMIT ${limit} OFFSET ${offset}
      `);

      const audits = rows.map((row) => ({
        assignment_id: row.assignment_id,
        call_id: row.call_id || 0,
        call_external_id: row.call_external_id,
        form_id: row.form_id,
        form_name: row.form_name,
        call_date: row.call_date,
        call_duration: row.call_duration || 0,
        csr_name: row.csr_name,
        department_name: row.department_name,
        submission_id: row.submission_id,
        status: row.status,
      })) as AssignedAudit[];

      return { audits, total };
    } catch (error) {
      logger.error('Error fetching assigned audits:', error);
      throw new Error('Failed to fetch assigned audits');
    }
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
    try {
      const submission_id = await prisma.$transaction(async (tx) => {
        const submission = await tx.submission.create({
          data: {
            form_id: submissionData.form_id,
            call_id: submissionData.call_id ?? null,
            submitted_by: submissionData.submitted_by,
            status: submissionData.status as PrismaSubmissionStatus,
            submitted_at: submissionData.submitted_at ?? undefined,
          },
        });

        if (submissionData.answers && submissionData.answers.length > 0) {
          await tx.submissionAnswer.createMany({
            data: submissionData.answers.map((a) => ({
              submission_id: submission.id,
              question_id: a.question_id,
              answer: a.answer ?? null,
              notes: a.notes ?? null,
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
    } catch (error) {
      throw error;
    }
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

  async getExistingDraft(call_id: number | null, form_id: number, submitted_by: number): Promise<Submission | null> {
    try {
      const sub = await prisma.submission.findFirst({
        where: {
          call_id: call_id ?? null,
          form_id: form_id,
          submitted_by: submitted_by,
          status: 'DRAFT',
        },
      });
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
    try {
      await prisma.$transaction(async (tx) => {
        await tx.submission.update({
          where: { id: submission_id },
          data: {
            status: submissionData.status as PrismaSubmissionStatus,
            submitted_at: submissionData.submitted_at ?? undefined,
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
      });
    } catch (error) {
      throw error;
    }
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

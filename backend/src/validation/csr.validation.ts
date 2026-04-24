import { z } from 'zod';
import {
  PageSchema,
  PageSizeSchema,
  optionalString,
  optionalDate,
  SubmissionStatusSchema,
  CoachingSessionStatusSchema,
  CoachingPurposeSchema,
  CoachingFormatSchema,
} from './common';

/**
 * CSR validation schemas using Zod.
 *
 * Field names in these schemas must match what the corresponding controller
 * actually reads from `req.query` / `req.body`. Z.object's default `.strip()`
 * mode silently drops anything unknown, so a mismatched name turns the whole
 * schema into a no-op (pre-production review item #32). Status / purpose /
 * format enums come from `validation/common.ts`, which mirrors the Prisma
 * enums exactly.
 */

export const CSRAuditFiltersSchema = z.object({
  page: PageSchema,
  limit: PageSizeSchema,
  // `csrAudit.controller.getCSRAudits` reads camelCase form/date keys.
  formName: optionalString(),
  form_id_search: optionalString(),
  startDate: optionalDate(),
  endDate: optionalDate(),
  status: z.preprocess(v => (v === '' ? undefined : v), SubmissionStatusSchema.optional()),
  searchTerm: optionalString(),
});

export const AuditIdSchema = z.object({
  id: z.coerce.number().int().min(1)
});

export const FinalizeSubmissionSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().min(1)
  }),
  body: z.object({
    acknowledged: z.boolean()
  })
});

// QuizSubmissionSchema / CourseProgressSchema / PositionUpdateSchema were
// removed during the pre-production review (item #31): they were never
// imported, used drifted field names that no controller actually read, and
// referenced enrollment / course-progress flows that have since been removed.
// Add new validation here only when a controller will actively call it.

export const CoachingSessionFiltersSchema = z.object({
  page: PageSchema,
  limit: PageSizeSchema,
  pageSize: PageSizeSchema,
  // `csr.controller.getCSRCoachingSessions` reads these exact keys.
  status: z.preprocess(v => (v === '' ? undefined : v), CoachingSessionStatusSchema.optional()),
  coaching_purpose: z.preprocess(v => (v === '' ? undefined : v), CoachingPurposeSchema.optional()),
  coaching_format: z.preprocess(v => (v === '' ? undefined : v), CoachingFormatSchema.optional()),
  startDate: optionalDate(),
  endDate: optionalDate(),
  search: optionalString(),
});

export const SessionIdSchema = z.object({
  sessionId: z.coerce.number().int().min(1)
});

// CertificateIdSchema removed during pre-production review (item #31) — no
// controller reads `certificate_id` and no route mounted it.

/**
 * Validation middleware helper. Spreads `req.query`, `req.params`, and
 * `req.body` into one object so flat schemas (most of the ones above) can
 * read their fields directly, while still exposing `params` / `body` as
 * sub-objects for nested schemas like `FinalizeSubmissionSchema`.
 *
 * Note: this validates only — it does **not** rewrite `req.query`, so the
 * controller still reads raw values. The controller is responsible for the
 * coercion that the schema describes.
 */
export const validateSchema = (schema: z.ZodSchema) => {
  return (req: any, res: any, next: any) => {
    try {
      schema.parse({
        ...req.query,
        ...req.params,
        ...req.body,
        params: req.params,
        body: req.body,
      });
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: 'Validation error',
          errors: error.errors.map(err => ({
            path: err.path.join('.'),
            message: err.message,
          })),
        });
      }
      next(error);
    }
  };
};

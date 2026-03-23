import { z } from 'zod';

/**
 * CSR validation schemas using Zod
 */

export const CSRAuditFiltersSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  form_name: z.preprocess(val => val === '' ? undefined : val, z.string().optional()),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format. Expected YYYY-MM-DD').optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format. Expected YYYY-MM-DD').optional(),
  status: z.preprocess(val => val === '' ? undefined : val, z.enum(['DRAFT', 'SUBMITTED', 'FINALIZED', 'DISPUTED']).optional()),
  searchTerm: z.preprocess(val => val === '' ? undefined : val, z.string().optional())
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

export const QuizSubmissionSchema = z.object({
  params: z.object({
    quiz_id: z.coerce.number().int().min(1)
  }),
  body: z.object({
    answers: z.array(z.object({
      question_id: z.number().int().min(1),
      selected_answer: z.string().min(1)
    })).min(1)
  })
});

export const CourseProgressSchema = z.object({
  params: z.object({
    enrollment_id: z.coerce.number().int().min(1)
  }),
  body: z.object({
    progress: z.number().min(0).max(100),
    last_accessed: z.string().datetime().optional()
  })
});

export const PositionUpdateSchema = z.object({
  params: z.object({
    enrollment_id: z.coerce.number().int().min(1)
  }),
  body: z.object({
    position: z.number().min(0),
    section_id: z.string().optional(),
    page_id: z.string().optional()
  })
});

export const CoachingSessionFiltersSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.preprocess(val => val === '' ? undefined : val, z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED']).optional()),
  coaching_type: z.preprocess(val => val === '' ? undefined : val, z.enum(['IMPROVEMENT', 'DEVELOPMENT', 'PERFORMANCE']).optional()),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format. Expected YYYY-MM-DD').optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format. Expected YYYY-MM-DD').optional(),
  search: z.preprocess(val => val === '' ? undefined : val, z.string().optional())
});

export const SessionIdSchema = z.object({
  sessionId: z.coerce.number().int().min(1)
});

export const CertificateIdSchema = z.object({
  certificate_id: z.coerce.number().int().min(1)
});

// Validation middleware helper
export const validateSchema = (schema: z.ZodSchema) => {
  return (req: any, res: any, next: any) => {
    try {
      schema.parse({
        ...req.query,
        ...req.params,
        ...req.body,
        params: req.params,
        body: req.body
      });
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: 'Validation error',
          errors: error.errors.map(err => ({
            path: err.path.join('.'),
            message: err.message
          }))
        });
      }
      next(error);
    }
  };
}; 
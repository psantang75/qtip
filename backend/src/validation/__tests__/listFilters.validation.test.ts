import { describe, it, expect } from 'vitest';
import {
  DepartmentListQuerySchema,
  DirectorDepartmentListQuerySchema,
  TeamAuditsListQuerySchema,
  ManagerDisputesListQuerySchema,
  DisputeHistoryQuerySchema,
  WriteUpListQuerySchema,
  QaCompletedListQuerySchema,
  TrainerCompletedListQuerySchema,
  TrainerCoachingSessionsListQuerySchema,
  AuditLogListQuerySchema,
  EnhancedPerfGoalListQuerySchema,
} from '../listFilters.validation';
import { UserListQuerySchema } from '../user.validation';

/**
 * These schemas are wired through `validateSchema`, which parses a MERGED object
 * of `{...query, ...params, ...body}`. The tests below feed the schema the same
 * flat shape and assert the NARROW contract: numeric ids + hard enums are
 * validated, everything else (pagination, dates, search, booleans) is ignored
 * (stripped) so it stays lenient in the handler.
 */

describe('DepartmentListQuerySchema', () => {
  it('accepts a numeric manager_id', () => {
    expect(DepartmentListQuerySchema.safeParse({ manager_id: '7' }).success).toBe(true);
  });
  it('treats empty / absent manager_id as valid', () => {
    expect(DepartmentListQuerySchema.safeParse({}).success).toBe(true);
    expect(DepartmentListQuerySchema.safeParse({ manager_id: '' }).success).toBe(true);
  });
  it('rejects a non-numeric manager_id', () => {
    expect(DepartmentListQuerySchema.safeParse({ manager_id: 'abc' }).success).toBe(false);
  });
  it('ignores lenient pass-through keys (search / is_active / pagination)', () => {
    const r = DepartmentListQuerySchema.safeParse({
      manager_id: '3', search: 'sales', is_active: 'true', page: 'x', limit: '', pageSize: '9999',
    });
    expect(r.success).toBe(true);
  });
});

describe('DirectorDepartmentListQuerySchema', () => {
  it('accepts numeric director_id + department_id', () => {
    expect(DirectorDepartmentListQuerySchema.safeParse({ director_id: '2', department_id: '5' }).success).toBe(true);
  });
  it('rejects a non-numeric department_id', () => {
    expect(DirectorDepartmentListQuerySchema.safeParse({ department_id: 'nope' }).success).toBe(false);
  });
});

describe('UserListQuerySchema', () => {
  it('accepts numeric role_id + department_id', () => {
    expect(UserListQuerySchema.safeParse({ role_id: '3', department_id: '8' }).success).toBe(true);
  });
  it('ignores role name / is_active / search (kept lenient)', () => {
    expect(
      UserListQuerySchema.safeParse({ role: 'Manager', is_active: 'true', search: 'jane' }).success,
    ).toBe(true);
  });
  it('rejects a non-numeric role_id', () => {
    expect(UserListQuerySchema.safeParse({ role_id: 'admin' }).success).toBe(false);
  });
});

describe('id-only list schemas keep enums/dates/search lenient', () => {
  it('TeamAuditsListQuerySchema validates ids, ignores status/dispute_status/search', () => {
    expect(
      TeamAuditsListQuerySchema.safeParse({
        csr_id: '5', form_id: '9', status: 'DISPUTED', dispute_status: 'Pending', search: 'x',
      }).success,
    ).toBe(true);
    expect(TeamAuditsListQuerySchema.safeParse({ csr_id: 'abc' }).success).toBe(false);
  });

  it('ManagerDisputesListQuerySchema validates ids, ignores status enum', () => {
    expect(ManagerDisputesListQuerySchema.safeParse({ csr_id: '2', status: 'WHATEVER' }).success).toBe(true);
    expect(ManagerDisputesListQuerySchema.safeParse({ form_id: 'x' }).success).toBe(false);
  });

  it('DisputeHistoryQuerySchema validates form_id, ignores status/searchTerm/dates', () => {
    expect(
      DisputeHistoryQuerySchema.safeParse({ form_id: '3', status: 'anything', searchTerm: 'q', start_date: '2026-01-01' }).success,
    ).toBe(true);
    expect(DisputeHistoryQuerySchema.safeParse({ form_id: '0.5' }).success).toBe(false);
  });

  it('Qa/Trainer completed schemas validate form_id, ignore status/dates/search', () => {
    expect(QaCompletedListQuerySchema.safeParse({ form_id: '11', status: 'ALL', date_start: '2026-01-01' }).success).toBe(true);
    expect(QaCompletedListQuerySchema.safeParse({ form_id: 'nan' }).success).toBe(false);
    expect(TrainerCompletedListQuerySchema.safeParse({ form_id: '4', status: 'ALL' }).success).toBe(true);
  });

  it('TrainerCoachingSessionsListQuerySchema validates id refs, ignores status/topic_ids/dates', () => {
    expect(
      TrainerCoachingSessionsListQuerySchema.safeParse({
        csr_id: '7', coaching_purpose: '2', coaching_format: '3', status: 'IN_PROCESS', topic_ids: '1,2,3', overdue_only: 'true',
      }).success,
    ).toBe(true);
    expect(TrainerCoachingSessionsListQuerySchema.safeParse({ coaching_purpose: 'x' }).success).toBe(false);
  });

  it('AuditLogListQuerySchema validates user_id, ignores action/dates', () => {
    expect(AuditLogListQuerySchema.safeParse({ user_id: '9', action: 'LOGIN', start_date: '2026-01-01' }).success).toBe(true);
    expect(AuditLogListQuerySchema.safeParse({ user_id: 'x' }).success).toBe(false);
  });

  it('EnhancedPerfGoalListQuerySchema validates ids, ignores goal_type/scope/target_scope enums', () => {
    expect(
      EnhancedPerfGoalListQuerySchema.safeParse({
        user_id: '1', department_id: '2', form_id: '3', goal_type: 'FOO', scope: 'BAR', target_scope: 'BAZ',
      }).success,
    ).toBe(true);
    expect(EnhancedPerfGoalListQuerySchema.safeParse({ department_id: 'x' }).success).toBe(false);
  });
});

describe('WriteUpListQuerySchema', () => {
  it('accepts the bounded document_type values + numeric csr_id', () => {
    for (const t of ['VERBAL_WARNING', 'WRITTEN_WARNING', 'FINAL_WARNING']) {
      expect(WriteUpListQuerySchema.safeParse({ document_type: t, csr_id: '5' }).success).toBe(true);
    }
  });
  it('treats empty document_type as absent and ignores status/dates/search', () => {
    expect(WriteUpListQuerySchema.safeParse({ document_type: '', status: 'CLOSED', search: 'q' }).success).toBe(true);
  });
  it('rejects an out-of-enum document_type and non-numeric csr_id', () => {
    expect(WriteUpListQuerySchema.safeParse({ document_type: 'SUSPENSION' }).success).toBe(false);
    expect(WriteUpListQuerySchema.safeParse({ csr_id: 'x' }).success).toBe(false);
  });
});

/**
 * Shared types and the domain error for the scheduling section. Mirrors
 * services/writeups/writeup.types.ts.
 */
import { Request } from 'express';

export class ScheduleServiceError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 500, code = 'SCHEDULE_ERROR') {
    super(message);
    this.name = 'ScheduleServiceError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** Authenticated request shape, as populated by the auth + authorizePage middleware. */
export interface AuthReq extends Request {
  user?: { user_id: number; role: string; role_id?: number };
  pageAccess?: {
    pageKey: string;
    level: 'NONE' | 'OWN' | 'ALL' | 'EDIT';
    canView: boolean;
    canViewAll: boolean;
    canEdit: boolean;
  };
}

/** Scope for a scheduling read/write, resolved from page access + role. */
export interface ScheduleScope {
  viewerId: number;
  canViewAll: boolean;
  /** null = unrestricted (admin/director-all); [] = manages nothing. */
  departmentIds: number[] | null;
  isAdmin: boolean;
}

export interface SegmentInput {
  activity_type_id: number;
  start: string; // 'HH:MM' wall clock
  end: string;
}

export interface ShiftInput {
  user_id: number;
  shift_date: string; // 'YYYY-MM-DD'
  is_day_off: boolean;
  start?: string | null; // 'HH:MM'
  end?: string | null;
  notes?: string | null;
  segments?: SegmentInput[];
}

export interface ExceptionInput {
  user_id: number;
  exception_date: string;
  exception_type_id: number;
  is_full_day: boolean;
  start?: string | null; // 'HH:MM'
  end?: string | null;
  notes?: string | null;
  paychex_reference?: string | null;
}

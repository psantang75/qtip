import apiClient from './apiClient';
import { logError } from '../utils/errorHandling';

/**
 * Frontend client for the live CRM lookup endpoints
 * (`backend/src/routes/crm.routes.ts`). The audit-form ticket/task
 * section persists only a reference (kind + external_id) on the
 * submission; the header + notes payloads come from these calls every
 * time the section renders.
 *
 * Mirrors the structural pattern of `callService.ts`.
 */

export type TicketTaskKind = 'TICKET' | 'TASK';

export interface TaskHeader {
  task_id: number;
  task_type: string | null;
  task_status: string | null;
  assigned_to_id: number | null;
  assigned_to_name: string | null;
  customer_id: number | null;
  created_on: string | null;
  due_on: string | null;
  completed_on: string | null;
}

export interface TicketHeader {
  ticket_id: number;
  class_name: string | null;
  subclass_name: string | null;
  classification_id: number | null;
  status: string | null;
  resolution: string | null;
  assigned_to_id: number | null;
  assigned_to_name: string | null;
  customer_id: number | null;
  created_on: string | null;
  modified_on: string | null;
  description: string | null;
}

export interface CRMNote {
  id: number;
  created_on: string | null;
  created_by: number | null;
  /** Best-effort name; for tasks parsed out of note text. */
  created_by_name: string | null;
  note: string;
  status_after: string | null;
  next_contact_date: string | null;
  /** True if note's CreatedOn is strictly after the audit's submitted_at. */
  is_after_audit: boolean;
}

const crmService = {
  getTaskHeader: async (taskId: number): Promise<TaskHeader | null> => {
    try {
      const res = await apiClient.get<TaskHeader>(`/crm/task/${taskId}`);
      return res.data;
    } catch (error: any) {
      if (error?.response?.status === 404) return null;
      logError('crmService', `[CRM] Failed to load task ${taskId}`, error);
      throw new Error('Failed to load task');
    }
  },

  getTaskNotes: async (taskId: number, auditAt?: string | null): Promise<CRMNote[]> => {
    try {
      const res = await apiClient.get<CRMNote[]>(`/crm/task/${taskId}/notes`, {
        params: auditAt ? { auditAt } : undefined,
      });
      return Array.isArray(res.data) ? res.data : [];
    } catch (error) {
      logError('crmService', `[CRM] Failed to load task notes ${taskId}`, error);
      throw new Error('Failed to load task notes');
    }
  },

  getTicketHeader: async (ticketId: number): Promise<TicketHeader | null> => {
    try {
      const res = await apiClient.get<TicketHeader>(`/crm/ticket/${ticketId}`);
      return res.data;
    } catch (error: any) {
      if (error?.response?.status === 404) return null;
      logError('crmService', `[CRM] Failed to load ticket ${ticketId}`, error);
      throw new Error('Failed to load ticket');
    }
  },

  getTicketNotes: async (ticketId: number, auditAt?: string | null): Promise<CRMNote[]> => {
    try {
      const res = await apiClient.get<CRMNote[]>(`/crm/ticket/${ticketId}/notes`, {
        params: auditAt ? { auditAt } : undefined,
      });
      return Array.isArray(res.data) ? res.data : [];
    } catch (error) {
      logError('crmService', `[CRM] Failed to load ticket notes ${ticketId}`, error);
      throw new Error('Failed to load ticket notes');
    }
  },
};

export default crmService;

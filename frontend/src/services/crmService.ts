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
  /** tblTaskType.TaskTypeID — selects the Jobs-vs-TaskManager URL base. */
  task_type_id: number | null;
  /** tblTaskType.NewScreen — the layout segment used to build the CRM deep link. */
  new_screen: string | null;
  /** tblJobs.JobID — only present/needed for job-typed tasks (14/42/46). */
  job_id: number | null;
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

/** A phone call logged against the ticket/task, with the agent's wrap-up. */
export interface CRMCallActivity {
  id: number;
  conversation_id: string;
  /** When the wrap-up was saved — the time the CRM shows. */
  occurred_on: string | null;
  direction: string | null;
  /** The other party's number (E.164 as stored by the CRM). */
  phone_number: string | null;
  contact_name: string | null;
  duration_sec: number | null;
  disposition: string | null;
  agent_id: number | null;
  agent_name: string | null;
  wrap_up: string;
  is_after_audit: boolean;
}

const crmService = {
  getTaskHeader: async (taskId: number): Promise<TaskHeader | null> => {
    try {
      const res = await apiClient.get<TaskHeader>(`/crm/task/${taskId}`);
      return res.data;
    } catch (error) {
      if ((error as { response?: { status?: number } })?.response?.status === 404) return null;
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
    } catch (error) {
      if ((error as { response?: { status?: number } })?.response?.status === 404) return null;
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

  getCallActivity: async (kind: TicketTaskKind, id: number, auditAt?: string | null): Promise<CRMCallActivity[]> => {
    const segment = kind === 'TASK' ? 'task' : 'ticket';
    try {
      const res = await apiClient.get<CRMCallActivity[]>(`/crm/${segment}/${id}/calls`, {
        params: auditAt ? { auditAt } : undefined,
      });
      return Array.isArray(res.data) ? res.data : [];
    } catch (error) {
      logError('crmService', `[CRM] Failed to load ${segment} call activity ${id}`, error);
      throw new Error('Failed to load call activity');
    }
  },
};

export default crmService;

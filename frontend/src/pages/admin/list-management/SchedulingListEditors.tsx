/**
 * Scheduling list editors surfaced inside List Management.
 *
 * Exception types and activity types live in their own tables but now reach full
 * parity with the generic lists (add / edit / activate / drag-sort / categories)
 * by driving the shared GenericListEditor through thin service adapters. Their
 * domain fields (excused, duration, paid) ride along as GenericListEditor "meta"
 * so they stay editable. Coverage thresholds are a richer per-department
 * settings surface, so they live in their own file (re-exported below).
 *
 * Read-open, admin-write; the backend re-checks admin on every mutation.
 */
import schedulingService, { type ApiActivityType, type ApiExceptionType } from '@/services/schedulingService'
import {
  GenericListEditor,
  type EditorItem,
  type ListEditorService,
  type ListEditorMeta,
} from './GenericListEditor'

// Coverage thresholds are a richer per-department settings surface (time frames,
// expand/collapse), so they live in their own file. Re-exported here so List
// Management's import path stays stable.
export { CoverageThresholdsEditor } from './CoverageThresholdsEditor'

// ── Exception types ──────────────────────────────────────────────────────────
const excService: ListEditorService = {
  getItems: async (inc) => (await schedulingService.listExceptionTypes(inc)).map((x: ApiExceptionType): EditorItem => ({
    id: x.id, list_type: 'schedule_exception_type', label: x.label, category: x.category ?? undefined,
    sort_order: x.sort_order, is_active: x.is_active, is_system: x.is_system,
    is_excused: x.is_excused, duration_mode: x.duration_mode,
    // '' rather than null so the "Not linked" option matches on value.
    paychex_pay_type: x.paychex_pay_type ?? '',
  })),
  createItem:   (p) => schedulingService.createExceptionType(p as Record<string, unknown>),
  updateItem:   (id, p) => schedulingService.updateExceptionType(id, p),
  toggleStatus: async (id) => {
    const cur = (await schedulingService.listExceptionTypes(true)).find(x => x.id === id)
    return schedulingService.setExceptionTypeActive(id, !cur?.is_active)
  },
  reorder:      (order) => schedulingService.reorderExceptionTypes(order),
  deleteItem:   () => Promise.reject(new Error('Exception types are deactivated, not deleted')),
}

// Paychex is the system of record for time off: its pay types arrive on the punch
// feed and scheduling turns them into exceptions. Linking is a picker, not free
// text, because a typo here silently stops an entire category of PTO from being
// excused and the only symptom is points nobody can explain.
//
// These are the eight non-work pay types that flow over, spelled the way the feed
// spells them — the Description column, not the code, so 'Jury Duty' and not 'JD'.
const PAYCHEX_PAY_TYPES = [
  'PTO - Approved',
  'PTO - Not Approved',
  'Holiday',
  'Bereavement',
  'Jury Duty',
  'VTO',
  'Unpaid - Approved',
  'Unpaid - Not Approved',
]

const excMeta: ListEditorMeta = {
  fields: [
    { key: 'is_excused', label: 'Excused', type: 'select', coerce: 'boolean', options: [
      { value: 'true', label: 'Excused' },
      { value: 'false', label: 'Unexcused' },
    ] },
    { key: 'duration_mode', label: 'Duration', type: 'select', options: [
      { value: 'EITHER', label: 'Full day or partial' },
      { value: 'FULL_DAY', label: 'Full day' },
      { value: 'WINDOW', label: 'Partial day' },
    ] },
    { key: 'paychex_pay_type', label: 'Paychex', type: 'select', options: [
      { value: '', label: 'Not linked' },
      ...PAYCHEX_PAY_TYPES.map(p => ({ value: p, label: p })),
    ] },
  ],
  addDefaults: { is_excused: false, duration_mode: 'EITHER' },
  allowDelete: false,
}

export function ExceptionTypesEditor() {
  return <GenericListEditor listType="schedule_exception_type" listLabel="exception type" service={excService} meta={excMeta} />
}

// ── Activity types ───────────────────────────────────────────────────────────
const actService: ListEditorService = {
  getItems: async (inc) => (await schedulingService.listActivityTypes(inc)).map((a: ApiActivityType): EditorItem => ({
    id: a.id, list_type: 'schedule_activity_type', label: a.label, category: a.category ?? undefined,
    sort_order: a.sort_order, is_active: a.is_active, is_system: a.is_system,
    is_paid: a.is_paid, counts_as_coverage: a.counts_as_coverage,
  })),
  createItem:   (p) => schedulingService.createActivityType(p as Record<string, unknown>),
  updateItem:   (id, p) => schedulingService.updateActivityType(id, p),
  toggleStatus: async (id) => {
    const cur = (await schedulingService.listActivityTypes(true)).find(a => a.id === id)
    return schedulingService.setActivityTypeActive(id, !cur?.is_active)
  },
  reorder:      (order) => schedulingService.reorderActivityTypes(order),
  deleteItem:   () => Promise.reject(new Error('Activity types are deactivated, not deleted')),
}

const actMeta: ListEditorMeta = {
  fields: [
    { key: 'is_paid', label: 'Paid', type: 'toggle' },
    { key: 'counts_as_coverage', label: 'Coverage', type: 'toggle' },
  ],
  addDefaults: { is_paid: true, counts_as_coverage: false },
  allowDelete: false,
  lockToggleWhen: (item) => !!item.is_system && item.is_active,
}

export function ActivityTypesEditor() {
  return <GenericListEditor listType="schedule_activity_type" listLabel="activity" service={actService} meta={actMeta} />
}

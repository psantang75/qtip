/**
 * Filter-form state for the On-Demand Report view page: the controls' shape, the
 * per-report defaults merged over it, and its conversion to the API params.
 */
import type {
  OnDemandReportFilterParams,
  OnDemandReportSummary,
} from '@/services/onDemandReportsService'

export const DEFAULT_PERIOD = 'Current Month'

export interface FilterState {
  period: string
  customStart: string
  customEnd: string
  departments: string[]
  forms: string[]
  agents: string[]
  submissionId: string
  topics: string[]
  status: string
  sessionId: string
  callLengthBand: string
  campaign: string
  declineReason: string
  currency: string
}

export const EMPTY_STATE: FilterState = {
  period: DEFAULT_PERIOD,
  customStart: '',
  customEnd: '',
  departments: [],
  forms: [],
  agents: [],
  submissionId: '',
  topics: [],
  status: '',
  sessionId: '',
  callLengthBand: '',
  campaign: '',
  declineReason: '',
  currency: '',
}

/** Merge per-report default filter values (e.g. coaching → status=CLOSED) on top of the empty state. */
export function applyDefaults(meta?: OnDemandReportSummary | null): FilterState {
  const d = meta?.defaultFilters
  if (!d) return EMPTY_STATE
  return {
    ...EMPTY_STATE,
    departments: d.departments ?? EMPTY_STATE.departments,
    forms: d.forms ?? EMPTY_STATE.forms,
    agents: d.agents ?? EMPTY_STATE.agents,
    submissionId: d.submissionId ?? EMPTY_STATE.submissionId,
    topics: d.topics ?? EMPTY_STATE.topics,
    status: d.status ?? EMPTY_STATE.status,
    sessionId: d.sessionId ?? EMPTY_STATE.sessionId,
    callLengthBand: d.callLengthBand ?? EMPTY_STATE.callLengthBand,
    campaign: d.campaign ?? EMPTY_STATE.campaign,
    declineReason: d.declineReason ?? EMPTY_STATE.declineReason,
    currency: d.currency ?? EMPTY_STATE.currency,
  }
}

/** True when `draft` differs from the report's defaulted baseline. */
export function differsFromBaseline(draft: FilterState, baseline: FilterState): boolean {
  return (
    draft.departments.length !== baseline.departments.length
    || draft.forms.length !== baseline.forms.length
    || draft.agents.length !== baseline.agents.length
    || draft.topics.length !== baseline.topics.length
    || draft.submissionId !== baseline.submissionId
    || draft.sessionId !== baseline.sessionId
    || draft.status !== baseline.status
    || draft.callLengthBand !== baseline.callLengthBand
    || draft.campaign !== baseline.campaign
    || draft.declineReason !== baseline.declineReason
    || draft.currency !== baseline.currency
    || (!!draft.period && draft.period !== DEFAULT_PERIOD)
    || !!draft.customStart
    || !!draft.customEnd
  )
}

export function toFilterParams(state: FilterState): OnDemandReportFilterParams {
  // Backend normalises e.g. "Current Month" → "current_month".
  return {
    period: state.period,
    customStart: state.period === 'Custom' ? state.customStart : undefined,
    customEnd: state.period === 'Custom' ? state.customEnd : undefined,
    departments: state.departments.length ? state.departments : undefined,
    forms: state.forms.length ? state.forms : undefined,
    agents: state.agents.length ? state.agents : undefined,
    submissionId: state.submissionId || undefined,
    topics: state.topics.length ? state.topics : undefined,
    status: state.status || undefined,
    sessionId: state.sessionId || undefined,
    callLengthBand: state.callLengthBand || undefined,
    campaign: state.campaign || undefined,
    declineReason: state.declineReason || undefined,
    currency: state.currency || undefined,
  }
}

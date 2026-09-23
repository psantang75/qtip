/**
 * Response contracts for Insights → Sales Agent Activity → Missed Opportunities.
 * Mirrors the flat-JSON shape of `@/types/collections`; field names match
 * `backend/src/services/insightsMissedOpportunities.service.ts` exactly.
 */

export type MissedOpportunitySeverity = 'low' | 'medium' | 'high'

/** One detected miss, with the coaching fix that goes with it. */
export interface MissedOpportunityFinding {
  findingId: string
  dateKey: number
  callDate: string | null
  agentName: string | null
  conversationId: string | null
  talkSecs: number | null
  direction: string | null
  customerName: string | null
  /** CRM record the model cited from the rep's same-day notes; null when none. */
  crmRefKind: 'TASK' | 'TICKET' | null
  crmRefId: number | null
  ruleKey: string
  ruleName: string | null
  category: string | null
  severity: MissedOpportunitySeverity
  title: string
  whatHappened: string
  evidenceQuote: string | null
  /** Who said evidenceQuote: 'CUSTOMER' | 'AGENT'. Null when unattributed. */
  evidenceSpeaker: 'CUSTOMER' | 'AGENT' | null
  recommendedApproach: string
  /** Morning-after action to save this account; null when nothing is recoverable. */
  recoveryAction: string | null
  estValueNote: string | null
}

export interface MissedOpportunityAgentRow {
  agentName: string
  findings: number
  high: number
  medium: number
  low: number
  callsWithFindings: number
  topRuleName: string | null
}

export interface MissedOpportunityRuleTotal {
  ruleKey: string
  ruleName: string | null
  category: string | null
  findings: number
}

/** The run for the selected day — drives the freshness stamp and the run banner. */
export interface MissedOpportunityRunInfo {
  runDate: string | null
  status: 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED' | null
  callsConsidered: number
  callsAnalyzed: number
  callsFailed: number
  /** Calls with no transcript to judge — neither graded nor failed. */
  callsSkipped: number
  findingsCount: number
  usdCost: number
  errorText: string | null
}

export interface MissedOpportunityResponse {
  totals: {
    findings: number
    high: number
    agentsAffected: number
    /** Calls carrying at least one finding that matches the page's filters. */
    callsWithFindings: number
    /** Calls the run graded, day-wide. Failed and skipped calls are excluded. */
    callsAnalyzed: number
    findingsPerCall: number | null
    /** Analyzed calls the review found nothing to coach on. */
    cleanCalls: number | null
    /** `cleanCalls` as a percentage of analyzed calls. */
    cleanCallRate: number | null
  }
  /**
   * Why the run-basis rates (`findingsPerCall`, `cleanCalls`, `cleanCallRate`)
   * are null. `calls_analyzed` is only recorded day-wide, so once the page is
   * narrowed to some agents or departments there is no matching denominator
   * and a rate would divide two different populations.
   */
  ratesUnavailableReason: 'filtered' | 'no-run' | null
  agents: MissedOpportunityAgentRow[]
  byRule: MissedOpportunityRuleTotal[]
  findings: MissedOpportunityFinding[]
  /** Null when the selected day was never analyzed — the page says so rather than showing zero. */
  run: MissedOpportunityRunInfo | null
  /** Outer bounds of the analyzed days; bounds the day picker. */
  runWindow: { earliest: string | null; latest: string | null }
  availableUsers: string[]
  availableDepartments: string[]
  dateRange: { start: string; end: string } | null
  dataLastUpdated: string | null
}

/** A rule set row as the Settings tab edits it. */
export interface MissedOpportunityRule {
  rule_id: number
  rule_key: string
  rule_name: string
  category: string
  severity: MissedOpportunitySeverity
  /** What the model looks for. */
  body_md: string
  /** How to coach the fix; steers the recommended-approach wording. */
  guidance_md: string | null
  is_active: boolean
  /**
   * True when the miss is a step the rep skipped, false when it grades the
   * content of something they did. Only omission rules go through the
   * verification pass, which drops a finding if the transcript shows the rep
   * making the move the finding says they never made.
   */
  is_omission: boolean
  sort_order: number
  updated_by: number | null
  updated_at: string
}

/** Scalar thresholds behind the rule set, stored in `ie_config`. */
export interface MissedOpportunitySettings {
  minTalkSecs: number
  excludedAgents: string[]
  dailyUsdCap: number
  modelTier: 'cheap' | 'reasoning'
  maxCallsPerRun: number
  /** Editable persona/judgment narrative prepended to the prompt; steers how calls are graded. */
  systemPersona: string
  /** BookStack page URLs whose content grounds the recommended approach; empty disables grounding. */
  kbAnchorUrls: string[]
  /** Whether the prior business day is graded automatically. */
  scheduleEnabled: boolean
  /** Earliest hour (0-23, Eastern) the automatic grading may run. */
  scheduleHour: number
}

export interface MissedOpportunityRulesResponse {
  rules: MissedOpportunityRule[]
  settings: MissedOpportunitySettings
  /** Sales roster for the exclusion picker, as the worker names agents. */
  salesAgents: string[]
  /** True only for Admin — the Settings tab is read-only for everyone else. */
  canEdit: boolean
}

export interface CreateRuleInput {
  rule_key: string
  rule_name: string
  category?: string
  severity?: MissedOpportunitySeverity
  body_md: string
  guidance_md?: string | null
  is_active?: boolean
  is_omission?: boolean
  sort_order?: number
}

/** rule_key is absent by design — stored findings reference it. */
export type UpdateRuleInput = Partial<Omit<CreateRuleInput, 'rule_key'>>

/** The immediate ack from starting a re-grade — the run itself continues in the background. */
export interface RunStartResult {
  started: boolean
  runDate: string | null
}

/** The run row for a day, polled after a re-grade starts to follow it to completion. */
export interface MissedOpportunityRunStatus {
  runDate: string | null
  status: 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED' | null
  callsConsidered: number
  callsAnalyzed: number
  callsFailed: number
  callsSkipped: number
  findingsCount: number
  usdCost: number
  errorText: string | null
  /** ISO timestamp the run reached a terminal status; null while RUNNING. */
  finishedAt: string | null
}

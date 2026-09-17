/** Contracts for the Missed Opportunities report and run status. */
export interface MissedOpportunityFilters {
  period: string;
  customStart?: string;
  customEnd?: string;
  users?: string[];
  departments?: string[];
  ruleKeys?: string[];
  severities?: string[];
  /** SELF scope: pin to the viewer's own conformed employee row. */
  selfEmployeeKey?: number | null;
  /** DEPARTMENT/DIVISION scope: pin to the viewer's department subtree. */
  departmentKeys?: number[];
}

export interface MissedOpportunityFindingRow {
  findingId: string;
  dateKey: number;
  callDate: string | null;
  agentName: string | null;
  conversationId: string | null;
  talkSecs: number | null;
  direction: string | null;
  customerName: string | null;
  /** CRM record the model cited, for the deep link. Null when none was cited. */
  crmRefKind: 'TASK' | 'TICKET' | null;
  crmRefId: number | null;
  ruleKey: string;
  ruleName: string | null;
  category: string | null;
  severity: string;
  title: string;
  whatHappened: string;
  evidenceQuote: string | null;
  /** Who said evidenceQuote: 'CUSTOMER' | 'AGENT'. Null when unattributed. */
  evidenceSpeaker: 'CUSTOMER' | 'AGENT' | null;
  recommendedApproach: string;
  /** Morning-after action to save this account; null when nothing is recoverable. */
  recoveryAction: string | null;
  estValueNote: string | null;
}

export interface MissedOpportunityAgentRow {
  agentName: string;
  findings: number;
  high: number;
  medium: number;
  low: number;
  callsWithFindings: number;
  /**
   * The rule that fired MOST OFTEN for this agent — the habit to coach. This
   * was previously the agent's highest-SEVERITY rule while the column read
   * "Most Common Miss", so a single high finding outranked four repeats of
   * another rule.
   */
  topRuleName: string | null;
}

export interface MissedOpportunityRuleTotal {
  ruleKey: string;
  ruleName: string | null;
  category: string | null;
  findings: number;
}

export interface MissedOpportunityResult {
  totals: {
    /** Findings matching the page's filters — the basis of the table below. */
    findings: number;
    high: number;
    agentsAffected: number;
    /** Calls carrying at least one filtered finding. */
    callsWithFindings: number;
    /**
     * Calls the run actually reviewed, day-wide. Failed and skipped calls are
     * excluded by the worker, so this is a population that was really graded.
     */
    callsAnalyzed: number;
    /**
     * Findings per analyzed call. Null unless the page is showing the whole
     * run — see `ratesUnavailableReason`.
     */
    findingsPerCall: number | null;
    /** Analyzed calls the review found nothing to coach on. Null when unavailable. */
    cleanCalls: number | null;
    /** `cleanCalls` as a percentage of analyzed calls. */
    cleanCallRate: number | null;
  };
  /**
   * Why the run-basis rates above are null.
   *
   * `filtered` — the page is narrowed to some agents or departments (by filter
   * or by viewer scope) but `calls_analyzed` is only recorded day-wide, so
   * there is no matching denominator for the subset. Dividing the narrowed
   * numerator by the day-wide denominator is what made a single-agent view
   * report a 95% clean rate for the whole floor.
   * `no-run` — the window contains no run at all.
   */
  ratesUnavailableReason: 'filtered' | 'no-run' | null;
  agents: MissedOpportunityAgentRow[];
  byRule: MissedOpportunityRuleTotal[];
  findings: MissedOpportunityFindingRow[];
  /**
   * The run that produced the selected day, or null when that day was never
   * analyzed. Null is the signal the page turns into an on-screen note — an
   * un-analyzed day must never render as a clean day with zero misses.
   */
  run: {
    runDate: string | null;
    status: string | null;
    callsConsidered: number;
    callsAnalyzed: number;
    callsFailed: number;
    /**
     * Calls with no transcript to judge. Recorded since the run table shipped
     * but never surfaced; a day where most calls were skipped or failed is a
     * day whose clean-call rate describes almost nothing, and the page cannot
     * say so without this.
     */
    callsSkipped: number;
    findingsCount: number;
    usdCost: number;
    errorText: string | null;
  } | null;
  /**
   * Outer bounds of every day that has been analyzed. Drives the day picker's
   * selectable range: the report cannot describe a day before its first nightly
   * run, so those days are not offerable.
   */
  runWindow: { earliest: string | null; latest: string | null };
  availableUsers: string[];
  availableDepartments: string[];
  dateRange: { start: string; end: string } | null;
  dataLastUpdated: string | null;
}

export interface MissedOpportunityRunStatus {
  runDate: string | null;
  status: 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED' | null;
  callsConsidered: number;
  callsAnalyzed: number;
  callsFailed: number;
  /** Calls with no transcript to judge — neither graded nor failed. */
  callsSkipped: number;
  findingsCount: number;
  usdCost: number;
  errorText: string | null;
  /** ISO timestamp the run reached a terminal status; null while RUNNING. */
  finishedAt: string | null;
}


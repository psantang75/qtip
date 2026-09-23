/**
 * Response contracts for the Sales Plays learning loop (Phase 2), under
 * Insights → Sales Agent Activity → Missed Opportunities. Field names match
 * `backend/.../salesPlays/plays.service.ts` and `.../salesPlays/settings.ts`.
 */

export type PlayCategory =
  | 'objection'
  | 'closing'
  | 'discovery'
  | 'upsell'
  | 'urgency'
  | 'research'

export type PlayStatus = 'proposed' | 'active' | 'archived'

/** One mined play (a reusable tactic), pending or approved. */
export interface SalesPlay {
  playId: number
  category: string
  title: string
  bodyMd: string
  evidenceQuote: string | null
  evidenceSpeaker: string | null
  sourceOutcome: string
  sourceConversationId: string | null
  sourceAgentName: string | null
  estValueNote: string | null
  status: string
  sortOrder: number
  /** How many WON/LOST calls back this play (cluster size); null if unconsolidated. */
  supportCount: number | null
  createdAt: string
  updatedAt: string
}

/** Scalar settings for the miner, stored in `ie_config`. */
export interface SalesPlaysSettings {
  /** Master switch: off = no mining AND no injection into recommendations. */
  enabled: boolean
  /** Reps whose WON/LOST calls the miner learns from. */
  roster: string[]
  /** Last mined business day (ISO), or null if never mined. */
  lastMined: string | null
  /** First-run lookback (days) when never mined. */
  seedDays: number
  /** Hard USD ceiling for one monthly mine. */
  monthlyUsdCap: number
  /** Day of month (1-28) the mine may run. */
  scheduleDay: number
  /** Earliest hour (0-23, Eastern) on that day. */
  scheduleHour: number
}

export interface SalesPlaysResponse {
  plays: SalesPlay[]
  settings: SalesPlaysSettings
  /** True only for Admin — plays are read-only for everyone else. */
  canEdit: boolean
}

export interface UpdatePlayInput {
  status?: PlayStatus
  category?: PlayCategory
  title?: string
  bodyMd?: string
  sortOrder?: number
}

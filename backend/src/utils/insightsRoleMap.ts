const INSIGHTS_ROLE_MAP: Record<string, number> = {
  Admin: 1,
  QA: 2,
  CSR: 3,
  Trainer: 4,
  Manager: 5,
  Director: 6,
}

export type InsightsRoleName = keyof typeof INSIGHTS_ROLE_MAP

/**
 * Resolve a role name string to its numeric ID for the Insights permission system.
 * Returns null for unknown/unrecognized roles — callers should deny access.
 */
export function getInsightsRoleId(role: string): number | null {
  return INSIGHTS_ROLE_MAP[role] ?? null
}

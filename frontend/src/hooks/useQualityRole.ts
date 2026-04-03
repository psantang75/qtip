import { useAuth } from '@/contexts/AuthContext'

/**
 * Canonical role ID constants — import from here, never hardcode numbers in pages.
 */
export const ROLE_IDS = {
  ADMIN:    1,
  QA:       2,
  CSR:      3,
  TRAINER:  4,
  MANAGER:  5,
  DIRECTOR: 6,
} as const

/**
 * Single source of truth for role-based logic across all sections.
 * All role_id comparisons should use this hook — never hardcode numbers in pages.
 */
export function useQualityRole() {
  const { user } = useAuth()
  const roleId = user?.role_id ?? 0

  const isAdmin    = roleId === ROLE_IDS.ADMIN
  const isQA       = roleId === ROLE_IDS.QA
  const isCSR      = roleId === ROLE_IDS.CSR
  const isTrainer  = roleId === ROLE_IDS.TRAINER
  const isManager  = roleId === ROLE_IDS.MANAGER
  const isDirector = roleId === ROLE_IDS.DIRECTOR

  return {
    roleId,
    isAdmin,
    isQA,
    isCSR,
    isTrainer,
    isManager,
    isDirector,
    isAdminOrQA:       isAdmin || isQA,
    canResolveDispute: isAdmin || isManager,
    canViewAnalytics:  isAdmin || isQA || isManager || isDirector,
  }
}

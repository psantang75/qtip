import { useAuth } from '@/contexts/AuthContext'

/**
 * Single source of truth for role-based logic in the Quality section.
 * All role_id comparisons should go here — never hardcode numbers in pages.
 *
 * Role IDs:
 *   1 = Admin
 *   2 = QA
 *   3 = CSR
 *   4 = Trainer
 *   5 = Manager
 */
export function useQualityRole() {
  const { user } = useAuth()
  const roleId = user?.role_id ?? 0

  const isAdmin   = roleId === 1
  const isQA      = roleId === 2
  const isCSR     = roleId === 3
  const isTrainer = roleId === 4
  const isManager = roleId === 5

  return {
    roleId,
    isAdmin,
    isQA,
    isCSR,
    isTrainer,
    isManager,
    isAdminOrQA:       isAdmin || isQA,
    canResolveDispute: isAdmin || isManager,
    canViewAnalytics:  isAdmin || isQA || isManager,
  }
}

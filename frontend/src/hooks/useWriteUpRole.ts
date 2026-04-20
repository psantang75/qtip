import { useQualityRole } from './useQualityRole'

/**
 * Role flags specific to the Write-Ups section.
 * Builds on useQualityRole — never hardcode role_id numbers in write-up pages.
 *
 * canManage: Admin, QA, Manager — can create, edit, and transition write-ups
 * canEdit:   Admin, Manager     — can edit an existing write-up
 * isAgent:   Agent only         — can view and sign their own write-ups
 */
export function useWriteUpRole() {
  const base = useQualityRole()

  return {
    ...base,
    canManage: base.isAdmin || base.isQA || base.isManager,
    canEdit:   base.isAdmin || base.isManager,
  }
}

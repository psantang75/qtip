import { useQualityRole } from './useQualityRole'

/**
 * Role flags for the Scheduling section, built on useQualityRole — never
 * hardcode role_id numbers in scheduling pages. Actual write authority is
 * enforced server-side per department; these flags only shape the UI.
 *
 * canManage: Admin, Manager, Director — see the editor grid
 * canEdit:   Admin, Manager           — write shifts/exceptions/templates
 * isAdmin:   Admin                     — manage the scheduling lists + unlock
 */
export function useScheduleRole() {
  const base = useQualityRole()
  return {
    ...base,
    canManage: base.isAdmin || base.isManager || base.isDirector,
    canEdit: base.isAdmin || base.isManager,
  }
}

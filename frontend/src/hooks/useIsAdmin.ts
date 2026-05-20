/**
 * Thin convenience hook that returns true when the current user is an
 * Admin. Pages and cards that just need a boolean for "show this Save
 * button or render it disabled?" should import this rather than reach
 * for `useQualityRole` (which exposes every role flag) or wire up
 * `useAuth` themselves.
 *
 * Backed by `useQualityRole().isAdmin` to keep one source of truth for
 * role-id resolution.
 */

import { useQualityRole } from './useQualityRole'

export function useIsAdmin(): boolean {
  return useQualityRole().isAdmin
}

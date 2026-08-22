/**
 * Shared attendance-policy vocabulary (level → badge colour, seconds → the
 * H:MM:SS the policy is written in) so the roster and the page read it from one
 * place.
 *
 * Lives in its own module (not `AttendancePolicyTooltips.tsx`) so that component
 * file only exports components — keeps Vite fast-refresh working.
 */

export const LEVEL_VARIANT: Record<string, 'warning' | 'bad'> = {
  coaching: 'warning',
  verbal: 'warning',
  written: 'bad',
  final: 'bad',
  separation: 'bad',
}

/** 'H:MM:SS' from seconds, matching how the policy table is written. */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

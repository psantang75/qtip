/**
 * Display helpers for a finding's interaction chrome (time, date, direction).
 * Call timestamps are instants, so they use the viewer's local timezone — same
 * as the other Agent Activity stamps, not the date-only Quality formatter.
 */

export const SEVERITY_CHIP: Record<string, string> = {
  high: 'bg-destructive/10 text-destructive',
  medium: 'bg-warning/10 text-warning',
  low: 'bg-slate-100 text-slate-500',
}

export function formatDirection(direction: string | null): string {
  if (!direction) return 'Call'
  return direction.charAt(0).toUpperCase() + direction.slice(1).toLowerCase()
}

export function formatTalkMins(talkSecs: number | null): string | null {
  if (talkSecs == null) return null
  return `${Math.round(talkSecs / 60)} min`
}

export function formatCallStamp(iso: string | null): { date: string; time: string } | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return {
    date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
  }
}

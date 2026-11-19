import type { CRMCallActivity, CRMNote } from '@/services/crmService'

/** One row of a linked ticket/task's activity: a CRM note or a logged phone call. */
export type TimelineEntry =
  | { kind: 'note'; key: string; at: string | null; isAfterAudit: boolean; note: CRMNote }
  | { kind: 'call'; key: string; at: string | null; isAfterAudit: boolean; call: CRMCallActivity }

function timeOf(at: string | null): number {
  const ms = at ? new Date(at).getTime() : NaN
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms
}

/** Notes and calls interleaved newest first, matching the CRM's activity list. */
export function buildTimeline(notes: CRMNote[], calls: CRMCallActivity[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...notes.map((note): TimelineEntry => ({
      kind: 'note', key: `note-${note.id}`, at: note.created_on, isAfterAudit: note.is_after_audit, note,
    })),
    ...calls.map((call): TimelineEntry => ({
      kind: 'call', key: `call-${call.id}`, at: call.occurred_on, isAfterAudit: call.is_after_audit, call,
    })),
  ]
  return entries.sort((a, b) => {
    const ta = timeOf(a.at)
    const tb = timeOf(b.at)
    if (ta === tb) return 0
    return tb > ta ? 1 : -1
  })
}

/** "(4 notes)", "(4 notes, 1 call)" or "(2 calls)". */
export function timelineCountLabel(entries: TimelineEntry[]): string {
  const calls = entries.filter((e) => e.kind === 'call').length
  const notes = entries.length - calls
  const parts: string[] = []
  if (notes > 0 || calls === 0) parts.push(`${notes} ${notes === 1 ? 'note' : 'notes'}`)
  if (calls > 0) parts.push(`${calls} ${calls === 1 ? 'call' : 'calls'}`)
  return `(${parts.join(', ')})`
}

/** CRM-style duration: "43s", "7m 43s", "1h 2m 5s". */
export function formatCallDuration(sec: number | null): string | null {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return null
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/** "+17017723971" -> "1 (701) 772-3971"; anything not NANP-shaped is returned as stored. */
export function formatPhoneNumber(raw: string | null): string | null {
  if (!raw) return null
  const d = raw.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) return `1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return raw
}

export function callAgentLabel(call: CRMCallActivity): string {
  return call.agent_name ?? (call.agent_id ? `User #${call.agent_id}` : 'Unknown')
}

/**
 * The CRM's one-line call summary:
 * "Called Brent Heid — 1 (701) 772-3971 | Direction: Outbound | Duration: 7m 43s | Agent: Jamie Waldie | Spoke With Intended Contact"
 */
export function callSummary(call: CRMCallActivity): string {
  const inbound = (call.direction ?? '').trim().toLowerCase() === 'inbound'
  const who = [call.contact_name, formatPhoneNumber(call.phone_number)].filter(Boolean).join(' — ')
  const parts = [`${inbound ? 'Call from' : 'Called'}${who ? ` ${who}` : ''}`]
  if (call.direction) parts.push(`Direction: ${call.direction}`)
  const duration = formatCallDuration(call.duration_sec)
  if (duration) parts.push(`Duration: ${duration}`)
  parts.push(`Agent: ${callAgentLabel(call)}`)
  if (call.disposition) parts.push(call.disposition)
  return parts.join(' | ')
}

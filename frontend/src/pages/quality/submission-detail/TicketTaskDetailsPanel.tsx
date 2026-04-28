import TicketTaskSelector, { type TicketTaskRef } from '@/components/common/TicketTaskSelector'

/**
 * Read-only viewer for the linked CRM tickets/tasks attached to a
 * submission. Mirrors `CallDetailsPanel` — wraps the underlying
 * `TicketTaskSelector` in `readOnly` mode (which hides Add / Cancel /
 * Remove and skips the radio + ID input form).
 *
 * `auditAt` enables the "At time of audit" / "Activity since audit"
 * note split. CRM data is fetched live by the selector itself; this
 * panel only owns the wrapping card chrome.
 */
interface Props {
  ticketTasks: TicketTaskRef[]
  auditAt?: string | null
}

export function TicketTaskDetailsPanel({ ticketTasks, auditAt }: Props) {
  if (!ticketTasks || ticketTasks.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 bg-white border-b border-slate-100">
        <h3 className="text-[15px] font-semibold text-slate-800">Ticket / Task Details</h3>
      </div>
      <div className="px-4 py-3">
        <TicketTaskSelector
          selected={ticketTasks}
          onChange={() => { /* read-only — no-op */ }}
          auditAt={auditAt}
          readOnly
        />
      </div>
    </div>
  )
}

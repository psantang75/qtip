import type { TicketTaskKind } from '@/services/crmService'

/**
 * Deep-link URL into the CRM for a ticket or task.
 *
 * Single source of truth for these URLs — the Quality ticket/task panel and the
 * Insights Missed Opportunities findings both link to the same records, and a
 * second copy of the host would drift the day the CRM moves.
 */
export function buildCrmUrl(kind: TicketTaskKind, externalId: number): string {
  if (kind === 'TASK') {
    return `https://crm.dm-us.com/TaskManager/AccountsReceivableManager?TaskID=${externalId}`
  }
  // Ticket edit page. CustomerID/JobID are populated server-side from the
  // ticket once it loads, so passing 0 for both is the canonical entry URL.
  return `https://crm.dm-us.com/Tickets/Edit?CustomerID=0&JobID=0&TicketID=${externalId}`
}

/**
 * Deep-link to an invoice's Order/Detail page in CRM.
 *
 * The Order/Detail page keys on BOTH the customer account and the order, so a
 * collections invoice row can only build this link when the warehouse carried the
 * customer id. Returns null when it did not, so the caller renders the invoice number
 * as plain text rather than a link that would land on the wrong account.
 */
export function buildCrmOrderUrl(customerId: number | null, orderId: number): string | null {
  if (!customerId) return null
  return `https://crm.dm-us.com/Order/Detail?CustomerID=${customerId}&OrderID=${orderId}`
}

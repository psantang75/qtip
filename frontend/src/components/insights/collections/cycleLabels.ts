/** Shared Cycle Performance / Cycle Invoices labels. */
export const RESULT_LABEL: Record<string, string> = {
  OK: 'Processed',
  DECLINED: 'Declined',
  ERROR: 'Submission Error',
  VOIDED: 'Charged Then Voided',
  IN_FLIGHT: 'Awaiting Settlement',
  NO_RESPONSE: 'Attempted · No Response',
  NO_CHARGE_EXPIRED: 'Never Attempted · Expired Card',
  NO_CHARGE: 'Never Attempted · No Request Sent',
  PENDING_ACH: 'ACH · No Result Recorded',
  ALREADY_SETTLED: 'Already Settled',
  OUTSTANDING: 'Still Outstanding',
}

export const GRID_FILTERS = [
  'DECLINED', 'OUTSTANDING', 'ERROR', 'VOIDED', 'IN_FLIGHT', 'NO_RESPONSE',
  'NO_CHARGE_EXPIRED', 'NO_CHARGE', 'ALREADY_SETTLED', 'PENDING_ACH', 'OK',
]

/**
 * Who took the payment, in the reader's language. The fact separates a member of staff
 * from the customer's own portal login from the automated run, and all three arrive
 * carrying a person's name — so the name alone cannot say which one it was.
 */
export const PAYER_LABEL: Record<string, string> = {
  AGENT: 'Internal agent',
  PORTAL: 'Portal user',
  SYSTEM: 'Automatic run',
}

export const INVOICE_PAGE_SIZE = 250

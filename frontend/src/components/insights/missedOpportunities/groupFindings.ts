/**
 * Group a day's findings for the performance review: agent (caller) then
 * customer, then the calls with that customer. Shared by the on-screen list
 * and its tests so the Word export can mirror the same order.
 */

export const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

export interface FindingLike {
  findingId: string
  callDate: string | null
  conversationId: string | null
  customerName: string | null
  category: string | null
  severity: string
}

export interface InteractionGroup<T> {
  key: string
  findings: T[]
}

export interface CustomerGroup<T> {
  customerName: string
  findings: T[]
  interactions: InteractionGroup<T>[]
}

export function customerLabel(f: { customerName: string | null }): string {
  const name = f.customerName?.trim()
  return name || 'Unknown caller'
}

export function interactionKey(f: {
  conversationId: string | null
  callDate: string | null
  findingId: string
}): string {
  return f.conversationId ?? `anon:${f.callDate ?? f.findingId}`
}

export function uniqueCategories(findings: { category: string | null }[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const f of findings) {
    const c = f.category?.trim()
    if (c && !seen.has(c)) {
      seen.add(c)
      out.push(c)
    }
  }
  return out
}

function byCallTime<T extends FindingLike>(a: T, b: T): number {
  const ta = a.callDate ? Date.parse(a.callDate) : 0
  const tb = b.callDate ? Date.parse(b.callDate) : 0
  return (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb)
}

function bySeverity<T extends FindingLike>(a: T, b: T): number {
  return (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)
}

function highCount<T extends FindingLike>(rows: T[]): number {
  return rows.filter((f) => f.severity === 'high').length
}

/** Customers with the worst misses first; calls inside a customer stay chronological. */
export function groupByCustomerThenInteraction<T extends FindingLike>(
  findings: T[],
): CustomerGroup<T>[] {
  const byCustomer = new Map<string, T[]>()
  for (const f of findings) {
    const key = customerLabel(f)
    const list = byCustomer.get(key)
    if (list) list.push(f)
    else byCustomer.set(key, [f])
  }

  const customers: CustomerGroup<T>[] = [...byCustomer.entries()].map(([customerName, rows]) => {
    const chronological = [...rows].sort(byCallTime)
    const ixOrder: string[] = []
    const byIx = new Map<string, T[]>()
    for (const f of chronological) {
      const k = interactionKey(f)
      if (!byIx.has(k)) {
        byIx.set(k, [])
        ixOrder.push(k)
      }
      byIx.get(k)!.push(f)
    }
    return {
      customerName,
      findings: [...rows].sort(bySeverity),
      interactions: ixOrder.map((key) => ({
        key,
        findings: [...(byIx.get(key) ?? [])].sort(bySeverity),
      })),
    }
  })

  customers.sort((a, b) => {
    const high = highCount(b.findings) - highCount(a.findings)
    if (high !== 0) return high
    const misses = b.findings.length - a.findings.length
    if (misses !== 0) return misses
    return a.customerName.localeCompare(b.customerName)
  })
  return customers
}

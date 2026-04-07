export interface DateRange   { start: Date; end: Date }
export interface PeriodRanges { current: DateRange; prior: DateRange }

function endOfDay(d: Date): Date {
  const n = new Date(d); n.setHours(23, 59, 59, 999); return n
}
function addDays(d: Date, days: number): Date {
  const n = new Date(d); n.setDate(n.getDate() + days); return n
}
function mondayOf(d: Date): Date {
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const n = new Date(d); n.setDate(n.getDate() + diff); n.setHours(0, 0, 0, 0); return n
}
function monthStart(y: number, m: number): Date { return new Date(y, m, 1) }
function monthEnd(y: number, m: number): Date   { return endOfDay(new Date(y, m + 1, 0)) }
function quarterStartMonth(d: Date): number     { return Math.floor(d.getMonth() / 3) * 3 }

export function resolvePeriod(
  period: string,
  customStart?: string,
  customEnd?: string,
): PeriodRanges {
  const norm  = period.toLowerCase().replace(/\s+/g, '_')
  const today = new Date()
  const y = today.getFullYear()
  const m = today.getMonth()

  switch (norm) {
    case 'current_week': {
      const mon  = mondayOf(today)
      const pMon = addDays(mon, -7)
      return {
        current: { start: mon,  end: endOfDay(addDays(mon, 6)) },
        prior:   { start: pMon, end: endOfDay(addDays(mon, -1)) },
      }
    }
    case 'prior_week': {
      const thisMon = mondayOf(today)
      const pMon    = addDays(thisMon, -7)
      const ppMon   = addDays(thisMon, -14)
      return {
        current: { start: pMon,  end: endOfDay(addDays(thisMon, -1)) },
        prior:   { start: ppMon, end: endOfDay(addDays(pMon,   -1)) },
      }
    }
    case 'current_month': {
      const cStart = monthStart(y, m)
      const pStart = monthStart(y, m - 1)
      const daysIn = today.getDate()
      const pDaysMax = new Date(y, m, 0).getDate()
      const pEnd = new Date(y, m - 1, Math.min(daysIn, pDaysMax))
      return {
        current: { start: cStart, end: endOfDay(today) },
        prior:   { start: pStart, end: endOfDay(pEnd) },
      }
    }
    case 'prior_month': {
      const cStart = monthStart(y, m - 1)
      const cEnd   = monthEnd(y, m - 1)
      return {
        current: { start: cStart,          end: cEnd },
        prior:   { start: monthStart(y, m - 2), end: monthEnd(y, m - 2) },
      }
    }
    case 'current_quarter': {
      const qm     = quarterStartMonth(today)
      const qStart = monthStart(y, qm)
      const pqStart = new Date(y, qm - 3, 1)
      const pqEnd   = new Date(y, qm, 0)
      const daysIn  = Math.floor((today.getTime() - qStart.getTime()) / 86400000) + 1
      const pEnd    = endOfDay(new Date(Math.min(addDays(pqStart, daysIn - 1).getTime(), pqEnd.getTime())))
      return {
        current: { start: qStart,  end: endOfDay(today) },
        prior:   { start: pqStart, end: pEnd },
      }
    }
    case 'prior_quarter': {
      const qm     = quarterStartMonth(today)
      const pqStart = new Date(y, qm - 3, 1)
      const pqEnd   = monthEnd(y, qm - 1)
      return {
        current: { start: pqStart,          end: pqEnd },
        prior:   { start: new Date(y, qm - 6, 1), end: monthEnd(y, qm - 4) },
      }
    }
    case 'current_year': {
      const start  = new Date(y, 0, 1)
      const pStart = new Date(y - 1, 0, 1)
      const daysIn = Math.floor((today.getTime() - start.getTime()) / 86400000) + 1
      return {
        current: { start, end: endOfDay(today) },
        prior:   { start: pStart, end: endOfDay(addDays(pStart, daysIn - 1)) },
      }
    }
    case 'prior_year': {
      return {
        current: { start: new Date(y - 1, 0, 1), end: endOfDay(new Date(y - 1, 11, 31)) },
        prior:   { start: new Date(y - 2, 0, 1), end: endOfDay(new Date(y - 2, 11, 31)) },
      }
    }
    case 'custom': {
      if (!customStart || !customEnd) return resolvePeriod('current_month')
      const start  = new Date(customStart + 'T00:00:00')
      const end    = endOfDay(new Date(customEnd + 'T00:00:00'))
      const spanMs = end.getTime() - start.getTime()
      const pEnd   = new Date(start.getTime() - 1)
      return {
        current: { start, end },
        prior:   { start: new Date(pEnd.getTime() - spanMs), end: endOfDay(pEnd) },
      }
    }
    default:
      return resolvePeriod('current_month')
  }
}

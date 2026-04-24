/**
 * Pure-function tests for shared date helpers.
 *
 * The functions in `dateFormat.ts` are touched by every list, detail, and
 * PDF view, so even small regressions (e.g. UTC vs local interpretation of
 * `YYYY-MM-DD`) ripple across the app. These tests pin the behavior the
 * rest of the codebase assumes — see pre-production review item #47.
 */

import { describe, expect, it } from 'vitest'
import {
  fmtLocal,
  formatMetadataDate,
  formatQualityDate,
  formatQualityDateLong,
  priorNinetyDays,
} from '../dateFormat'

describe('formatQualityDate', () => {
  it('returns em-dash for null / undefined / empty', () => {
    expect(formatQualityDate(null)).toBe('—')
    expect(formatQualityDate(undefined)).toBe('—')
    expect(formatQualityDate('')).toBe('—')
  })

  it('parses YYYY-MM-DD as local time (no UTC midnight shift)', () => {
    // The whole point of the special-case in dateFormat.ts: a `2026-03-24`
    // string must always render as Mar 24 regardless of TZ.
    expect(formatQualityDate('2026-03-24')).toBe('Mar 24, 2026')
  })

  it('handles datetime strings by stripping the time component', () => {
    expect(formatQualityDate('2026-03-24T15:42:00Z')).toBe('Mar 24, 2026')
  })

  it('returns em-dash on garbage input', () => {
    expect(formatQualityDate('not-a-date')).toBe('—')
  })
})

describe('formatQualityDateLong', () => {
  it('uses long month names for PDF-style output', () => {
    expect(formatQualityDateLong('2026-04-14')).toBe('April 14, 2026')
  })
})

describe('formatMetadataDate', () => {
  it('renders a YYYY-MM-DD metadata field as short month/day/year', () => {
    expect(formatMetadataDate('2026-03-24')).toBe('Mar 24, 2026')
  })

  it('passes through anything that isn\'t a YYYY-MM-DD string', () => {
    expect(formatMetadataDate('not-a-date')).toBe('not-a-date')
  })
})

describe('fmtLocal', () => {
  it('zero-pads month and day', () => {
    expect(fmtLocal(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(fmtLocal(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})

describe('priorNinetyDays', () => {
  it('returns a 90-day window ending today, both as YYYY-MM-DD', () => {
    const { from, to } = priorNinetyDays()
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const fromMs = new Date(from).getTime()
    const toMs   = new Date(to).getTime()
    const days   = Math.round((toMs - fromMs) / 86_400_000)
    expect(days).toBe(90)
  })
})

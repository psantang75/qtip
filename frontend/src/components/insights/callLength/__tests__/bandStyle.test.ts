/**
 * The wrap parts are phased out by the phone system rather than by us, so the
 * chart has to follow the data: a part with no time anywhere in the period
 * leaves the bars and the legend, and one with time in any bucket stays.
 */
import { describe, it, expect } from 'vitest'
import { visibleWrapSeries, WRAP_SERIES } from '../bandStyle'
import type { BandTotal } from '@/types/callLength'

const band = (over: Partial<BandTotal> = {}): BandTotal => ({
  key: 'm2_5', label: '2-5 min', calls: 10, pctCalls: 50, handleHours: 1,
  wrapHours: 0, wrapExtendedHours: 0, wrapPendingHours: 0, pctTime: 50, avgMin: 3,
  ...over,
})

const labels = (bands: BandTotal[]) => visibleWrapSeries(bands).map(s => s.label)

describe('visibleWrapSeries', () => {
  it('shows all three parts, in order, for a period that has all three', () => {
    expect(labels([band({ wrapHours: 1, wrapExtendedHours: 0.1, wrapPendingHours: 0.4 })]))
      .toEqual(['Wrap', 'Wrap Extended', 'Wrap Pending'])
  })

  it('shows only Wrap Pending once wrap and wrap extended are retired', () => {
    expect(labels([band({ wrapPendingHours: 0.7 }), band({ key: 'o20', wrapPendingHours: 2 })]))
      .toEqual(['Wrap Pending'])
  })

  it('keeps a part that has time in any one bucket', () => {
    expect(labels([band(), band({ key: 'o20', wrapExtendedHours: 0.1 })])).toEqual(['Wrap Extended'])
  })

  it('shows nothing for a period with no after-call time', () => {
    expect(visibleWrapSeries([band(), band({ key: 'o20' })])).toEqual([])
    expect(visibleWrapSeries([])).toEqual([])
  })

  it('keeps every part on the brand warning colour, told apart by opacity', () => {
    expect(new Set(WRAP_SERIES.map(s => s.fill))).toEqual(new Set(['#f39c12']))
    expect(new Set(WRAP_SERIES.map(s => s.fillOpacity)).size).toBe(WRAP_SERIES.length)
  })
})

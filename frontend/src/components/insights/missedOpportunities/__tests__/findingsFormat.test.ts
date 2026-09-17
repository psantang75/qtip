import { describe, it, expect } from 'vitest'
import { formatCallStamp, formatDirection, formatTalkMins } from '../findingsFormat'

describe('findingsFormat', () => {
  it('capitalizes direction and rounds talk time to minutes', () => {
    expect(formatDirection('inbound')).toBe('Inbound')
    expect(formatDirection(null)).toBe('Call')
    expect(formatTalkMins(420)).toBe('7 min')
  })

  it('splits a call instant into a local date and time', () => {
    const stamp = formatCallStamp('2026-09-04T13:42:00.000Z')
    expect(stamp).not.toBeNull()
    expect(stamp!.date).toMatch(/Sep 4, 2026/)
    expect(stamp!.time).toMatch(/\d{1,2}:\d{2} [AP]M/)
  })
})

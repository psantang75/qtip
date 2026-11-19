import { describe, expect, it } from 'vitest'
import type { CRMCallActivity, CRMNote } from '@/services/crmService'
import {
  buildTimeline,
  callSummary,
  formatCallDuration,
  formatPhoneNumber,
  timelineCountLabel,
} from '../crmTimeline'

const call = (over: Partial<CRMCallActivity> = {}): CRMCallActivity => ({
  id: 2634,
  conversation_id: 'conv-2634',
  occurred_on: '2026-11-18T22:11:49.000Z',
  direction: 'Outbound',
  phone_number: '+17017723971',
  contact_name: 'Brent Heid',
  duration_sec: 463,
  disposition: 'Spoke With Intended Contact',
  agent_id: 81,
  agent_name: 'Jamie Waldie',
  wrap_up: 'During the CM call Brent mentioned a new location.',
  is_after_audit: false,
  ...over,
})

const note = (id: number, createdOn: string | null, over: Partial<CRMNote> = {}): CRMNote => ({
  id,
  created_on: createdOn,
  created_by: 81,
  created_by_name: 'Jamie Waldie',
  note: `note ${id}`,
  status_after: null,
  next_contact_date: null,
  is_after_audit: false,
  ...over,
})

describe('callSummary', () => {
  it('matches the CRM call line for an outbound call', () => {
    expect(callSummary(call())).toBe(
      'Called Brent Heid — 1 (701) 772-3971 | Direction: Outbound | Duration: 7m 43s | Agent: Jamie Waldie | Spoke With Intended Contact',
    )
  })

  it('reads "Call from" on inbound calls and skips missing parts', () => {
    expect(callSummary(call({
      direction: 'Inbound', contact_name: null, duration_sec: null, disposition: null,
    }))).toBe('Call from 1 (701) 772-3971 | Direction: Inbound | Agent: Jamie Waldie')
  })

  it('falls back to the agent user id when the name did not resolve', () => {
    expect(callSummary(call({ agent_name: null }))).toContain('Agent: User #81')
  })
})

describe('formatCallDuration', () => {
  it('formats seconds the way the CRM does', () => {
    expect(formatCallDuration(43)).toBe('43s')
    expect(formatCallDuration(463)).toBe('7m 43s')
    expect(formatCallDuration(3725)).toBe('1h 2m 5s')
    expect(formatCallDuration(0)).toBe('0s')
  })

  it('returns null when there is no usable duration', () => {
    expect(formatCallDuration(null)).toBeNull()
    expect(formatCallDuration(-1)).toBeNull()
  })
})

describe('formatPhoneNumber', () => {
  it('formats NANP numbers and leaves others as stored', () => {
    expect(formatPhoneNumber('+17017723971')).toBe('1 (701) 772-3971')
    expect(formatPhoneNumber('7017723971')).toBe('(701) 772-3971')
    expect(formatPhoneNumber('+442071234567')).toBe('+442071234567')
    expect(formatPhoneNumber(null)).toBeNull()
  })
})

describe('buildTimeline', () => {
  it('interleaves notes and calls newest first, undated rows last', () => {
    const entries = buildTimeline(
      [note(1, '2026-11-18T20:00:00.000Z'), note(2, null), note(3, '2026-11-19T15:00:00.000Z')],
      [call()],
    )
    expect(entries.map((e) => e.key)).toEqual(['note-3', 'call-2634', 'note-1', 'note-2'])
  })

  it('carries each source row\'s before/after-audit flag', () => {
    const entries = buildTimeline(
      [note(1, '2026-11-18T20:00:00.000Z')],
      [call({ is_after_audit: true })],
    )
    expect(entries.find((e) => e.kind === 'call')?.isAfterAudit).toBe(true)
    expect(entries.find((e) => e.kind === 'note')?.isAfterAudit).toBe(false)
  })
})

describe('timelineCountLabel', () => {
  it('only mentions calls when there are some', () => {
    expect(timelineCountLabel(buildTimeline([note(1, null)], []))).toBe('(1 note)')
    expect(timelineCountLabel(buildTimeline([note(1, null), note(2, null)], [call()]))).toBe('(2 notes, 1 call)')
    expect(timelineCountLabel(buildTimeline([], [call(), call({ id: 2 })]))).toBe('(2 calls)')
  })
})

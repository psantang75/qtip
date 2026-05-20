/**
 * Pure-function tests for the ManualRunCard's attached-sources helpers.
 *
 * The React component is a thin wrapper around these — pinning the
 * data transformations here gives us coverage of the request body
 * shape and the run-button gate without needing a DOM test runner.
 */

import { describe, it, expect } from 'vitest'
import {
  canRunManual,
  nextAttachedDefault,
  trimAttachedSources,
} from '../manualRunCardState'

describe('nextAttachedDefault', () => {
  it('suggests CONVERSATION when the primary is a TICKET', () => {
    expect(nextAttachedDefault('TICKET')).toBe('CONVERSATION')
  })
  it('suggests CONVERSATION when the primary is a TASK', () => {
    expect(nextAttachedDefault('TASK')).toBe('CONVERSATION')
  })
  it('suggests TICKET when the primary is a CONVERSATION', () => {
    expect(nextAttachedDefault('CONVERSATION')).toBe('TICKET')
  })
})

describe('trimAttachedSources', () => {
  it('returns [] for an empty list', () => {
    expect(trimAttachedSources([])).toEqual([])
  })

  it('trims whitespace on external_id', () => {
    expect(
      trimAttachedSources([{ kind: 'CONVERSATION', external_id: '  abc-123  ' }])
    ).toEqual([{ kind: 'CONVERSATION', external_id: 'abc-123' }])
  })

  it('drops rows whose id is empty / whitespace-only', () => {
    expect(
      trimAttachedSources([
        { kind: 'TICKET', external_id: '42' },
        { kind: 'TASK', external_id: '   ' },
        { kind: 'CONVERSATION', external_id: '' },
      ])
    ).toEqual([{ kind: 'TICKET', external_id: '42' }])
  })

  it('preserves the row order across the filter', () => {
    expect(
      trimAttachedSources([
        { kind: 'TICKET', external_id: '1' },
        { kind: 'CONVERSATION', external_id: 'abc' },
        { kind: 'TASK', external_id: '7' },
      ])
    ).toEqual([
      { kind: 'TICKET', external_id: '1' },
      { kind: 'CONVERSATION', external_id: 'abc' },
      { kind: 'TASK', external_id: '7' },
    ])
  })
})

describe('canRunManual', () => {
  it('blocks when the primary id is blank', () => {
    expect(canRunManual('', [])).toBe(false)
    expect(canRunManual('   ', [])).toBe(false)
  })

  it('allows a single-source run with no attachments', () => {
    expect(canRunManual('42', [])).toBe(true)
  })

  it('allows when every attached row has a non-empty id', () => {
    expect(
      canRunManual('42', [
        { kind: 'CONVERSATION', external_id: 'abc-123' },
        { kind: 'TICKET', external_id: '7' },
      ])
    ).toBe(true)
  })

  it('blocks when any attached row is empty (in-progress edit)', () => {
    expect(
      canRunManual('42', [
        { kind: 'CONVERSATION', external_id: 'abc-123' },
        { kind: 'TICKET', external_id: '   ' },
      ])
    ).toBe(false)
  })
})

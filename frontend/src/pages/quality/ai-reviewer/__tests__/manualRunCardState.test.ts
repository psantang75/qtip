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
  normalizeAttachedSources,
  normalizeManualRunId,
} from '../manualRunCardState'

const CONVERSATION_ID = '4c397ac5-ec9a-40ed-9235-c046f2e6f927'
const GENESYS_URL =
  `https://apps.usw2.pure.cloud/directory/#/analytics/interactions/${CONVERSATION_ID}/admin%22`

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

describe('normalizeManualRunId', () => {
  it('reduces a pasted Genesys URL to the conversation id', () => {
    expect(normalizeManualRunId('CONVERSATION', GENESYS_URL)).toBe(CONVERSATION_ID)
  })

  it('trims a conversation id entered on its own', () => {
    expect(normalizeManualRunId('CONVERSATION', `  ${CONVERSATION_ID} `)).toBe(CONVERSATION_ID)
  })

  it('only trims ticket and task ids, which are plain numbers', () => {
    expect(normalizeManualRunId('TICKET', ' 279046 ')).toBe('279046')
    expect(normalizeManualRunId('TASK', ' 12345 ')).toBe('12345')
  })

  it('leaves a URL pasted under TICKET alone rather than guessing', () => {
    expect(normalizeManualRunId('TICKET', GENESYS_URL)).toBe(GENESYS_URL)
  })
})

describe('normalizeAttachedSources', () => {
  it('returns [] for an empty list', () => {
    expect(normalizeAttachedSources([])).toEqual([])
  })

  it('trims whitespace on external_id', () => {
    expect(
      normalizeAttachedSources([{ kind: 'CONVERSATION', external_id: '  abc-123  ' }])
    ).toEqual([{ kind: 'CONVERSATION', external_id: 'abc-123' }])
  })

  it('reduces a pasted Genesys URL on a CONVERSATION row to the id', () => {
    expect(
      normalizeAttachedSources([{ kind: 'CONVERSATION', external_id: GENESYS_URL }])
    ).toEqual([{ kind: 'CONVERSATION', external_id: CONVERSATION_ID }])
  })

  it('drops rows whose id is empty / whitespace-only', () => {
    expect(
      normalizeAttachedSources([
        { kind: 'TICKET', external_id: '42' },
        { kind: 'TASK', external_id: '   ' },
        { kind: 'CONVERSATION', external_id: '' },
      ])
    ).toEqual([{ kind: 'TICKET', external_id: '42' }])
  })

  it('preserves the row order across the filter', () => {
    expect(
      normalizeAttachedSources([
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

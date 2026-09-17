/**
 * The banner is a disclosure, so both halves of the rule matter: it has to
 * appear when a load is in flight or actually broken, and stay away when a
 * leftover NULL stamp would otherwise scream "never run".
 */
import { describe, it, expect } from 'vitest'
import { summariseFreshness } from '../cycleFreshness'

const NOW = new Date('2026-09-14T12:00:00Z').getTime()

const dep = (over: Partial<{
  code: string; label: string; lastRunAt: string | null;
  nextRunAt: string | null; status: string | null; isActive: boolean
}> = {}) => ({
  code: 'collections_invoice',
  label: 'Invoices',
  lastRunAt: '2026-09-14T06:00:00Z',
  nextRunAt: '2026-09-15T06:00:00Z',
  status: 'SUCCESS',
  isActive: true,
  ...over,
})

describe('summariseFreshness', () => {
  it('says nothing when every input loaded healthily and together', () => {
    const { show } = summariseFreshness([
      dep(),
      dep({ code: 'collections_billing', label: 'Gateway Results' }),
    ], NOW)

    expect(show).toBe(false)
  })

  it('does not treat leftover unstamped members as never-run', () => {
    const { show } = summariseFreshness([
      dep(),
      dep({ code: 'collections_billing', label: 'Gateway Results', lastRunAt: null, status: null }),
    ], NOW)

    expect(show).toBe(false)
  })

  it('speaks up when the finished stamps are a day apart', () => {
    const { show } = summariseFreshness([
      dep(),
      dep({
        code: 'collections_task', label: 'AR Tasks', lastRunAt: '2026-09-07T06:00:00Z',
      }),
    ], NOW)

    expect(show).toBe(true)
  })

  it('treats a true empty registry as a problem', () => {
    const { show, lines } = summariseFreshness([
      dep({ lastRunAt: null, status: null }),
    ], NOW)

    expect(show).toBe(true)
    expect(lines[0]).toMatchObject({ state: 'no stamp yet', isProblem: true })
  })

  it('flags a switched-off schedule', () => {
    const { show, lines } = summariseFreshness([dep({ isActive: false })], NOW)

    expect(show).toBe(true)
    expect(lines[0].state).toContain('schedule is off')
  })

  it('flags a failed run while still saying when the last good data arrived', () => {
    const { show, lines } = summariseFreshness([dep({ status: 'FAILED' })], NOW)

    expect(show).toBe(true)
    expect(lines[0].state).toBe('loaded 6h ago · last run failed')
  })

  it('while a load is running, names waiting steps instead of never-run', () => {
    const { show, loading, lines } = summariseFreshness([
      dep({ lastRunAt: '2026-09-14T11:50:00Z' }),
      dep({ code: 'collections_billing', label: 'Gateway Results', lastRunAt: null, status: null }),
    ], NOW, true)

    expect(show).toBe(true)
    expect(loading).toBe(true)
    expect(lines[1]).toMatchObject({ state: 'waiting in this load', isProblem: false })
  })

  it('reports age in the unit a reader thinks in', () => {
    const lines = summariseFreshness([
      dep({ lastRunAt: '2026-09-14T11:45:00Z' }),
      dep({ code: 'b', lastRunAt: '2026-09-14T03:00:00Z' }),
      dep({ code: 'c', lastRunAt: '2026-09-11T12:00:00Z' }),
    ], NOW).lines.map(l => l.state)

    expect(lines).toEqual(['loaded just now', 'loaded 9h ago', 'loaded 3d ago'])
  })
})

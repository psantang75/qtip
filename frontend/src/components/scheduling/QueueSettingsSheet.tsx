/**
 * Everything about how a department's queues are planned, on one surface.
 *
 * This replaces two dialogs that were reached from two different controls: one
 * for the rules and each queue's numbers, another for who can take a single
 * queue, opened from a dropdown in the page header. Setting a queue's minimum
 * to three and checking whether three people can actually take it is one
 * thought, so it is now one sheet with one Save — each queue row expands to
 * reveal its own membership.
 *
 * Membership is read from the department roster, which already returns every
 * person with the queues they belong to, so opening the sheet costs one request
 * rather than one per queue. It is written back per queue, because that is the
 * shape of the API: a PUT replaces one queue's membership for the people the
 * caller can manage, leaving another department's side of a shared queue alone.
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { ListLoadingSkeleton } from '@/components/common/ListLoadingSkeleton'
import { useToast } from '@/hooks/use-toast'
import { t } from '@/lib/t'
import { cn } from '@/lib/utils'
import { optionCls } from '@/utils/forms/optionCls'
import phoneQueueService, {
  type ApiDepartmentQueue, type ApiQueuePolicy, type FillStrategy,
} from '@/services/phoneQueueService'
import { phoneQueueKeys } from '@/services/phoneQueueQueryKeys'
import { QueueMemberRows, type MemberDraft } from './QueueMemberRows'

const num = 'h-8 w-16 rounded-md border border-slate-200 bg-white px-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/40'
const GRID = 'grid grid-cols-[1.25rem_2.5rem_1fr_4.5rem_4rem_4rem_4rem] items-center gap-2'

const STRATEGIES: Array<{ id: FillStrategy; label: string }> = [
  { id: 'PRIORITY', label: 'By priority' },
  { id: 'ROUND_ROBIN', label: 'Round robin' },
]

const key = (queueId: number, userId: number) => `${queueId}:${userId}`

function NumberCell({ value, onChange, min = 0, title }: {
  value: number | null
  onChange: (v: number | null) => void
  min?: number
  title: string
}) {
  return (
    <input type="number" className={num} title={title} min={min} value={value ?? ''}
      placeholder={value === null ? '—' : undefined}
      onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} />
  )
}

function Rule({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <Label className="text-[13px]">{label}</Label>
        <p className="text-[12px] text-slate-500">{hint}</p>
      </div>
      {children}
    </div>
  )
}

export function QueueSettingsSheet({ departmentId, open, onOpenChange }: {
  departmentId: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const qc = useQueryClient()
  const { toast } = useToast()

  const [rows, setRows] = useState<ApiDepartmentQueue[] | null>(null)
  const [policy, setPolicy] = useState<ApiQueuePolicy | null>(null)
  const [members, setMembers] = useState<Record<string, MemberDraft>>({})
  const [dirtyQueues, setDirtyQueues] = useState<Set<number>>(new Set())
  const [expanded, setExpanded] = useState<number | null>(null)

  const queuesQ = useQuery({
    queryKey: phoneQueueKeys.departmentQueues(departmentId),
    queryFn: () => phoneQueueService.getDepartmentQueues(departmentId),
    enabled: open,
  })
  const policyQ = useQuery({
    queryKey: phoneQueueKeys.policy(departmentId),
    queryFn: () => phoneQueueService.getPolicy(departmentId),
    enabled: open,
  })
  const rosterQ = useQuery({
    queryKey: phoneQueueKeys.roster(departmentId),
    queryFn: () => phoneQueueService.getRoster(departmentId),
    enabled: open,
  })

  const people = useMemo(() => rosterQ.data?.people ?? [], [rosterQ.data])

  // Seed the local draft from server state. This must key off `open` as well as
  // the query data: React Query hands back a structurally-shared (same-reference)
  // object when a refetch matches the cache, so after the sheet is closed — which
  // blanks the draft to null — a plain `[data]` effect would never re-fire on
  // reopen and the sheet would sit on its skeleton forever (loading gates on
  // `!rows || !policy`). Re-seeding on the open transition fixes that.
  useEffect(() => { if (open && queuesQ.data) setRows(queuesQ.data.queues) }, [open, queuesQ.data])
  useEffect(() => { if (open && policyQ.data) setPolicy(policyQ.data) }, [open, policyQ.data])
  useEffect(() => {
    if (!open || !queuesQ.data || !rosterQ.data) return
    const next: Record<string, MemberDraft> = {}
    for (const q of queuesQ.data.queues) {
      for (const p of rosterQ.data.people) {
        const m = p.queues.find(x => x.queue_id === q.queue_id)
        next[key(q.queue_id, p.user_id)] = {
          member: !!m,
          is_home: m?.is_home ?? false,
          person_priority: m?.person_priority ?? 100,
          is_pinned: m?.is_pinned ?? false,
        }
      }
    }
    setMembers(next)
    setDirtyQueues(new Set())
  }, [open, queuesQ.data, rosterQ.data])
  useEffect(() => {
    if (open) return
    setRows(null); setPolicy(null); setMembers({}); setDirtyQueues(new Set()); setExpanded(null)
  }, [open])

  const patchQueue = (queueId: number, next: Partial<ApiDepartmentQueue>) =>
    setRows(cur => (cur ?? []).map(r => r.queue_id === queueId ? { ...r, ...next } : r))

  /**
   * Adopting a home queue drops the person's previous one, in the draft as well
   * as on the server. Doing it here keeps the two other queue rows honest while
   * the sheet is still open, instead of the change appearing after a save.
   */
  const patchMember = (queueId: number, userId: number, next: Partial<MemberDraft>) => {
    const touched = new Set(dirtyQueues).add(queueId)
    setMembers(cur => {
      const out = { ...cur, [key(queueId, userId)]: { ...cur[key(queueId, userId)], ...next } }
      if (next.is_home) {
        for (const r of rows ?? []) {
          if (r.queue_id === queueId) continue
          const k = key(r.queue_id, userId)
          if (!out[k]?.is_home) continue
          out[k] = { ...out[k], is_home: false }
          touched.add(r.queue_id)
        }
      }
      return out
    })
    setDirtyQueues(touched)
  }

  const homeQueueNameOf = (queueId: number, userId: number): string | null => {
    for (const r of rows ?? []) {
      if (r.queue_id === queueId) continue
      if (members[key(r.queue_id, userId)]?.is_home) return r.queue_name
    }
    return null
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      if (policy) {
        await phoneQueueService.savePolicy(departmentId, {
          is_enabled: policy.is_enabled,
          max_queues_per_person: policy.max_queues_per_person,
          require_min_one_per_queue: policy.require_min_one_per_queue,
          respect_pins: policy.respect_pins,
          fill_strategy: policy.fill_strategy,
        })
      }
      await phoneQueueService.saveDepartmentQueues(
        departmentId,
        (rows ?? []).filter(r => r.assigned).map(r => ({
          queue_id: r.queue_id,
          is_active: r.is_active,
          fill_priority: r.fill_priority,
          min_agents: r.min_agents,
          target_agents: r.target_agents,
          max_agents: r.max_agents,
          // Time-of-day windows have no editor yet and the solver honours them,
          // so they are round-tripped rather than silently dropped.
          windows: r.windows,
        })),
      )
      for (const queueId of dirtyQueues) {
        await phoneQueueService.saveQueueMembers(
          queueId,
          people
            .filter(p => members[key(queueId, p.user_id)]?.member)
            .map(p => {
              const d = members[key(queueId, p.user_id)]
              return {
                user_id: p.user_id,
                is_home: d.is_home,
                person_priority: d.person_priority,
                is_pinned: d.is_pinned,
              }
            }),
        )
      }
    },
    onSuccess: () => {
      // Membership is global, so a shared queue's other department is stale too.
      qc.invalidateQueries({ queryKey: phoneQueueKeys.all })
      toast({ title: 'Queue settings saved' })
      onOpenChange(false)
    },
    onError: (e) => toast(t.fromError(e)),
  })

  const loading = queuesQ.isLoading || policyQ.isLoading || rosterQ.isLoading || !rows || !policy

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="space-y-1 border-b border-slate-200 p-5">
          <SheetTitle>Queue settings — {queuesQ.data?.department_name ?? 'department'}</SheetTitle>
          <SheetDescription>
            Turn on the queues this department staffs, set its numbers for each, and open a
            queue to say who can take it.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? <ListLoadingSkeleton rows={6} /> : (
            <div className="space-y-5">
              <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                <Rule label="Plan queue coverage for this department"
                  hint="Off means the page shows nothing and no queue is solved.">
                  <Switch checked={policy.is_enabled} onCheckedChange={v => setPolicy({ ...policy, is_enabled: v })} />
                </Rule>
                <Rule label="Every queue needs at least one person"
                  hint="Fills each queue with a body before any queue reaches its minimum. A queue with nobody in it does not ring.">
                  <Switch checked={policy.require_min_one_per_queue}
                    onCheckedChange={v => setPolicy({ ...policy, require_min_one_per_queue: v })} />
                </Rule>
                <Rule label="Respect pins"
                  hint="A pinned person is never moved, however short another queue is.">
                  <Switch checked={policy.respect_pins} onCheckedChange={v => setPolicy({ ...policy, respect_pins: v })} />
                </Rule>
                <Rule label="Who covers when several people could"
                  hint="Round robin spreads cover duty by preferring whoever has done least of it so far that day.">
                  <div className="flex shrink-0 gap-1">
                    {STRATEGIES.map(s => (
                      <button key={s.id} type="button" onClick={() => setPolicy({ ...policy, fill_strategy: s.id })}
                        className={cn('h-8 rounded border px-3 text-[12px] font-medium transition-all',
                          optionCls(policy.fill_strategy === s.id))}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </Rule>
                <Rule label="Queues one person can cover at once"
                  hint="Raise above one only if your phone system really rings somebody for several queues.">
                  <input type="number" className={num} min={1} max={10} value={policy.max_queues_per_person}
                    onChange={e => setPolicy({ ...policy, max_queues_per_person: Math.max(1, Number(e.target.value) || 1) })} />
                </Rule>
              </section>

              <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className={cn(GRID, 'border-b border-slate-100 bg-slate-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500')}>
                  <span />
                  <span />
                  <span>Queue</span>
                  <span title="Lower is filled first">Fill order</span>
                  <span>Min</span>
                  <span>Target</span>
                  <span>Max</span>
                </div>

                {rows.map(r => {
                  const isOpen = expanded === r.queue_id
                  const takes = people.filter(p => members[key(r.queue_id, p.user_id)]?.member).length
                  return (
                    <div key={r.queue_id} className="border-b border-slate-100 last:border-b-0">
                      <div className={cn(GRID, 'px-3 py-2', !r.assigned && 'opacity-45')}>
                        <button type="button" aria-label={isOpen ? 'Hide members' : 'Show members'}
                          onClick={() => setExpanded(isOpen ? null : r.queue_id)}
                          className="text-slate-400 transition-colors hover:text-primary">
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                        <Switch checked={r.assigned} className="scale-75"
                          onCheckedChange={v => patchQueue(r.queue_id, { assigned: v, is_active: v })} />
                        <button type="button" onClick={() => setExpanded(isOpen ? null : r.queue_id)}
                          className="flex items-center gap-2 truncate text-left text-[13px] text-slate-700 hover:text-primary">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
                          <span className="truncate">{r.queue_name}</span>
                          <span className="shrink-0 text-[11px] text-slate-400">{takes} can take it</span>
                        </button>
                        <NumberCell value={r.fill_priority} min={1} title="Lower is filled first"
                          onChange={v => patchQueue(r.queue_id, { fill_priority: v ?? 1 })} />
                        <NumberCell value={r.min_agents} title="Fewest people this queue can run on"
                          onChange={v => patchQueue(r.queue_id, { min_agents: v ?? 0 })} />
                        <NumberCell value={r.target_agents} title="What this queue should have when there are people to spare"
                          onChange={v => patchQueue(r.queue_id, { target_agents: v ?? 0 })} />
                        <NumberCell value={r.max_agents} title="Leave blank for no cap"
                          onChange={v => patchQueue(r.queue_id, { max_agents: v })} />
                      </div>

                      {isOpen && (
                        <QueueMemberRows
                          people={people}
                          draft={Object.fromEntries(people.map(p => [p.user_id, members[key(r.queue_id, p.user_id)]]))}
                          onPatch={(userId, next) => patchMember(r.queue_id, userId, next)}
                          homeQueueNameOf={userId => homeQueueNameOf(r.queue_id, userId)}
                        />
                      )}
                    </div>
                  )
                })}

                {rows.length === 0 && (
                  <div className="p-8 text-center text-[13px] text-slate-400">
                    No queues in the library yet. An admin adds them in List Management → Scheduling → Phone Queues.
                  </div>
                )}
              </section>
            </div>
          )}
        </div>

        <SheetFooter className="border-t border-slate-200 p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => saveMut.mutate()} disabled={loading || saveMut.isPending}>
            {saveMut.isPending ? 'Saving\u2026' : 'Save'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

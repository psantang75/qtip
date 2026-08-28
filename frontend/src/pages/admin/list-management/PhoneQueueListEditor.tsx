/**
 * Phone queue LIBRARY editor (List Management → Scheduling → Phone Queues).
 *
 * The global set of queues that exist at all. Flatter than the campaign library
 * — one level, no timing rules — so it mirrors that editor's row structure and
 * drag-sort without the category block. Sort order is the tie-breaker the solver
 * uses when two queues share a fill priority, and the order they render in on
 * the coverage page.
 *
 * A department decides which of these it staffs and what its minimums are; that
 * lives on the Phone Queues page, not here, because those numbers differ per
 * department. Admin-only writes — the backend re-checks admin on every mutation.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { CSS } from '@dnd-kit/utilities'
import { Plus, Pencil, Eye, EyeOff, Check, X, GripVertical, Building2 } from 'lucide-react'

import { ListLoadingSkeleton } from '@/components/common/ListLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { ColorSwatchPicker } from '@/components/common/ColorSwatchPicker'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import phoneQueueService, { type ApiPhoneQueue } from '@/services/phoneQueueService'
import { phoneQueueKeys } from '@/services/phoneQueueQueryKeys'

const inp = 'h-8 px-2 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-primary/40'
const KEY = phoneQueueKeys.library(true)

function QueueRow({ queue, onSave, onToggle }: {
  queue: ApiPhoneQueue
  onSave: (id: number, patch: Record<string, unknown>) => void
  onToggle: (queue: ApiPhoneQueue) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: queue.id })
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(queue.queue_name)
  const [code, setCode] = useState(queue.queue_code ?? '')
  const [description, setDescription] = useState(queue.description ?? '')
  const style = { transform: CSS.Transform.toString(transform), transition }

  const commit = () => {
    if (!name.trim()) return
    onSave(queue.id, { queue_name: name.trim(), queue_code: code.trim() || null, description: description.trim() || null })
    setEditing(false)
  }
  const cancel = () => {
    setName(queue.queue_name); setCode(queue.queue_code ?? ''); setDescription(queue.description ?? '')
    setEditing(false)
  }

  if (editing) {
    return (
      <div ref={setNodeRef} style={style} className="flex flex-wrap items-center gap-2 rounded-lg bg-primary/5 px-3 py-2">
        <GripVertical className="h-4 w-4 shrink-0 text-slate-200" />
        <ColorSwatchPicker value={queue.color} onChange={color => onSave(queue.id, { color })} />
        <input className={cn(inp, 'min-w-[9rem] flex-1')} value={name} autoFocus placeholder="Queue name"
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }} />
        <input className={cn(inp, 'w-40')} value={code} placeholder="Genesys queue"
          title="The name of the matching queue in Genesys, so a supervisor knows what to change"
          onChange={e => setCode(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }} />
        <input className={cn(inp, 'min-w-[10rem] flex-1')} value={description} placeholder="What this queue takes"
          onChange={e => setDescription(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }} />
        <Button type="button" variant="ghost" size="sm" onClick={commit} className="h-8 w-8 p-0 text-emerald-600 hover:text-emerald-700"><Check className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" onClick={cancel} className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></Button>
      </div>
    )
  }

  const activeDepts = queue.departments.filter(d => d.is_active)

  return (
    <div ref={setNodeRef} style={style}
      className={cn('group flex items-center gap-2 rounded-lg bg-white px-3 py-2.5', isDragging && 'z-10 opacity-80 shadow-md', !queue.is_active && 'opacity-40')}>
      <Button {...attributes} {...listeners} type="button" variant="ghost" size="sm"
        className="h-8 w-8 shrink-0 cursor-grab touch-none p-0 text-slate-300 hover:text-slate-400 active:cursor-grabbing">
        <GripVertical className="h-4 w-4" />
      </Button>
      <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-slate-200" style={{ backgroundColor: queue.color }} />
      <span className="text-[13px] font-medium text-slate-700">{queue.queue_name}</span>
      {queue.queue_code && (
        <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10.5px] font-medium text-slate-500">
          {queue.queue_code}
        </span>
      )}
      <span className="flex-1 truncate text-[12px] text-slate-400">{queue.description}</span>
      <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10.5px] font-medium text-slate-500"
        title={activeDepts.map(d => d.department_name).join(', ') || 'Not staffed by any department yet'}>
        <Building2 className="mr-1 inline h-3 w-3" />
        {activeDepts.length === 0 ? 'unassigned' : `${activeDepts.length} dept${activeDepts.length === 1 ? '' : 's'}`}
      </span>
      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)} className="h-8 w-8 p-0 text-slate-400 hover:text-primary"><Pencil className="h-3.5 w-3.5" /></Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onToggle(queue)} className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600"
          title={queue.is_active ? 'Retire queue' : 'Bring queue back'}>
          {queue.is_active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  )
}

export function PhoneQueueListEditor() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [adding, setAdding] = useState(false)
  // Local order while a drag is in flight, so the list does not snap back to the
  // server order before the reorder round-trips.
  const [localQueues, setLocalQueues] = useState<ApiPhoneQueue[] | null>(null)

  const { data: serverQueues = [], isLoading, isError, refetch } = useQuery({
    queryKey: KEY,
    queryFn: () => phoneQueueService.getLibrary(true),
  })
  const queues = localQueues ?? serverQueues

  const invalidate = () => { qc.invalidateQueries({ queryKey: phoneQueueKeys.all }); setLocalQueues(null) }
  const errToast = (verb: string) => () => toast({ variant: 'destructive', title: `Couldn't ${verb}`, description: 'Try again.' })

  const addMut = useMutation({
    mutationFn: (queue_name: string) => phoneQueueService.createQueue({ queue_name }),
    onSuccess: invalidate, onError: errToast('add queue'),
  })
  const saveMut = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Record<string, unknown> }) => phoneQueueService.updateQueue(id, patch),
    onSuccess: invalidate, onError: errToast('save queue'),
  })
  const toggleMut = useMutation({
    mutationFn: (q: ApiPhoneQueue) => phoneQueueService.setQueueActive(q.id, !q.is_active),
    onSuccess: invalidate, onError: errToast('update queue'),
  })
  const reorderMut = useMutation({
    mutationFn: (order: { id: number; sort_order: number }[]) => phoneQueueService.reorderQueues(order),
    onSuccess: invalidate, onError: () => { setLocalQueues(null); errToast('save order')() },
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = queues.findIndex(q => q.id === Number(active.id))
    const to = queues.findIndex(q => q.id === Number(over.id))
    if (from === -1 || to === -1) return
    const next = arrayMove(queues, from, to)
    setLocalQueues(next)
    reorderMut.mutate(next.map((q, i) => ({ id: q.id, sort_order: (i + 1) * 10 })))
  }

  if (isLoading) return <div className="overflow-hidden rounded-xl border border-slate-200 bg-white"><ListLoadingSkeleton rows={4} /></div>
  if (isError) return <div className="rounded-xl border border-slate-200 bg-white p-4"><TableErrorState message="Couldn't load the phone queue library. Refresh to try again." onRetry={refetch} /></div>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-[12px] text-slate-500">
          <span><span className="font-semibold text-slate-700">{queues.filter(q => q.is_active).length}</span> active queues</span>
          <span className="text-slate-400">Drag to set the order they appear in, and the tie-break when two share a fill priority.</span>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(v => !v)} className="flex items-center gap-1 text-[12px] font-medium text-slate-500 hover:text-primary">
          <Plus className="h-3.5 w-3.5" /> New Queue
        </Button>
      </div>

      {adding && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
          <input className={cn(inp, 'flex-1')} placeholder="Queue name…" autoFocus
            onKeyDown={e => {
              const v = (e.target as HTMLInputElement).value.trim()
              if (e.key === 'Enter' && v) { addMut.mutate(v); setAdding(false) }
              if (e.key === 'Escape') setAdding(false)
            }} />
          <span className="text-[12px] text-slate-400">Press Enter to add</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)} className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></Button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={handleDragEnd}>
          <SortableContext items={queues.map(q => q.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-0.5 px-2 py-1">
              {queues.map(q => (
                <QueueRow key={q.id} queue={q}
                  onSave={(id, patch) => saveMut.mutate({ id, patch })}
                  onToggle={queue => toggleMut.mutate(queue)} />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {queues.length === 0 && (
          <div className="p-10 text-center text-[13px] text-slate-400">
            No phone queues yet. Add one, then assign it to a department on the Phone Queues page.
          </div>
        )}
      </div>
    </div>
  )
}

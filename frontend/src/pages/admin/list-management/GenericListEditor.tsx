import { useState, useMemo } from 'react'
import { ListLoadingSkeleton } from '@/components/common/ListLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor,
  useSensor, useSensors, type DragEndEvent, type DraggableAttributes,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers'
import { CSS } from '@dnd-kit/utilities'
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities'
import { Plus, Pencil, Eye, EyeOff, Check, X, GripVertical, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import listService, { type ListItem } from '@/services/listService'

const inp = 'h-8 px-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/40'

// A list row may carry extra domain fields (e.g. scheduling's is_excused). These
// stay optional so every existing generic list keeps working unchanged.
export type EditorItem = ListItem & {
  is_system?: boolean
  is_excused?: boolean
  duration_mode?: string
  paychex_pay_type?: string
  is_paid?: boolean
  counts_as_coverage?: boolean
}

// Domain-specific columns rendered on the row (view badge + edit control). Used
// by non-generic lists (scheduling) to reach parity without bespoke editors.
export interface MetaFieldDef {
  key: string
  label: string
  type: 'toggle' | 'select'
  options?: { value: string; label: string }[]
  // 'boolean' → a select whose option values are 'true'/'false' but the row
  // reads/writes an actual boolean (e.g. Excused / Unexcused).
  coerce?: 'boolean'
}

export interface ListEditorMeta {
  fields: MetaFieldDef[]
  addDefaults?: Record<string, unknown>
  allowDelete?: boolean               // default true — hidden when false
  lockToggleWhen?: (item: EditorItem) => boolean   // e.g. system rows can't deactivate
}

// Data source behind the editor. Defaults to the generic list_items API; other
// domains (scheduling) pass an adapter over their own service.
export interface ListEditorService {
  getItems(includeInactive: boolean): Promise<EditorItem[]>
  createItem(payload: { label: string; category?: string } & Record<string, unknown>): Promise<unknown>
  updateItem(id: number, payload: Record<string, unknown>): Promise<unknown>
  toggleStatus(id: number): Promise<unknown>
  reorder(items: { id: number; sort_order: number }[]): Promise<unknown>
  deleteItem(id: number): Promise<unknown>
}

const fieldValue = (item: EditorItem, key: string) => (item as unknown as Record<string, unknown>)[key]

// ── Sortable list item ────────────────────────────────────────────────────────

function SortableListItem({ item, onSave, onToggle, onDelete, availableCategories = [], meta }: {
  item: EditorItem
  onSave: (id: number, patch: Record<string, unknown>) => void
  onToggle: (id: number) => void
  onDelete: (id: number) => void
  availableCategories?: string[]
  meta?: ListEditorMeta
}) {
  const initMeta = () => (meta?.fields ?? []).reduce<Record<string, unknown>>((acc, f) => {
    const v = fieldValue(item, f.key)
    acc[f.key] = f.coerce === 'boolean' ? String(!!v) : v
    return acc
  }, {})
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const [editing,    setEditing]   = useState(false)
  const [label,      setLabel]     = useState(item.label)
  const [category,   setCategory]  = useState(item.category ?? '')
  const [metaDraft,  setMetaDraft] = useState<Record<string, unknown>>(initMeta)
  const [confirming, setConfirming] = useState(false)
  const style = { transform: CSS.Transform.toString(transform), transition }

  const buildPatch = () => {
    const out: Record<string, unknown> = { label, category }
    for (const f of meta?.fields ?? []) {
      const raw = metaDraft[f.key]
      out[f.key] = f.coerce === 'boolean' ? (raw === true || raw === 'true') : raw
    }
    return out
  }
  const commit = () => { onSave(item.id, buildPatch()); setEditing(false) }
  const cancel = () => { setLabel(item.label); setCategory(item.category ?? ''); setMetaDraft(initMeta()); setEditing(false) }

  const toggleLocked = meta?.lockToggleWhen?.(item) ?? false
  const showDelete   = meta ? meta.allowDelete !== false : true

  if (editing) {
    return (
      <div ref={setNodeRef} style={style} className="flex flex-wrap items-center gap-2 py-2 px-3 bg-primary/5 rounded-lg">
        <GripVertical className="h-4 w-4 text-slate-200 shrink-0" />
        {availableCategories.length > 0 ? (
          <select value={category} onChange={e => setCategory(e.target.value)} className={cn(inp, 'w-2/5 bg-white')}>
            <option value="">— No category —</option>
            {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        ) : (
          <input className={cn(inp, 'w-2/5 bg-white')} value={category} placeholder="Category (optional)"
            onChange={e => setCategory(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }} />
        )}
        <input className={cn(inp, 'flex-1 min-w-[8rem] bg-white')} value={label} autoFocus placeholder="Label"
          onChange={e => setLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }} />
        {(meta?.fields ?? []).map(f => f.type === 'toggle' ? (
          <button key={f.key} type="button" onClick={() => setMetaDraft(d => ({ ...d, [f.key]: !d[f.key] }))}
            className={cn('h-8 px-2.5 rounded-md text-[12px] font-medium border transition-colors',
              metaDraft[f.key] ? 'bg-primary/10 border-primary text-primary' : 'bg-white border-slate-200 text-slate-500 hover:text-slate-700')}>
            {f.label}
          </button>
        ) : (
          <select key={f.key} value={String(metaDraft[f.key] ?? '')} onChange={e => setMetaDraft(d => ({ ...d, [f.key]: e.target.value }))}
            className={cn(inp, 'bg-white')} title={f.label}>
            {(f.options ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ))}
        <Button type="button" variant="ghost" size="sm" onClick={commit} className="h-8 w-8 p-0 text-emerald-600 hover:text-emerald-700"><Check className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" onClick={cancel} className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></Button>
      </div>
    )
  }

  return (
    <div ref={setNodeRef} style={style}
      className={cn('flex items-center gap-2 py-2.5 px-3 rounded-lg group bg-white',
        isDragging && 'shadow-md opacity-80 z-10', !item.is_active && 'opacity-40')}>
      <Button {...attributes} {...listeners} type="button" variant="ghost" size="sm"
        className="h-8 w-8 shrink-0 cursor-grab touch-none p-0 text-slate-300 hover:text-slate-400 active:cursor-grabbing">
        <GripVertical className="h-4 w-4" />
      </Button>
      <span className="text-[13px] text-slate-700 flex-1">{item.label}</span>
      {(meta?.fields ?? []).map(f => {
        const v = fieldValue(item, f.key)
        const text = f.type === 'select'
          ? (f.options?.find(o => o.value === String(v))?.label ?? String(v ?? ''))
          : (v ? f.label : `Not ${f.label.toLowerCase()}`)
        // An unset select (e.g. an exception type with no Paychex link) reads grey
        // rather than green — the badge should not imply a link that isn't there.
        const on = !!v
        return (
          <span key={f.key} className={cn('shrink-0 rounded-full border px-1.5 py-0.5 text-[10.5px] font-medium',
            on ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-400')}>
            {text}
          </span>
        )
      })}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)} className="h-8 w-8 p-0 text-slate-400 hover:text-primary"><Pencil className="h-3.5 w-3.5" /></Button>
        <Button type="button" variant="ghost" size="sm" disabled={toggleLocked} onClick={() => onToggle(item.id)}
          title={toggleLocked ? 'System items cannot be deactivated' : undefined}
          className={cn('h-8 w-8 p-0 text-slate-400 hover:text-slate-600', toggleLocked && 'opacity-30 cursor-not-allowed hover:text-slate-400')}>
          {item.is_active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </Button>
        {showDelete && (confirming ? (
          <>
            <span className="text-[11px] text-red-500 font-medium">Delete?</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => { onDelete(item.id); setConfirming(false) }} className="h-8 w-8 p-0 text-red-500 hover:text-red-700"><Check className="h-3.5 w-3.5" /></Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)} className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></Button>
          </>
        ) : (
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(true)} className="h-8 w-8 p-0 text-slate-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></Button>
        ))}
      </div>
    </div>
  )
}

// ── Category block ────────────────────────────────────────────────────────────

function CategoryBlock({ cat, items, addingIn, onStartAdd, onAdd, onCloseAdd,
  onSaveItem, onToggleItem, onDeleteItem, onReorderItems, onRemoveCategory, dragHandleProps, availableCategories = [], meta }: {
  cat: string; items: EditorItem[]; availableCategories?: string[]
  addingIn: string | null
  onStartAdd: (cat: string) => void; onAdd: (label: string) => void; onCloseAdd: () => void
  onSaveItem: (id: number, patch: Record<string, unknown>) => void
  onToggleItem: (id: number) => void; onDeleteItem: (id: number) => void
  onReorderItems: (cat: string, newItems: EditorItem[]) => void
  onRemoveCategory: (cat: string) => void
  dragHandleProps: DraggableAttributes & SyntheticListenerMap
  meta?: ListEditorMeta
}) {
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const itemSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const handleItemDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = items.findIndex(i => i.id === Number(active.id))
    const to   = items.findIndex(i => i.id === Number(over.id))
    if (from !== -1 && to !== -1) onReorderItems(cat, arrayMove(items, from, to))
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Button {...dragHandleProps} type="button" variant="ghost" size="sm" className="h-8 w-8 shrink-0 cursor-grab touch-none p-0 text-slate-300 hover:text-slate-500 active:cursor-grabbing">
            <GripVertical className="h-4 w-4" />
          </Button>
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">{cat}</p>
          <span className="text-[10px] text-slate-400">{items.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="default" size="sm" onClick={() => onStartAdd(cat)} className="flex items-center gap-1 text-[12px] font-medium">
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
          {confirmingRemove ? (
            <>
              <span className="text-[11px] text-red-500 font-medium">Remove category?</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => { onRemoveCategory(cat); setConfirmingRemove(false) }} className="h-8 w-8 p-0 text-red-500 hover:text-red-700"><Check className="h-3.5 w-3.5" /></Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingRemove(false)} className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></Button>
            </>
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingRemove(true)} className="h-8 w-8 p-0 text-slate-300 transition-colors hover:text-red-500" title="Remove category">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
      <div className="px-2 py-1 space-y-0.5">
        <DndContext sensors={itemSensors} collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]} onDragEnd={handleItemDragEnd}>
          <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
            {items.map(item => (
              <SortableListItem key={item.id} item={item}
                availableCategories={availableCategories} meta={meta}
                onSave={onSaveItem} onToggle={onToggleItem} onDelete={onDeleteItem} />
            ))}
          </SortableContext>
        </DndContext>
        {addingIn === cat && (
          <div className="flex items-center gap-2 mt-1 px-3 py-2 bg-slate-50 rounded-lg border border-dashed border-slate-300">
            <GripVertical className="h-4 w-4 text-slate-200 shrink-0" />
            <input className={cn(inp, 'flex-1 bg-white')} placeholder={`New option in ${cat}…`} autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim())
                  onAdd((e.target as HTMLInputElement).value.trim())
                if (e.key === 'Escape') onCloseAdd()
              }} />
            <Button type="button" variant="ghost" size="sm" onClick={onCloseAdd} className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></Button>
          </div>
        )}
      </div>
    </div>
  )
}

function SortableCategoryWrapper(props: Omit<Parameters<typeof CategoryBlock>[0], 'dragHandleProps'>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `cat:${props.cat}` })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'opacity-60 shadow-xl z-50 scale-[1.02] transition-transform')}>
      <CategoryBlock {...props} dragHandleProps={{ ...attributes, ...listeners } as DraggableAttributes & SyntheticListenerMap} />
    </div>
  )
}

// ── Uncategorized sortable block ──────────────────────────────────────────────

export function UncategorizedBlock({ uncategorized, categories, items, commit, onSave, onToggle, onDelete, meta }: {
  uncategorized: EditorItem[]
  categories: string[]
  items: EditorItem[]
  commit: (newItems: EditorItem[]) => void
  onSave: (id: number, patch: Record<string, unknown>) => void
  onToggle: (id: number) => void
  onDelete: (id: number) => void
  meta?: ListEditorMeta
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = uncategorized.findIndex(i => i.id === Number(active.id))
    const to   = uncategorized.findIndex(i => i.id === Number(over.id))
    if (from === -1 || to === -1) return
    const reorderedUncat = arrayMove(uncategorized, from, to)
    const categorizedItems = categories.flatMap(c => items.filter(i => i.category === c))
    commit([...categorizedItems, ...reorderedUncat])
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 border-dashed overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50/50 border-b border-slate-100">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Uncategorized</p>
        <span className="text-[10px] text-slate-400">{uncategorized.length} — edit an item to assign a category</span>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]} onDragEnd={handleDragEnd}>
        <SortableContext items={uncategorized.map(i => i.id)} strategy={verticalListSortingStrategy}>
          <div className="px-2 py-1 space-y-0.5">
            {uncategorized.map(item => (
              <SortableListItem key={item.id} item={item}
                availableCategories={categories} meta={meta}
                onSave={onSave} onToggle={onToggle} onDelete={onDelete} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}

// ── Generic list editor ───────────────────────────────────────────────────────

export function GenericListEditor({ listType, listLabel, service, meta }: {
  listType: string; listLabel: string; service?: ListEditorService; meta?: ListEditorMeta
}) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [localItems,        setLocalItems]        = useState<EditorItem[] | null>(null)
  const [addingIn,          setAddingIn]          = useState<string | null>(null)
  const [newCategory,       setNewCategory]       = useState('')
  const [showCatForm,       setShowCatForm]       = useState(false)
  const [addingFlat,        setAddingFlat]        = useState(false)
  const [newLabel,          setNewLabel]          = useState('')
  const [pendingCategories, setPendingCategories] = useState<string[]>([])

  // Default to the generic list_items API; callers may inject their own adapter.
  const svc: ListEditorService = useMemo(() => service ?? {
    getItems:    (inc) => listService.getItems(listType, inc) as Promise<EditorItem[]>,
    createItem:  (p) => listService.createItem({ list_type: listType, ...p }),
    updateItem:  (id, p) => listService.updateItem(id, p),
    toggleStatus:(id) => listService.toggleStatus(id),
    reorder:     (items) => listService.reorder(items),
    deleteItem:  (id) => listService.deleteItem(id),
  }, [service, listType])

  const { data: serverItems = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['list-items', listType, 'all'],
    queryFn:  () => svc.getItems(true),
  })
  const items: EditorItem[] = localItems ?? serverItems

  const persistedCats = useMemo(() =>
    [...new Set(items.filter(i => i.category).map(i => i.category!))], [items])
  const categories = useMemo(() =>
    [...new Set([...persistedCats, ...pendingCategories])], [persistedCats, pendingCategories])
  const hasCategories = categories.length > 0

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['list-items', listType] }); setLocalItems(null) }

  // Mutation onError uses canonical wording from docs/error-messages-catalog.md.
  const saveMut      = useMutation({ mutationFn: ({ id, patch }: { id: number; patch: Record<string, unknown> }) => svc.updateItem(id, patch), onSuccess: () => { invalidate(); toast({ title: 'Saved' }) }, onError: () => toast({ variant: 'destructive', title: "Couldn't save item", description: 'Try again.' }) })
  const toggleMut    = useMutation({ mutationFn: (id: number) => svc.toggleStatus(id), onSuccess: invalidate, onError: () => toast({ variant: 'destructive', title: "Couldn't update item", description: 'Try again.' }) })
  const addMut       = useMutation({ mutationFn: ({ label, category }: { label: string; category?: string }) => svc.createItem({ label, category, ...(meta?.addDefaults ?? {}) }), onSuccess: () => { invalidate(); toast({ title: 'Added' }) }, onError: () => toast({ variant: 'destructive', title: "Couldn't add item", description: 'Try again.' }) })
  const reorderMut   = useMutation({ mutationFn: (payload: { id: number; sort_order: number }[]) => svc.reorder(payload), onSuccess: invalidate, onError: () => { setLocalItems(null); toast({ variant: 'destructive', title: "Couldn't save new order", description: 'Try again.' }) } })
  const deleteMut    = useMutation({ mutationFn: (id: number) => svc.deleteItem(id), onSuccess: () => { invalidate(); toast({ title: 'Deleted' }) }, onError: () => toast({ variant: 'destructive', title: "Couldn't delete item", description: 'Try again.' }) })
  const clearCatMut  = useMutation({
    mutationFn: (ids: number[]) => Promise.all(ids.map(id => svc.updateItem(id, { category: '' }))),
    onSuccess:  () => { invalidate(); toast({ title: 'Category removed' }) },
    onError:    () => toast({ variant: 'destructive', title: "Couldn't remove category", description: 'Try again.' }),
  })

  const commit = (newItems: EditorItem[]) => { setLocalItems(newItems); reorderMut.mutate(newItems.map((it, idx) => ({ id: it.id, sort_order: idx + 1 }))) }

  const handleFlatDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = items.findIndex(i => i.id === Number(active.id))
    const to   = items.findIndex(i => i.id === Number(over.id))
    if (from !== -1 && to !== -1) commit(arrayMove(items, from, to))
  }

  const handleCatDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = categories.indexOf(String(active.id).slice(4))
    const to   = categories.indexOf(String(over.id).slice(4))
    if (from === -1 || to === -1) return
    const newOrder = arrayMove(categories, from, to)
    const reordered: EditorItem[] = []
    newOrder.forEach(cat => reordered.push(...items.filter(i => i.category === cat)))
    reordered.push(...items.filter(i => !i.category))
    commit(reordered)
  }

  const handleItemReorder = (cat: string, newCatItems: EditorItem[]) => {
    const reordered = categories.flatMap(c => c === cat ? newCatItems : items.filter(i => i.category === c))
    reordered.push(...items.filter(i => !i.category))
    commit(reordered)
  }

  const handleRemoveCategory = (cat: string) => {
    setPendingCategories(prev => prev.filter(c => c !== cat))
    const catItems = items.filter(i => i.category === cat)
    if (catItems.length > 0) clearCatMut.mutate(catItems.map(i => i.id))
    setLocalItems(null)
  }

  const itemActions = {
    onSaveItem:          (id: number, patch: Record<string, unknown>) => saveMut.mutate({ id, patch }),
    onToggleItem:        (id: number) => toggleMut.mutate(id),
    onDeleteItem:        (id: number) => deleteMut.mutate(id),
    onReorderItems:      handleItemReorder,
    onRemoveCategory:    handleRemoveCategory,
    availableCategories: categories,
    meta,
  }

  if (isLoading) return <div className="bg-white rounded-xl border border-slate-200 overflow-hidden"><ListLoadingSkeleton rows={4} /></div>
  if (isError)   return <div className="bg-white rounded-xl border border-slate-200 p-4"><TableErrorState message="Couldn't load list. Refresh to try again." onRetry={refetch} /></div>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-[12px] text-slate-500">
          <span><span className="font-semibold text-slate-700">{items.filter(i => i.is_active).length}</span> active</span>
          {items.filter(i => !i.is_active).length > 0 && <span><span className="font-semibold text-slate-400">{items.filter(i => !i.is_active).length}</span> inactive</span>}
          {hasCategories && <span><span className="font-semibold text-slate-700">{categories.length}</span> categories</span>}
        </div>
        <div className="flex items-center gap-3">
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowCatForm(v => !v)} className="flex items-center gap-1 text-[12px] font-medium text-slate-500 hover:text-primary">
            <Plus className="h-3.5 w-3.5" /> New Category
          </Button>
          {!hasCategories && (
            <Button type="button" variant="default" size="sm" onClick={() => setAddingFlat(v => !v)} className="flex items-center gap-1 text-[12px] font-medium">
              <Plus className="h-3.5 w-3.5" /> Add Option
            </Button>
          )}
        </div>
      </div>

      {showCatForm && (
        <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg border border-dashed border-slate-300">
          <input className={cn(inp, 'flex-1 bg-white')} placeholder="Category name…" value={newCategory} autoFocus
            onChange={e => setNewCategory(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && newCategory.trim()) {
                const cat = newCategory.trim()
                if (!categories.includes(cat)) { setPendingCategories(prev => [...prev, cat]); setAddingIn(cat) }
                setShowCatForm(false); setNewCategory('')
              }
              if (e.key === 'Escape') { setShowCatForm(false); setNewCategory('') }
            }} />
          <span className="text-[12px] text-slate-400">Press Enter, then add items</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => { setShowCatForm(false); setNewCategory('') }} className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></Button>
        </div>
      )}

      {!hasCategories && addingFlat && (
        <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg border border-dashed border-slate-300">
          <input className={cn(inp, 'flex-1 bg-white')} placeholder={`New ${listLabel} option…`} value={newLabel} autoFocus
            onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && newLabel.trim()) { addMut.mutate({ label: newLabel.trim() }); setNewLabel(''); setAddingFlat(false) }
              if (e.key === 'Escape') { setAddingFlat(false); setNewLabel('') }
            }} />
          <span className="text-[12px] text-slate-400">Press Enter to add</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => { setAddingFlat(false); setNewLabel('') }} className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></Button>
        </div>
      )}

      {!hasCategories && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <DndContext sensors={sensors} collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]} onDragEnd={handleFlatDragEnd}>
            <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
              <div className="px-2 py-1 space-y-0.5">
                {items.map(item => (
                  <SortableListItem key={item.id} item={item}
                    availableCategories={categories} meta={meta}
                    onSave={(id, patch) => saveMut.mutate({ id, patch })}
                    onToggle={id => toggleMut.mutate(id)}
                    onDelete={id => deleteMut.mutate(id)} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}

      {hasCategories && (() => {
        const uncategorized = items.filter(i => !i.category)
        return (
          <DndContext sensors={sensors} collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]} onDragEnd={handleCatDragEnd}>
            <SortableContext items={categories.map(c => `cat:${c}`)} strategy={verticalListSortingStrategy}>
              {categories.map(cat => (
                <SortableCategoryWrapper key={cat} cat={cat}
                  items={items.filter(i => i.category === cat)} addingIn={addingIn}
                  onStartAdd={setAddingIn}
                  onAdd={label => { addMut.mutate({ label, category: cat }); setPendingCategories(prev => prev.filter(c => c !== cat)); setAddingIn(null) }}
                  onCloseAdd={() => {
                    if (addingIn && pendingCategories.includes(addingIn) && !items.some(i => i.category === addingIn))
                      setPendingCategories(prev => prev.filter(c => c !== addingIn))
                    setAddingIn(null)
                  }}
                  {...itemActions}
                />
              ))}
            </SortableContext>
            {uncategorized.length > 0 && (
              <UncategorizedBlock uncategorized={uncategorized} categories={categories} items={items}
                commit={commit} meta={meta}
                onSave={(id, patch) => saveMut.mutate({ id, patch })}
                onToggle={id => toggleMut.mutate(id)}
                onDelete={id => deleteMut.mutate(id)}
              />
            )}
          </DndContext>
        )
      })()}
    </div>
  )
}

/**
 * Campaign LIBRARY editor (List Management → Scheduling → Call Campaigns).
 *
 * Richer than GenericListEditor: categories carry a color (swatch picker) and
 * campaigns carry a timing rule (anchor_type + offset + optional reference +
 * not-on-Friday). Categories and campaigns each drag-sort; that sort order is
 * exactly the order chips render in on the calendar. Admin-only writes — the
 * backend re-checks admin on every mutation.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers'
import { CSS } from '@dnd-kit/utilities'
import { Plus, Pencil, Eye, EyeOff, Check, X, GripVertical, CalendarClock } from 'lucide-react'

import { ListLoadingSkeleton } from '@/components/common/ListLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { ColorSwatchPicker } from '@/components/common/ColorSwatchPicker'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import campaignService, {
  type ApiCampaignCategory, type ApiCampaignItem, type CampaignAnchorType,
} from '@/services/campaignService'

const inp = 'h-8 px-2 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-primary/40'
const KEY = ['campaign-library']

const ANCHORS: { value: CampaignAnchorType; label: string }[] = [
  { value: 'BD_FROM_START', label: 'Business day from start' },
  { value: 'BD_FROM_END', label: 'Business day from end' },
  { value: 'RELATIVE_TO_CAMPAIGN', label: 'Relative to another campaign' },
]

function anchorSummary(it: ApiCampaignItem, refLabel?: string): string {
  const base =
    it.anchor_type === 'BD_FROM_START' ? `BD ${it.anchor_offset} from start`
    : it.anchor_type === 'BD_FROM_END' ? `BD ${it.anchor_offset} from end`
    : `${it.anchor_offset >= 0 ? '+' : ''}${it.anchor_offset} BD from ${refLabel ? `"${refLabel}"` : 'campaign'}`
  return it.not_on_friday ? `${base} · not Fri` : base
}

// ── Campaign item row ──────────────────────────────────────────────────────────
function ItemRow({ item, refLabel, allItems, categories, onSave, onToggle }: {
  item: ApiCampaignItem
  refLabel?: string
  allItems: ApiCampaignItem[]
  categories: ApiCampaignCategory[]
  onSave: (id: number, patch: Record<string, unknown>) => void
  onToggle: (item: ApiCampaignItem) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(item.label)
  const [catId, setCatId] = useState(item.category_id)
  const [anchor, setAnchor] = useState<CampaignAnchorType>(item.anchor_type)
  const [offset, setOffset] = useState(item.anchor_offset)
  const [ref, setRef] = useState<number | ''>(item.anchor_ref_item_id ?? '')
  const [notFri, setNotFri] = useState(item.not_on_friday)
  const style = { transform: CSS.Transform.toString(transform), transition }
  const catNameOf = (id: number) => categories.find(c => c.id === id)?.name ?? '—'

  const commit = () => {
    onSave(item.id, {
      label, category_id: catId, anchor_type: anchor, anchor_offset: Number(offset),
      anchor_ref_item_id: anchor === 'RELATIVE_TO_CAMPAIGN' ? (ref === '' ? null : Number(ref)) : null,
      not_on_friday: notFri,
    })
    setEditing(false)
  }
  const cancel = () => {
    setLabel(item.label); setCatId(item.category_id); setAnchor(item.anchor_type); setOffset(item.anchor_offset)
    setRef(item.anchor_ref_item_id ?? ''); setNotFri(item.not_on_friday); setEditing(false)
  }

  if (editing) {
    return (
      <div ref={setNodeRef} style={style} className="flex flex-wrap items-center gap-2 rounded-lg bg-primary/5 px-3 py-2">
        <GripVertical className="h-4 w-4 shrink-0 text-slate-200" />
        <select className={cn(inp, 'w-44')} value={catId} onChange={e => setCatId(Number(e.target.value))} title="Category">
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input className={cn(inp, 'min-w-[9rem] flex-1')} value={label} autoFocus placeholder="Campaign name"
          onChange={e => setLabel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }} />
        <select className={inp} value={anchor} onChange={e => setAnchor(e.target.value as CampaignAnchorType)} title="Timing rule">
          {ANCHORS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
        <input className={cn(inp, 'w-16')} type="number" value={offset} title="Offset (business days)"
          onChange={e => setOffset(Number(e.target.value))} />
        {anchor === 'RELATIVE_TO_CAMPAIGN' && (
          <select className={inp} value={ref} onChange={e => setRef(e.target.value === '' ? '' : Number(e.target.value))} title="Reference campaign">
            <option value="">— reference —</option>
            {/* Labels repeat across categories, so qualify each one to keep the pick unambiguous. */}
            {allItems.filter(i => i.id !== item.id).map(i => (
              <option key={i.id} value={i.id}>{catNameOf(i.category_id)} · {i.label}</option>
            ))}
          </select>
        )}
        <button type="button" onClick={() => setNotFri(v => !v)}
          className={cn('h-8 rounded-md border px-2.5 text-[12px] font-medium transition-colors',
            notFri ? 'border-primary bg-primary/10 text-primary' : 'border-slate-200 bg-white text-slate-500 hover:text-slate-700')}>
          Not on Friday
        </button>
        <Button type="button" variant="ghost" size="sm" onClick={commit} className="h-8 w-8 p-0 text-emerald-600 hover:text-emerald-700"><Check className="h-4 w-4" /></Button>
        <Button type="button" variant="ghost" size="sm" onClick={cancel} className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></Button>
      </div>
    )
  }

  return (
    <div ref={setNodeRef} style={style}
      className={cn('group flex items-center gap-2 rounded-lg bg-white px-3 py-2.5', isDragging && 'z-10 opacity-80 shadow-md', !item.is_active && 'opacity-40')}>
      <Button {...attributes} {...listeners} type="button" variant="ghost" size="sm"
        className="h-8 w-8 shrink-0 cursor-grab touch-none p-0 text-slate-300 hover:text-slate-400 active:cursor-grabbing">
        <GripVertical className="h-4 w-4" />
      </Button>
      <span className="flex-1 text-[13px] text-slate-700">{item.label}</span>
      <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10.5px] font-medium text-slate-500">
        <CalendarClock className="mr-1 inline h-3 w-3" />{anchorSummary(item, refLabel)}
      </span>
      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)} className="h-8 w-8 p-0 text-slate-400 hover:text-primary"><Pencil className="h-3.5 w-3.5" /></Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onToggle(item)} className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600">
          {item.is_active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  )
}

// ── Category block ──────────────────────────────────────────────────────────────
function CategoryBlock({ cat, allItems, categories, onSaveCat, onToggleCat, onAddItem, onSaveItem, onToggleItem, onReorderItems }: {
  cat: ApiCampaignCategory
  allItems: ApiCampaignItem[]
  categories: ApiCampaignCategory[]
  onSaveCat: (id: number, patch: { name?: string; color?: string }) => void
  onToggleCat: (cat: ApiCampaignCategory) => void
  onAddItem: (catId: number, label: string) => void
  onSaveItem: (id: number, patch: Record<string, unknown>) => void
  onToggleItem: (item: ApiCampaignItem) => void
  onReorderItems: (catId: number, items: ApiCampaignItem[]) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `cat:${cat.id}` })
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(cat.name)
  const [adding, setAdding] = useState(false)
  const refLabelOf = (id: number | null) => allItems.find(i => i.id === id)?.label

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = cat.items.findIndex(i => i.id === Number(active.id))
    const to = cat.items.findIndex(i => i.id === Number(over.id))
    if (from !== -1 && to !== -1) onReorderItems(cat.id, arrayMove(cat.items, from, to))
  }

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('overflow-hidden rounded-xl border border-slate-200 bg-white', isDragging && 'z-50 scale-[1.01] opacity-70 shadow-xl', !cat.is_active && 'opacity-50')}>
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Button {...attributes} {...listeners} type="button" variant="ghost" size="sm"
            className="h-8 w-8 shrink-0 cursor-grab touch-none p-0 text-slate-300 hover:text-slate-500 active:cursor-grabbing"><GripVertical className="h-4 w-4" /></Button>
          <ColorSwatchPicker value={cat.color} onChange={color => onSaveCat(cat.id, { color })} />
          {editing ? (
            <input className={cn(inp, 'w-48')} value={name} autoFocus
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { onSaveCat(cat.id, { name }); setEditing(false) } if (e.key === 'Escape') { setName(cat.name); setEditing(false) } }}
              onBlur={() => { if (name.trim() && name !== cat.name) onSaveCat(cat.id, { name }); setEditing(false) }} />
          ) : (
            <button type="button" onClick={() => setEditing(true)} className="text-[12px] font-semibold uppercase tracking-widest text-slate-600 hover:text-primary">{cat.name}</button>
          )}
          <span className="text-[10px] text-slate-400">{cat.items.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="default" size="sm" onClick={() => setAdding(true)} className="flex items-center gap-1 text-[12px] font-medium"><Plus className="h-3.5 w-3.5" /> Add</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => onToggleCat(cat)} className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600" title={cat.is_active ? 'Hide category' : 'Show category'}>
            {cat.is_active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
      <div className="space-y-0.5 px-2 py-1">
        <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis, restrictToParentElement]} onDragEnd={handleDragEnd}>
          <SortableContext items={cat.items.map(i => i.id)} strategy={verticalListSortingStrategy}>
            {cat.items.map(it => (
              <ItemRow key={it.id} item={it} refLabel={refLabelOf(it.anchor_ref_item_id)} allItems={allItems}
                categories={categories} onSave={onSaveItem} onToggle={onToggleItem} />
            ))}
          </SortableContext>
        </DndContext>
        {adding && (
          <div className="mt-1 flex items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2">
            <GripVertical className="h-4 w-4 shrink-0 text-slate-200" />
            <input className={cn(inp, 'flex-1')} placeholder={`New campaign in ${cat.name}…`} autoFocus
              onKeyDown={e => {
                const v = (e.target as HTMLInputElement).value.trim()
                if (e.key === 'Enter' && v) { onAddItem(cat.id, v); setAdding(false) }
                if (e.key === 'Escape') setAdding(false)
              }} />
            <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)} className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Editor ────────────────────────────────────────────────────────────────────
export function CampaignListEditor() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [addingCat, setAddingCat] = useState(false)
  const [localCats, setLocalCats] = useState<ApiCampaignCategory[] | null>(null)

  const { data: serverCats = [], isLoading, isError, refetch } = useQuery({ queryKey: KEY, queryFn: () => campaignService.getLibrary(true) })
  const cats = localCats ?? serverCats
  const allItems = useMemo(() => cats.flatMap(c => c.items), [cats])

  const invalidate = () => { qc.invalidateQueries({ queryKey: KEY }); setLocalCats(null) }
  const errToast = (verb: string) => () => toast({ variant: 'destructive', title: `Couldn't ${verb}`, description: 'Try again.' })

  const addCatMut = useMutation({ mutationFn: (name: string) => campaignService.createCategory({ name }), onSuccess: invalidate, onError: errToast('add category') })
  const saveCatMut = useMutation({ mutationFn: ({ id, patch }: { id: number; patch: { name?: string; color?: string } }) => campaignService.updateCategory(id, patch), onSuccess: invalidate, onError: errToast('save category') })
  const toggleCatMut = useMutation({ mutationFn: (c: ApiCampaignCategory) => campaignService.setCategoryActive(c.id, !c.is_active), onSuccess: invalidate, onError: errToast('update category') })
  const reorderCatMut = useMutation({ mutationFn: (order: { id: number; sort_order: number }[]) => campaignService.reorderCategories(order), onSuccess: invalidate, onError: () => { setLocalCats(null); errToast('save order')() } })

  const addItemMut = useMutation({ mutationFn: ({ catId, label }: { catId: number; label: string }) => campaignService.createItem({ category_id: catId, label }), onSuccess: invalidate, onError: errToast('add campaign') })
  const saveItemMut = useMutation({ mutationFn: ({ id, patch }: { id: number; patch: Record<string, unknown> }) => campaignService.updateItem(id, patch), onSuccess: invalidate, onError: errToast('save campaign') })
  const toggleItemMut = useMutation({ mutationFn: (it: ApiCampaignItem) => campaignService.setItemActive(it.id, !it.is_active), onSuccess: invalidate, onError: errToast('update campaign') })
  const reorderItemMut = useMutation({ mutationFn: (order: { id: number; sort_order: number }[]) => campaignService.reorderItems(order), onSuccess: invalidate, onError: () => { setLocalCats(null); errToast('save order')() } })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const handleCatDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = cats.findIndex(c => `cat:${c.id}` === active.id)
    const to = cats.findIndex(c => `cat:${c.id}` === over.id)
    if (from === -1 || to === -1) return
    const next = arrayMove(cats, from, to)
    setLocalCats(next)
    reorderCatMut.mutate(next.map((c, i) => ({ id: c.id, sort_order: (i + 1) * 10 })))
  }
  const handleItemReorder = (catId: number, items: ApiCampaignItem[]) => {
    setLocalCats(cats.map(c => c.id === catId ? { ...c, items } : c))
    reorderItemMut.mutate(items.map((it, i) => ({ id: it.id, sort_order: (i + 1) * 10 })))
  }

  if (isLoading) return <div className="overflow-hidden rounded-xl border border-slate-200 bg-white"><ListLoadingSkeleton rows={4} /></div>
  if (isError) return <div className="rounded-xl border border-slate-200 bg-white p-4"><TableErrorState message="Couldn't load the campaign library. Refresh to try again." onRetry={refetch} /></div>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-[12px] text-slate-500">
          <span><span className="font-semibold text-slate-700">{cats.filter(c => c.is_active).length}</span> categories</span>
          <span><span className="font-semibold text-slate-700">{allItems.filter(i => i.is_active).length}</span> campaigns</span>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setAddingCat(v => !v)} className="flex items-center gap-1 text-[12px] font-medium text-slate-500 hover:text-primary">
          <Plus className="h-3.5 w-3.5" /> New Category
        </Button>
      </div>

      {addingCat && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
          <input className={cn(inp, 'flex-1')} placeholder="Category name…" autoFocus
            onKeyDown={e => {
              const v = (e.target as HTMLInputElement).value.trim()
              if (e.key === 'Enter' && v) { addCatMut.mutate(v); setAddingCat(false) }
              if (e.key === 'Escape') setAddingCat(false)
            }} />
          <span className="text-[12px] text-slate-400">Press Enter to add</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAddingCat(false)} className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></Button>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={handleCatDragEnd}>
        <SortableContext items={cats.map(c => `cat:${c.id}`)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {cats.map(cat => (
              <CategoryBlock key={cat.id} cat={cat} allItems={allItems} categories={cats}
                onSaveCat={(id, patch) => saveCatMut.mutate({ id, patch })}
                onToggleCat={c => toggleCatMut.mutate(c)}
                onAddItem={(catId, label) => addItemMut.mutate({ catId, label })}
                onSaveItem={(id, patch) => saveItemMut.mutate({ id, patch })}
                onToggleItem={it => toggleItemMut.mutate(it)}
                onReorderItems={handleItemReorder}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {cats.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-[13px] text-slate-400">
          No campaign categories yet. Add one to start building the library.
        </div>
      )}
    </div>
  )
}

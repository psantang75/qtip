import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers'
import { CSS } from '@dnd-kit/utilities'
import { ChevronRight, ChevronDown, List, Settings2, Plus, Pencil, Eye, EyeOff, Check, X, GripVertical, Trash2 } from 'lucide-react'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import listService, { type ListItem } from '@/services/listService'
// ── List catalogue ────────────────────────────────────────────────────────────

type ListTier = 'label-override' | 'dynamic'

interface ManagedList {
  key: string
  label: string
  description: string
  tier: ListTier
  implemented: boolean
  listType?: string       // the DB list_type value when implemented
}

interface ListSection {
  id: string
  label: string
  lists: ManagedList[]
}

const SECTIONS: ListSection[] = [
  {
    id: 'quality',
    label: 'Quality',
    lists: [
      { key: 'dispute_reasons', label: 'Dispute Reasons', description: 'Reasons a CSR can select when disputing a QA audit.', tier: 'dynamic', implemented: false },
      { key: 'qa_form_types',  label: 'QA Form Types',   description: 'Categories used to classify quality audit forms.',  tier: 'dynamic', implemented: false },
    ],
  },
  {
    id: 'training',
    label: 'Training',
    lists: [
      { key: 'topics',           label: 'Training Topics',  description: '', tier: 'dynamic',        implemented: true,  listType: 'training_topic'   },
      { key: 'coaching_purpose', label: 'Coaching Purpose', description: '', tier: 'label-override', implemented: true,  listType: 'coaching_purpose' },
      { key: 'coaching_format',  label: 'Coaching Format',  description: '', tier: 'label-override', implemented: true,  listType: 'coaching_format'  },
      { key: 'coaching_source',  label: 'Coaching Source',  description: '', tier: 'label-override', implemented: true,  listType: 'coaching_source'  },
      { key: 'behavior_flags',   label: 'Behavior Flags',   description: '', tier: 'dynamic',        implemented: true,  listType: 'behavior_flag'    },
    ],
  },
]


const inp = 'h-8 px-2 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/40'

// ── Generic sortable item — label + optional category in edit mode ────────────

function SortableListItem({ item, onSave, onToggle, onDelete, showItemKey, availableCategories = [] }: {
  item: ListItem
  onSave: (id: number, label: string, category: string) => void
  onToggle: (id: number) => void
  onDelete: (id: number) => void
  showItemKey?: boolean
  availableCategories?: string[]
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const [editing,    setEditing]   = useState(false)
  const [label,      setLabel]     = useState(item.label)
  const [category,   setCategory]  = useState(item.category ?? '')
  const [confirming, setConfirming] = useState(false)
  const style = { transform: CSS.Transform.toString(transform), transition }

  const commit = () => { onSave(item.id, label, category); setEditing(false) }
  const cancel = () => { setLabel(item.label); setCategory(item.category ?? ''); setEditing(false) }

  if (editing) {
    return (
      <div ref={setNodeRef} style={style} className="flex items-center gap-2 py-2 px-3 bg-primary/5 rounded-lg">
        <GripVertical className="h-4 w-4 text-slate-200 shrink-0" />
        {availableCategories.length > 0 ? (
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className={cn(inp, 'w-2/5 bg-white')}
          >
            <option value="">— No category —</option>
            {availableCategories.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        ) : (
          <input className={cn(inp, 'w-2/5 bg-white')} value={category}
            placeholder="Category (optional)" onChange={e => setCategory(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }} />
        )}
        <input className={cn(inp, 'flex-1 bg-white')} value={label} autoFocus
          placeholder="Label" onChange={e => setLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }} />
        <button type="button" onClick={commit} className="text-emerald-600 hover:text-emerald-700"><Check className="h-4 w-4" /></button>
        <button type="button" onClick={cancel}  className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
      </div>
    )
  }

  return (
    <div ref={setNodeRef} style={style}
      className={cn(
        'flex items-center gap-2 py-2.5 px-3 rounded-lg group bg-white',
        isDragging && 'shadow-md opacity-80 z-10',
        !item.is_active && 'opacity-40'
      )}>
      <button {...attributes} {...listeners} type="button"
        className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-400 shrink-0 touch-none">
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="text-[13px] text-slate-700 flex-1">{item.label}</span>
      {showItemKey && item.item_key && <span className="text-[11px] text-slate-400 font-mono">{item.item_key}</span>}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button type="button" onClick={() => setEditing(true)}
          className="p-1 text-slate-400 hover:text-primary rounded"><Pencil className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => onToggle(item.id)}
          className="p-1 text-slate-400 hover:text-slate-600 rounded">
          {item.is_active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>
        {confirming ? (
          <>
            <span className="text-[11px] text-red-500 font-medium">Delete?</span>
            <button type="button" onClick={() => { onDelete(item.id); setConfirming(false) }}
              className="p-1 text-red-500 hover:text-red-700 rounded"><Check className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => setConfirming(false)}
              className="p-1 text-slate-400 hover:text-slate-600 rounded"><X className="h-3.5 w-3.5" /></button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirming(true)}
            className="p-1 text-slate-300 hover:text-red-500 rounded">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

// ── Category block (own DndContext per category) ───────────────────────────────

function CategoryBlock({ cat, items, addingIn, onStartAdd, onAdd, onCloseAdd,
  onSaveItem, onToggleItem, onDeleteItem, onReorderItems, onRemoveCategory, dragHandleProps, showItemKey, availableCategories = [] }: {
  cat: string; items: ListItem[]; showItemKey?: boolean; availableCategories?: string[]
  addingIn: string | null
  onStartAdd: (cat: string) => void; onAdd: (label: string) => void; onCloseAdd: () => void
  onSaveItem: (id: number, label: string, category: string) => void
  onToggleItem: (id: number) => void; onDeleteItem: (id: number) => void
  onReorderItems: (cat: string, newItems: ListItem[]) => void
  onRemoveCategory: (cat: string) => void
  dragHandleProps: Record<string, unknown>
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
          <button {...(dragHandleProps as any)} type="button"
            className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 touch-none">
            <GripVertical className="h-4 w-4" />
          </button>
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">{cat}</p>
          <span className="text-[10px] text-slate-400">{items.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onStartAdd(cat)}
            className="flex items-center gap-1 text-[12px] text-primary hover:text-primary/80 font-medium">
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
          {confirmingRemove ? (
            <>
              <span className="text-[11px] text-red-500 font-medium">Remove category?</span>
              <button type="button" onClick={() => { onRemoveCategory(cat); setConfirmingRemove(false) }}
                className="p-1 text-red-500 hover:text-red-700 rounded"><Check className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => setConfirmingRemove(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded"><X className="h-3.5 w-3.5" /></button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmingRemove(true)}
              className="text-slate-300 hover:text-red-500 transition-colors" title="Remove category">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="px-2 py-1 space-y-0.5">
        <DndContext sensors={itemSensors} collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]} onDragEnd={handleItemDragEnd}>
          <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
            {items.map(item => (
              <SortableListItem key={item.id} item={item} showItemKey={showItemKey}
                availableCategories={availableCategories}
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
            <button type="button" onClick={onCloseAdd} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
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
      <CategoryBlock {...(props as any)} dragHandleProps={{ ...attributes, ...listeners }} />
    </div>
  )
}

// ── Uncategorized sortable block ──────────────────────────────────────────────

function UncategorizedBlock({ uncategorized, categories, items, showItemKey, commit, onSave, onToggle, onDelete }: {
  uncategorized: ListItem[]
  categories: string[]
  items: ListItem[]
  showItemKey?: boolean
  commit: (newItems: ListItem[]) => void
  onSave: (id: number, label: string, category: string) => void
  onToggle: (id: number) => void
  onDelete: (id: number) => void
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
              <SortableListItem key={item.id} item={item} showItemKey={showItemKey}
                availableCategories={categories}
                onSave={onSave} onToggle={onToggle} onDelete={onDelete} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}

// ── Generic list editor ────────────────────────────────────────────────────────

function GenericListEditor({ listType, listLabel }: { listType: string; listLabel: string }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [localItems,        setLocalItems]        = useState<ListItem[] | null>(null)
  const [addingIn,          setAddingIn]          = useState<string | null>(null)
  const [newCategory,       setNewCategory]       = useState('')
  const [showCatForm,       setShowCatForm]       = useState(false)
  const [addingFlat,        setAddingFlat]        = useState(false)
  const [newLabel,          setNewLabel]          = useState('')
  const [pendingCategories, setPendingCategories] = useState<string[]>([])

  const { data: serverItems = [], isLoading } = useQuery({
    queryKey: ['list-items', listType, 'all'],
    queryFn:  () => listService.getItems(listType, true),
  })
  const items = localItems ?? serverItems
  const showItemKey = items.some(i => i.item_key)

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

  const saveMut = useMutation({
    mutationFn: ({ id, label, category }: { id: number; label: string; category: string }) =>
      listService.updateItem(id, { label, category: category || undefined }),
    onSuccess: () => { invalidate(); toast({ title: 'Saved' }) },
    onError:   () => toast({ title: 'Save failed', variant: 'destructive' }),
  })
  const toggleMut = useMutation({
    mutationFn: (id: number) => listService.toggleStatus(id),
    onSuccess: invalidate,
    onError:   () => toast({ title: 'Update failed', variant: 'destructive' }),
  })
  const addMut = useMutation({
    mutationFn: ({ label, category }: { label: string; category?: string }) =>
      listService.createItem({ list_type: listType, label, category }),
    onSuccess: () => { invalidate(); toast({ title: 'Added' }) },
    onError:   () => toast({ title: 'Add failed', variant: 'destructive' }),
  })
  const reorderMut = useMutation({
    mutationFn: (payload: { id: number; sort_order: number }[]) => listService.reorder(payload),
    onSuccess: invalidate,
    onError:   () => { setLocalItems(null); toast({ title: 'Reorder failed', variant: 'destructive' }) },
  })
  const deleteMut = useMutation({
    mutationFn: (id: number) => listService.deleteItem(id),
    onSuccess: () => { invalidate(); toast({ title: 'Deleted' }) },
    onError:   () => toast({ title: 'Delete failed', variant: 'destructive' }),
  })

  const commit = (newItems: ListItem[]) => { setLocalItems(newItems); reorderMut.mutate(newItems.map((it, idx) => ({ id: it.id, sort_order: idx + 1 }))) }

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
    const reordered: ListItem[] = []
    newOrder.forEach(cat => reordered.push(...items.filter(i => i.category === cat)))
    reordered.push(...items.filter(i => !i.category))
    commit(reordered)
  }

  const handleItemReorder = (cat: string, newCatItems: ListItem[]) => {
    const reordered = categories.flatMap(c => c === cat ? newCatItems : items.filter(i => i.category === c))
    reordered.push(...items.filter(i => !i.category))
    commit(reordered)
  }

  const handleRemoveCategory = (cat: string) => {
    setPendingCategories(prev => prev.filter(c => c !== cat))
    const catItems = items.filter(i => i.category === cat)
    if (catItems.length > 0) {
      Promise.all(catItems.map(item => listService.updateItem(item.id, { category: '' })))
        .then(() => { invalidate(); toast({ title: 'Category removed' }) })
        .catch(() => toast({ title: 'Failed', variant: 'destructive' }))
    }
    setLocalItems(null)
  }

  const itemActions = {
    onSaveItem:          (id: number, label: string, category: string) => saveMut.mutate({ id, label, category }),
    onToggleItem:        (id: number) => toggleMut.mutate(id),
    onDeleteItem:        (id: number) => deleteMut.mutate(id),
    onReorderItems:      handleItemReorder,
    onRemoveCategory:    handleRemoveCategory,
    availableCategories: categories,
  }

  if (isLoading) return <div className="p-6 text-[13px] text-slate-400">Loading…</div>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-[12px] text-slate-500">
          <span><span className="font-semibold text-slate-700">{items.filter(i => i.is_active).length}</span> active</span>
          {items.filter(i => !i.is_active).length > 0 && (
            <span><span className="font-semibold text-slate-400">{items.filter(i => !i.is_active).length}</span> inactive</span>
          )}
          {hasCategories && <span><span className="font-semibold text-slate-700">{categories.length}</span> categories</span>}
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setShowCatForm(v => !v)}
            className="flex items-center gap-1 text-[12px] text-slate-500 hover:text-primary font-medium">
            <Plus className="h-3.5 w-3.5" /> New Category
          </button>
          {!hasCategories && (
            <button type="button" onClick={() => setAddingFlat(v => !v)}
              className="flex items-center gap-1 text-[12px] text-primary hover:text-primary/80 font-medium">
              <Plus className="h-3.5 w-3.5" /> Add Option
            </button>
          )}
        </div>
      </div>

      {showCatForm && (
        <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg border border-dashed border-slate-300">
          <input className={cn(inp, 'flex-1 bg-white')} placeholder="Category name…"
            value={newCategory} autoFocus onChange={e => setNewCategory(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && newCategory.trim()) {
                const cat = newCategory.trim()
                if (!categories.includes(cat)) { setPendingCategories(prev => [...prev, cat]); setAddingIn(cat) }
                setShowCatForm(false); setNewCategory('')
              }
              if (e.key === 'Escape') { setShowCatForm(false); setNewCategory('') }
            }} />
          <span className="text-[12px] text-slate-400">Press Enter, then add items</span>
          <button type="button" onClick={() => { setShowCatForm(false); setNewCategory('') }}
            className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>
      )}

      {!hasCategories && addingFlat && (
        <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg border border-dashed border-slate-300">
          <input className={cn(inp, 'flex-1 bg-white')} placeholder={`New ${listLabel} option…`}
            value={newLabel} autoFocus onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && newLabel.trim()) { addMut.mutate({ label: newLabel.trim() }); setNewLabel(''); setAddingFlat(false) }
              if (e.key === 'Escape') { setAddingFlat(false); setNewLabel('') }
            }} />
          <span className="text-[12px] text-slate-400">Press Enter to add</span>
          <button type="button" onClick={() => { setAddingFlat(false); setNewLabel('') }}
            className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>
      )}

      {!hasCategories && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <DndContext sensors={sensors} collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]} onDragEnd={handleFlatDragEnd}>
            <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
              <div className="px-2 py-1 space-y-0.5">
                {items.map(item => (
                  <SortableListItem key={item.id} item={item} showItemKey={showItemKey}
                    availableCategories={categories}
                    onSave={(id, label, category) => saveMut.mutate({ id, label, category })}
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
                <SortableCategoryWrapper
                  key={cat} cat={cat} showItemKey={showItemKey}
                  items={items.filter(i => i.category === cat)}
                  addingIn={addingIn}
                  onStartAdd={setAddingIn}
                  onAdd={label => {
                    addMut.mutate({ label, category: cat })
                    setPendingCategories(prev => prev.filter(c => c !== cat))
                    setAddingIn(null)
                  }}
                  onCloseAdd={() => {
                    if (addingIn && pendingCategories.includes(addingIn) &&
                        !items.some(i => i.category === addingIn)) {
                      setPendingCategories(prev => prev.filter(c => c !== addingIn))
                    }
                    setAddingIn(null)
                  }}
                  {...itemActions}
                />
              ))}
            </SortableContext>
            {uncategorized.length > 0 && (
              <UncategorizedBlock
                uncategorized={uncategorized}
                categories={categories}
                items={items}
                showItemKey={showItemKey}
                commit={commit}
                onSave={(id, label, category) => saveMut.mutate({ id, label, category })}
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ListManagementPage() {
  const [openSection,  setOpenSection]  = useState<string>('training')
  const [selectedList, setSelectedList] = useState<ManagedList | null>(
    SECTIONS.find(s => s.id === 'training')?.lists.find(l => l.key === 'behavior_flags') ?? null
  )

  const currentSection = SECTIONS.find(s => s.id === openSection)

  return (
    <QualityListPage>
      <QualityPageHeader
        title="List Management"
        subtitle="Manage dropdown values, labels and ordering used throughout the system."
      />

      <div className="grid grid-cols-4 gap-6">

        {/* ── Left nav ──────────────────────────────────────────────────── */}
        <div className="col-span-1 space-y-1">
          {SECTIONS.map(section => {
            const isOpen = openSection === section.id
            return (
              <div key={section.id}>
                <button type="button"
                  onClick={() => { setOpenSection(section.id); setSelectedList(null) }}
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-colors',
                    isOpen ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50'
                  )}
                >
                  <div className="flex items-center gap-2"><List className="h-4 w-4 shrink-0" />{section.label}</div>
                  {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>

                {isOpen && (
                  <div className="ml-3 mt-1 space-y-0.5 pl-3 border-l border-slate-200">
                    {section.lists.map(list => (
                      <button key={list.key} type="button"
                        onClick={() => setSelectedList(list)}
                        className={cn(
                          'w-full text-left px-2 py-2 rounded-md text-[13px] transition-colors flex items-center justify-between gap-2',
                          selectedList?.key === list.key ? 'bg-primary/10 text-primary font-medium' : 'text-slate-600 hover:bg-slate-50'
                        )}
                      >
                        <span>{list.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ── Right content ─────────────────────────────────────────────── */}
        <div className="col-span-3">

          {!selectedList ? (
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h2 className="text-base font-semibold text-slate-800 mb-1">{currentSection?.label} Lists</h2>
              <p className="text-[13px] text-slate-500 mb-5">Select a list from the left to manage its items.</p>
              <div className="space-y-3">
                {currentSection?.lists.map(list => (
                  <button key={list.key} type="button" onClick={() => setSelectedList(list)}
                    className="w-full text-left flex items-start justify-between gap-4 p-4 rounded-lg border border-slate-200 hover:border-primary/40 hover:bg-slate-50 transition-colors group">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-[13px] font-semibold text-slate-800">{list.label}</p>
                      </div>
                      <p className="text-[12px] text-slate-500 leading-snug">{list.description}</p>
                    </div>
                    <Settings2 className="h-4 w-4 text-slate-300 group-hover:text-primary shrink-0 mt-0.5 transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Header */}
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-slate-800 mb-1">
                      {selectedList.label}
                    </h2>
                    <p className="text-[13px] text-slate-500">{selectedList.description}</p>
                  </div>
                  <button type="button" onClick={() => setSelectedList(null)}
                    className="text-[12px] text-slate-400 hover:text-slate-600 shrink-0">← Back</button>
                </div>
              </div>

              {/* Editor or coming-soon */}
              {selectedList.implemented && selectedList.listType ? (
                <GenericListEditor listType={selectedList.listType} listLabel={selectedList.label} />
              ) : (
                <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center">
                  <Settings2 className="h-8 w-8 text-slate-300 mx-auto mb-3" />
                  <p className="text-[14px] font-semibold text-slate-500 mb-1">{selectedList.label} — Not yet converted</p>
                  <p className="text-[13px] text-slate-400 max-w-sm mx-auto">
                    This list is currently hardcoded in the system and will be moved here in a future update.
                  </p>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </QualityListPage>
  )
}


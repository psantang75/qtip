import { useState, useEffect } from 'react'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus, Trash2, Pencil, CheckCircle2, ClipboardList } from 'lucide-react'
import type { Form, FormCategory } from '@/types/form.types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { totalCategoryWeight } from './formBuilderUtils'

// ── Sortable category row ─────────────────────────────────────────────────────
function SortableCategoryRow({ cat, idx, isEditing, isWeightEdit, editPct, onStartEdit, onSaveEdit, onCancelEdit, onRemove, onWeightChange }: {
  cat: FormCategory; idx: number
  isEditing: boolean; isWeightEdit: boolean
  editPct: string
  onStartEdit: (idx: number) => void
  onSaveEdit: (idx: number, name: string, pct: string) => void
  onCancelEdit: () => void
  onRemove: (idx: number) => void
  onWeightChange: (idx: number, pct: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `cat-${idx}` })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  const [localName, setLocalName] = useState(cat.category_name)
  const [localPct, setLocalPct] = useState(String(Math.round(cat.weight * 100)))

  useEffect(() => {
    if (isEditing) { setLocalName(cat.category_name); setLocalPct(String(Math.round(cat.weight * 100))) }
  }, [isEditing, cat])

  return (
    <div ref={setNodeRef} style={style}
      className={cn('rounded-lg border transition-all', isDragging ? 'shadow-lg' : '',
        isEditing ? 'border-primary shadow-sm' : 'border-slate-200 bg-white')}>

      <div className={cn('flex items-center gap-2 px-3 py-2.5', isEditing ? 'bg-primary/5' : '')}>
        <button {...attributes} {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 text-slate-300 hover:text-slate-500 shrink-0 touch-none">
          <GripVertical className="h-4 w-4" />
        </button>

        <div className="flex-1 min-w-0">
          <span className={cn('font-medium text-sm truncate', isEditing ? 'text-primary' : 'text-slate-900')}>
            {isEditing ? (localName || cat.category_name) : cat.category_name}
          </span>
        </div>

        {isWeightEdit && !isEditing ? (
          <div className="flex items-center gap-1 shrink-0">
            <Input type="number" min={0} max={100} step={1} value={editPct}
              onChange={e => onWeightChange(idx, e.target.value)}
              className="h-7 w-20 text-sm text-right" />
            <span className="text-xs text-slate-500">%</span>
          </div>
        ) : (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 bg-slate-100 text-slate-700">
            {Math.round(cat.weight * 100)}%
          </span>
        )}

        <span className="text-xs text-slate-400 shrink-0 w-16 text-right">
          {cat.questions?.length ?? 0} {cat.questions?.length === 1 ? 'question' : 'questions'}
        </span>

        {!isWeightEdit && (
          <div className="flex gap-1 shrink-0">
            <Button variant="ghost" size="icon"
              className={cn('h-7 w-7', isEditing ? 'text-primary' : '')}
              title={isEditing ? 'Editing…' : 'Edit category'}
              onClick={() => isEditing ? undefined : onStartEdit(idx)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
              title="Remove category" onClick={() => onRemove(idx)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {isEditing && (
        <div className="px-3 pb-3 border-t border-primary/20 bg-white rounded-b-lg">
          <div className="flex gap-3 pt-3">
            <div className="flex-1 space-y-1">
              <Label className="text-xs font-medium text-slate-600">Category Name</Label>
              <Input value={localName} onChange={e => setLocalName(e.target.value)}
                placeholder="e.g. Greeting & Opening" className="h-8 text-sm"
                onKeyDown={e => e.key === 'Enter' && onSaveEdit(idx, localName, localPct)}
                autoFocus />
            </div>
            <div className="w-36 space-y-1">
              <Label className="text-xs font-medium text-slate-600">Weight</Label>
              <div className="flex items-center gap-1.5">
                <Input type="number" min={0} max={100} step={1} value={localPct}
                  onChange={e => setLocalPct(e.target.value)} className="h-8 text-sm"
                  onKeyDown={e => e.key === 'Enter' && onSaveEdit(idx, localName, localPct)} />
                <span className="text-sm text-slate-500 font-medium">%</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2 pt-3">
            <Button size="sm" className="bg-primary hover:bg-primary/90 text-white h-8 px-4"
              onClick={() => onSaveEdit(idx, localName, localPct)}
              disabled={!localName.trim() || !localPct}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Save
            </Button>
            <Button variant="outline" size="sm" className="h-8 px-4" onClick={onCancelEdit}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Step 2: Categories ─────────────────────────────────────────────────────────
export function CategoriesStep({ form, onChange }: { form: Form; onChange: (f: Form) => void }) {
  const cats = form.categories
  const total = totalCategoryWeight(cats)
  const remaining = Math.max(0, 1 - total)
  const weightOk = Math.abs(total - 1) < 0.005

  const [newName, setNewName]           = useState('')
  const [editIdx, setEditIdx]           = useState<number | null>(null)
  const [weightEditMode, setWEM]        = useState(false)
  const [editPcts, setEditPcts]         = useState<Record<number, string>>({})

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const catIds = cats.map((_, i) => `cat-${i}`)

  const enterWeightEdit = () => {
    const seed: Record<number, string> = {}
    cats.forEach((c, i) => { seed[i] = String(Math.round(c.weight * 100)) })
    setEditPcts(seed); setWEM(true); setEditIdx(null)
  }

  const applyWeightEdit = () => {
    const updated = cats.map((c, i) => {
      const pct = parseFloat(editPcts[i] ?? String(Math.round(c.weight * 100)))
      return { ...c, weight: isNaN(pct) ? c.weight : pct / 100 }
    })
    onChange({ ...form, categories: updated }); setWEM(false)
  }

  const distributeEqually = () => {
    if (cats.length === 0) return
    const each = Math.round(100 / cats.length)
    const seed: Record<number, string> = {}
    cats.forEach((_, i) => { seed[i] = String(each) })
    setEditPcts(seed)
  }

  const bulkTotal = Object.values(editPcts).reduce((s, v) => s + (parseFloat(v) || 0), 0)

  const addCategory = () => {
    if (!newName.trim()) return
    onChange({ ...form, categories: [...cats, { category_name: newName.trim(), weight: 0, questions: [] }] })
    setNewName('')
  }

  const startEdit = (idx: number) => { setEditIdx(idx); setWEM(false) }
  const cancelEdit = () => setEditIdx(null)
  const saveEdit = (idx: number, name: string, pct: string) => {
    const w = parseFloat(pct)
    if (!name.trim() || isNaN(w) || w <= 0) return
    onChange({ ...form, categories: cats.map((c, i) => i === idx ? { ...c, category_name: name.trim(), weight: w / 100 } : c) })
    setEditIdx(null)
  }

  const removeCategory = (idx: number) => {
    onChange({ ...form, categories: cats.filter((_, i) => i !== idx) })
    if (editIdx === idx) setEditIdx(null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = parseInt(String(active.id).replace('cat-', ''))
    const to   = parseInt(String(over.id).replace('cat-', ''))
    onChange({ ...form, categories: arrayMove(cats, from, to) })
    if (editIdx === from) setEditIdx(to)
    else if (editIdx === to) setEditIdx(from)
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className={cn('rounded-lg border px-4 py-2.5 text-sm',
        total > 1.005 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200')}>
        <div className="flex items-center justify-between mb-1.5">
          <span className={cn('font-medium', total > 1.005 ? 'text-red-700' : 'text-slate-700')}>
            Weights: {Math.round(total * 100)}% of 100%
          </span>
          {weightOk
            ? <span className="flex items-center gap-1 text-emerald-600 font-medium text-xs"><CheckCircle2 className="h-3.5 w-3.5" /> Ready</span>
            : total > 1.005
            ? <span className="text-red-600 font-medium text-xs">Exceeds 100% — reduce weights</span>
            : <span className="text-slate-400 text-xs">{Math.round(remaining * 100)}% remaining</span>
          }
        </div>
        <div className="w-full bg-slate-200 rounded-full h-1.5">
          <div className={cn('h-1.5 rounded-full transition-all duration-300',
            total > 1.005 ? 'bg-red-500' : weightOk ? 'bg-emerald-500' : 'bg-primary')}
            style={{ width: `${Math.min(100, Math.round(total * 100))}%` }} />
        </div>
      </div>

      <div className="flex gap-2 items-end">
        <div className="flex-1 space-y-1">
          <Label className="text-xs text-slate-600">Category Name</Label>
          <Input value={newName} onChange={e => setNewName(e.target.value)}
            placeholder="e.g. Greeting & Opening" className="h-9 text-sm"
            onKeyDown={e => e.key === 'Enter' && addCategory()} />
        </div>
        <Button size="sm" onClick={addCategory} disabled={!newName.trim()}
          className="bg-primary hover:bg-primary/90 text-white h-9">
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
        {cats.length > 1 && !weightEditMode && (
          <>
            <Button variant="outline" size="sm" className="h-9 text-xs" onClick={enterWeightEdit}>
              Set Weights
            </Button>
            <Button variant="ghost" size="sm" className="h-9 text-xs text-primary" onClick={() => {
              const each = Math.round(100 / cats.length)
              onChange({ ...form, categories: cats.map(c => ({ ...c, weight: each / 100 })) })
            }}>
              Distribute Equally
            </Button>
          </>
        )}
      </div>

      {weightEditMode && (
        <div className={cn('flex items-center justify-between rounded-lg px-4 py-2.5 border text-sm',
          Math.abs(bulkTotal - 100) < 1 ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200')}>
          <div className="flex items-center gap-3">
            <span className={cn('font-semibold', Math.abs(bulkTotal - 100) < 1 ? 'text-emerald-700' : 'text-amber-700')}>
              Total: {bulkTotal.toFixed(0)}%
            </span>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-primary px-2" onClick={distributeEqually}>
              Distribute Equally
            </Button>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="h-7 px-3 text-xs bg-primary hover:bg-primary/90 text-white"
              onClick={applyWeightEdit} disabled={Math.abs(bulkTotal - 100) > 1}>
              Apply
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-3 text-xs" onClick={() => setWEM(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {cats.length > 0 ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={catIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {cats.map((c, i) => (
                <SortableCategoryRow
                  key={`cat-${i}`} cat={c} idx={i}
                  isEditing={editIdx === i}
                  isWeightEdit={weightEditMode}
                  editPct={editPcts[i] ?? String(Math.round(c.weight * 100))}
                  onStartEdit={startEdit} onSaveEdit={saveEdit} onCancelEdit={cancelEdit}
                  onRemove={removeCategory}
                  onWeightChange={(idx, pct) => setEditPcts(prev => ({ ...prev, [idx]: pct }))}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="border-2 border-dashed border-slate-200 rounded-lg py-10 text-center text-slate-400">
          <ClipboardList className="h-8 w-8 mx-auto mb-2 text-slate-300" />
          <p className="text-sm">No categories yet. Add at least one above.</p>
        </div>
      )}
    </div>
  )
}

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Plus, Pencil, Trash2, ChevronRight, ChevronLeft,
  ClipboardList, CheckCircle2, AlertCircle, GripVertical,
} from 'lucide-react'
import { FormBuilderList } from './FormBuilderList'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useAuth } from '@/contexts/AuthContext'
import { getFormById, createForm, updateForm } from '@/services/formService'
import type { Form, FormCategory, FormQuestion, FormMetadataField, FormQuestionCondition, MetadataFieldType, RadioOption, QuestionType, ConditionType, LogicalOperator } from '@/types/form.types'
import {
  processConditionalLogic,
  calculateFormScore,
  prepareFormForRender,
  FormRenderer,
  type FormRenderData,
  getQuestionScore,
} from '@/utils/forms'
import type { CategoryRenderData } from '@/utils/forms/formRendererComponents'
import { getMaxPossibleScore } from '@/utils/forms/scoringAdapter'
import FormMetadataDisplay from '@/components/FormMetadataDisplay'
import { scoreColor } from '@/services/qaService'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────
type Step = 'metadata' | 'categories' | 'questions' | 'preview'
const STEPS: Step[] = ['metadata', 'categories', 'questions', 'preview']
const STEP_LABELS: Record<Step, string> = {
  metadata: '1. Details', categories: '2. Categories', questions: '3. Questions', preview: '4. Preview & Save',
}

function freshForm(): Form {
  const defaultMetadata: FormMetadataField[] = [
    { field_name: 'Reviewer Name', field_type: 'AUTO',    is_required: true,  interaction_type: 'CALL', sort_order: 0 },
    { field_name: 'Review Date',   field_type: 'AUTO',    is_required: true,  interaction_type: 'CALL', sort_order: 1 },
    { field_name: 'CSR',           field_type: 'DROPDOWN',is_required: true,  interaction_type: 'CALL', sort_order: 2 },
    { field_name: 'Spacer-1',      field_type: 'SPACER',  is_required: false, interaction_type: 'CALL', sort_order: 3 },
    { field_name: 'Customer ID',   field_type: 'TEXT',    is_required: true,  interaction_type: 'CALL', sort_order: 4 },
    { field_name: 'Customer Name', field_type: 'TEXT',    is_required: true,  interaction_type: 'CALL', sort_order: 5 },
    { field_name: 'Ticket Number', field_type: 'TEXT',    is_required: true,  interaction_type: 'CALL', sort_order: 6 },
    { field_name: 'Spacer-2',      field_type: 'SPACER',  is_required: false, interaction_type: 'CALL', sort_order: 7 },
    { field_name: 'Call Conversation ID', field_type: 'TEXT', is_required: true, interaction_type: 'CALL', sort_order: 8 },
    { field_name: 'Call Date',     field_type: 'DATE',    is_required: true,  interaction_type: 'CALL', sort_order: 9 },
  ]
  return { form_name: '', interaction_type: 'CALL', is_active: true, version: 1, categories: [], metadata_fields: defaultMetadata }
}

function totalCategoryWeight(categories: FormCategory[]): number {
  return categories.reduce((s, c) => s + (c.weight || 0), 0)
}

// ── Step indicator ─────────────────────────────────────────────────────────────
function StepBar({ current }: { current: Step }) {
  return (
    <div className="flex items-center gap-1 mb-6">
      {STEPS.map((s, i) => {
        const idx = STEPS.indexOf(current)
        const done = i < idx; const active = s === current
        return (
          <div key={s} className="flex items-center gap-1 flex-1">
            <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
              active ? 'bg-[#00aeef] text-white' : done ? 'bg-[#00aeef]/20 text-[#00aeef]' : 'bg-slate-100 text-slate-400')}>
              {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span>{i + 1}</span>}
              <span className="hidden sm:inline">{STEP_LABELS[s].split('. ')[1]}</span>
            </div>
            {i < STEPS.length - 1 && <div className={cn('flex-1 h-px', i < idx ? 'bg-[#00aeef]/40' : 'bg-slate-200')} />}
          </div>
        )
      })}
    </div>
  )
}

// ── Sortable metadata field row ───────────────────────────────────────────────
function SortableMetadataField({ field, idx, onUpdate, onRemove }: {
  field: FormMetadataField; idx: number
  onUpdate: (idx: number, patch: Partial<FormMetadataField>) => void
  onRemove: (idx: number) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `field-${idx}` })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  // Local state for the dropdown options editor
  const [newOption, setNewOption] = useState('')
  const existingOptions = field.dropdown_source
    ? field.dropdown_source.split(',').map(s => s.trim()).filter(Boolean)
    : []

  const addOption = () => {
    const trimmed = newOption.trim()
    if (!trimmed || existingOptions.includes(trimmed)) return
    const updated = [...existingOptions, trimmed].join(', ')
    onUpdate(idx, { dropdown_source: updated })
    setNewOption('')
  }

  const removeOption = (opt: string) => {
    const updated = existingOptions.filter(o => o !== opt).join(', ')
    onUpdate(idx, { dropdown_source: updated })
  }

  return (
    <div ref={setNodeRef} style={style}
      className={cn('rounded border', isDragging ? 'shadow-lg z-50' : '',
        field.field_type === 'SPACER' ? 'bg-slate-100 border-slate-200' : 'bg-white border-slate-200')}>
      {/* Main row */}
      <div className="grid grid-cols-10 gap-2 items-center p-2">
        {/* Drag handle */}
        <div className="col-span-1 flex justify-center">
          <button {...attributes} {...listeners}
            className="cursor-grab active:cursor-grabbing p-1 text-slate-400 hover:text-slate-600 rounded touch-none"
            title="Drag to reorder">
            <GripVertical className="h-4 w-4" />
          </button>
        </div>
        <div className="col-span-3">
          <Input value={field.field_name} disabled={field.field_type === 'SPACER'}
            onChange={e => onUpdate(idx, { field_name: e.target.value })}
            placeholder={field.field_type === 'SPACER' ? 'Visual spacer' : 'Field name'}
            className="h-8 text-sm" />
        </div>
        <div className="col-span-2">
          {/* AUTO is excluded — only available on system required fields */}
          <Select value={field.field_type} onValueChange={v => onUpdate(idx, { field_type: v as MetadataFieldType, dropdown_source: v !== 'DROPDOWN' ? undefined : field.dropdown_source })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="TEXT">Text</SelectItem>
              <SelectItem value="DROPDOWN">Dropdown</SelectItem>
              <SelectItem value="DATE">Date</SelectItem>
              <SelectItem value="SPACER">Spacer</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-3 flex items-center gap-1.5">
          <input type="checkbox" checked={field.is_required} disabled={field.field_type === 'SPACER'}
            onChange={e => onUpdate(idx, { is_required: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300" />
          <span className="text-xs text-slate-600">Required</span>
        </div>
        <div className="col-span-1 flex justify-center">
          <button onClick={() => onRemove(idx)} className="p-1 text-red-500 hover:bg-red-50 rounded" title="Remove field">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Dropdown options editor — shown only when type is DROPDOWN */}
      {field.field_type === 'DROPDOWN' && (
        <div className="px-3 pb-3 pt-0 space-y-2 border-t border-slate-100">
          <p className="text-[11px] font-medium text-slate-500 pt-2">Dropdown Options</p>

          {/* Existing options as removable chips */}
          {existingOptions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {existingOptions.map(opt => (
                <span key={opt}
                  className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 text-xs px-2 py-0.5 rounded-full border border-slate-200">
                  {opt}
                  <button onClick={() => removeOption(opt)}
                    className="text-slate-400 hover:text-red-500 ml-0.5 leading-none">
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Add option input */}
          <div className="flex gap-2 items-center">
            <Input
              value={newOption}
              onChange={e => setNewOption(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addOption()}
              placeholder="Type an option and press Enter or Add…"
              className="h-7 text-xs flex-1"
            />
            <Button size="sm" onClick={addOption} disabled={!newOption.trim()}
              className="h-7 px-2 text-xs bg-[#00aeef] hover:bg-[#0095cc] text-white">
              <Plus className="h-3 w-3 mr-1" /> Add
            </Button>
          </div>

          {existingOptions.length === 0 && (
            <p className="text-[11px] text-amber-600">⚠ No options defined — the dropdown will be empty during audits.</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Step 1: Metadata + Metadata Fields ────────────────────────────────────────
function MetadataStep({ form, onChange }: { form: Form; onChange: (f: Form) => void }) {
  const fields = form.metadata_fields || []

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const updateField = (idx: number, patch: Partial<FormMetadataField>) => {
    const updated = fields.map((f, i) => i === idx ? { ...f, ...patch } : f)
    onChange({ ...form, metadata_fields: updated })
  }

  const addField = () => {
    onChange({ ...form, metadata_fields: [...fields, {
      field_name: '', field_type: 'TEXT' as MetadataFieldType,
      is_required: true, interaction_type: form.interaction_type || 'CALL', sort_order: fields.length,
    }] })
  }

  const removeField = (idx: number) => {
    if (idx < 4) return
    onChange({ ...form, metadata_fields: fields.filter((_, i) => i !== idx) })
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    // IDs are "field-4", "field-5", ... extract the absolute index
    const fromAbs = parseInt(String(active.id).replace('field-', ''))
    const toAbs   = parseInt(String(over.id).replace('field-', ''))
    // Only allow reordering within the optional section (idx >= 4)
    if (fromAbs < 4 || toAbs < 4) return
    const required = fields.slice(0, 4)
    const optional = arrayMove(fields.slice(4), fromAbs - 4, toAbs - 4)
    onChange({ ...form, metadata_fields: [...required, ...optional].map((f, i) => ({ ...f, sort_order: i })) })
  }

  const handleInteractionChange = (val: string) => {
    const it = val as Form['interaction_type']
    onChange({ ...form, interaction_type: it, metadata_fields: fields.map(f => ({ ...f, interaction_type: it })) })
  }

  const optionalIds = fields.slice(4).map((_, i) => `field-${i + 4}`)

  return (
    <div className="max-w-3xl space-y-6">
      {/* Core fields */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label>Form Name <span className="text-red-500">*</span></Label>
          <Input value={form.form_name} onChange={e => onChange({ ...form, form_name: e.target.value })}
            placeholder="e.g. Customer Service Call Review" className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label>Interaction Type</Label>
          <Select value={form.interaction_type || 'CALL'} onValueChange={handleInteractionChange}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="CALL">Call</SelectItem>
              <SelectItem value="TICKET">Ticket</SelectItem>
              <SelectItem value="EMAIL">Email</SelectItem>
              <SelectItem value="CHAT">Chat</SelectItem>
              <SelectItem value="UNIVERSAL">Universal</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Version</Label>
          <div className="relative">
            <Input value={form.version || 1} disabled className="h-9 bg-slate-50 text-slate-500 pr-28" />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs bg-slate-200 px-2 py-0.5 rounded text-slate-600">Auto-incremented</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Switch checked={form.is_active} onCheckedChange={v => onChange({ ...form, is_active: v })} />
        <Label className="cursor-pointer">Active (available for audits)</Label>
      </div>

      {/* Metadata fields */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-4">
        {/* Required fields */}
        <div className="relative border-t-2 border-slate-300 pt-4 mt-2">
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-slate-50 px-3 text-xs font-medium text-slate-600">Required Fields</span>
        </div>
        {fields.slice(0, 4).map((field, i) => (
          <div key={i} className={cn('p-3 rounded border border-slate-200 flex items-center justify-between', field.field_type === 'SPACER' ? 'bg-slate-100' : 'bg-white')}>
            <div>
              <span className="font-medium text-slate-800 text-sm">{field.field_name}</span>
              <span className="text-xs text-slate-400 ml-2">
                {field.field_type === 'AUTO' && '— Auto-populated'}
                {field.field_type === 'DROPDOWN' && '— Dropdown'}
                {field.field_type === 'SPACER' && '— Visual spacer'}
              </span>
            </div>
            <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{field.field_type}</span>
          </div>
        ))}

        {/* Optional fields — drag-and-drop sortable */}
        <div className="relative border-t-2 border-slate-300 pt-4 mt-6">
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-slate-50 px-3 text-xs font-medium text-slate-600">Optional Fields</span>
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={addField} className="bg-[#00aeef] hover:bg-[#0095cc] text-white h-8">
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Field
          </Button>
        </div>

        {fields.slice(4).length > 0 && (
          <div className="grid grid-cols-10 gap-2 text-xs font-medium text-slate-500 px-1 mb-1">
            <div className="col-span-1" />
            <div className="col-span-3">Field Name</div>
            <div className="col-span-2">Type</div>
            <div className="col-span-3">Required</div>
            <div className="col-span-1 text-center">Del</div>
          </div>
        )}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={optionalIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {fields.slice(4).map((field, relIdx) => (
                <SortableMetadataField
                  key={`field-${relIdx + 4}`}
                  field={field}
                  idx={relIdx + 4}
                  onUpdate={updateField}
                  onRemove={removeField}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {fields.slice(4).length === 0 && (
          <p className="text-xs text-slate-400 text-center py-2">No optional fields yet. Click Add Field to create one.</p>
        )}
      </div>
    </div>
  )
}

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

  // Sync when edit opens
  useEffect(() => {
    if (isEditing) { setLocalName(cat.category_name); setLocalPct(String(Math.round(cat.weight * 100))) }
  }, [isEditing, cat])

  return (
    <div ref={setNodeRef} style={style}
      className={cn('rounded-lg border transition-all', isDragging ? 'shadow-lg' : '',
        isEditing ? 'border-[#00aeef] shadow-sm' : 'border-slate-200 bg-white')}>

      {/* Main row — always shows current state, never replaced */}
      <div className={cn('flex items-center gap-2 px-3 py-2.5', isEditing ? 'bg-[#00aeef]/5' : '')}>
        {/* Drag handle */}
        <button {...attributes} {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 text-slate-300 hover:text-slate-500 shrink-0 touch-none">
          <GripVertical className="h-4 w-4" />
        </button>

        {/* Name — shows live value from local state while editing */}
        <div className="flex-1 min-w-0">
          <span className={cn('font-medium text-sm truncate', isEditing ? 'text-[#00aeef]' : 'text-slate-900')}>
            {isEditing ? (localName || cat.category_name) : cat.category_name}
          </span>
        </div>

        {/* Weight badge or inline input (bulk weight-edit mode) */}
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

        {/* Question count */}
        <span className="text-xs text-slate-400 shrink-0 w-16 text-right">
          {cat.questions?.length ?? 0} {cat.questions?.length === 1 ? 'question' : 'questions'}
        </span>

        {/* Always-visible pencil + trash (not replaced by Save/Cancel) */}
        {!isWeightEdit && (
          <div className="flex gap-1 shrink-0">
            <Button variant="ghost" size="icon"
              className={cn('h-7 w-7', isEditing ? 'text-[#00aeef]' : '')}
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

      {/* Edit panel — expands below the row */}
      {isEditing && (
        <div className="px-3 pb-3 border-t border-[#00aeef]/20 bg-white rounded-b-lg">
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
          {/* Save / Cancel below the inputs */}
          <div className="flex gap-2 pt-3">
            <Button size="sm" className="bg-[#00aeef] hover:bg-[#0095cc] text-white h-8 px-4"
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
function CategoriesStep({ form, onChange }: { form: Form; onChange: (f: Form) => void }) {
  const cats = form.categories
  const total = totalCategoryWeight(cats)
  const remaining = Math.max(0, 1 - total)
  const weightOk = Math.abs(total - 1) < 0.005

  // Add category form
  const [newName, setNewName] = useState('')

  // Inline edit state
  const [editIdx, setEditIdx] = useState<number | null>(null)

  // Bulk weight-edit mode
  const [weightEditMode, setWeightEditMode] = useState(false)
  // editPcts stores working pct strings for bulk edit; keyed by index
  const [editPcts, setEditPcts] = useState<Record<number, string>>({})

  // dnd-kit
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const catIds = cats.map((_, i) => `cat-${i}`)

  // Enter bulk weight-edit: seed from current weights
  const enterWeightEdit = () => {
    const seed: Record<number, string> = {}
    cats.forEach((c, i) => { seed[i] = String(Math.round(c.weight * 100)) })
    setEditPcts(seed)
    setWeightEditMode(true)
    setEditIdx(null)
  }

  const applyWeightEdit = () => {
    const updated = cats.map((c, i) => {
      const pct = parseFloat(editPcts[i] ?? String(Math.round(c.weight * 100)))
      return { ...c, weight: isNaN(pct) ? c.weight : pct / 100 }
    })
    onChange({ ...form, categories: updated })
    setWeightEditMode(false)
  }

  const distributeEqually = () => {
    if (cats.length === 0) return
    const each = Math.round(100 / cats.length)
    const seed: Record<number, string> = {}
    cats.forEach((_, i) => { seed[i] = String(each) })
    setEditPcts(seed)
  }

  const bulkTotal = Object.values(editPcts).reduce((s, v) => s + (parseFloat(v) || 0), 0)

  // Add new category — name only, weight starts at 0. User sets weights afterwards.
  const addCategory = () => {
    if (!newName.trim()) return
    onChange({ ...form, categories: [...cats, { category_name: newName.trim(), weight: 0, questions: [] }] })
    setNewName('')
  }

  // Inline edit handlers
  const startEdit = (idx: number) => { setEditIdx(idx); setWeightEditMode(false) }
  const cancelEdit = () => setEditIdx(null)
  const saveEdit = (idx: number, name: string, pct: string) => {
    const w = parseFloat(pct)
    if (!name.trim() || isNaN(w) || w <= 0) return
    const updated = cats.map((c, i) => i === idx ? { ...c, category_name: name.trim(), weight: w / 100 } : c)
    onChange({ ...form, categories: updated })
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
      {/* Weight progress — informational; only shows error if over 100% */}
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
            : <span className="text-slate-400 text-xs">{Math.round(remaining * 100)}% remaining — set via Edit or Set Weights</span>
          }
        </div>
        <div className="w-full bg-slate-200 rounded-full h-1.5">
          <div className={cn('h-1.5 rounded-full transition-all duration-300',
            total > 1.005 ? 'bg-red-500' : weightOk ? 'bg-emerald-500' : 'bg-[#00aeef]')}
            style={{ width: `${Math.min(100, Math.round(total * 100))}%` }} />
        </div>
      </div>

      {/* Toolbar: Add category (name only) + Set Weights + Distribute Equally */}
      <div className="flex gap-2 items-end">
        <div className="flex-1 space-y-1">
          <Label className="text-xs text-slate-600">Category Name</Label>
          <Input value={newName} onChange={e => setNewName(e.target.value)}
            placeholder="e.g. Greeting & Opening" className="h-9 text-sm"
            onKeyDown={e => e.key === 'Enter' && addCategory()} />
        </div>
        <Button size="sm" onClick={addCategory} disabled={!newName.trim()}
          className="bg-[#00aeef] hover:bg-[#0095cc] text-white h-9">
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
        {cats.length > 1 && !weightEditMode && (
          <>
            <Button variant="outline" size="sm" className="h-9 text-xs" onClick={enterWeightEdit}>
              Set Weights
            </Button>
            <Button variant="ghost" size="sm" className="h-9 text-xs text-[#00aeef]" onClick={() => {
              const each = Math.round(100 / cats.length)
              onChange({ ...form, categories: cats.map(c => ({ ...c, weight: each / 100 })) })
            }}>
              Distribute Equally
            </Button>
          </>
        )}
      </div>

      {/* Bulk weight-edit toolbar */}
      {weightEditMode && (
        <div className={cn('flex items-center justify-between rounded-lg px-4 py-2.5 border text-sm',
          Math.abs(bulkTotal - 100) < 1 ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200')}>
          <div className="flex items-center gap-3">
            <span className={cn('font-semibold', Math.abs(bulkTotal - 100) < 1 ? 'text-emerald-700' : 'text-amber-700')}>
              Total: {bulkTotal.toFixed(0)}%
            </span>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-[#00aeef] hover:text-[#0095cc] px-2"
              onClick={distributeEqually}>
              Distribute Equally
            </Button>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="h-7 px-3 text-xs bg-[#00aeef] hover:bg-[#0095cc] text-white"
              onClick={applyWeightEdit}
              disabled={Math.abs(bulkTotal - 100) > 1}>
              Apply
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-3 text-xs" onClick={() => setWeightEditMode(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Category list */}
      {cats.length > 0 ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={catIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {cats.map((c, i) => (
                <SortableCategoryRow
                  key={`cat-${i}`}
                  cat={c} idx={i}
                  isEditing={editIdx === i}
                  isWeightEdit={weightEditMode}
                  editPct={editPcts[i] ?? String(Math.round(c.weight * 100))}
                  onStartEdit={startEdit}
                  onSaveEdit={saveEdit}
                  onCancelEdit={cancelEdit}
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

// ── Sortable question row ─────────────────────────────────────────────────────
function SortableQuestionRow({ q, qi, catIdx, form, onChange, allQuestions, isEditing, onStartEdit, onCancelEdit }: {
  q: FormQuestion; qi: number; catIdx: number
  form: Form; onChange: (f: Form) => void
  allQuestions: { id: number; text: string; type: string; catName: string; scaleMin: number; scaleMax: number; naAllowed: boolean; radioOptions: RadioOption[] }[]
  isEditing: boolean
  onStartEdit: (qi: number) => void
  onCancelEdit: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `q-${qi}` })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  // ── Local edit state ───────────────────────────────────────────────────────
  const [lText, setLText]         = useState(q.question_text)
  const [lType, setLType]         = useState<QuestionType>(q.question_type)
  const [lRequired, setLRequired] = useState(q.is_required ?? true)
  const [lVisible, setLVisible]   = useState(q.visible_to_csr !== false)
  const [lNa, setLNa]             = useState(q.is_na_allowed ?? false)
  // Point values (replaces weight)
  const [lYes, setLYes]           = useState(q.yes_value ?? 1)
  const [lNo, setLNo]             = useState(q.no_value ?? 0)
  const [lNaVal, setLNaVal]       = useState(q.na_value ?? 0)
  // Scale
  const [lScaleMin, setLScaleMin] = useState(q.scale_min ?? 1)
  const [lScaleMax, setLScaleMax] = useState(q.scale_max ?? 5)
  // Radio
  const [lRadio, setLRadio]       = useState<RadioOption[]>(q.radio_options ?? [])
  const [newOptText, setNewOptText] = useState('')
  const [newOptVal, setNewOptVal]   = useState('')
  const [newOptScore, setNewOptScore] = useState(0)
  const [newOptFree, setNewOptFree]  = useState(false)
  // ── Conditional logic (group-based: AND within group, OR between groups) ────
  const [lCond, setLCond] = useState(q.is_conditional ?? false)
  // lGroups: array of condition-groups. Each group = AND conditions. Between groups = OR.
  const [lGroups, setLGroups] = useState<FormQuestionCondition[][]>(() => {
    const src = q.conditions && q.conditions.length > 0
      ? q.conditions
      : q.conditional_question_id
        ? [{ target_question_id: q.conditional_question_id, condition_type: (q.condition_type as ConditionType) ?? 'EQUALS', target_value: q.conditional_value ?? '', logical_operator: 'AND' as LogicalOperator, group_id: 0, sort_order: 0 }]
        : []
    if (src.length === 0) return [[{ target_question_id: 0, condition_type: 'EQUALS' as ConditionType, target_value: '', logical_operator: 'AND' as LogicalOperator, group_id: 0, sort_order: 0 }]]
    // Group by group_id
    const byGroup: Record<number, FormQuestionCondition[]> = {}
    src.forEach(c => { const g = c.group_id ?? 0; if (!byGroup[g]) byGroup[g] = []; byGroup[g].push(c) })
    return Object.values(byGroup)
  })
  const [err, setErr] = useState<string|null>(null)

  // Sync when edit opens
  useEffect(() => {
    if (!isEditing) return
    setLText(q.question_text); setLType(q.question_type)
    setLRequired(q.is_required ?? true); setLVisible(q.visible_to_csr !== false)
    setLNa(q.is_na_allowed ?? false)
    setLYes(q.yes_value ?? 1); setLNo(q.no_value ?? 0); setLNaVal(q.na_value ?? 0)
    setLScaleMin(q.scale_min ?? 1); setLScaleMax(q.scale_max ?? 5)
    setLRadio(q.radio_options ?? [])
    setLCond(q.is_conditional ?? false)
    const src = q.conditions && q.conditions.length > 0
      ? q.conditions
      : q.conditional_question_id
        ? [{ target_question_id: q.conditional_question_id, condition_type: (q.condition_type as ConditionType) ?? 'EQUALS', target_value: q.conditional_value ?? '', logical_operator: 'AND' as LogicalOperator, group_id: 0, sort_order: 0 }]
        : []
    if (src.length === 0) {
      setLGroups([[{ target_question_id: 0, condition_type: 'EQUALS', target_value: '', logical_operator: 'AND', group_id: 0, sort_order: 0 }]])
    } else {
      const byGroup: Record<number, FormQuestionCondition[]> = {}
      src.forEach(c => { const g = c.group_id ?? 0; if (!byGroup[g]) byGroup[g] = []; byGroup[g].push(c) })
      setLGroups(Object.values(byGroup))
    }
    setErr(null)
  }, [isEditing, q])

  const noPoints = lType === 'INFO_BLOCK' || lType === 'TEXT' || lType === 'SUB_CATEGORY'
  const hasOptions = lType === 'RADIO' || lType === 'MULTI_SELECT'

  const saveEdit = () => {
    if (!lText.trim()) { setErr('Question text is required'); return }
    if (hasOptions && lRadio.length === 0) { setErr('Add at least one option'); return }
    if (lType === 'SCALE' && lScaleMin >= lScaleMax) { setErr('Scale min must be less than max'); return }
    if (lCond && lGroups.some(g => g.some(c => !c.target_question_id))) { setErr('All conditions need a source question'); return }

    // Flatten groups → conditions array with correct group_id and sort_order
    const flatConditions: FormQuestionCondition[] = lGroups.flatMap((group, gIdx) =>
      group.map((c, ci) => ({ ...c, group_id: gIdx, sort_order: ci, logical_operator: 'AND' as LogicalOperator }))
    )
    const updated: FormQuestion = {
      ...q,
      question_text: lText.trim(), question_type: lType, weight: 0,
      is_required: lRequired, visible_to_csr: lVisible, is_na_allowed: lNa,
      ...(lType === 'YES_NO' && { yes_value: lYes, no_value: lNo, ...(lNa && { na_value: lNaVal }) }),
      ...(lType === 'SCALE' && { scale_min: lScaleMin, scale_max: lScaleMax }),
      ...(hasOptions && { radio_options: lRadio }),
      is_conditional: lCond,
      ...(lCond ? { conditions: flatConditions } : { conditions: [] }),
    }
    const cats = [...form.categories]
    const qs = [...cats[catIdx].questions]; qs[qi] = updated
    cats[catIdx] = { ...cats[catIdx], questions: qs }
    onChange({ ...form, categories: cats }); onCancelEdit()
  }

  const removeQ = () => {
    const cats = [...form.categories]
    cats[catIdx] = { ...cats[catIdx], questions: cats[catIdx].questions.filter((_, i) => i !== qi) }
    onChange({ ...form, categories: cats }); onCancelEdit()
  }

  const addOpt = () => {
    if (!newOptText || !newOptVal) { setErr('Option text and value are required'); return }
    setLRadio([...lRadio, { option_text: newOptText, option_value: newOptVal, score: newOptScore, has_free_text: newOptFree }])
    setNewOptText(''); setNewOptVal(''); setNewOptScore(0); setNewOptFree(false); setErr(null)
  }

  const quickToggleVisible = (e: React.MouseEvent) => {
    e.stopPropagation()
    const cats = [...form.categories]
    const qs = [...cats[catIdx].questions]
    qs[qi] = { ...qs[qi], visible_to_csr: q.visible_to_csr === false }
    cats[catIdx] = { ...cats[catIdx], questions: qs }
    onChange({ ...form, categories: cats })
  }

  const isVisible = q.visible_to_csr !== false
  const condCount = (q.conditions?.length ?? 0) || (q.is_conditional ? 1 : 0)
  const needsValue = (ct: ConditionType) => ct === 'EQUALS' || ct === 'NOT_EQUALS'

  // Point-value summary for badge display
  const pointSummary = () => {
    if (q.question_type === 'YES_NO') return `Y:${q.yes_value ?? 1} N:${q.no_value ?? 0}`
    if (q.question_type === 'SCALE') return `${q.scale_min ?? 1}–${q.scale_max ?? 5} pts`
    if (q.question_type === 'RADIO' || q.question_type === 'MULTI_SELECT') return `${q.radio_options?.length ?? 0} opts`
    return null
  }

  return (
    <div ref={setNodeRef} style={style}
      className={cn('rounded-lg border transition-all', isDragging ? 'shadow-lg' : '',
        isEditing ? 'border-[#00aeef] shadow-sm' : 'border-slate-200 bg-white')}>

      {/* ── Main row ───────────────────────────────────────────────────────── */}
      <div className={cn('flex items-start gap-2 px-3 py-2.5', isEditing ? 'bg-[#00aeef]/5 rounded-t-lg' : '')}>
        <button {...attributes} {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 text-slate-300 hover:text-slate-500 shrink-0 touch-none mt-0.5">
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <p className={cn('text-sm font-medium', isEditing ? 'text-[#00aeef]' : 'text-slate-900')}>
            {q.question_text}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">{q.question_type}</Badge>
            {pointSummary() && (
              <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-slate-600">{pointSummary()}</Badge>
            )}
            {q.is_na_allowed && <Badge variant="outline" className="text-[10px] h-4 px-1.5">N/A</Badge>}
            {condCount > 0 && (
              <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-[#00aeef] border-[#00aeef]/30">
                {condCount} condition{condCount > 1 ? 's' : ''}
              </Badge>
            )}
            <button onClick={quickToggleVisible} title="Click to toggle visibility"
              className={cn('inline-flex items-center h-4 px-1.5 rounded-sm border text-[10px] font-semibold transition-colors',
                isVisible ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                          : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200')}>
              {isVisible ? '● Visible' : '○ Hidden'}
            </button>
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <Button variant="ghost" size="icon" className={cn('h-7 w-7', isEditing ? 'text-[#00aeef]' : '')}
            onClick={() => isEditing ? undefined : onStartEdit(qi)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
            onClick={removeQ}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Inline edit panel ──────────────────────────────────────────────── */}
      {isEditing && (
        <div className="px-3 pb-3 pt-3 border-t border-[#00aeef]/20 bg-white rounded-b-lg space-y-4">
          {err && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-xs">{err}</div>}

          {/* Text */}
          <div className="space-y-1">
            <Label className="text-xs">Question Text <span className="text-red-500">*</span></Label>
            <Textarea value={lText} onChange={e => setLText(e.target.value)} rows={2} className="text-sm resize-none" autoFocus />
          </div>

          {/* Type */}
          <div className="space-y-1 max-w-xs">
            <Label className="text-xs">Question Type</Label>
            <Select value={lType} onValueChange={v => { setLType(v as QuestionType); setErr(null) }}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="YES_NO">Yes / No</SelectItem>
                <SelectItem value="SCALE">Scale</SelectItem>
                <SelectItem value="TEXT">Text Input</SelectItem>
                <SelectItem value="INFO_BLOCK">Information Block</SelectItem>
                <SelectItem value="RADIO">Radio (single select)</SelectItem>
                <SelectItem value="MULTI_SELECT">Multi-Select (checkboxes)</SelectItem>
                <SelectItem value="SUB_CATEGORY">Sub-Category</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* ── Point Values (replaces weight) ─────────────────────────────── */}
          {!noPoints && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-3">
              <p className="text-xs font-semibold text-slate-700">Point Values</p>

              {lType === 'YES_NO' && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Yes</Label>
                    <Input type="number" min={0} step={1} value={lYes} onChange={e => setLYes(Number(e.target.value))} className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">No</Label>
                    <Input type="number" min={0} step={1} value={lNo} onChange={e => setLNo(Number(e.target.value))} className="h-8 text-sm" />
                  </div>
                  {lNa && (
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">N/A</Label>
                      <Input type="number" min={0} step={1} value={lNaVal} onChange={e => setLNaVal(Number(e.target.value))} className="h-8 text-sm" />
                    </div>
                  )}
                </div>
              )}

              {lType === 'SCALE' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Min Value (points)</Label>
                    <Input type="number" value={lScaleMin} onChange={e => setLScaleMin(Number(e.target.value))} className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Max Value (points)</Label>
                    <Input type="number" value={lScaleMax} onChange={e => setLScaleMax(Number(e.target.value))} className="h-8 text-sm" />
                  </div>
                </div>
              )}

              {hasOptions && (
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-500">
                    {lType === 'MULTI_SELECT'
                      ? 'Each option has its own point value. Final score = sum of all checked options.'
                      : 'Each option has its own point value below.'}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Radio / Multi-Select Options ──────────────────────────────── */}
          {hasOptions && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
              <p className="text-xs font-semibold text-slate-700">
                {lType === 'MULTI_SELECT' ? 'Checkbox Options' : 'Radio Options'}
              </p>
              <div className="grid grid-cols-12 gap-2 items-center">
                <Input value={newOptText} onChange={e => setNewOptText(e.target.value)} placeholder="Label" className="h-7 text-xs col-span-4" />
                <Input value={newOptVal} onChange={e => setNewOptVal(e.target.value)} placeholder="Value" className="h-7 text-xs col-span-3" />
                <Input type="number" value={newOptScore} onChange={e => setNewOptScore(Number(e.target.value))} placeholder="Pts" className="h-7 text-xs col-span-2" step={1} />
                <div className="col-span-3 flex items-center gap-1">
                  <Button size="sm" onClick={addOpt} className="h-7 text-xs bg-[#00aeef] hover:bg-[#0095cc] text-white px-2 flex-1">Add</Button>
                  <label className="flex items-center gap-1 text-[10px] text-slate-500 cursor-pointer shrink-0">
                    <input type="checkbox" checked={newOptFree} onChange={e => setNewOptFree(e.target.checked)} className="h-3 w-3" />Free
                  </label>
                </div>
              </div>
              {lRadio.map((opt, i) => (
                <div key={i} className="flex items-center gap-2 bg-white border border-slate-200 rounded px-2 py-1.5 text-xs">
                  <span className="font-medium flex-1 truncate">{opt.option_text}</span>
                  <span className="text-slate-400">({opt.option_value})</span>
                  <span className="font-medium text-slate-700">{opt.score} pts</span>
                  {opt.has_free_text && <span className="text-[#00aeef]">+Free</span>}
                  <button onClick={() => setLRadio(lRadio.filter((_, idx) => idx !== i))} className="text-red-500 hover:text-red-700 ml-1 font-bold">×</button>
                </div>
              ))}
            </div>
          )}

          {/* ── N/A option ───────────────────────────────────────────────── */}
          {(lType === 'YES_NO' || lType === 'SCALE') && (
            <div className="flex items-center gap-1.5">
              <input type="checkbox" id={`na-${qi}`} checked={lNa} onChange={e => setLNa(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300" />
              <label htmlFor={`na-${qi}`} className="text-xs text-slate-700 cursor-pointer">Allow N/A answer</label>
            </div>
          )}

          {/* ── Conditional Logic ─────────────────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <input type="checkbox" id={`cond-${qi}`} checked={lCond} onChange={e => setLCond(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300" />
              <label htmlFor={`cond-${qi}`} className="text-xs font-medium text-slate-700 cursor-pointer">
                Conditional Logic — only show this question when conditions are met
              </label>
            </div>

            {lCond && (
              <div className="border border-slate-300 bg-slate-50 rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">Conditions</p>
                  <p className="text-[10px] text-slate-400">AND within groups · OR between groups</p>
                </div>

                {/* Groups */}
                {lGroups.map((group, gIdx) => (
                  <div key={gIdx}>
                    {/* OR separator */}
                    {gIdx > 0 && (
                      <div className="flex items-center gap-2 my-2">
                        <div className="flex-1 h-px bg-slate-300" />
                        <span className="text-[11px] font-bold text-slate-500 bg-slate-50 px-2 py-0.5 border border-slate-300 rounded-full">OR</span>
                        <div className="flex-1 h-px bg-slate-300" />
                      </div>
                    )}

                    {/* Group card */}
                    <div className="bg-white border border-[#00aeef]/40 rounded-lg p-2.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-[#00aeef] uppercase tracking-wide">
                          {lGroups.length > 1 ? `Group ${gIdx + 1} — ALL must match` : 'ALL must match'}
                        </span>
                        {lGroups.length > 1 && (
                          <button onClick={() => setLGroups(prev => prev.filter((_, i) => i !== gIdx))}
                            className="text-[10px] text-red-400 hover:text-red-600">Remove group</button>
                        )}
                      </div>

                      {group.map((cond, ci) => {
                        // Find selected question to determine value options
                        const selectedQ = allQuestions.find(q => q.id === cond.target_question_id)
                        const valueOptions: { label: string; value: string }[] = !selectedQ ? [] :
                          selectedQ.type === 'YES_NO' ? [
                            { label: 'Yes', value: 'YES' },
                            { label: 'No', value: 'NO' },
                            ...(selectedQ.naAllowed ? [{ label: 'N/A', value: 'N/A' }] : []),
                          ] :
                          selectedQ.type === 'SCALE' ? Array.from({ length: selectedQ.scaleMax - selectedQ.scaleMin + 1 }, (_, i) => {
                            const v = String(selectedQ.scaleMin + i)
                            return { label: v, value: v }
                          }) :
                          selectedQ.type === 'RADIO' ? selectedQ.radioOptions.map(o => ({ label: o.option_text, value: o.option_value })) :
                          []

                        const updateCond = (patch: Partial<FormQuestionCondition>) =>
                          setLGroups(prev => prev.map((g, gi) => gi !== gIdx ? g :
                            g.map((c, ci2) => ci2 !== ci ? c : { ...c, ...patch })))

                        return (
                          <div key={ci}>
                            {ci > 0 && (
                              <div className="flex items-center gap-2 my-1.5">
                                <div className="w-4 h-px bg-[#00aeef]/30" />
                                <span className="text-[10px] font-bold text-[#00aeef]">AND</span>
                                <div className="flex-1 h-px bg-[#00aeef]/30" />
                              </div>
                            )}
                            <div className="grid grid-cols-12 gap-1.5 items-center">
                              {/* Question selector */}
                              <div className="col-span-4">
                                <Select
                                  value={cond.target_question_id ? String(cond.target_question_id) : ''}
                                  onValueChange={v => updateCond({ target_question_id: v ? Number(v) : 0, target_value: '' })}>
                                  <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Question…" /></SelectTrigger>
                                  <SelectContent>
                                    {allQuestions.filter(q => ['YES_NO','SCALE','RADIO'].includes(q.type)).map(q => (
                                      <SelectItem key={q.id} value={String(q.id)} className="text-xs">
                                        {q.catName}: {q.text.substring(0,24)}{q.text.length>24?'…':''}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              {/* Condition type */}
                              <div className="col-span-3">
                                <Select value={cond.condition_type} onValueChange={v => updateCond({ condition_type: v as ConditionType })}>
                                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="EQUALS">Equals</SelectItem>
                                    <SelectItem value="NOT_EQUALS">Not Equals</SelectItem>
                                    <SelectItem value="EXISTS">Has any answer</SelectItem>
                                    <SelectItem value="NOT_EXISTS">Has no answer</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>

                              {/* Value — smart dropdown or placeholder */}
                              <div className="col-span-4">
                                {needsValue(cond.condition_type) ? (
                                  valueOptions.length > 0 ? (
                                    <Select value={cond.target_value ?? ''} onValueChange={v => updateCond({ target_value: v })}>
                                      <SelectTrigger className="h-7 text-xs">
                                        <SelectValue placeholder="Select value…" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {valueOptions.map(opt => (
                                          <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  ) : (
                                    <div className="h-7 flex items-center">
                                      <span className="text-[10px] text-slate-400 italic pl-1">
                                        {cond.target_question_id ? 'No options available' : '← Select a question first'}
                                      </span>
                                    </div>
                                  )
                                ) : (
                                  <div className="h-7 flex items-center">
                                    <span className="text-[10px] text-slate-400 italic pl-1">no value needed</span>
                                  </div>
                                )}
                              </div>

                              {/* Remove row */}
                              <div className="col-span-1 flex justify-center">
                                {group.length > 1 && (
                                  <button
                                    onClick={() => setLGroups(prev => prev.map((g, gi) => gi !== gIdx ? g : g.filter((_, ci2) => ci2 !== ci)))}
                                    className="text-red-400 hover:text-red-600 font-bold leading-none text-base">×</button>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}

                      <Button variant="ghost" size="sm" className="h-6 text-[11px] text-[#00aeef] hover:text-[#0095cc] px-0"
                        onClick={() => setLGroups(prev => prev.map((g, gi) => gi !== gIdx ? g :
                          [...g, { target_question_id: 0, condition_type: 'EQUALS', target_value: '', logical_operator: 'AND', group_id: gIdx, sort_order: g.length }]))}>
                        <Plus className="h-2.5 w-2.5 mr-0.5" /> Add AND condition
                      </Button>
                    </div>
                  </div>
                ))}

                {/* Add OR group */}
                <Button variant="ghost" size="sm" className="h-7 text-xs w-full border border-dashed border-slate-300 text-slate-500 hover:border-[#00aeef] hover:text-[#00aeef] rounded-lg"
                  onClick={() => setLGroups(prev => [...prev, [{ target_question_id: 0, condition_type: 'EQUALS', target_value: '', logical_operator: 'AND', group_id: prev.length, sort_order: 0 }]])}>
                  <Plus className="h-3 w-3 mr-1" /> Add OR Group
                </Button>
              </div>
            )}
          </div>

          {/* ── Required + Visible toggles ─────────────────────────────────── */}
          <div className="flex flex-wrap gap-5 pt-1 border-t border-slate-100">
            <div className="flex items-center gap-2">
              <Switch checked={lRequired} onCheckedChange={setLRequired} />
              <Label className="text-xs cursor-pointer">Required</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={lVisible} onCheckedChange={setLVisible} />
              <Label className="text-xs cursor-pointer">Visible to User</Label>
            </div>
          </div>

          {/* Save / Cancel */}
          <div className="flex gap-2">
            <Button size="sm" className="bg-[#00aeef] hover:bg-[#0095cc] text-white h-8 px-4"
              onClick={saveEdit} disabled={!lText.trim()}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Save
            </Button>
            <Button variant="outline" size="sm" className="h-8 px-4" onClick={onCancelEdit}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Step 3: Questions ─────────────────────────────────────────────────────────
function QuestionsStep({ form, onChange }: { form: Form; onChange: (f: Form) => void }) {
  const [activeCatIdx, setActiveCatIdx] = useState(0)
  const [newQText, setNewQText] = useState('')
  const [newQType, setNewQType] = useState<QuestionType>('YES_NO')
  const [editQIdx, setEditQIdx] = useState<number | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const cat = form.categories[activeCatIdx]
  const allQuestions = form.categories.flatMap((c, ci) =>
    c.questions.map((q, qi) => ({
      id: q.id || -(ci * 1000 + qi + 1),
      text: q.question_text,
      type: q.question_type,
      catName: c.category_name,
      scaleMin: q.scale_min ?? 1,
      scaleMax: q.scale_max ?? 5,
      naAllowed: q.is_na_allowed ?? false,
      radioOptions: q.radio_options ?? [],
    }))
  )
  const qIds = (cat?.questions || []).map((_, qi) => `q-${qi}`)

  const addQuestion = (andConfigure = false) => {
    if (!newQText.trim() || !cat) return
    const newQ: FormQuestion = {
      question_text: newQText.trim(), question_type: newQType,
      weight: 0, is_required: true, visible_to_csr: true,
    }
    const cats = [...form.categories]
    const newIdx = (cats[activeCatIdx].questions || []).length
    cats[activeCatIdx] = { ...cats[activeCatIdx], questions: [...(cats[activeCatIdx].questions || []), newQ] }
    onChange({ ...form, categories: cats })
    setNewQText('')
    if (andConfigure) setEditQIdx(newIdx)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id || !cat) return
    const from = parseInt(String(active.id).replace('q-', ''))
    const to   = parseInt(String(over.id).replace('q-', ''))
    const cats = [...form.categories]
    cats[activeCatIdx] = { ...cats[activeCatIdx], questions: arrayMove(cat.questions, from, to) }
    onChange({ ...form, categories: cats })
    if (editQIdx === from) setEditQIdx(to)
    else if (editQIdx === to) setEditQIdx(from)
  }

  const switchCategory = (i: number) => { setActiveCatIdx(i); setEditQIdx(null); setNewQText('') }

  return (
    <div className="flex gap-6 max-w-5xl">
      {/* Category sidebar */}
      <div className="w-52 shrink-0 space-y-1">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Categories</p>
        {form.categories.map((c, i) => (
          <button key={i} onClick={() => switchCategory(i)}
            className={cn('w-full text-left px-3 py-2 rounded-lg text-sm transition-colors',
              i === activeCatIdx ? 'bg-[#00aeef]/10 text-[#00aeef] font-semibold' : 'text-slate-600 hover:bg-slate-100')}>
            <div className="truncate">{c.category_name}</div>
            <div className="text-xs text-slate-400">{c.questions?.length ?? 0} questions</div>
          </button>
        ))}
      </div>

      {/* Question panel */}
      <div className="flex-1 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">{cat?.category_name}</h3>
        </div>

        {cat ? (
          <>
            {/* Quick-add bar */}
            <div className="flex gap-2 items-end bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div className="flex-1 space-y-1">
                <Label className="text-xs text-slate-600">Question Text</Label>
                <Input value={newQText} onChange={e => setNewQText(e.target.value)}
                  placeholder="Type a question and click Add…" className="h-8 text-sm"
                  onKeyDown={e => e.key === 'Enter' && addQuestion()} />
              </div>
              <div className="w-36 space-y-1">
                <Label className="text-xs text-slate-600">Type</Label>
                <Select value={newQType} onValueChange={v => setNewQType(v as QuestionType)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="YES_NO">Yes / No</SelectItem>
                    <SelectItem value="SCALE">Scale</SelectItem>
                    <SelectItem value="TEXT">Text</SelectItem>
                    <SelectItem value="INFO_BLOCK">Info Block</SelectItem>
                    <SelectItem value="RADIO">Radio</SelectItem>
                    <SelectItem value="MULTI_SELECT">Multi-Select</SelectItem>
                    <SelectItem value="SUB_CATEGORY">Sub-Category</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" onClick={() => addQuestion(false)} disabled={!newQText.trim()}
                className="bg-[#00aeef] hover:bg-[#0095cc] text-white h-8">
                <Plus className="h-3.5 w-3.5 mr-1" /> Add
              </Button>
              <Button size="sm" variant="outline" onClick={() => addQuestion(true)} disabled={!newQText.trim()}
                className="h-8 text-xs border-[#00aeef] text-[#00aeef] hover:bg-[#00aeef]/10 whitespace-nowrap">
                Add & Configure
              </Button>
            </div>

            {/* Question list with drag-and-drop */}
            {cat.questions?.length ? (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={qIds} strategy={verticalListSortingStrategy}>
                  <div className="space-y-1.5">
                    {cat.questions.map((q, qi) => (
                      <SortableQuestionRow
                        key={`q-${qi}`}
                        q={q} qi={qi} catIdx={activeCatIdx}
                        form={form} onChange={onChange}
                        allQuestions={allQuestions}
                        isEditing={editQIdx === qi}
                        onStartEdit={setEditQIdx}
                        onCancelEdit={() => setEditQIdx(null)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              <div className="border-2 border-dashed border-slate-200 rounded-lg py-8 text-center text-slate-400 text-sm">
                No questions yet. Type above and click Add.
              </div>
            )}
          </>
        ) : (
          <div className="border-2 border-dashed border-slate-200 rounded-lg py-8 text-center text-slate-400 text-sm">
            No categories — add categories first.
          </div>
        )}
      </div>
    </div>
  )
}

// ── Step 4: Live Interactive Preview ─────────────────────────────────────────
interface PreviewAnswer { question_id: number; answer: string; score: number; notes: string }

function PreviewStep({ form }: { form: Form }) {
  const total = totalCategoryWeight(form.categories)
  const weightOk = Math.abs(total - 1) < 0.005

  // Ensure every question has a temp ID for preview logic
  const previewForm = useMemo(() => {
    const f = JSON.parse(JSON.stringify(form)) as Form
    f.categories.forEach((cat, ci) => {
      if (!cat.id) (cat as any).id = -(ci + 1) * 1000
      cat.questions.forEach((q, qi) => {
        if (!q.id) (q as any).id = -((ci + 1) * 1000 + qi + 1)
      })
    })
    return f
  }, [form])

  const [answers, setAnswers]               = useState<Record<number, PreviewAnswer>>({})
  const [visibilityMap, setVisibilityMap]   = useState<Record<number, boolean>>({})
  const [formRenderData, setFormRenderData] = useState<FormRenderData | null>(null)
  const [metadataValues, setMetadataValues] = useState<Record<string, string>>({})

  // Initialise on mount
  useEffect(() => {
    const strings: Record<number, string> = {}
    const vis = processConditionalLogic(previewForm, strings)
    const { totalScore, categoryScores } = calculateFormScore(previewForm, {})
    setVisibilityMap(vis)
    setFormRenderData(prepareFormForRender(previewForm, {}, vis, categoryScores, totalScore))
  }, [previewForm])

  // Recompute whenever answers change
  useEffect(() => {
    if (!Object.keys(answers).length && !formRenderData) return
    const strings: Record<number, string> = {}
    Object.entries(answers).forEach(([id, a]) => { strings[Number(id)] = a.answer || '' })
    const vis = processConditionalLogic(previewForm, strings)
    const { totalScore, categoryScores } = calculateFormScore(previewForm, answers)
    setVisibilityMap(vis)
    setFormRenderData(prepareFormForRender(previewForm, answers, vis, categoryScores, totalScore))
  }, [answers, previewForm]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAnswerChange = useCallback((questionId: number, value: string, _type: string) => {
    const question = previewForm.categories.flatMap(c => c.questions).find(q => q.id === questionId)
    const score = question ? getQuestionScore(question, value) : 0
    setAnswers(prev => ({ ...prev, [questionId]: { question_id: questionId, answer: value, score, notes: prev[questionId]?.notes || '' } }))
  }, [previewForm])

  const handleNotesChange = useCallback((questionId: number, notes: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: { ...prev[questionId], notes, question_id: questionId, answer: prev[questionId]?.answer || '', score: prev[questionId]?.score || 0 } }))
  }, [])

  const totalScore = formRenderData?.totalScore ?? 0
  const scoreClass = totalScore >= 85 ? 'text-emerald-600' : totalScore >= 70 ? 'text-amber-600' : 'text-red-600'
  const scoreBgClass = totalScore >= 85 ? 'bg-emerald-500' : totalScore >= 70 ? 'bg-amber-500' : 'bg-red-500'

  return (
    <div className="space-y-4">
      {!weightOk && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2 text-amber-700 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Category weights sum to {(total * 100).toFixed(0)}% — must be exactly 100% before saving.
        </div>
      )}

      {/* Form header */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{form.form_name}</h2>
          <p className="text-xs text-slate-500 mt-0.5">v{form.version ?? 1} · {form.interaction_type} · {form.is_active ? 'Active' : 'Inactive'}</p>
        </div>
        <div className="text-center">
          <div className={cn('text-3xl font-bold', scoreClass)}>{totalScore.toFixed(1)}%</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Live Score</div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* LEFT — Interactive form */}
        <div className="space-y-5">
          {/* Metadata fields */}
          {form.metadata_fields && form.metadata_fields.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Form Details</h3>
              <FormMetadataDisplay
                metadataFields={form.metadata_fields}
                values={Object.fromEntries(form.metadata_fields.map(f => {
                  const key = (f.id && f.id !== 0) ? f.id.toString() : f.field_name
                  return [key, metadataValues[key] || '']
                }))}
                onChange={(fieldId, value) => setMetadataValues(prev => ({ ...prev, [fieldId]: value }))}
                readonly={false}
                currentUser={{ id: 1, username: 'Preview User' }}
              />
            </div>
          )}

          {/* Form questions */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Form Questions</h3>
            {formRenderData ? (
              <FormRenderer
                formRenderData={formRenderData}
                isDisabled={false}
                onAnswerChange={handleAnswerChange}
                onNotesChange={handleNotesChange}
              />
            ) : (
              <div className="py-8 text-center text-slate-400 text-sm">Loading preview…</div>
            )}
          </div>
        </div>

        {/* RIGHT — Scoring details */}
        <div className="space-y-5">
          {/* Overall score card */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Overall Form Score</h3>
            <div className={cn('text-4xl font-bold text-center py-3', scoreClass)}>{totalScore.toFixed(2)}%</div>
            <div className="w-full bg-slate-100 rounded-full h-2.5 mt-2">
              <div className={cn('h-2.5 rounded-full transition-all', scoreBgClass)} style={{ width: `${Math.min(100, totalScore)}%` }} />
            </div>
          </div>

          {/* Question scores table */}
          {formRenderData?.categories && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Question Scores</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-3 py-2 text-left font-medium text-slate-600">Question</th>
                      <th className="px-2 py-2 text-center font-medium text-slate-600">Answer</th>
                      <th className="px-2 py-2 text-center font-medium text-slate-600">Score</th>
                      <th className="px-2 py-2 text-center font-medium text-slate-600">Possible</th>
                      <th className="px-2 py-2 text-center font-medium text-slate-600">Wtd Score</th>
                      <th className="px-2 py-2 text-center font-medium text-slate-600">Wtd Possible</th>
                      <th className="px-2 py-2 text-center font-medium text-slate-600">Visible</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(formRenderData.categories as CategoryRenderData[]).map((cat, ci) => {
                      const scoringQs = (cat.allQuestions || []).filter((q: any) => {
                        const t = (q.type || q.question_type || '').toLowerCase()
                        return !['text', 'sub_category', 'info_block'].includes(t)
                      })
                      if (!scoringQs.length) return null
                      return (
                        <React.Fragment key={`cat-${ci}`}>
                          <tr className="bg-slate-50 border-b border-slate-200">
                            <td colSpan={7} className="px-3 py-2 font-semibold text-slate-700">
                              <div className="flex justify-between">
                                <span>{cat.name}</span>
                                <span className="font-normal text-slate-500">Weight: {(cat.weight * 100).toFixed(0)}%</span>
                              </div>
                            </td>
                          </tr>
                          {scoringQs.map((q: any, qi: number) => {
                            const ans   = answers[q.id]
                            const vis   = visibilityMap[q.id] !== false
                            const qScore = Number(ans?.score) || 0
                            let maxScore = 0
                            if (vis) {
                              const orig = previewForm.categories.flatMap(c => c.questions).find(x => x.id === q.id)
                              if (orig) {
                                const isNA = ans?.answer?.toLowerCase() === 'na' || ans?.answer?.toLowerCase() === 'n/a'
                                maxScore = (isNA && (orig as any).is_na_allowed) ? 0 : getMaxPossibleScore(orig)
                              }
                            }
                            const catW = Number(cat.weight) || 0
                            return (
                              <tr key={`q-${ci}-${qi}`} className="border-b border-slate-100 hover:bg-slate-50/50">
                                <td className="px-3 py-2 text-slate-600 pl-6 max-w-[200px] truncate" title={q.text}>{q.text}</td>
                                <td className="px-2 py-2 text-center text-slate-600">{vis && ans?.answer ? ans.answer : '—'}</td>
                                <td className="px-2 py-2 text-center text-slate-600">{vis ? qScore : 0}</td>
                                <td className="px-2 py-2 text-center text-slate-600">{maxScore}</td>
                                <td className="px-2 py-2 text-center text-slate-600">{vis ? (qScore * catW).toFixed(2) : '0.00'}</td>
                                <td className="px-2 py-2 text-center text-slate-600">{(maxScore * catW).toFixed(2)}</td>
                                <td className="px-2 py-2 text-center">
                                  <span className={vis ? 'text-emerald-600 font-medium' : 'text-red-500'}>{vis ? 'Yes' : 'No'}</span>
                                </td>
                              </tr>
                            )
                          })}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Category scores table */}
          {formRenderData?.categories && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Category Scores</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-3 py-2 text-left font-medium text-slate-600">Category</th>
                      <th className="px-2 py-2 text-center font-medium text-slate-600">Earned</th>
                      <th className="px-2 py-2 text-center font-medium text-slate-600">Possible</th>
                      <th className="px-2 py-2 text-center font-medium text-slate-600">Cat%</th>
                      <th className="px-2 py-2 text-center font-medium text-slate-600">Weight</th>
                      <th className="px-2 py-2 text-center font-medium text-slate-600">Wtd Score</th>
                      <th className="px-2 py-2 text-center font-medium text-slate-600">Wtd Possible</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      let totalWtdNum = 0; let totalWtdDen = 0
                      const rows = (formRenderData.categories as CategoryRenderData[]).map((cat, ci) => {
                        const cs = formRenderData.categoryScores?.[cat.id]
                        const earned   = Number(cs?.earnedPoints)   || 0
                        const possible = Number(cs?.possiblePoints) || 0
                        const catPct   = possible > 0 ? (earned / possible) * 100 : 0
                        const w        = Number(cat.weight) || 0
                        const wNum     = earned * w; const wDen = possible * w
                        if (possible > 0) { totalWtdNum += wNum; totalWtdDen += wDen }
                        return (
                          <tr key={ci} className="border-b border-slate-100">
                            <td className="px-3 py-2 text-slate-700 font-medium">{cat.name}</td>
                            <td className="px-2 py-2 text-center text-slate-600">{earned}</td>
                            <td className="px-2 py-2 text-center text-slate-600">{possible}</td>
                            <td className="px-2 py-2 text-center text-slate-600">{catPct.toFixed(0)}%</td>
                            <td className="px-2 py-2 text-center text-slate-600">{(w * 100).toFixed(0)}%</td>
                            <td className="px-2 py-2 text-center text-slate-600">{wNum.toFixed(2)}</td>
                            <td className="px-2 py-2 text-center text-slate-600">{wDen.toFixed(2)}</td>
                          </tr>
                        )
                      })
                      const finalScore = totalWtdDen > 0 ? (totalWtdNum / totalWtdDen) * 100 : 0
                      return [
                        ...rows,
                        <tr key="totals" className="bg-slate-50 border-t-2 border-slate-300 font-semibold">
                          <td className="px-3 py-2 text-slate-800">TOTALS</td>
                          <td colSpan={4} />
                          <td className="px-2 py-2 text-center text-slate-800">{totalWtdNum.toFixed(2)}</td>
                          <td className="px-2 py-2 text-center text-slate-800">{totalWtdDen.toFixed(2)}</td>
                        </tr>,
                        <tr key="final" className="bg-[#00aeef]/10">
                          <td colSpan={6} className="px-3 py-2 text-right text-slate-700 font-semibold text-sm">Final Score</td>
                          <td className={cn('px-2 py-2 text-center font-bold text-sm', scoreColor(finalScore))}>{finalScore.toFixed(2)}%</td>
                        </tr>,
                      ]
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* How scoring works */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-2">How Scoring Works</h3>
            <ul className="text-xs text-slate-600 space-y-1.5">
              <li>• <strong>N/A answers</strong> and hidden conditional questions are excluded from scoring.</li>
              <li>• <strong>Weighted Score</strong> = question score × category weight.</li>
              <li>• <strong>Final Score</strong> = total weighted earned ÷ total weighted possible × 100.</li>
              <li>• Text, Info Block, and Sub-Category questions are not scored.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

// Main page ─────────────────────────────────────────────────────────────────
export default function FormsPage() {
  const { user } = useAuth()
  const { toast } = useToast()

  const [view, setView] = useState<'list' | 'builder'>('list')
  const [step, setStep] = useState<Step>('metadata')
  const [form, setForm] = useState<Form>(freshForm())
  const [saving, setSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  if (user && user.role_id !== 1 && user.role_id !== 2) {
    return (
      <div className="p-6">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-amber-700">You don't have permission to access Form Builder.</div>
      </div>
    )
  }

  const handleChange = (updated: Form) => { setForm(updated); setHasChanges(true) }

  const openEdit = async (formId: number) => {
    try {
      const data = await getFormById(formId, true)
      setForm(data); setStep('metadata'); setView('builder'); setHasChanges(false)
    } catch { toast({ title: 'Error', description: 'Failed to load form.', variant: 'destructive' }) }
  }

  const openPreview = async (formId: number) => {
    try {
      const data = await getFormById(formId, true)
      setForm(data); setStep('preview'); setView('builder'); setHasChanges(false)
    } catch { toast({ title: 'Error', description: 'Failed to load form.', variant: 'destructive' }) }
  }

  const openDuplicate = async (formId: number) => {
    try {
      const data = await getFormById(formId)
      const copy: Form = {
        ...data, id: undefined, form_name: `${data.form_name} (Copy)`, version: 1,
        categories: data.categories.map(c => ({
          ...c, id: undefined, form_id: undefined,
          questions: c.questions.map(q => ({ ...q, id: undefined, category_id: undefined })),
        })),
        metadata_fields: data.metadata_fields?.map(f => ({ ...f, id: undefined, form_id: undefined })) || [],
      }
      setForm(copy); setStep('metadata'); setView('builder'); setHasChanges(true)
    } catch { toast({ title: 'Error', description: 'Failed to duplicate form.', variant: 'destructive' }) }
  }

  const validateStep = (): { ok: boolean; message?: string } => {
    if (step === 'metadata' && !form.form_name.trim()) return { ok: false, message: 'Form name is required.' }
    if (step === 'categories') {
      if (form.categories.length === 0) return { ok: false, message: 'Add at least one category.' }
      const total = totalCategoryWeight(form.categories)
      if (Math.abs(total - 1) > 0.005) return { ok: false, message: `Weights sum to ${(total * 100).toFixed(0)}% — must be 100%.` }
    }
    if (step === 'questions' && !form.categories.some(c => c.questions?.length > 0)) {
      return { ok: false, message: 'Add at least one question.' }
    }
    return { ok: true }
  }

  const nextStep = () => {
    const v = validateStep()
    if (!v.ok) { toast({ title: 'Validation error', description: v.message, variant: 'destructive' }); return }
    const idx = STEPS.indexOf(step)
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1])
  }

  const prevStep = () => {
    const idx = STEPS.indexOf(step)
    if (idx > 0) setStep(STEPS[idx - 1]); else setView('list')
  }

  const saveForm = async () => {
    if (Math.abs(totalCategoryWeight(form.categories) - 1) > 0.005) {
      toast({ title: 'Weight error', description: 'Category weights must sum to 100%.', variant: 'destructive' }); return
    }
    setSaving(true)
    try {
      const payload: Form = {
        ...form,
        metadata_fields: (form.metadata_fields || []).map((f, i) => ({ ...f, sort_order: i })),
      }
      if (form.id) {
        await updateForm(form.id, payload)
        toast({ title: 'Form updated', description: `"${form.form_name}" saved as new version.` })
      } else {
        await createForm(payload)
        toast({ title: 'Form created', description: `"${form.form_name}" is now live.` })
      }
      setHasChanges(false)
      setTimeout(() => { setView('list') }, 1500)
    } catch (e: any) {
      toast({ title: 'Save failed', description: e.message || 'Please try again.', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  if (view === 'list') {
    return <FormBuilderList onEdit={openEdit} onCreate={() => { setForm(freshForm()); setStep('metadata'); setHasChanges(false); setView('builder') }} onPreview={openPreview} onDuplicate={openDuplicate} />
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{form.id ? `Edit Form: ${form.form_name}` : 'Create New Form'}</h1>
          {hasChanges && <p className="text-xs text-amber-600 mt-0.5">* Unsaved changes</p>}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setView('list')}>Cancel</Button>
      </div>

      <StepBar current={step} />

      <div className="min-h-[300px]">
        {step === 'metadata'   && <MetadataStep   form={form} onChange={handleChange} />}
        {step === 'categories' && <CategoriesStep form={form} onChange={handleChange} />}
        {step === 'questions'  && <QuestionsStep  form={form} onChange={handleChange} />}
        {step === 'preview'    && <PreviewStep    form={form} />}
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-slate-200">
        <Button variant="outline" onClick={prevStep}>
          <ChevronLeft className="h-4 w-4 mr-1" />{step === 'metadata' ? 'Cancel' : 'Back'}
        </Button>
        {step !== 'preview' ? (
          <Button onClick={nextStep} className="bg-primary hover:bg-primary/90 text-white">
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button onClick={saveForm} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {saving ? 'Saving…' : form.id ? 'Save as New Version' : 'Create Form'}
          </Button>
        )}
      </div>
    </div>
  )
}

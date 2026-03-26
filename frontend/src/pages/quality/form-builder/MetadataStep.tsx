import { useState } from 'react'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import type { Form, FormMetadataField, MetadataFieldType } from '@/types/form.types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

// ── Sortable metadata field row ───────────────────────────────────────────────
function SortableMetadataField({ field, idx, onUpdate, onRemove }: {
  field: FormMetadataField; idx: number
  onUpdate: (idx: number, patch: Partial<FormMetadataField>) => void
  onRemove: (idx: number) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `field-${idx}` })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  const [newOption, setNewOption] = useState('')
  const existingOptions = field.dropdown_source
    ? field.dropdown_source.split(',').map(s => s.trim()).filter(Boolean)
    : []

  const addOption = () => {
    const trimmed = newOption.trim()
    if (!trimmed || existingOptions.includes(trimmed)) return
    onUpdate(idx, { dropdown_source: [...existingOptions, trimmed].join(', ') })
    setNewOption('')
  }

  const removeOption = (opt: string) =>
    onUpdate(idx, { dropdown_source: existingOptions.filter(o => o !== opt).join(', ') })

  return (
    <div ref={setNodeRef} style={style}
      className={cn('rounded border', isDragging ? 'shadow-lg z-50' : '',
        field.field_type === 'SPACER' ? 'bg-slate-100 border-slate-200' : 'bg-white border-slate-200')}>
      <div className="grid grid-cols-10 gap-2 items-center p-2">
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
          <Select value={field.field_type}
            onValueChange={v => onUpdate(idx, { field_type: v as MetadataFieldType, dropdown_source: v !== 'DROPDOWN' ? undefined : field.dropdown_source })}>
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

      {field.field_type === 'DROPDOWN' && (
        <div className="px-3 pb-3 pt-0 space-y-2 border-t border-slate-100">
          <p className="text-[11px] font-medium text-slate-500 pt-2">Dropdown Options</p>
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
          <div className="flex gap-2 items-center">
            <Input value={newOption} onChange={e => setNewOption(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addOption()}
              placeholder="Type an option and press Enter or Add…"
              className="h-7 text-xs flex-1" />
            <Button size="sm" onClick={addOption} disabled={!newOption.trim()}
              className="h-7 px-2 text-xs bg-primary hover:bg-primary/90 text-white">
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
export function MetadataStep({ form, onChange }: { form: Form; onChange: (f: Form) => void }) {
  const fields = form.metadata_fields || []
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const updateField = (idx: number, patch: Partial<FormMetadataField>) =>
    onChange({ ...form, metadata_fields: fields.map((f, i) => i === idx ? { ...f, ...patch } : f) })

  const addField = () =>
    onChange({ ...form, metadata_fields: [...fields, {
      field_name: '', field_type: 'TEXT' as MetadataFieldType,
      is_required: true, interaction_type: form.interaction_type || 'CALL', sort_order: fields.length,
    }] })

  const removeField = (idx: number) => {
    if (idx < 4) return
    onChange({ ...form, metadata_fields: fields.filter((_, i) => i !== idx) })
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const fromAbs = parseInt(String(active.id).replace('field-', ''))
    const toAbs   = parseInt(String(over.id).replace('field-', ''))
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

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-4">
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

        <div className="relative border-t-2 border-slate-300 pt-4 mt-6">
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-slate-50 px-3 text-xs font-medium text-slate-600">Optional Fields</span>
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={addField} className="bg-primary hover:bg-primary/90 text-white h-8">
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
                  field={field} idx={relIdx + 4}
                  onUpdate={updateField} onRemove={removeField}
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

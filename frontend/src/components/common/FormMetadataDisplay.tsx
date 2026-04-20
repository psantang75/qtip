import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { FormMetadataField } from '@/types/form.types'
import { isAgentMetadataField, displayFieldName } from '@/utils/formMetadataOrder'

interface FormMetadataDisplayProps {
  metadataFields: FormMetadataField[]
  values: Record<string, string>
  onChange?: (fieldId: string, value: string) => void
  readonly?: boolean
  currentUser?: { id: number; username: string }
  /** Users to populate DROPDOWN fields that have no dropdown_source (e.g. Agent picker) */
  userOptions?: { id: number; username: string }[]
}

/**
 * Renders form metadata fields (TEXT, DROPDOWN, DATE, AUTO, SPACER) for both
 * the form builder preview step and the live audit form.
 */
export default function FormMetadataDisplay({
  metadataFields,
  values,
  onChange,
  readonly = false,
  currentUser,
  userOptions = [],
}: FormMetadataDisplayProps) {
  const getKey = (field: FormMetadataField) =>
    field.id && field.id !== 0 ? field.id.toString() : field.field_name

  const handleChange = (field: FormMetadataField, value: string) => {
    if (!onChange || readonly) return
    onChange(getKey(field), value)
  }

  const sorted = [...metadataFields].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {sorted.map((field, idx) => {
        const key  = getKey(field)
        const val  = values[key] ?? ''

        if (field.field_type === 'SPACER') {
          return <div key={idx} className="h-0 overflow-hidden" aria-hidden />
        }

        return (
          <div key={idx} className="space-y-1">
            <label className="block text-[12px] font-medium text-slate-600">
              {displayFieldName(field.field_name)}
              {field.is_required && <span className="text-red-500 ml-0.5">*</span>}
            </label>

            {field.field_type === 'AUTO' && (
              <p className="text-[13px] text-slate-500 h-9 flex items-center">
                {(() => {
                  const v = val.trim()
                  if (v) return v
                  const n = field.field_name.toLowerCase()
                  if (n.includes('reviewer') || n.includes('auditor') || n.includes('agent') || (n.includes('user') && n.includes('name')))
                    return currentUser?.username ?? '—'
                  if (n.includes('date')) return new Date().toISOString().slice(0, 10)
                  return currentUser?.username ?? '—'
                })()}
              </p>
            )}

            {field.field_type === 'TEXT' && (
              <Input
                value={val}
                readOnly={readonly}
                onChange={e => handleChange(field, e.target.value)}
                placeholder={displayFieldName(field.field_name)}
                className="h-9 text-[13px]"
              />
            )}

            {field.field_type === 'DATE' && (
              <Input
                type="date"
                value={val}
                readOnly={readonly}
                onChange={e => handleChange(field, e.target.value)}
                className="h-9 text-[13px]"
              />
            )}

            {field.field_type === 'DROPDOWN' && (
              (() => {
                const staticOpts = (field.dropdown_source ?? '').split(',').map(o => o.trim()).filter(Boolean)
                const agentField = isAgentMetadataField(field)
                const showUsers = userOptions.length > 0 && (agentField || staticOpts.length === 0)

                if (readonly) {
                  const displayVal = showUsers
                    ? (userOptions.find(u => String(u.id) === val)?.username ?? val)
                    : val
                  return <p className="text-[13px] text-slate-700 h-9 flex items-center">{displayVal || '—'}</p>
                }

                return (
                  <Select value={val ? val : undefined} onValueChange={v => handleChange(field, v)}>
                    <SelectTrigger className="h-9 text-[13px]">
                      <SelectValue placeholder={`Select ${displayFieldName(field.field_name)}…`} />
                    </SelectTrigger>
                    <SelectContent>
                      {showUsers
                        ? userOptions.map(u => (
                            <SelectItem key={u.id} value={String(u.id)}>{u.username}</SelectItem>
                          ))
                        : staticOpts.map(opt => (
                            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                          ))
                      }
                    </SelectContent>
                  </Select>
                )
              })()
            )}
          </div>
        )
      })}
    </div>
  )
}

import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { FormMetadataField } from '@/types/form.types'

interface FormMetadataDisplayProps {
  metadataFields: FormMetadataField[]
  values: Record<string, string>
  onChange?: (fieldId: string, value: string) => void
  readonly?: boolean
  currentUser?: { id: number; username: string }
  /** Users to populate DROPDOWN fields that have no dropdown_source (e.g. CSR picker) */
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
          return <div key={idx} className="col-span-full h-2" />
        }

        return (
          <div key={idx} className="space-y-1">
            <label className="block text-[12px] font-medium text-slate-600">
              {field.field_name}
              {field.is_required && <span className="text-red-500 ml-0.5">*</span>}
            </label>

            {field.field_type === 'AUTO' && (
              <p className="text-[13px] text-slate-500 h-9 flex items-center">
                {field.field_name.toLowerCase().includes('agent') || field.field_name.toLowerCase().includes('user')
                  ? currentUser?.username ?? '—'
                  : new Date().toLocaleDateString()}
              </p>
            )}

            {field.field_type === 'TEXT' && (
              <Input
                value={val}
                readOnly={readonly}
                onChange={e => handleChange(field, e.target.value)}
                placeholder={field.field_name}
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
                const showUsers  = staticOpts.length === 0 && userOptions.length > 0

                if (readonly) {
                  // Resolve display label: for user dropdowns the stored value is the user ID
                  const displayVal = showUsers
                    ? (userOptions.find(u => String(u.id) === val)?.username ?? val)
                    : val
                  return <p className="text-[13px] text-slate-700 h-9 flex items-center">{displayVal || '—'}</p>
                }

                return (
                  <Select value={val} onValueChange={v => handleChange(field, v)}>
                    <SelectTrigger className="h-9 text-[13px]">
                      <SelectValue placeholder={`Select ${field.field_name}…`} />
                    </SelectTrigger>
                    <SelectContent>
                      {showUsers
                        ? userOptions.map(u => (
                            // Store the user ID as the value, display the username
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

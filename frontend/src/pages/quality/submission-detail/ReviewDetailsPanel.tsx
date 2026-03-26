interface ReviewField {
  field_name: string
  field_type: string
  value:      string
}

interface Props {
  topFields:       ReviewField[]
  bottomFields:    ReviewField[]
  hasBottomFields: boolean
  csrName?:        string | null
  isCSR:           boolean
  username?:       string
}

export function ReviewDetailsPanel({
  topFields, bottomFields, hasBottomFields, csrName, isCSR, username,
}: Props) {
  if (topFields.length === 0 && !hasBottomFields) return null

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 bg-white border-b border-slate-100">
        <h3 className="text-[15px] font-semibold text-slate-800">Review Details</h3>
      </div>

      {topFields.length > 0 && (
        <div className="px-4 py-3">
          <div className="grid grid-cols-3 gap-x-4 gap-y-2">
            {topFields.map((f, i) => {
              const displayValue = f.field_name === 'CSR'
                ? (csrName ?? (isCSR ? username : null) ?? f.value ?? '—')
                : (f.value || '—')
              return (
                <div key={i} className="min-w-0">
                  <p className="text-[11px] text-slate-400 mb-0.5">{f.field_name}</p>
                  <p className="text-[14px] font-semibold text-slate-900 truncate" title={displayValue}>
                    {displayValue}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {topFields.length > 0 && hasBottomFields && (
        <div className="border-t border-slate-100" />
      )}

      {hasBottomFields && (
        <div className="px-4 py-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {bottomFields.map((f, i) => {
              if (f.field_type === 'SPACER') return <div key={`spacer-${i}`} />
              return (
                <div key={i} className="min-w-0 flex items-baseline gap-1.5">
                  <span className="text-[12px] text-slate-500 shrink-0">{f.field_name}:</span>
                  <span className="text-[14px] font-semibold text-slate-800 truncate" title={f.value || '—'}>
                    {f.value || '—'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

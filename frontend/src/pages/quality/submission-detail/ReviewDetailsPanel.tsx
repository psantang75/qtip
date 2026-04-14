import { Section, InfoRow } from '@/components/common/DetailLayout'

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

  const allFields = [
    ...topFields.map(f => ({
      ...f,
      value: f.field_name === 'CSR'
        ? (csrName ?? (isCSR ? username : null) ?? f.value ?? '—')
        : (f.value || '—'),
    })),
    ...(hasBottomFields ? bottomFields : []),
  ].filter(f => f.field_type !== 'SPACER')

  return (
    <Section title="Review Details">
      <div className="grid grid-cols-2 gap-x-8 gap-y-4">
        {allFields.map((f, i) => (
          <InfoRow key={i} label={f.field_name} value={f.value || '—'} />
        ))}
      </div>
    </Section>
  )
}

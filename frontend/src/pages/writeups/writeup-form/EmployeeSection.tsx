import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { FormSection, Field } from '@/pages/training/coaching-form/CoachingFormSections'
import userService from '@/services/userService'
import type { WriteUpFormState } from './types'

type Updater = <K extends keyof WriteUpFormState>(key: K, value: WriteUpFormState[K]) => void

export function EmployeeSection({ form, update }: { form: WriteUpFormState; update: Updater }) {
  const { data: csrsData } = useQuery({
    queryKey: ['csrs-for-writeup'],
    queryFn:  () => userService.getUsers(1, 100, { role_id: 3, is_active: true }),
    staleTime: 60_000,
  })
  const { data: managersData } = useQuery({
    queryKey: ['managers-for-writeup'],
    queryFn:  () => userService.getUsers(1, 100, { role_id: 5, is_active: true }),
    staleTime: 60_000,
  })
  const { data: adminsData } = useQuery({
    queryKey: ['admins-for-writeup'],
    queryFn:  () => userService.getUsers(1, 100, { role_id: 1, is_active: true }),
    staleTime: 60_000,
  })

  const csrsByDept = useMemo(() => {
    const items = [...(csrsData?.items ?? [])]
    const grouped: Record<string, typeof items> = {}
    for (const u of items) {
      const dept = u.department_name ?? ''
      if (!grouped[dept]) grouped[dept] = []
      grouped[dept].push(u)
    }
    const sortedDepts = Object.keys(grouped).sort((a, b) => a.localeCompare(b))
    sortedDepts.forEach(d => grouped[d].sort((a, b) => a.username.localeCompare(b.username)))
    return { grouped, sortedDepts }
  }, [csrsData])

  const staffOptions = useMemo(() => {
    const combined = [...(managersData?.items ?? []), ...(adminsData?.items ?? [])]
    return combined
      .filter((u, i, arr) => arr.findIndex(x => x.id === u.id) === i)
      .sort((a, b) => a.username.localeCompare(b.username))
  }, [managersData, adminsData])

  return (
    <FormSection title="Employee & Document Type">
      <div className="grid grid-cols-2 gap-4 mb-4">
        <Field label="Employee" required>
          <Select
            value={form.csr_id ? String(form.csr_id) : ''}
            onValueChange={v => update('csr_id', Number(v))}
          >
            <SelectTrigger className="h-9 text-[13px]">
              <SelectValue placeholder="Select employee…" />
            </SelectTrigger>
            <SelectContent>
              {csrsByDept.sortedDepts.map((dept, i) => (
                <SelectGroup key={dept}>
                  {i > 0 && <SelectSeparator />}
                  <SelectLabel className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest px-2 py-1">
                    {dept || 'No Department'}
                  </SelectLabel>
                  {csrsByDept.grouped[dept].map(u => (
                    <SelectItem key={u.id} value={String(u.id)}>{u.username}</SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Document Type" required>
          <Select
            value={form.document_type}
            onValueChange={v => update('document_type', v as WriteUpFormState['document_type'])}
          >
            <SelectTrigger className="h-9 text-[13px]">
              <SelectValue placeholder="Select type…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="VERBAL_WARNING">Verbal Warning</SelectItem>
              <SelectItem value="WRITTEN_WARNING">Written Warning</SelectItem>
              <SelectItem value="FINAL_WARNING">Final Warning</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      {(() => {
        const samePersonError =
          form.manager_id > 0 &&
          form.hr_witness_id > 0 &&
          form.manager_id === form.hr_witness_id
        return (
          <>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Manager">
                <Select
                  value={form.manager_id ? String(form.manager_id) : ''}
                  onValueChange={v => update('manager_id', Number(v))}
                >
                  <SelectTrigger className={`h-9 text-[13px] ${samePersonError ? 'border-red-400 focus:ring-red-400' : ''}`}>
                    <SelectValue placeholder="Select manager…" />
                  </SelectTrigger>
                  <SelectContent>
                    {staffOptions.map(u => (
                      <SelectItem key={u.id} value={String(u.id)}>{u.username}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="HR Witness">
                <Select
                  value={form.hr_witness_id ? String(form.hr_witness_id) : ''}
                  onValueChange={v => update('hr_witness_id', Number(v))}
                >
                  <SelectTrigger className={`h-9 text-[13px] ${samePersonError ? 'border-red-400 focus:ring-red-400' : ''}`}>
                    <SelectValue placeholder="Select HR witness…" />
                  </SelectTrigger>
                  <SelectContent>
                    {staffOptions.map(u => (
                      <SelectItem key={u.id} value={String(u.id)}>{u.username}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Meeting Date">
                <Input
                  type="date"
                  className="h-9 text-[13px]"
                  value={form.meeting_date}
                  onChange={e => update('meeting_date', e.target.value)}
                />
              </Field>
            </div>
            {samePersonError && (
              <p className="text-[12px] text-red-500 mt-1">
                Manager and HR Witness cannot be the same person.
              </p>
            )}
          </>
        )
      })()}
    </FormSection>
  )
}

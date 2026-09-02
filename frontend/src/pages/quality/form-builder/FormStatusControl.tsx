import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, X } from 'lucide-react'
import type { Form } from '@/types/form.types'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { optionCls } from '@/utils/forms/optionCls'
import userService, { type User } from '@/services/userService'

// Internal-form audience roles. `admin` is always permitted implicitly, so it is
// not offered here. These mirror the roles granted the Internal Research
// Insights section (ie_page_role_access): Manager, QA, Trainer.
const INTERNAL_AUDIENCE_ROLES: Array<{ key: string; label: string }> = [
  { key: 'manager', label: 'Manager' },
  { key: 'qa',      label: 'QA'      },
  { key: 'trainer', label: 'Trainer' },
]

// Agents must never see Internal data, so they can never be an audience — the
// individual-user picker hides this role from search results.
const EXCLUDED_AUDIENCE_ROLE = 'CSR'

type FormStatus = 'ACTIVE' | 'INACTIVE' | 'INTERNAL'

const STATUS_OPTIONS: Array<{ value: FormStatus; label: string; hint: string }> = [
  { value: 'ACTIVE',   label: 'Active',   hint: 'Live — visible to auditors and included in all reporting.' },
  { value: 'INACTIVE', label: 'Inactive', hint: 'Hidden from new audits; existing submissions are preserved.' },
  { value: 'INTERNAL', label: 'Internal', hint: 'Hidden internal research form. The form and its results are excluded from every agent/CSR and standard Quality surface; both appear only for the audience below and in Insights → Internal Research.' },
]

// ── Individual-user audience picker ───────────────────────────────────────────
// Lets you grant specific people (e.g. one manager) in addition to whole roles.
// Selected users show as removable chips; typing (2+ chars) searches active
// non-agent users to add.
function InternalUserPicker({ selected, onChange }: { selected: number[]; onChange: (ids: number[]) => void }) {
  const [term, setTerm] = useState('')

  // Resolve the selected ids to user records so chips can show names/roles.
  const { data: selectedUsers = [] } = useQuery({
    queryKey: ['internal-audience-users', [...selected].sort((a, b) => a - b)],
    queryFn: async () => {
      const rows = await Promise.all(selected.map((id) => userService.getUserById(id).catch(() => null)))
      return rows.filter((u): u is User => u !== null)
    },
    enabled: selected.length > 0,
  })

  const q = term.trim()
  const { data: search } = useQuery({
    queryKey: ['internal-user-search', q],
    queryFn: () => userService.getUsers(1, 10, { search: q, is_active: true }),
    enabled: q.length >= 2,
  })

  const options = (search?.items ?? [])
    .filter((u) => (u.role_name ?? '').toUpperCase() !== EXCLUDED_AUDIENCE_ROLE)
    .filter((u) => !selected.includes(u.id))

  const add = (id: number) => { onChange([...selected, id]); setTerm('') }
  const remove = (id: number) => onChange(selected.filter((x) => x !== id))

  return (
    <div className="space-y-1.5">
      <Label className="text-[12px] font-medium text-slate-700">Specific people (optional)</Label>
      <p className="text-[11px] text-slate-500">Grant named individuals in addition to (or instead of) the roles above — e.g. one manager rather than all managers.</p>

      {selectedUsers.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {selectedUsers.map((u) => (
            <span key={u.id}
              className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 text-xs px-2 py-0.5 rounded-full border border-slate-200">
              {u.username}
              {u.role_name && <span className="text-slate-400">· {u.role_name}</span>}
              <button type="button" onClick={() => remove(u.id)}
                className="text-slate-400 hover:text-red-500 ml-0.5 leading-none" title="Remove">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative pt-1">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
        <Input value={term} onChange={(e) => setTerm(e.target.value)}
          placeholder="Search users by name or email…" className="h-8 pl-7 text-xs" />
        {q.length >= 2 && (
          <div className="absolute z-20 mt-1 w-full max-h-52 overflow-auto rounded-md border border-slate-200 bg-white shadow-md">
            {options.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-400">No matching users.</p>
            ) : (
              options.map((u) => (
                <button key={u.id} type="button" onClick={() => add(u.id)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-50">
                  <span className="text-slate-700">{u.username}</span>
                  <span className="text-slate-400">{u.role_name ?? ''}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Form status: Active / Inactive / Internal ─────────────────────────────────
// Internal layers on top of is_active: it flips access_mode to 'INTERNAL'
// (hidden capture) and reveals a per-form audience picker (roles + individual
// users). Active/Inactive clear the internal fields so the form reverts to
// normal is_active governance.
export function FormStatusControl({ form, onChange }: { form: Form; onChange: (f: Form) => void }) {
  const status: FormStatus = form.access_mode === 'INTERNAL' ? 'INTERNAL' : form.is_active ? 'ACTIVE' : 'INACTIVE'
  const roles = form.access_roles ?? []
  const users = form.access_users ?? []

  const setStatus = (next: FormStatus) => {
    if (next === 'INTERNAL') {
      onChange({ ...form, access_mode: 'INTERNAL', is_active: true, access_roles: roles, access_users: users })
    } else {
      onChange({ ...form, access_mode: null, access_roles: null, access_users: null, is_active: next === 'ACTIVE' })
    }
  }

  const toggleRole = (key: string) => {
    const next = roles.includes(key) ? roles.filter((r) => r !== key) : [...roles, key]
    onChange({ ...form, access_roles: next })
  }

  const setUsers = (ids: number[]) => onChange({ ...form, access_users: ids })

  const activeHint = STATUS_OPTIONS.find((o) => o.value === status)?.hint
  const hasAudience = roles.length > 0 || users.length > 0

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label className="text-sm font-medium text-slate-800">Form Status</Label>
          <p className="text-[11px] text-slate-500">{activeHint}</p>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {STATUS_OPTIONS.map((opt) => (
            <button key={opt.value} type="button" onClick={() => setStatus(opt.value)}
              className={cn('h-7 px-3 text-[12px] rounded border font-medium transition-all', optionCls(status === opt.value))}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {status === 'INTERNAL' && (
        <div className="border-t border-slate-100 pt-3 space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[12px] font-medium text-slate-700">Who can audit &amp; view results</Label>
            <p className="text-[11px] text-slate-500">Admins always have access. Select the roles allowed to use this form and see its Internal Research data.</p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {INTERNAL_AUDIENCE_ROLES.map((role) => (
                <button key={role.key} type="button" onClick={() => toggleRole(role.key)}
                  className={cn('h-7 px-3 text-[12px] rounded border font-medium transition-all', optionCls(roles.includes(role.key)))}>
                  {role.label}
                </button>
              ))}
            </div>
          </div>

          <InternalUserPicker selected={users} onChange={setUsers} />

          {!hasAudience && (
            <p className="text-[11px] text-amber-600">Only admins will see this form and its results until a role or person is selected.</p>
          )}
        </div>
      )}
    </div>
  )
}

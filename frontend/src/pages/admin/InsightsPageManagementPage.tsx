import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import {
  listPages, updatePageAccess, updatePageDepartmentAccess, listInsightsDepartments,
  listOverrides, createOverride, deleteOverride,
} from '@/services/insightsService'
import type {
  IePage, IePageRoleAccess, IePageDepartmentAccess, IePageUserOverride, DataScope,
} from '@/services/insightsService'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SearchableMultiSelect } from '@/components/common/SearchableMultiSelect'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

// Mirrors the rows in the `roles` table. Keep this list in sync with the DB
// — adding an id here that doesn't exist in `roles` will fail the FK on
// `ie_page_role_access.role_id` when saving.
const ROLES = [
  { id: 1, name: 'Admin' },
  { id: 2, name: 'QA' },
  { id: 3, name: 'CSR' },
  { id: 4, name: 'Trainer' },
  { id: 5, name: 'Manager' },
]

const SCOPES = ['ALL', 'DIVISION', 'DEPARTMENT', 'SELF'] as const

export default function InsightsPageManagementPage() {
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const { data: pages = [], isLoading } = useQuery({ queryKey: ['ie-pages'], queryFn: listPages })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Insights Pages</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage page access control for the Insights Engine</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/60">
              <TableHead className="w-8" />
              <TableHead className="py-4">Page Key</TableHead>
              <TableHead className="py-4">Name</TableHead>
              <TableHead className="py-4">Category</TableHead>
              <TableHead className="py-4">Route</TableHead>
              <TableHead className="py-4">Active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : pages.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">No pages registered yet. Pages are added when section blueprints are deployed.</TableCell></TableRow>
            ) : pages.map(p => (
              <React.Fragment key={p.id}>
                <TableRow className="hover:bg-slate-50/50 cursor-pointer" onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}>
                  <TableCell>{expandedId === p.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</TableCell>
                  <TableCell className="font-mono text-[13px]">{p.page_key}</TableCell>
                  <TableCell className="font-medium text-[14px]">{p.page_name}</TableCell>
                  <TableCell className="text-[13px] text-slate-600">{p.category}</TableCell>
                  <TableCell className="text-[13px] text-slate-600">{p.route_path}</TableCell>
                  <TableCell>
                    <span className={`w-1.5 h-1.5 rounded-full inline-block ${p.is_active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                  </TableCell>
                </TableRow>
                {expandedId === p.id && (
                  <TableRow>
                    <TableCell colSpan={6} className="bg-slate-50 px-6 py-4">
                      <PageDetailSection page={p} />
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function PageDetailSection({ page }: { page: IePage }) {
  const qc = useQueryClient()
  const { toast } = useToast()

  const existingAccess = page.role_access ?? []
  const [roleEdits, setRoleEdits] = useState<Record<number, { can_access: boolean; data_scope: string }>>(() => {
    const map: Record<number, { can_access: boolean; data_scope: string }> = {}
    for (const r of ROLES) {
      const existing = existingAccess.find((a: IePageRoleAccess) => a.role_id === r.id)
      // MySQL returns TINYINT(1) as a number (0/1); coerce to boolean so the
      // backend Zod schema (z.boolean()) doesn't reject the payload.
      map[r.id] = {
        can_access: Boolean(existing?.can_access),
        data_scope: existing?.data_scope ?? 'SELF',
      }
    }
    return map
  })

  const accessMut = useMutation({
    mutationFn: () => {
      const roles = ROLES.map(r => ({
        role_id: r.id,
        can_access: Boolean(roleEdits[r.id].can_access),
        data_scope: roleEdits[r.id].data_scope as 'ALL' | 'DIVISION' | 'DEPARTMENT' | 'SELF',
      }))
      return updatePageAccess(page.id, roles)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ie-pages'] }); toast({ title: 'Access updated' }) },
    onError: (e: Error) => toast({ title: 'Failed to save access', description: e.message, variant: 'destructive' }),
  })

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-slate-700">Role Access</h4>
          <Button size="sm" variant="outline" className="h-7 text-[12px]" onClick={() => accessMut.mutate()} disabled={accessMut.isPending}>
            {accessMut.isPending ? 'Saving...' : 'Save Access'}
          </Button>
        </div>
        <Table>
          <TableHeader><TableRow className="bg-white">
            <TableHead className="py-2 text-[12px]">Role</TableHead>
            <TableHead className="py-2 text-[12px]">Can Access</TableHead>
            <TableHead className="py-2 text-[12px]">Data Scope</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {ROLES.map(r => (
              <TableRow key={r.id}>
                <TableCell className="text-[13px] font-medium">{r.name}</TableCell>
                <TableCell>
                  <button type="button"
                    onClick={() => setRoleEdits(prev => ({ ...prev, [r.id]: { ...prev[r.id], can_access: !prev[r.id].can_access } }))}
                    className={`w-9 h-5 rounded-full transition-colors relative ${roleEdits[r.id].can_access ? 'bg-primary' : 'bg-slate-300'}`}>
                    <span className={`absolute top-1/2 left-0 h-4 w-4 -translate-y-1/2 rounded-full bg-white shadow transition-transform ${roleEdits[r.id].can_access ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
                  </button>
                </TableCell>
                <TableCell>
                  <Select value={roleEdits[r.id].data_scope}
                    onValueChange={v => setRoleEdits(prev => ({ ...prev, [r.id]: { ...prev[r.id], data_scope: v } }))}>
                    <SelectTrigger className="h-7 w-[140px] text-[12px]"><SelectValue /></SelectTrigger>
                    <SelectContent>{SCOPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <DepartmentAccessSection page={page} />

      <OverridesSection pageId={page.id} />
    </div>
  )
}

function DepartmentAccessSection({ page }: { page: IePage }) {
  const qc = useQueryClient()
  const { toast } = useToast()

  const { data: departments = [] } = useQuery({ queryKey: ['ie-departments'], queryFn: listInsightsDepartments })

  // Edit state keyed by department_key. Seeded from the page's existing grants;
  // MySQL returns TINYINT(1) as 0/1, so coerce to a real boolean.
  const [deptEdits, setDeptEdits] = useState<Record<number, { can_access: boolean; data_scope: DataScope }>>(() => {
    const map: Record<number, { can_access: boolean; data_scope: DataScope }> = {}
    for (const d of (page.department_access ?? []) as IePageDepartmentAccess[]) {
      map[d.department_key] = { can_access: Boolean(d.can_access), data_scope: d.data_scope ?? 'DEPARTMENT' }
    }
    return map
  })

  const selectedIds = Object.keys(deptEdits).map(Number)

  const handleSelectionChange = (ids: number[]) => {
    setDeptEdits(prev => {
      const next: Record<number, { can_access: boolean; data_scope: DataScope }> = {}
      for (const id of ids) {
        next[id] = prev[id] ?? { can_access: true, data_scope: 'DEPARTMENT' }
      }
      return next
    })
  }

  const deptMut = useMutation({
    mutationFn: () => {
      const payload = Object.entries(deptEdits).map(([key, v]) => ({
        department_key: Number(key),
        can_access: Boolean(v.can_access),
        data_scope: v.data_scope,
      }))
      return updatePageDepartmentAccess(page.id, payload)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ie-pages'] }); toast({ title: 'Department access updated' }) },
    onError: (e: Error) => toast({ title: 'Failed to save department access', description: e.message, variant: 'destructive' }),
  })

  const deptName = (key: number) =>
    departments.find(d => d.department_key === key)?.department_name ?? `Department #${key}`

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-700">Department Access</h4>
        <Button size="sm" variant="outline" className="h-7 text-[12px]" onClick={() => deptMut.mutate()} disabled={deptMut.isPending}>
          {deptMut.isPending ? 'Saving...' : 'Save Department Access'}
        </Button>
      </div>
      <p className="text-[12px] text-muted-foreground">
        Additive to role access — a user can open this page if their role OR their department grants it.
        Granting a parent department includes all departments beneath it.
      </p>
      <SearchableMultiSelect
        items={departments.map(d => ({ id: d.department_key, label: d.department_name }))}
        selectedIds={selectedIds}
        onChange={handleSelectionChange}
        placeholder="Add departments…"
        width="w-[280px]"
        emptyMessage="No departments found"
      />
      {selectedIds.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No department grants.</p>
      ) : (
        <Table>
          <TableHeader><TableRow className="bg-white">
            <TableHead className="py-2 text-[12px]">Department</TableHead>
            <TableHead className="py-2 text-[12px]">Can Access</TableHead>
            <TableHead className="py-2 text-[12px]">Data Scope</TableHead>
            <TableHead className="py-2 w-8" />
          </TableRow></TableHeader>
          <TableBody>
            {selectedIds.map(key => (
              <TableRow key={key}>
                <TableCell className="text-[13px] font-medium">{deptName(key)}</TableCell>
                <TableCell>
                  <button type="button"
                    onClick={() => setDeptEdits(prev => ({ ...prev, [key]: { ...prev[key], can_access: !prev[key].can_access } }))}
                    className={`w-9 h-5 rounded-full transition-colors relative ${deptEdits[key].can_access ? 'bg-primary' : 'bg-slate-300'}`}>
                    <span className={`absolute top-1/2 left-0 h-4 w-4 -translate-y-1/2 rounded-full bg-white shadow transition-transform ${deptEdits[key].can_access ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
                  </button>
                </TableCell>
                <TableCell>
                  <Select value={deptEdits[key].data_scope}
                    onValueChange={v => setDeptEdits(prev => ({ ...prev, [key]: { ...prev[key], data_scope: v as DataScope } }))}>
                    <SelectTrigger className="h-7 w-[140px] text-[12px]"><SelectValue /></SelectTrigger>
                    <SelectContent>{SCOPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <button onClick={() => handleSelectionChange(selectedIds.filter(k => k !== key))} className="text-red-500 hover:text-red-700"><Trash2 size={14} /></button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

function OverridesSection({ pageId }: { pageId: number }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [adding, setAdding] = useState(false)
  const [newUserId, setNewUserId] = useState('')
  const [newAccess, setNewAccess] = useState(true)
  const [newScope, setNewScope] = useState('ALL')
  const [newReason, setNewReason] = useState('')

  const { data: overrides = [] } = useQuery({ queryKey: ['ie-overrides', pageId], queryFn: () => listOverrides(pageId) })

  const addMut = useMutation({
    mutationFn: () => createOverride(pageId, { user_id: parseInt(newUserId), can_access: newAccess, data_scope: newScope, reason: newReason || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ie-overrides', pageId] }); toast({ title: 'Override created' }); setAdding(false); setNewUserId(''); setNewReason('') },
    onError: (e: Error) => toast({ title: e.message, variant: 'destructive' }),
  })

  const delMut = useMutation({
    mutationFn: (id: number) => deleteOverride(pageId, id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ie-overrides', pageId] }); toast({ title: 'Override removed' }) },
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-700">User Overrides</h4>
        <Button size="sm" variant="outline" className="h-7 text-[12px]" onClick={() => setAdding(!adding)}>
          <Plus size={12} className="mr-1" /> Add Override
        </Button>
      </div>
      {overrides.length > 0 && (
        <Table>
          <TableHeader><TableRow className="bg-white">
            <TableHead className="py-2 text-[12px]">User</TableHead>
            <TableHead className="py-2 text-[12px]">Access</TableHead>
            <TableHead className="py-2 text-[12px]">Scope</TableHead>
            <TableHead className="py-2 text-[12px]">Granted By</TableHead>
            <TableHead className="py-2 text-[12px]">Reason</TableHead>
            <TableHead className="py-2 w-8" />
          </TableRow></TableHeader>
          <TableBody>
            {overrides.map((o: IePageUserOverride) => (
              <TableRow key={o.id}>
                <TableCell className="text-[13px]">{o.user_name}</TableCell>
                <TableCell className="text-[13px]">{o.can_access ? 'Yes' : 'No'}</TableCell>
                <TableCell className="text-[13px]">{o.data_scope ?? '—'}</TableCell>
                <TableCell className="text-[13px]">{o.granter_name}</TableCell>
                <TableCell className="text-[13px] text-slate-500 max-w-[200px] truncate">{o.reason ?? '—'}</TableCell>
                <TableCell>
                  <button onClick={() => delMut.mutate(o.id)} className="text-red-500 hover:text-red-700"><Trash2 size={14} /></button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {overrides.length === 0 && !adding && <p className="text-[13px] text-muted-foreground">No user overrides.</p>}
      {adding && (
        <div className="bg-white rounded-lg border p-3 space-y-3">
          <div className="grid grid-cols-4 gap-3">
            <div><label className="text-[12px] font-medium">User ID</label><Input type="number" value={newUserId} onChange={e => setNewUserId(e.target.value)} placeholder="e.g. 5" /></div>
            <div><label className="text-[12px] font-medium">Access</label>
              <Select value={newAccess ? 'yes' : 'no'} onValueChange={v => setNewAccess(v === 'yes')}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="yes">Grant</SelectItem><SelectItem value="no">Deny</SelectItem></SelectContent>
              </Select>
            </div>
            <div><label className="text-[12px] font-medium">Scope</label>
              <Select value={newScope} onValueChange={setNewScope}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{SCOPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><label className="text-[12px] font-medium">Reason</label><Input value={newReason} onChange={e => setNewReason(e.target.value)} placeholder="Optional" /></div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" onClick={() => addMut.mutate()} disabled={!newUserId || addMut.isPending}>{addMut.isPending ? 'Saving...' : 'Save'}</Button>
          </div>
        </div>
      )}
    </div>
  )
}

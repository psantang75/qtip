import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Pencil, ChevronLeft, ChevronRight,
  ChevronDown, ChevronsUpDown, ChevronUp,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import userService from '@/services/userService'
import type { User } from '@/services/userService'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { UserFormSheet } from './users/UserFormSheet'
import { UserFilterBar, ROLE_NAMES } from './users/UserFilterBar'
import { TableErrorState } from '@/components/common/TableErrorState'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'

type AdminUser = User
type SortField = 'username' | 'email' | 'role_id' | 'department_name' | 'is_active' | 'last_login'
type SortDir   = 'asc' | 'desc'

function formatDate(d?: string | null) {
  if (!d) return 'Never'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function AdminUsersPage() {
  const queryClient = useQueryClient()
  const { user: me } = useAuth()

  // ── Filter state ──────────────────────────────────────────────────────────
  const [search,        setSearch]        = useState('')
  // clientPage drives display pagination only; serverPage drives the API fetch
  const [clientPage,    setClientPage]    = useState(1)
  const [selectedRoles, setSelectedRoles] = useState<number[]>([])
  const [selectedDepts, setSelectedDepts] = useState<number[]>([])
  const [statusFilter,  setStatusFilter]  = useState<string>('active')

  // ── Sort state ────────────────────────────────────────────────────────────
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDir,   setSortDir]   = useState<SortDir>('asc')

  // ── Sheet state ───────────────────────────────────────────────────────────
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editUser,  setEditUser]  = useState<AdminUser | null>(null)

  const LIMIT = 100

  // ── Queries ───────────────────────────────────────────────────────────────
  // Server always fetches page 1 with a large limit; client handles display pagination.
  const { data: usersData, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-users', search],
    queryFn:  () => userService.getUsers(1, LIMIT, search ? { search } : {}),
  })
  const { data: roles = [] }       = useQuery({ queryKey: ['roles'],              queryFn: () => userService.getRoles() })
  const { data: departments = [] } = useQuery({ queryKey: ['departments-simple'], queryFn: () => userService.getDepartments() })

  // ── Client-side filter + sort ─────────────────────────────────────────────
  const filteredUsers = useMemo(() => {
    let list = (usersData?.items ?? []) as AdminUser[]
    if (selectedRoles.length > 0) list = list.filter(u => selectedRoles.includes(u.role_id))
    if (selectedDepts.length > 0) list = list.filter(u => selectedDepts.includes(u.department_id ?? -1))
    if (statusFilter === 'active')   list = list.filter(u => u.is_active)
    if (statusFilter === 'inactive') list = list.filter(u => !u.is_active)
    if (sortField) {
      list = [...list].sort((a, b) => {
        const av = (a as Record<string, unknown>)[sortField] ?? ''
        const bv = (b as Record<string, unknown>)[sortField] ?? ''
        const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return list
  }, [usersData?.items, selectedRoles, selectedDepts, statusFilter, sortField, sortDir])

  const PAGE_SIZE     = 25
  const totalFiltered = filteredUsers.length
  const pages         = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE))
  const pagedUsers    = filteredUsers.slice((clientPage - 1) * PAGE_SIZE, clientPage * PAGE_SIZE)

  // ── Sort helpers ──────────────────────────────────────────────────────────
  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
    setClientPage(1)
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ChevronsUpDown size={12} className="ml-1 text-slate-400 shrink-0" />
    return sortDir === 'asc'
      ? <ChevronUp   size={12} className="ml-1 text-primary shrink-0" />
      : <ChevronDown size={12} className="ml-1 text-primary shrink-0" />
  }

  function SortHead({ field, children, className }: { field: SortField; children: React.ReactNode; className?: string }) {
    return (
      <TableHead className={`py-4 cursor-pointer select-none hover:bg-slate-100 transition-colors whitespace-nowrap ${className ?? ''}`}
        onClick={() => { toggleSort(field); setClientPage(1) }}>
        <div className="flex items-center">{children}<SortIcon field={field} /></div>
      </TableHead>
    )
  }

  // ── Toggle active mutation ────────────────────────────────────────────────
  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => userService.toggleUserStatus(id, active),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  })

  return (
    <div className="space-y-5">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">User Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage accounts, roles, and access</p>
        </div>
        <Button onClick={() => { setEditUser(null); setSheetOpen(true) }} className="gap-1.5">
          <Plus size={15} /> Add User
        </Button>
      </div>

      {/* Filters */}
      <UserFilterBar
        search={search}         onSearchChange={v => { setSearch(v); setClientPage(1) }}
        roles={roles}           departments={departments}
        selectedRoles={selectedRoles}   selectedDepts={selectedDepts}
        statusFilter={statusFilter}
        onApplyRoles={ids  => { setSelectedRoles(ids);  setClientPage(1) }}
        onApplyDepts={ids  => { setSelectedDepts(ids);  setClientPage(1) }}
        onStatusChange={v  => { setStatusFilter(v);     setClientPage(1) }}
        onReset={() => { setSelectedRoles([]); setSelectedDepts([]); setStatusFilter('active'); setSearch(''); setClientPage(1) }}
      />

      {/* Count */}
      <p className="text-[13px] text-muted-foreground">
        Showing {pagedUsers.length} of {totalFiltered} users
      </p>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <Table>
          <TableHeader>
            <StandardTableHeaderRow>
              <SortHead field="username">Name</SortHead>
              <SortHead field="email">Email</SortHead>
              <SortHead field="department_name">Department</SortHead>
              <SortHead field="role_id">Role</SortHead>
              <SortHead field="last_login">Last Login</SortHead>
              <SortHead field="is_active">Status</SortHead>
              <TableHead className="py-4 w-[60px]" />
            </StandardTableHeaderRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : isError ? (
              <TableRow><TableCell colSpan={7} className="py-4"><TableErrorState message="Failed to load users." onRetry={refetch} /></TableCell></TableRow>
            ) : pagedUsers.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No users found</TableCell></TableRow>
            ) : pagedUsers.map(u => (
              <TableRow key={u.id} className="hover:bg-slate-50/50">
                <TableCell className="text-[13px] font-medium text-slate-900">{u.username}</TableCell>
                <TableCell className="text-[13px] text-slate-500">{u.email}</TableCell>
                <TableCell className="text-[13px] text-slate-600">{u.department_name ?? '—'}</TableCell>
                <TableCell className="text-[13px] text-slate-600">{ROLE_NAMES[u.role_id] ?? '—'}</TableCell>
                <TableCell className="text-[13px] text-slate-500">{formatDate(u.last_login)}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm"
                    className="h-auto px-0 gap-1.5 text-[12px] hover:bg-transparent"
                    disabled={u.id === me?.id}
                    title={u.id === me?.id ? "Can't deactivate yourself" : undefined}
                    onClick={() => toggleMutation.mutate({ id: u.id, active: !u.is_active })}>
                    <span className={`w-1.5 h-1.5 rounded-full ${u.is_active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                    <span className={u.is_active ? 'text-emerald-700' : 'text-slate-500'}>{u.is_active ? 'Active' : 'Inactive'}</span>
                  </Button>
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]"
                    onClick={() => { setEditUser(u); setSheetOpen(true) }}>
                    <Pencil size={12} className="mr-1" /> Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">Page {clientPage} of {pages}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={clientPage === 1}    onClick={() => setClientPage(p => p - 1)}><ChevronLeft  size={14} /></Button>
          <Button variant="outline" size="sm" disabled={clientPage >= pages} onClick={() => setClientPage(p => p + 1)}><ChevronRight size={14} /></Button>
        </div>
      </div>

      {/* Add / Edit Sheet */}
      <UserFormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        editUser={editUser}
        currentUserId={me?.id}
        roles={roles}
        departments={departments}
      />

    </div>
  )
}

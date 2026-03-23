import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus, Search, Pencil, ChevronLeft, ChevronRight,
  Eye, EyeOff, AlertCircle, ChevronDown, ChevronsUpDown,
  ChevronUp,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/hooks/use-toast'
import userService from '@/services/userService'
import type { User, Department } from '@/services/userService'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu, DropdownMenuCheckboxItem,
  DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'

// AdminUser extends the base User — all extra fields already on User after authService update
type AdminUser = User

// ── Sort types ────────────────────────────────────────────────────────────────
type SortField = 'username' | 'email' | 'role_id' | 'department_name' | 'is_active' | 'last_login'
type SortDir   = 'asc' | 'desc'

// ── Form schema ───────────────────────────────────────────────────────────────
const makeSchema = (isCreate: boolean) =>
  z.object({
    username:      z.string().min(3, 'Min 3 characters'),
    email:         z.string().email('Valid email required'),
    password:      isCreate
      ? z.string().min(6, 'Min 6 characters')
      : z.string().optional(),
    title:         z.string().optional(),
    role_id:       z.coerce.number().min(1, 'Role required'),
    department_id: z.coerce.number().nullable().optional(),
    is_active:     z.boolean().optional(),
  })

type FormValues = z.infer<ReturnType<typeof makeSchema>>

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(d?: string | null) {
  if (!d) return 'Never'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const ROLE_NAMES: Record<number, string> = {
  1: 'Admin', 2: 'QA', 3: 'User', 4: 'Trainer', 5: 'Manager',
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function AdminUsersPage() {
  const queryClient = useQueryClient()
  const { user: me } = useAuth()
  const { toast } = useToast()

  // ── Applied filter state (what the table actually filters by) ────────────
  const [page, setPage]               = useState(1)
  const [search, setSearch]           = useState('')
  const [selectedRoles, setSelectedRoles]   = useState<number[]>([])
  const [selectedDepts, setSelectedDepts]   = useState<number[]>([])
  const [statusFilter, setStatusFilter]     = useState<string>('active')

  // ── Pending state (selections inside the dropdown before Apply) ───────────
  const [pendingRoles, setPendingRoles] = useState<number[]>([])
  const [pendingDepts, setPendingDepts] = useState<number[]>([])

  // ── Dropdown open state (controlled so they don't auto-close on check) ────
  const [rolesOpen, setRolesOpen] = useState(false)
  const [deptsOpen, setDeptsOpen] = useState(false)

  function handleRolesOpenChange(open: boolean) {
    if (open) setPendingRoles([...selectedRoles]) // seed pending from applied
    setRolesOpen(open)
  }

  function handleDeptsOpenChange(open: boolean) {
    if (open) setPendingDepts([...selectedDepts]) // seed pending from applied
    setDeptsOpen(open)
  }

  // ── Sort state ────────────────────────────────────────────────────────────
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDir,   setSortDir]   = useState<SortDir>('asc')

  // ── Sheet state ───────────────────────────────────────────────────────────
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editUser, setEditUser]   = useState<AdminUser | null>(null)
  const [showPass, setShowPass]   = useState(false)
  const [apiError, setApiError]   = useState<string | null>(null)

  const LIMIT = 100 // fetch enough to filter client-side

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: usersData, isLoading } = useQuery({
    queryKey: ['admin-users', page, search],
    queryFn: () => userService.getUsers(page, LIMIT, search ? { search } : {}),
  })

  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn:  () => userService.getRoles(),
  })

  const { data: departments = [] } = useQuery({
    queryKey: ['departments-simple'],
    queryFn:  () => userService.getDepartments(),
  })

  // ── Client-side filter + sort ─────────────────────────────────────────────
  const rawUsers = usersData?.items ?? []

  const filteredUsers = useMemo(() => {
    let list = rawUsers as AdminUser[]

    if (selectedRoles.length > 0)
      list = list.filter(u => selectedRoles.includes(u.role_id))

    if (selectedDepts.length > 0)
      list = list.filter(u => selectedDepts.includes(u.department_id ?? -1))

    if (statusFilter === 'active')   list = list.filter(u => u.is_active)
    if (statusFilter === 'inactive') list = list.filter(u => !u.is_active)

    if (sortField) {
      list = [...list].sort((a, b) => {
        const av = (a as any)[sortField] ?? ''
        const bv = (b as any)[sortField] ?? ''
        const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
        return sortDir === 'asc' ? cmp : -cmp
      })
    }

    return list
  }, [rawUsers, selectedRoles, selectedDepts, statusFilter, sortField, sortDir])

  // Paginate the filtered result client-side
  const PAGE_SIZE  = 25
  const totalFiltered = filteredUsers.length
  const pages      = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE))
  const pagedUsers = filteredUsers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // ── Sort helpers ──────────────────────────────────────────────────────────
  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
    setPage(1)
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ChevronsUpDown size={12} className="ml-1 text-slate-400 shrink-0" />
    return sortDir === 'asc'
      ? <ChevronUp   size={12} className="ml-1 text-[#00aeef] shrink-0" />
      : <ChevronDown size={12} className="ml-1 text-[#00aeef] shrink-0" />
  }

  // ── Mutations ─────────────────────────────────────────────────────────────
  const isCreate = !editUser

  const form = useForm<FormValues>({
    resolver: zodResolver(makeSchema(isCreate)),
    defaultValues: {
      username: '', email: '', password: '', title: '',
      role_id: 3, department_id: null, is_active: true,
    },
  })

  const createMutation = useMutation({
    mutationFn: (v: FormValues) => userService.createUser({
      username: v.username, email: v.email,
      password: v.password!, role_id: v.role_id,
      department_id: v.department_id ?? null,
      title: v.title || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      toast({ title: 'User created', description: `${form.getValues('username')} has been added.` })
      closeSheet()
    },
    onError: (e: Error) => setApiError(e.message),
  })

  const updateMutation = useMutation({
    mutationFn: async (v: FormValues) => {
      // Update core user fields
      await userService.updateUser(editUser!.id, {
        username: v.username, email: v.email,
        ...(v.password ? { password: v.password } : {}),
        role_id: v.role_id,
        department_id: v.department_id ?? null,
        title: v.title || undefined,
      })
      // Toggle active status only if it changed
      const newActive = v.is_active ?? editUser!.is_active
      if (newActive !== editUser!.is_active) {
        await userService.toggleUserStatus(editUser!.id, newActive)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      toast({ title: 'User updated', description: 'Changes saved successfully.' })
      closeSheet()
    },
    onError: (e: Error) => setApiError(e.message),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      userService.toggleUserStatus(id, active),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  })

  // ── Sheet helpers ─────────────────────────────────────────────────────────
  function openCreate() {
    setEditUser(null); setApiError(null); setShowPass(false)
    form.reset({ username: '', email: '', password: '', title: '', role_id: 3, department_id: null, is_active: true })
    setSheetOpen(true)
  }

  function openEdit(u: AdminUser) {
    setEditUser(u); setApiError(null); setShowPass(false)
    form.reset({
      username: u.username, email: u.email, password: '',
      title: u.title ?? '', role_id: u.role_id,
      department_id: u.department_id,
      is_active: u.is_active,
    })
    setSheetOpen(true)
  }

  function closeSheet() { setSheetOpen(false); setEditUser(null) }

  const onSubmit = (v: FormValues) => {
    setApiError(null)
    if (isCreate) createMutation.mutate(v)
    else          updateMutation.mutate(v)
  }

  const isBusy = createMutation.isPending || updateMutation.isPending

  // ── Filter label helpers ──────────────────────────────────────────────────
  const roleBtnLabel = selectedRoles.length === 0
    ? 'All Roles'
    : selectedRoles.length === 1
      ? (ROLE_NAMES[selectedRoles[0]] ?? 'Role')
      : `${selectedRoles.length} Roles`

  const deptBtnLabel = selectedDepts.length === 0
    ? 'All Departments'
    : selectedDepts.length === 1
      ? (departments.find(d => d.id === selectedDepts[0])?.department_name ?? 'Dept')
      : `${selectedDepts.length} Departments`

  const statusLabel: Record<string, string> = {
    all: 'All Status', active: 'Active', inactive: 'Inactive',
  }

  // ── Sort header cell ──────────────────────────────────────────────────────
  function SortHead({ field, children, className }: {
    field: SortField; children: React.ReactNode; className?: string
  }) {
    return (
      <TableHead
        className={`py-4 cursor-pointer select-none hover:bg-slate-100 transition-colors whitespace-nowrap ${className ?? ''}`}
        onClick={() => { toggleSort(field); setPage(1) }}
      >
        <div className="flex items-center">
          {children}
          <SortIcon field={field} />
        </div>
      </TableHead>
    )
  }

  return (
    <div className="space-y-5">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">User Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage accounts, roles, and access</p>
        </div>
        <Button onClick={openCreate} className="gap-1.5">
          <Plus size={15} /> Add User
        </Button>
      </div>

      {/* Filter toolbar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-3">

        {/* Search */}
        <div className="relative flex-1 min-w-[280px] max-w-[400px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search name or email…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            className="pl-10"
          />
        </div>

        {/* Roles — multi-select with Apply/Reset (stays open until Apply) */}
        <DropdownMenu open={rolesOpen} onOpenChange={handleRolesOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="w-[175px] justify-between font-normal">
              <span className="truncate">{roleBtnLabel}</span>
              <ChevronDown size={13} className="ml-1 shrink-0 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[175px]" onInteractOutside={() => setRolesOpen(false)}>
            {roles.map(r => (
              <DropdownMenuCheckboxItem
                key={r.id}
                checked={pendingRoles.includes(r.id)}
                onCheckedChange={checked =>
                  setPendingRoles(prev =>
                    checked ? [...prev, r.id] : prev.filter(id => id !== r.id)
                  )
                }
                onSelect={e => e.preventDefault()}
              >
                {r.role_name}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <div className="flex gap-2 px-2 py-2">
              <Button
                variant="outline" size="sm"
                className="flex-1 h-7 text-[12px]"
                onClick={() => setPendingRoles([])}
              >
                Reset
              </Button>
              <Button
                size="sm"
                className="flex-1 h-7 text-[12px]"
                onClick={() => { setSelectedRoles(pendingRoles); setPage(1); setRolesOpen(false) }}
              >
                Apply
              </Button>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Departments — multi-select with Apply/Reset (stays open until Apply) */}
        <DropdownMenu open={deptsOpen} onOpenChange={handleDeptsOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="w-[195px] justify-between font-normal">
              <span className="truncate">{deptBtnLabel}</span>
              <ChevronDown size={13} className="ml-1 shrink-0 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[195px]" onInteractOutside={() => setDeptsOpen(false)}>
            {departments.map(d => (
              <DropdownMenuCheckboxItem
                key={d.id}
                checked={pendingDepts.includes(d.id)}
                onCheckedChange={checked =>
                  setPendingDepts(prev =>
                    checked ? [...prev, d.id] : prev.filter(id => id !== d.id)
                  )
                }
                onSelect={e => e.preventDefault()}
              >
                {d.department_name}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <div className="flex gap-2 px-2 py-2">
              <Button
                variant="outline" size="sm"
                className="flex-1 h-7 text-[12px]"
                onClick={() => setPendingDepts([])}
              >
                Reset
              </Button>
              <Button
                size="sm"
                className="flex-1 h-7 text-[12px]"
                onClick={() => { setSelectedDepts(pendingDepts); setPage(1); setDeptsOpen(false) }}
              >
                Apply
              </Button>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Status — single select */}
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1) }}>
          <SelectTrigger className="w-[145px]">
            <SelectValue>{statusLabel[statusFilter]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>

        {/* Clear filters — always visible, disabled when nothing active */}
        <button
          onClick={() => { setSelectedRoles([]); setSelectedDepts([]); setPendingRoles([]); setPendingDepts([]); setStatusFilter('active'); setSearch(''); setPage(1) }}
          disabled={selectedRoles.length === 0 && selectedDepts.length === 0 && statusFilter === 'active' && search === ''}
          className="ml-auto text-[12px] font-medium text-[#00aeef] hover:underline disabled:opacity-30 disabled:cursor-not-allowed disabled:no-underline"
        >
          Reset Filters
        </button>
      </div>

      {/* Count */}
      <p className="text-[13px] text-muted-foreground">
        Showing {pagedUsers.length} of {totalFiltered} users
      </p>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 border-b border-slate-200">
              <SortHead field="username">Name</SortHead>
              <SortHead field="email">Email</SortHead>
              <SortHead field="department_name">Department</SortHead>
              <SortHead field="role_id">Role</SortHead>
              <SortHead field="last_login">Last Login</SortHead>
              <SortHead field="is_active">Status</SortHead>
              <TableHead className="py-4 w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">Loading…</TableCell>
              </TableRow>
            ) : pagedUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No users found</TableCell>
              </TableRow>
            ) : pagedUsers.map(u => (
              <TableRow key={u.id} className="hover:bg-slate-50/50">
                <TableCell className="text-[13px] font-medium text-slate-900">{u.username}</TableCell>
                <TableCell className="text-[13px] text-slate-500">{u.email}</TableCell>
                <TableCell className="text-[13px] text-slate-600">{u.department_name ?? '—'}</TableCell>
                <TableCell className="text-[13px] text-slate-600">{ROLE_NAMES[u.role_id] ?? '—'}</TableCell>
                <TableCell className="text-[13px] text-slate-500">{formatDate(u.last_login)}</TableCell>
                <TableCell>
                  <button
                    className="flex items-center gap-1.5 text-[12px]"
                    onClick={() => { if (u.id === me?.id) return; toggleMutation.mutate({ id: u.id, active: !u.is_active }) }}
                    title={u.id === me?.id ? "Can't deactivate yourself" : undefined}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${u.is_active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                    <span className={u.is_active ? 'text-emerald-700' : 'text-slate-500'}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </button>
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]" onClick={() => openEdit(u)}>
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
        <p className="text-[13px] text-muted-foreground">Page {page} of {pages}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft size={14} />
          </Button>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>
            <ChevronRight size={14} />
          </Button>
        </div>
      </div>

      {/* Add / Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto" aria-describedby={undefined}>
          <SheetHeader className="pb-4">
            <SheetTitle>{isCreate ? 'Add User' : `Edit User: ${editUser?.username}`}</SheetTitle>
          </SheetHeader>

          {apiError && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2.5 mb-4 text-[13px]">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              {apiError}
            </div>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

              <FormField control={form.control} name="username" render={({ field }) => (
                <FormItem>
                  <FormLabel>Display Name</FormLabel>
                  <FormControl><Input placeholder="e.g. Jane Smith" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl><Input type="email" placeholder="jane@company.com" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="password" render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        type={showPass ? 'text' : 'password'}
                        placeholder={isCreate ? 'Min 6 characters' : 'Leave blank to keep current'}
                        className="pr-9"
                        {...field}
                      />
                      <button type="button" tabIndex={-1} onClick={() => setShowPass(v => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="title" render={({ field }) => (
                <FormItem>
                  <FormLabel>Job Title <span className="text-muted-foreground">(optional)</span></FormLabel>
                  <FormControl><Input placeholder="e.g. Senior QA Analyst" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="role_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={String(field.value)}>
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {roles.map(r => (
                        <SelectItem key={r.id} value={String(r.id)}>{r.role_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="department_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Department <span className="text-muted-foreground">(optional)</span></FormLabel>
                  <Select
                    onValueChange={v => field.onChange(v === 'none' ? null : Number(v))}
                    defaultValue={field.value ? String(field.value) : 'none'}
                  >
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="No department" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">No department</SelectItem>
                      {departments.map(d => (
                        <SelectItem key={d.id} value={String(d.id)}>{d.department_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              {!isCreate && editUser && editUser.id !== me?.id && (
                <FormField control={form.control} name="is_active" render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <FormLabel className="text-[13px] font-medium">Account Active</FormLabel>
                      <p className="text-[12px] text-muted-foreground">Inactive users cannot log in</p>
                    </div>
                    <FormControl>
                      <button
                        type="button"
                        onClick={() => field.onChange(!field.value)}
                        className={`w-10 h-5 rounded-full transition-colors ${field.value ? 'bg-[#00aeef]' : 'bg-slate-300'} relative`}
                      >
                        <span className={`absolute top-1/2 left-0 h-4 w-4 -translate-y-1/2 rounded-full bg-white shadow ring-0 transition-transform ${field.value ? 'translate-x-[22px]' : 'translate-x-[2px]'}`} />
                      </button>
                    </FormControl>
                  </FormItem>
                )} />
              )}

              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" className="flex-1" onClick={closeSheet}>Cancel</Button>
                <Button type="submit" className="flex-1" disabled={isBusy}>
                  {isBusy ? 'Saving…' : isCreate ? 'Create User' : 'Save Changes'}
                </Button>
              </div>

            </form>
          </Form>
        </SheetContent>
      </Sheet>

    </div>
  )
}

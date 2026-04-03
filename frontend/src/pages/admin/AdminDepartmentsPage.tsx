import { useState, useMemo } from 'react'
import { ROLE_IDS } from '@/hooks/useQualityRole'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Pencil, X, AlertCircle, Search, ChevronDown, ChevronUp, ChevronsUpDown, Users } from 'lucide-react'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu, DropdownMenuCheckboxItem,
  DropdownMenuContent, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/hooks/use-toast'
import departmentService from '@/services/departmentService'
import userService from '@/services/userService'
import type { Department } from '@/services/departmentService'
import { Button } from '@/components/ui/button'
import { TableErrorState } from '@/components/common/TableErrorState'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'

// ── Sortable header cell ──────────────────────────────────────────────────────
function DeptSortHead({ field, sortField, sortDir, onSort, children }: {
  field: string; sortField: string | null; sortDir: 'asc' | 'desc'
  onSort: (f: string) => void; children: React.ReactNode
}) {
  return (
    <TableHead
      className="py-4 cursor-pointer select-none hover:bg-slate-100 transition-colors"
      onClick={() => onSort(field)}
    >
      <div className="flex items-center">
        {children}
        {sortField !== field
          ? <ChevronsUpDown size={12} className="ml-1 text-slate-400" />
          : sortDir === 'asc'
            ? <ChevronUp   size={12} className="ml-1 text-primary" />
            : <ChevronDown size={12} className="ml-1 text-primary" />
        }
      </div>
    </TableHead>
  )
}

// ── Schema ────────────────────────────────────────────────────────────────────
const deptSchema = z.object({
  department_name: z.string().min(2, 'Min 2 characters'),
  manager_ids:     z.array(z.number()).optional(),
  is_active:       z.boolean().optional(),
})

type FormValues = z.infer<typeof deptSchema>

// ── Component ─────────────────────────────────────────────────────────────────
export default function AdminDepartmentsPage() {
  const queryClient = useQueryClient()
  const { toast }   = useToast()

  const [sortField, setSortField] = useState<string | null>(null)
  const [sortDir, setSortDir]     = useState<'asc' | 'desc'>('asc')

  const [sheetOpen, setSheetOpen]           = useState(false)
  const [editDept, setEditDept]             = useState<Department | null>(null)
  const [apiError, setApiError]             = useState<string | null>(null)
  const [search, setSearch]                 = useState('')
  const [statusFilter, setStatusFilter]     = useState<string>('active')
  // Manager dropdown state
  const [managerDropdownOpen, setManagerDropdownOpen] = useState(false)
  const [managerQuery, setManagerQuery]               = useState('')

  const isCreate = !editDept

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: deptsRaw, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-departments'],
    queryFn:  () => departmentService.getDepartments(1, 100),
  })

  // getDepartments always returns PaginatedResponse<Department>
  const allDepartments: Department[] = deptsRaw?.items ?? []

  // Client-side filter + sort (list is small)
  const departments = useMemo(() => {
    let list = allDepartments.filter(d => {
      const matchesSearch = !search ||
        d.department_name.toLowerCase().includes(search.toLowerCase())
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && d.is_active) ||
        (statusFilter === 'inactive' && !d.is_active)
      return matchesSearch && matchesStatus
    })
    if (sortField) {
      list = [...list].sort((a, b) => {
        const av = (a as Record<string, unknown>)[sortField] ?? ''
        const bv = (b as Record<string, unknown>)[sortField] ?? ''
        const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return list
  }, [allDepartments, search, statusFilter, sortField, sortDir])

  const { data: assignable = [] } = useQuery({
    queryKey: ['assignable-users'],
    queryFn:  () => departmentService.getAssignableUsers(),
  })

  const managers = assignable.filter(u => u.role_id === ROLE_IDS.MANAGER)

  // ── Form ─────────────────────────────────────────────────────────────────
  const form = useForm<FormValues>({
    resolver: zodResolver(deptSchema),
    defaultValues: { department_name: '', manager_ids: [] },
  })

  const selectedIds = form.watch('manager_ids') ?? []

  // ── Mutations ────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (v: FormValues) =>
      departmentService.createDepartment({
        department_name: v.department_name,
        manager_ids:     v.manager_ids ?? [],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-departments'] })
      toast({ title: 'Department created' })
      closeSheet()
    },
    onError: (e: Error) => setApiError(e.message),
  })

  const updateMutation = useMutation({
    mutationFn: async (v: FormValues) => {
      // Update name and managers
      await departmentService.updateDepartment(editDept!.id, {
        department_name: v.department_name,
        manager_ids:     v.manager_ids ?? [],
      })
      // Toggle active status only if it changed
      const newActive = v.is_active ?? editDept!.is_active
      if (newActive !== editDept!.is_active) {
        await departmentService.toggleDepartmentStatus(editDept!.id, newActive)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-departments'] })
      toast({ title: 'Department updated' })
      closeSheet()
    },
    onError: (e: Error) => setApiError(e.message),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      departmentService.toggleDepartmentStatus(id, active),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-departments'] }),
  })

  // ── Helpers ──────────────────────────────────────────────────────────────
  function openCreate() {
    setEditDept(null)
    setApiError(null)
    form.reset({ department_name: '', manager_ids: [], is_active: true })
    setSheetOpen(true)
  }

  function openEdit(d: Department) {
    setEditDept(d)
    setApiError(null)
    // Coerce all manager IDs to numbers and filter out any invalid values
    const managerIds = (d.managers ?? [])
      .map(m => Number(m.manager_id))
      .filter(id => !isNaN(id) && id > 0)
    form.reset({
      department_name: d.department_name ?? '',
      manager_ids: managerIds,
      is_active: d.is_active,
    })
    setSheetOpen(true)
  }

  function closeSheet() { setSheetOpen(false); setEditDept(null); setManagerQuery('') }

  function toggleManager(id: number) {
    const numId = Number(id)
    const current = selectedIds.map(Number)
    form.setValue(
      'manager_ids',
      current.includes(numId) ? current.filter(i => i !== numId) : [...current, numId]
    )
  }

  function removeManager(id: number) {
    form.setValue('manager_ids', selectedIds.filter(i => Number(i) !== Number(id)))
  }

  const onSubmit = (v: FormValues) => {
    setApiError(null)
    if (isCreate) createMutation.mutate(v)
    else          updateMutation.mutate(v)
  }

  const isBusy = createMutation.isPending || updateMutation.isPending

  function deptSort(field: string) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  // Managers filtered by the in-dropdown search term
  const visibleManagers = managers.filter(m =>
    (m.username ?? '').toLowerCase().includes(managerQuery.toLowerCase())
  )

  // Label for the dropdown trigger
  const managerTriggerLabel = selectedIds.length === 0
    ? 'Select managers…'
    : selectedIds.length === 1
      ? managers.find(m => Number(m.id) === selectedIds[0])?.username ?? '1 selected'
      : `${selectedIds.length} managers selected`

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Departments</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage departments and manager assignments</p>
        </div>
        <Button onClick={openCreate} className="gap-1.5">
          <Plus size={15} /> Add Department
        </Button>
      </div>

      {/* Filters — same pattern as Users page */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-[360px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search departments…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[145px]"><SelectValue placeholder="All Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>

        <button
          onClick={() => { setSearch(''); setStatusFilter('active') }}
          disabled={search === '' && statusFilter === 'active'}
          className="ml-auto text-[12px] font-medium text-primary hover:underline disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Reset Filters
        </button>
      </div>

      {/* Count */}
      <p className="text-[13px] text-muted-foreground">
        Showing {departments.length} of {allDepartments.length} departments
      </p>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <Table>
          <TableHeader>
            <StandardTableHeaderRow>
              <DeptSortHead field="department_name" sortField={sortField} sortDir={sortDir} onSort={deptSort}>Department</DeptSortHead>
              <TableHead className="py-4">Users</TableHead>
              <TableHead className="py-4">Managers</TableHead>
              <DeptSortHead field="is_active" sortField={sortField} sortDir={sortDir} onSort={deptSort}>Status</DeptSortHead>
              <TableHead className="py-4 w-[80px]" />
            </StandardTableHeaderRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">Loading…</TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow><TableCell colSpan={5} className="py-4"><TableErrorState message="Failed to load departments." onRetry={refetch} /></TableCell></TableRow>
            ) : departments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">No departments found</TableCell>
              </TableRow>
            ) : departments.map(d => (
              <TableRow key={d.id} className="hover:bg-slate-50/50">
                <TableCell className="font-medium text-[14px]">{d.department_name}</TableCell>
                <TableCell className="text-[13px] text-slate-600">{d.user_count ?? 0}</TableCell>
                <TableCell className="text-[13px] text-slate-600">
                  {d.managers && d.managers.length > 0
                    ? d.managers.map(m => m.manager_name).join(', ')
                    : <span className="text-muted-foreground">—</span>
                  }
                </TableCell>
                <TableCell>
                  <button
                    className="flex items-center gap-1.5 text-[12px]"
                    onClick={() => toggleMutation.mutate({ id: d.id, active: !d.is_active })}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${d.is_active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                    <span className={d.is_active ? 'text-emerald-700' : 'text-slate-500'}>
                      {d.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </button>
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]" onClick={() => openEdit(d)}>
                    <Pencil size={12} className="mr-1" /> Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto" aria-describedby={undefined}>
          <SheetHeader className="pb-4">
            <SheetTitle>{isCreate ? 'Add Department' : `Edit: ${editDept?.department_name}`}</SheetTitle>
          </SheetHeader>

          {apiError && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2.5 mb-4 text-[13px]">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              {apiError}
            </div>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">

              <FormField control={form.control} name="department_name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Department Name</FormLabel>
                  <FormControl><Input placeholder="e.g. Customer Service" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {/* Manager assignment */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Assigned Managers</Label>

                {/* Selected chips — shown above the dropdown */}
                {selectedIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedIds.map(id => {
                      const m = managers.find(u => Number(u.id) === Number(id))
                      if (!m) return null
                      return (
                        <span
                          key={id}
                          className="flex items-center gap-1 bg-primary/10 text-primary text-[12px] font-medium px-2.5 py-1 rounded-full"
                        >
                          {m.username ?? '—'}
                          <button
                            type="button"
                            onClick={() => removeManager(id)}
                            className="hover:text-red-500 ml-0.5 leading-none"
                          >
                            <X size={11} />
                          </button>
                        </span>
                      )
                    })}
                  </div>
                )}

                {/* Multi-select dropdown — stays open until closed */}
                <DropdownMenu
                  open={managerDropdownOpen}
                  onOpenChange={open => { setManagerDropdownOpen(open); if (!open) setManagerQuery('') }}
                >
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-between font-normal text-[13px]"
                    >
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Users size={14} />
                        {managerTriggerLabel}
                      </span>
                      <ChevronDown size={13} className="shrink-0 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>

                  <DropdownMenuContent
                    className="w-[--radix-dropdown-menu-trigger-width]"
                    onInteractOutside={() => { setManagerDropdownOpen(false); setManagerQuery('') }}
                  >
                    {/* Search inside the dropdown */}
                    <div className="px-2 pt-2 pb-1">
                      <div className="relative">
                        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                        <Input
                          placeholder="Search managers…"
                          value={managerQuery}
                          onChange={e => setManagerQuery(e.target.value)}
                          className="pl-8 h-8 text-[13px]"
                          onKeyDown={e => e.stopPropagation()}
                        />
                      </div>
                    </div>

                    {/* Manager list with checkboxes */}
                    <div className="max-h-[200px] overflow-y-auto">
                      {visibleManagers.length === 0 ? (
                        <p className="text-[12px] text-muted-foreground px-3 py-2">No managers found</p>
                      ) : visibleManagers.map(m => (
                        <DropdownMenuCheckboxItem
                          key={m.id}
                          checked={selectedIds.map(Number).includes(Number(m.id))}
                          onCheckedChange={() => toggleManager(m.id)}
                          onSelect={e => e.preventDefault()}
                        >
                          {m.username ?? '—'}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Active/Inactive toggle — edit only */}
              {!isCreate && (
                <FormField control={form.control} name="is_active" render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <FormLabel className="text-[13px] font-medium">Department Active</FormLabel>
                      <p className="text-[12px] text-muted-foreground">Inactive departments are hidden from assignments</p>
                    </div>
                    <FormControl>
                      <button
                        type="button"
                        onClick={() => field.onChange(!field.value)}
                        className={`w-10 h-5 rounded-full transition-colors relative ${field.value ? 'bg-primary' : 'bg-slate-300'}`}
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
                  {isBusy ? 'Saving…' : isCreate ? 'Create' : 'Save Changes'}
                </Button>
              </div>
            </form>
          </Form>
        </SheetContent>
      </Sheet>

    </div>
  )
}

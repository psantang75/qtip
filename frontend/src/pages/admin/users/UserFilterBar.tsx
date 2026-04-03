import { useState } from 'react'
import { Search, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu, DropdownMenuCheckboxItem,
  DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Role, Department } from '@/services/userService'

interface Props {
  search:         string
  onSearchChange: (v: string) => void
  roles:          Role[]
  departments:    Department[]
  selectedRoles:  number[]
  selectedDepts:  number[]
  statusFilter:   string
  onApplyRoles:   (ids: number[]) => void
  onApplyDepts:   (ids: number[]) => void
  onStatusChange: (v: string) => void
  onReset:        () => void
}

const STATUS_LABELS: Record<string, string> = { all: 'All Status', active: 'Active', inactive: 'Inactive' }
const ROLE_NAMES: Record<number, string>    = { 1: 'Admin', 2: 'QA', 3: 'CSR', 4: 'Trainer', 5: 'Manager', 6: 'Director' }

export { ROLE_NAMES }

export function UserFilterBar({
  search, onSearchChange, roles, departments,
  selectedRoles, selectedDepts, statusFilter,
  onApplyRoles, onApplyDepts, onStatusChange, onReset,
}: Props) {
  const [pendingRoles, setPendingRoles] = useState<number[]>([])
  const [pendingDepts, setPendingDepts] = useState<number[]>([])
  const [rolesOpen,    setRolesOpen]    = useState(false)
  const [deptsOpen,    setDeptsOpen]    = useState(false)

  const roleBtnLabel = selectedRoles.length === 0 ? 'All Roles'
    : selectedRoles.length === 1 ? (ROLE_NAMES[selectedRoles[0]] ?? 'Role')
    : `${selectedRoles.length} Roles`

  const deptBtnLabel = selectedDepts.length === 0 ? 'All Departments'
    : selectedDepts.length === 1 ? (departments.find(d => d.id === selectedDepts[0])?.department_name ?? 'Dept')
    : `${selectedDepts.length} Departments`

  const isFiltered = selectedRoles.length > 0 || selectedDepts.length > 0 || statusFilter !== 'active' || search !== ''

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-3">
      {/* Search */}
      <div className="relative flex-1 min-w-[280px] max-w-[400px]">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input placeholder="Search name or email…" value={search}
          onChange={e => onSearchChange(e.target.value)} className="pl-10" />
      </div>

      {/* Roles */}
      <DropdownMenu open={rolesOpen} onOpenChange={open => { if (open) setPendingRoles([...selectedRoles]); setRolesOpen(open) }}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="w-[175px] justify-between font-normal">
            <span className="truncate">{roleBtnLabel}</span>
            <ChevronDown size={13} className="ml-1 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[175px]" onInteractOutside={() => setRolesOpen(false)}>
          {roles.map(r => (
            <DropdownMenuCheckboxItem key={r.id} checked={pendingRoles.includes(r.id)}
              onCheckedChange={c => setPendingRoles(p => c ? [...p, r.id] : p.filter(id => id !== r.id))}
              onSelect={e => e.preventDefault()}>
              {r.role_name}
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <div className="flex gap-2 px-2 py-2">
            <Button variant="outline" size="sm" className="flex-1 h-7 text-[12px]" onClick={() => setPendingRoles([])}>Reset</Button>
            <Button size="sm" className="flex-1 h-7 text-[12px]" onClick={() => { onApplyRoles(pendingRoles); setRolesOpen(false) }}>Apply</Button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Departments */}
      <DropdownMenu open={deptsOpen} onOpenChange={open => { if (open) setPendingDepts([...selectedDepts]); setDeptsOpen(open) }}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="w-[195px] justify-between font-normal">
            <span className="truncate">{deptBtnLabel}</span>
            <ChevronDown size={13} className="ml-1 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[195px]" onInteractOutside={() => setDeptsOpen(false)}>
          {departments.map(d => (
            <DropdownMenuCheckboxItem key={d.id} checked={pendingDepts.includes(d.id)}
              onCheckedChange={c => setPendingDepts(p => c ? [...p, d.id] : p.filter(id => id !== d.id))}
              onSelect={e => e.preventDefault()}>
              {d.department_name}
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <div className="flex gap-2 px-2 py-2">
            <Button variant="outline" size="sm" className="flex-1 h-7 text-[12px]" onClick={() => setPendingDepts([])}>Reset</Button>
            <Button size="sm" className="flex-1 h-7 text-[12px]" onClick={() => { onApplyDepts(pendingDepts); setDeptsOpen(false) }}>Apply</Button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Status */}
      <Select value={statusFilter} onValueChange={onStatusChange}>
        <SelectTrigger className="w-[145px]">
          <SelectValue>{STATUS_LABELS[statusFilter]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="inactive">Inactive</SelectItem>
        </SelectContent>
      </Select>

      <Button variant="link" size="sm" onClick={onReset} disabled={!isFiltered}
        className="ml-auto text-[12px] h-auto px-0 disabled:opacity-30">
        Reset Filters
      </Button>
    </div>
  )
}

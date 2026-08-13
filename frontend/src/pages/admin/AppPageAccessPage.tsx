import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Lock } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/utils/errorHandling'
import {
  listAppPages, updateAppPageAccess,
  type AppPageAdmin, type AppPageAdminGrant, type AppAccessLevel,
} from '@/services/appAccessService'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

/**
 * Admin > Page Access
 *
 * DB-driven role access for non-Insights sections (Quality, Training,
 * Performance Warnings). Each page/role gets ONE access level on a 4-rung
 * ladder, which drives the sidebar, route guards and APIs in lockstep:
 *
 *   None        — hidden everywhere
 *   Own only    — their own records (the "My X" self view) — self pages only
 *   View all    — everyone's records, read-only
 *   View & edit — everyone's records + create / edit / delete
 *
 * Page rows are added via migration, not from this UI. CSR is capped at
 * "Own only" here (and self-scoped again at the data layer regardless).
 */

/** Display-friendly section labels (DB stores lowercase). */
const SECTION_LABELS: Record<string, string> = {
  quality:             'Quality',
  training:            'Training',
  performancewarnings: 'Performance Warnings',
}
const sectionLabel = (s: string) => SECTION_LABELS[s] ?? s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Section display order in this screen. The backend returns rows sorted
 * alphabetically by section (`performancewarnings`, `quality`, `training`),
 * which doesn't match the UX order users expect (mirrors the top-bar
 * tab order: Quality → Training → Performance Warnings). Anything not in
 * this list falls to the end, in alphabetical order.
 */
const SECTION_ORDER = ['quality', 'training', 'performancewarnings']
const sectionRank = (s: string) => {
  const i = SECTION_ORDER.indexOf(s)
  return i === -1 ? Number.MAX_SAFE_INTEGER : i
}

// Mirror the `roles` table. Adding an id here that isn't a real role row
// will FK-fail when saving (see AppPermissionService.updatePageAccess).
// Director (id 6) was removed from the system — do not re-add without
// also re-seeding the `roles` table.
const ROLES = [
  { id: 1, name: 'Admin' },
  { id: 2, name: 'QA' },
  { id: 3, name: 'CSR' },
  { id: 4, name: 'Trainer' },
  { id: 5, name: 'Manager' },
]

const CSR_ROLE_ID = 3

/**
 * Per-page, per-role notes shown under a specific role's access dropdown. Use
 * this when a page's data layer applies an intentional scope for that role that
 * the level dropdown alone can't express — so an admin doesn't pick "View all"
 * and assume the system is broken when not every record appears. The
 * enforcement still lives in the backend service; this is the documented,
 * admin-facing acknowledgement of it. Keyed by page_key → role_id.
 */
const PAGE_ROLE_NOTES: Record<string, Record<number, string>> = {
  quality_disputes: {
    2: 'QA reviewers only see disputes on audits they personally submitted, and only after the dispute has been adjusted/resolved.',
  },
}

export default function AppPageAccessPage() {
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const { data: rawPages = [], isLoading } = useQuery({
    queryKey: ['app-pages'],
    queryFn:  listAppPages,
  })

  // Re-sort into the UX order (Quality → Training → Performance Warnings),
  // keeping per-section `sort_order` from the backend as the secondary key.
  const pages = [...rawPages].sort((a, b) => {
    const ra = sectionRank(a.section)
    const rb = sectionRank(b.section)
    if (ra !== rb) return ra - rb
    return a.sort_order - b.sort_order
  })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Page Access</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage per-role access for every page outside the Insights section.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/60">
              <TableHead className="w-8" />
              <TableHead className="py-4">Section</TableHead>
              <TableHead className="py-4">Page Name</TableHead>
              <TableHead className="py-4">Page Key</TableHead>
              <TableHead className="py-4">Route</TableHead>
              <TableHead className="py-4">Active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : pages.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">No pages registered yet.</TableCell></TableRow>
            ) : pages.map(p => (
              <React.Fragment key={p.id}>
                <TableRow className="hover:bg-slate-50/50 cursor-pointer" onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}>
                  <TableCell>{expandedId === p.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</TableCell>
                  <TableCell className="text-[13px] font-semibold text-slate-700">{sectionLabel(p.section)}</TableCell>
                  <TableCell className="font-medium text-[14px]">{p.page_name}</TableCell>
                  <TableCell className="font-mono text-[12px] text-slate-500">{p.page_key}</TableCell>
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

/** Human label for each access level (the editor dropdown options). */
const LEVEL_LABEL: Record<AppAccessLevel, string> = {
  NONE: 'No access',
  OWN:  'Own only',
  ALL:  'View all',
  EDIT: 'View & edit',
}

/** Short verb phrase used in the plain-language summary. */
const LEVEL_SUMMARY: Record<AppAccessLevel, string> = {
  NONE: 'no access',
  OWN:  'see only their own',
  ALL:  'view everyone’s',
  EDIT: 'view & edit everyone’s',
}

function PageDetailSection({ page }: { page: AppPageAdmin }) {
  const qc = useQueryClient()
  const { toast } = useToast()

  const [edits, setEdits] = useState<Record<number, AppAccessLevel>>(() => {
    const map: Record<number, AppAccessLevel> = {}
    for (const r of ROLES) {
      map[r.id] = page.grants.find(g => g.role_id === r.id)?.access_level ?? 'NONE'
    }
    return map
  })

  const mut = useMutation({
    mutationFn: () => {
      const grants: AppPageAdminGrant[] = ROLES.map(r => ({
        role_id:      r.id,
        access_level: edits[r.id],
      }))
      return updateAppPageAccess(page.id, grants)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['app-pages'] }); qc.invalidateQueries({ queryKey: ['app-navigation'] }); toast({ title: 'Access updated' }) },
    onError: (e: Error) => toast({
      variant: 'destructive',
      title: "Couldn't save access",
      description: getErrorMessage(e, 'Try again.'),
    }),
  })

  // CSR is capped at None / Own. "Own only" is offered on self-supporting pages
  // (the "My X" self-view) AND on pages that already grant CSR OWN — i.e.
  // department-scoped read-only views like Call Campaigns, where a CSR sees
  // their own department's data on the shared page (no separate self-route).
  // Without this, such a seeded grant is invisible here and silently wiped on
  // the next save (the backend applies the same rule).
  const csrOwnAllowed =
    page.supports_self ||
    page.grants.some(g => g.role_id === CSR_ROLE_ID && g.access_level === 'OWN')

  // Levels available for a given role on this page.
  function optionsFor(roleId: number): AppAccessLevel[] {
    if (roleId === CSR_ROLE_ID) {
      return csrOwnAllowed ? ['NONE', 'OWN'] : ['NONE']
    }
    return page.supports_self ? ['NONE', 'OWN', 'ALL', 'EDIT'] : ['NONE', 'ALL', 'EDIT']
  }

  function setLevel(roleId: number, level: AppAccessLevel) {
    setEdits(prev => ({ ...prev, [roleId]: level }))
  }

  // Plain-language summary of who can do what (granted roles only).
  const summary = ROLES
    .filter(r => edits[r.id] !== 'NONE')
    .map(r => `${r.name} ${LEVEL_SUMMARY[edits[r.id]]}`)

  const roleNotes = PAGE_ROLE_NOTES[page.page_key]

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-700">Role Access</h4>
        <Button size="sm" variant="outline" className="h-7 text-[12px]" onClick={() => mut.mutate()} disabled={mut.isPending}>
          {mut.isPending ? 'Saving...' : 'Save Access'}
        </Button>
      </div>

      <p className="text-[12.5px] text-slate-600">
        {summary.length === 0
          ? 'No role can access this page.'
          : <>On this page, {summary.join('; ')}.</>}
      </p>

      <Table>
        <TableHeader>
          <TableRow className="bg-white">
            <TableHead className="py-2 text-[12px]">Role</TableHead>
            <TableHead className="py-2 text-[12px]">Access Level</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ROLES.map(r => {
            const csrLocked = r.id === CSR_ROLE_ID
            return (
              <TableRow key={r.id}>
                <TableCell className="text-[13px] font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    {r.name}
                    {csrLocked && <Lock size={12} className="text-slate-400" aria-label="CSR is always self-scoped at the data layer" />}
                  </span>
                </TableCell>
                <TableCell>
                  <Select value={edits[r.id]} onValueChange={(v) => setLevel(r.id, v as AppAccessLevel)}>
                    <SelectTrigger className="h-8 w-[150px] text-[13px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {optionsFor(r.id).map(level => (
                        <SelectItem key={level} value={level} className="text-[13px]">
                          {LEVEL_LABEL[level]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {roleNotes?.[r.id] && (
                    <p className="mt-1.5 text-[11.5px] leading-snug text-slate-500">
                      {roleNotes[r.id]}
                    </p>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

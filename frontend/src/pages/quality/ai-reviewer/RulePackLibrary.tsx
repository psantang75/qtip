/**
 * RulePackLibrary — admin page to author + manage AI Reviewer rule packs.
 *
 * Rule packs are reusable bodies of policy/process text that get
 * injected into the AI Reviewer system prompt for any form they're
 * assigned to. They're authored here by department leads and assigned
 * to specific forms via the chip picker on the AI Reviewer Form Detail
 * page (which keeps its existing API).
 *
 * Replaces the file-based `backend/prompts/rule-packs/*.md` convention
 * (now stored in `ai_rule_pack` per migration 20260513100000).
 *
 * Patterns followed:
 *   - TanStack Table for the list (per the design rule: never roll a
 *     custom data table)
 *   - shadcn Sheet for the editor drawer
 *   - shadcn Switch for the "Show archived" toggle
 *   - Brand tokens (`bg-primary`, `text-destructive`, etc.) — no hex
 *     values outside the existing palette
 *   - lucide-react for icons; no emojis
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import {
  Archive,
  ArrowLeft,
  Library,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  X,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import aiReviewerService, {
  type RulePack,
  type RulePackUpsertPayload,
} from '@/services/aiReviewerService'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { useToast } from '@/hooks/use-toast'

type EditorState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; pack: RulePack }

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function RulePackLibrary() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [showArchived, setShowArchived] = useState(false)
  const [editor, setEditor] = useState<EditorState>({ mode: 'closed' })
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }])

  const packsQ = useQuery({
    queryKey: ['ai-reviewer-rule-packs', showArchived],
    queryFn: () => aiReviewerService.listAllRulePacks(showArchived),
    staleTime: 30 * 1000,
  })

  const archiveMut = useMutation({
    mutationFn: (id: number) => aiReviewerService.archiveRulePack(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-reviewer-rule-packs'] })
      toast({ title: 'Pack archived' })
    },
    onError: (e: any) =>
      toast({ title: 'Archive failed', description: e?.message, variant: 'destructive' }),
  })

  const restoreMut = useMutation({
    mutationFn: (id: number) => aiReviewerService.restoreRulePack(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-reviewer-rule-packs'] })
      toast({ title: 'Pack restored' })
    },
    onError: (e: any) =>
      toast({ title: 'Restore failed', description: e?.message, variant: 'destructive' }),
  })

  const columns = useMemo<ColumnDef<RulePack>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="font-medium text-neutral-900">{row.original.name}</div>
            <div className="font-mono text-xs text-neutral-700">{row.original.key}</div>
          </div>
        ),
      },
      {
        accessorKey: 'owner_dept',
        header: 'Owner dept',
        cell: ({ getValue }) => (
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-neutral-700">
            {getValue<string>()}
          </span>
        ),
      },
      {
        accessorKey: 'updated_at',
        header: 'Updated',
        cell: ({ getValue }) => (
          <span className="text-xs text-neutral-700">{fmtDate(getValue<string>())}</span>
        ),
      },
      {
        accessorKey: 'is_archived',
        header: 'Status',
        cell: ({ getValue }) =>
          getValue<boolean>() ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
              <Archive className="h-3 w-3" />
              Archived
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
              Active
            </span>
          ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditor({ mode: 'edit', pack: row.original })}>
              <Pencil className="mr-1 h-3 w-3" />
              Edit
            </Button>
            {row.original.is_archived ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => restoreMut.mutate(row.original.id)}
                disabled={restoreMut.isPending}
              >
                <RotateCcw className="mr-1 h-3 w-3" />
                Restore
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => archiveMut.mutate(row.original.id)}
                disabled={archiveMut.isPending}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Archive className="mr-1 h-3 w-3" />
                Archive
              </Button>
            )}
          </div>
        ),
      },
    ],
    [archiveMut, restoreMut],
  )

  const table = useReactTable({
    data: packsQ.data ?? [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <Link
            to="/app/quality/ai-reviewer"
            className="mb-2 inline-flex items-center gap-1 text-xs text-neutral-700 hover:text-primary"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to AI Reviewer forms
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-neutral-900">
            <Library className="h-6 w-6 text-primary" />
            Rule pack library
          </h1>
          <p className="mt-1 text-sm text-neutral-700">
            Author the policy / process text the AI Reviewer uses when
            grading. Form admins assign packs to specific forms via the
            chip picker on each form{`'`}s AI Reviewer page.
          </p>
        </div>
        <Button onClick={() => setEditor({ mode: 'create' })} className="bg-primary text-white hover:bg-primary/90">
          <Plus className="mr-1 h-4 w-4" />
          New rule pack
        </Button>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="text-sm text-neutral-700">
            {packsQ.data?.length ?? 0} pack{packsQ.data?.length === 1 ? '' : 's'}
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-neutral-700">
            <Switch checked={showArchived} onCheckedChange={setShowArchived} />
            Show archived
          </label>
        </div>

        {packsQ.isLoading && (
          <div className="flex items-center gap-2 text-sm text-neutral-700">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}

        {packsQ.isError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            Failed to load rule packs.
          </div>
        )}

        {!packsQ.isLoading && !packsQ.isError && (packsQ.data?.length ?? 0) === 0 && (
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-neutral-700">
            No rule packs yet. Click {`"New rule pack"`} above to author one.
          </div>
        )}

        {(packsQ.data?.length ?? 0) > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id} className="border-b border-slate-200 text-left">
                    {hg.headers.map((h) => (
                      <th
                        key={h.id}
                        className="cursor-pointer select-none pb-2 pr-4 text-xs font-semibold uppercase tracking-wide text-neutral-700"
                        onClick={h.column.getToggleSortingHandler()}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="py-3 pr-4 align-top">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <RulePackEditorSheet
        state={editor}
        onClose={() => setEditor({ mode: 'closed' })}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ['ai-reviewer-rule-packs'] })
          setEditor({ mode: 'closed' })
        }}
      />
    </div>
  )
}

interface RulePackEditorSheetProps {
  state: EditorState
  onClose: () => void
  onSaved: () => void
}

function RulePackEditorSheet({ state, onClose, onSaved }: RulePackEditorSheetProps) {
  const { toast } = useToast()
  const isCreate = state.mode === 'create'
  const isEdit = state.mode === 'edit'
  const open = isCreate || isEdit
  const initial = isEdit ? state.pack : null

  const [keyValue, setKeyValue] = useState('')
  const [name, setName] = useState('')
  const [ownerDept, setOwnerDept] = useState('')
  const [bodyMd, setBodyMd] = useState('')
  const [urlsText, setUrlsText] = useState('')

  // Reseed the form fields whenever the editor target changes
  // (closed → create, create → edit a different pack, etc.).
  const stateKey = isEdit ? `edit:${state.pack.id}` : isCreate ? 'create' : 'closed'
  const lastStateKey = useRef<string | null>(null)
  useEffect(() => {
    if (lastStateKey.current === stateKey) return
    lastStateKey.current = stateKey
    setKeyValue(initial?.key ?? '')
    setName(initial?.name ?? '')
    setOwnerDept(initial?.owner_dept ?? '')
    setBodyMd(initial?.body ?? '')
    setUrlsText((initial?.always_include_urls ?? []).join('\n'))
    // initial is intentionally derived from stateKey so both move in lockstep
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey])

  const saveMut = useMutation({
    mutationFn: (payload: RulePackUpsertPayload) =>
      isEdit
        ? aiReviewerService.updateRulePack(state.pack.id, payload)
        : aiReviewerService.createRulePack(payload),
    onSuccess: (pack) => {
      toast({ title: isEdit ? 'Pack updated' : `Pack created (${pack.key})` })
      onSaved()
    },
    onError: (e: any) =>
      toast({
        title: 'Save failed',
        description: e?.response?.data?.error ?? e?.message,
        variant: 'destructive',
      }),
  })

  function handleSave() {
    const urls = urlsText
      .split(/\r?\n/)
      .map((u) => u.trim())
      .filter((u) => u.length > 0)
    saveMut.mutate({
      ...(isCreate ? { key: keyValue.trim() } : {}),
      name: name.trim(),
      owner_dept: ownerDept.trim(),
      body_md: bodyMd,
      always_include_urls: urls,
    })
  }

  return (
    <Sheet open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{isEdit ? `Edit ${initial?.name ?? ''}` : 'New rule pack'}</SheetTitle>
          <SheetDescription>
            Pack body markdown is rendered into the AI Reviewer system
            prompt verbatim. Keep instructions specific and bullet-listed
            so the model can attribute each rule.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="rp-key">Key</Label>
              <Input
                id="rp-key"
                value={keyValue}
                onChange={(e) => setKeyValue(e.target.value)}
                placeholder="tech-ticket-process"
                disabled={isEdit}
                className="font-mono"
              />
              <p className="mt-1 text-xs text-neutral-700">
                {isEdit
                  ? 'Key is immutable post-creation (referenced by chip-picker assignments).'
                  : 'Lowercase, dashes only. e.g. tech-ticket-process'}
              </p>
            </div>
            <div>
              <Label htmlFor="rp-owner">Owner dept</Label>
              <Input
                id="rp-owner"
                value={ownerDept}
                onChange={(e) => setOwnerDept(e.target.value)}
                placeholder="Tech Support"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="rp-name">Display name</Label>
            <Input
              id="rp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tech Ticket Process"
            />
          </div>

          <div>
            <Label htmlFor="rp-body">Body markdown</Label>
            <Textarea
              id="rp-body"
              value={bodyMd}
              onChange={(e) => setBodyMd(e.target.value)}
              rows={20}
              className="font-mono text-xs"
              placeholder={'Description grading:\n- ...\n\nClass / Subclass evaluation:\n- ...'}
            />
          </div>

          <div>
            <Label htmlFor="rp-urls">Always-include KB URLs (one per line, optional)</Label>
            <Textarea
              id="rp-urls"
              value={urlsText}
              onChange={(e) => setUrlsText(e.target.value)}
              rows={4}
              className="font-mono text-xs"
              placeholder="http://know.crm.dm-us.com/books/.../page/handling-process"
            />
            <p className="mt-1 text-xs text-neutral-700">
              These KB pages are loaded into the prompt for every run on
              forms that have this pack assigned.
            </p>
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
            <Button variant="outline" onClick={onClose} disabled={saveMut.isPending}>
              <X className="mr-1 h-4 w-4" />
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saveMut.isPending}
              className="bg-primary text-white hover:bg-primary/90"
            >
              {saveMut.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1 h-4 w-4" />
              )}
              Save
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

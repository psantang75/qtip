/**
 * BasePromptLibrary — admin page to author + manage the AI Reviewer
 * Base prompt (layer 1 of the 4-layer system-prompt model).
 *
 * Mirrors RulePackLibrary (same shadcn primitives, same table pattern,
 * same editor sheet) so admins moving between the two pages see one
 * consistent surface.
 *
 * Only `kind='base'` rows are shown. The Trace prompt
 * (`kind='trace'`) is INFRASTRUCTURE — engineers edit it via PR or DB
 * — and is rendered read-only inside the optional "Advanced
 * (engineering)" section at the bottom.
 *
 * History + rollback live in BasePromptVersionHistory (separate file
 * to keep this one under the 200-300 LoC ceiling per project rules).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { getErrorMessage } from '@/utils/errorHandling'
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
  ChevronDown,
  ChevronRight,
  History,
  Library,
  Loader2,
  Pencil,
  Plus,
  Save,
  Star,
  X,
} from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import aiReviewerService, {
  type BasePromptDetail,
  type BasePromptKind,
  type BasePromptSummary,
  type BasePromptUpsertPayload,
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
import { BasePromptVersionHistory } from './BasePromptVersionHistory'

type EditorState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; base: BasePromptDetail }

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const KIND_LABEL: Record<BasePromptKind, string> = {
  base: 'Base prompt',
  trace: 'Trace (Pass 1, infrastructure)',
}

export default function BasePromptLibrary() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [params] = useSearchParams()
  const preselectId = params.get('base')

  const [showArchived, setShowArchived] = useState(false)
  const [editor, setEditor] = useState<EditorState>({ mode: 'closed' })
  const [historyFor, setHistoryFor] = useState<BasePromptDetail | null>(null)
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }])

  // Library only surfaces the admin-editable Base prompt; the trace
  // prompt is rendered separately under "Advanced (engineering)".
  const basesQ = useQuery({
    queryKey: ['ai-reviewer-base-prompts', 'base', showArchived],
    queryFn: () => aiReviewerService.listBasePrompts({ kind: 'base', includeArchived: showArchived }),
    staleTime: 30 * 1000,
  })

  // Honour `?base=<id>` query param: open the editor for that base on
  // first load, after the list has resolved.
  const preselectHandled = useRef(false)
  useEffect(() => {
    if (preselectHandled.current || !preselectId || !basesQ.data) return
    const id = Number(preselectId)
    if (!Number.isFinite(id) || id <= 0) return
    const summary = basesQ.data.find((b) => b.id === id)
    if (!summary) return
    preselectHandled.current = true
    void aiReviewerService.getBasePrompt(id).then((detail) => setEditor({ mode: 'edit', base: detail }))
  }, [preselectId, basesQ.data])

  const archiveMut = useMutation({
    mutationFn: (id: number) => aiReviewerService.archiveBasePrompt(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-reviewer-base-prompts'] })
      toast({ title: 'Base prompt archived' })
    },
    onError: (e) =>
      toast({
        variant: 'destructive',
        title: "Couldn't archive base prompt",
        description: getErrorMessage(e, 'Try again.'),
      }),
  })

  const setDefaultMut = useMutation({
    mutationFn: (id: number) => aiReviewerService.setBasePromptDefault(id),
    onSuccess: (next) => {
      qc.invalidateQueries({ queryKey: ['ai-reviewer-base-prompts'] })
      qc.invalidateQueries({ queryKey: ['ai-reviewer-prompt-preview'] })
      toast({
        title: 'Default updated',
        description: `${next.key} is now the default for ${KIND_LABEL[next.prompt_kind]}.`,
      })
    },
    onError: (e) =>
      toast({
        variant: 'destructive',
        title: "Couldn't set default",
        description: getErrorMessage(e, 'Try again.'),
      }),
  })

  async function openEditor(id: number) {
    const detail = await aiReviewerService.getBasePrompt(id)
    if (detail) setEditor({ mode: 'edit', base: detail })
  }

  async function openHistory(id: number) {
    const detail = await aiReviewerService.getBasePrompt(id)
    if (detail) setHistoryFor(detail)
  }

  const columns = useMemo<ColumnDef<BasePromptSummary>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-neutral-900">{row.original.name}</span>
              {row.original.is_default && (
                <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
                  <Star className="h-2.5 w-2.5" />
                  Default
                </span>
              )}
            </div>
            <div className="font-mono text-xs text-neutral-700">
              {row.original.key}
              {row.original.current_version != null ? ` v${row.original.current_version}` : ''}
            </div>
          </div>
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
            <Button size="sm" variant="outline" onClick={() => openHistory(row.original.id)}>
              <History className="mr-1 h-3 w-3" />
              History
            </Button>
            {!row.original.is_default && !row.original.is_archived && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDefaultMut.mutate(row.original.id)}
                disabled={setDefaultMut.isPending}
              >
                <Star className="mr-1 h-3 w-3" />
                Set default
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => openEditor(row.original.id)}>
              <Pencil className="mr-1 h-3 w-3" />
              Edit
            </Button>
            {!row.original.is_archived && !row.original.is_default && (
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
    // openEditor / openHistory are stable (no dependencies); mutations
    // are referenced via .isPending so they belong in the deps list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [archiveMut.isPending, setDefaultMut.isPending],
  )

  const table = useReactTable({
    data: basesQ.data ?? [],
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
            Base prompt
          </h1>
          <p className="mt-1 text-sm text-neutral-700">
            The universal grading rules every AI review starts from. Common to every form, every department. The same
            Base body is concatenated with rule packs + per-form guidance + learned corrections at runtime.
          </p>
        </div>
        <Button onClick={() => setEditor({ mode: 'create' })} className="bg-primary text-white hover:bg-primary/90">
          <Plus className="mr-1 h-4 w-4" />
          New version
        </Button>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="text-sm text-neutral-700">
            {basesQ.data?.length ?? 0} base{basesQ.data?.length === 1 ? '' : 's'}
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-neutral-700">
            <Switch checked={showArchived} onCheckedChange={setShowArchived} />
            Show archived
          </label>
        </div>

        {basesQ.isLoading && (
          <div className="flex items-center gap-2 text-sm text-neutral-700">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}

        {basesQ.isError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            Couldn't load base prompts. Refresh to try again.
          </div>
        )}

        {!basesQ.isLoading && !basesQ.isError && (basesQ.data?.length ?? 0) === 0 && (
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-neutral-700">
            No base prompts yet. Click {`"New base prompt"`} above to author one.
          </div>
        )}

        {(basesQ.data?.length ?? 0) > 0 && (
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

      <AdvancedTracePromptSection />

      <BasePromptEditorSheet
        state={editor}
        onClose={() => setEditor({ mode: 'closed' })}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ['ai-reviewer-base-prompts'] })
          qc.invalidateQueries({ queryKey: ['ai-reviewer-prompt-preview'] })
          setEditor({ mode: 'closed' })
        }}
      />

      <BasePromptVersionHistory
        open={historyFor != null}
        base={historyFor}
        onClose={() => setHistoryFor(null)}
        onRolledBack={() => setHistoryFor(null)}
      />
    </div>
  )
}

/**
 * Advanced (engineering) section — read-only view of the Trace prompt
 * (Pass 1 of the two-pass pipeline). Visible to admins so they can
 * inspect what the trace pass uses, but not editable from the UI;
 * engineers manage trace via PR or DB. Default collapsed because QA
 * admins do not need to think about this.
 */
function AdvancedTracePromptSection() {
  const [open, setOpen] = useState(false)
  const traceQ = useQuery({
    queryKey: ['ai-reviewer-base-prompts', 'trace'],
    queryFn: () => aiReviewerService.listBasePrompts({ kind: 'trace' }),
    enabled: open,
    staleTime: 60 * 1000,
  })
  const trace = (traceQ.data ?? [])[0] ?? null
  const detailQ = useQuery({
    queryKey: ['ai-reviewer-base-prompts', 'trace', 'detail', trace?.id ?? null],
    queryFn: () => (trace ? aiReviewerService.getBasePrompt(trace.id) : Promise.resolve(null)),
    enabled: open && trace != null,
    staleTime: 60 * 1000,
  })

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-2 px-4 py-3 text-left hover:bg-slate-50"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-slate-500 mt-0.5" />
        ) : (
          <ChevronRight className="h-4 w-4 text-slate-500 mt-0.5" />
        )}
        <div>
          <h2 className="text-[14px] font-semibold text-slate-900">Advanced (engineering)</h2>
          <p className="text-[12px] text-slate-500">
            The Trace prompt used for Pass 1 of the multi-source pipeline. Infrastructure-managed; not editable here.
          </p>
        </div>
      </button>

      {open && (
        <div className="p-4 border-t border-slate-100 space-y-3">
          {traceQ.isLoading && (
            <div className="text-[13px] text-slate-500 flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          )}
          {!traceQ.isLoading && !trace && (
            <div className="text-[13px] text-slate-500">No trace prompt found.</div>
          )}
          {trace && (
            <>
              <div className="flex items-center gap-2 text-[12px] text-slate-700">
                <span className="font-medium">{trace.name}</span>
                <span className="font-mono text-[11px] text-slate-500">
                  {trace.key}
                  {trace.current_version != null ? ` v${trace.current_version}` : ''}
                </span>
              </div>
              {detailQ.isLoading ? (
                <div className="text-[13px] text-slate-500 flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading body…
                </div>
              ) : detailQ.data ? (
                <pre className="max-h-[60vh] overflow-auto rounded-md border border-slate-200 bg-slate-900 text-slate-100 p-3 text-[11px] font-mono leading-relaxed whitespace-pre-wrap">
                  {detailQ.data.body}
                </pre>
              ) : null}
            </>
          )}
        </div>
      )}
    </section>
  )
}

interface BasePromptEditorSheetProps {
  state: EditorState
  onClose: () => void
  onSaved: () => void
}

function BasePromptEditorSheet({ state, onClose, onSaved }: BasePromptEditorSheetProps) {
  const { toast } = useToast()
  const isCreate = state.mode === 'create'
  const isEdit = state.mode === 'edit'
  const open = isCreate || isEdit
  const initial = isEdit ? state.base : null

  const [keyValue, setKeyValue] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  // The Library only ever creates / edits Base prompts. Trace prompts
  // are infrastructure — engineers manage them via PR or DB, not here.
  const promptKind: BasePromptKind = 'base'
  const [bodyMd, setBodyMd] = useState('')
  const [changeNote, setChangeNote] = useState('')
  const [setAsDefault, setSetAsDefault] = useState(false)

  const stateKey = isEdit ? `edit:${state.base.id}` : isCreate ? 'create' : 'closed'
  const lastStateKey = useRef<string | null>(null)
  useEffect(() => {
    if (lastStateKey.current === stateKey) return
    lastStateKey.current = stateKey
    setKeyValue(initial?.key ?? '')
    setName(initial?.name ?? '')
    setDescription(initial?.description ?? '')
    setBodyMd(initial?.body ?? '')
    setChangeNote('')
    setSetAsDefault(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey])

  const saveMut = useMutation({
    mutationFn: (payload: BasePromptUpsertPayload) =>
      isEdit
        ? aiReviewerService.updateBasePrompt(state.base.id, payload)
        : aiReviewerService.createBasePrompt(payload),
    onSuccess: (base) => {
      toast({
        title: isEdit ? `Saved v${base.current_version}` : `Created ${base.key}`,
      })
      onSaved()
    },
    onError: (e) =>
      toast({
        variant: 'destructive',
        title: "Couldn't save base prompt",
        description: getErrorMessage(e, 'Try again.'),
      }),
  })

  function handleSave() {
    saveMut.mutate({
      ...(isCreate ? { key: keyValue.trim() } : {}),
      name: name.trim(),
      description: description.trim() || null,
      prompt_kind: promptKind,
      body_md: bodyMd,
      change_note: changeNote.trim() || null,
      set_as_default: setAsDefault,
    })
  }

  return (
    <Sheet open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{isEdit ? `Edit ${initial?.name ?? ''}` : 'New base prompt'}</SheetTitle>
          <SheetDescription>
            Body markdown is rendered into the AI Reviewer system prompt verbatim. Saving creates a new version row;
            previous versions stay browsable from the History drawer.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <div>
            <Label htmlFor="bp-key">Key</Label>
            <Input
              id="bp-key"
              value={keyValue}
              onChange={(e) => setKeyValue(e.target.value)}
              placeholder="base.v2"
              disabled={isEdit}
              className="font-mono max-w-md"
            />
            <p className="mt-1 text-xs text-neutral-700">
              {isEdit
                ? 'Key is immutable post-creation (referenced by eval-run prompt hashes).'
                : 'Lowercase alphanumeric with dashes/dots/underscores. e.g. base.v2'}
            </p>
          </div>

          <div>
            <Label htmlFor="bp-name">Display name</Label>
            <Input
              id="bp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sales Discovery (single source)"
            />
          </div>

          <div>
            <Label htmlFor="bp-desc">Description (optional)</Label>
            <Input
              id="bp-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Used by sales discovery and warm-lead qualification forms."
            />
          </div>

          <div>
            <Label htmlFor="bp-body">Body markdown</Label>
            <Textarea
              id="bp-body"
              value={bodyMd}
              onChange={(e) => setBodyMd(e.target.value)}
              rows={20}
              className="font-mono text-[11px]"
              placeholder={'You are the Q-Tip AI Reviewer.\n\n...'}
            />
          </div>

          <div>
            <Label htmlFor="bp-note">Change note (optional)</Label>
            <Input
              id="bp-note"
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              placeholder="What changed in this version, in one sentence."
              maxLength={500}
            />
          </div>

          {!initial?.is_default && (
            <label className="inline-flex items-center gap-2 text-sm text-neutral-700">
              <Switch checked={setAsDefault} onCheckedChange={setSetAsDefault} />
              Set as the active Base prompt on save
            </label>
          )}

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

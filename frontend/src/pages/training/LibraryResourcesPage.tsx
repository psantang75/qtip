import { useState, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, FileText, Image, FileSpreadsheet, Film, Link, File } from 'lucide-react'
import trainingService, { type TrainingResource, type ResourceType } from '@/services/trainingService'
import { ResourceLink } from '@/components/training/ResourceLink'
import listService, { type ListItem } from '@/services/listService'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { QualityFilterBar } from '@/components/common/QualityFilterBar'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'
import { SortableTableHead } from '@/components/common/SortableTableHead'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { ListPagination } from '@/components/common/ListPagination'
import { StagedMultiSelect } from '@/components/common/StagedMultiSelect'
import { SearchableMultiSelect } from '@/components/common/SearchableMultiSelect'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { useListSort } from '@/hooks/useListSort'
import { cn } from '@/lib/utils'

// ── Resource type config ──────────────────────────────────────────────────────

const RESOURCE_TYPES: { value: ResourceType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'URL',        label: 'URL Link',    icon: Link            },
  { value: 'PDF',        label: 'PDF',         icon: FileText        },
  { value: 'IMAGE',      label: 'Image',       icon: Image           },
  { value: 'WORD',       label: 'Word Doc',    icon: FileText        },
  { value: 'POWERPOINT', label: 'PowerPoint',  icon: FileSpreadsheet },
  { value: 'EXCEL',      label: 'Excel',       icon: FileSpreadsheet },
  { value: 'VIDEO',      label: 'Video',       icon: Film            },
  { value: 'FILE',       label: 'Other File',  icon: File            },
]

const TYPE_MAP = Object.fromEntries(RESOURCE_TYPES.map(t => [t.value, t]))

function ResourceTypeBadge({ type }: { type: ResourceType }) {
  const cfg = TYPE_MAP[type] ?? TYPE_MAP['FILE']
  const Icon = cfg.icon
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-slate-500">
      <Icon className="h-3.5 w-3.5 shrink-0" /> {cfg.label}
    </span>
  )
}

// ── Form types ────────────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'active' | 'inactive'

interface ResourceForm {
  title: string
  resource_type: ResourceType
  url: string
  file: File | null
  description: string
  topic_ids: number[]
  is_active: boolean
}

const EMPTY: ResourceForm = {
  title: '', resource_type: 'URL', url: '', file: null, description: '', topic_ids: [], is_active: true,
}

function isValidUrl(url: string): boolean {
  try { new URL(url); return true } catch { return false }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LibraryResourcesPage() {
  const qc           = useQueryClient()
  const { toast }    = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [editing,      setEditing]      = useState<TrainingResource | null | {}>( null )
  const [form,         setForm]         = useState<ResourceForm>(EMPTY)
  const [urlErr,       setUrlErr]       = useState('')
  const [titleErr,     setTitleErr]     = useState('')
  const [search,       setSearch]       = useState('')
  const [statusFilter,  setStatusFilter]  = useState<StatusFilter>('active')
  const [topicFilter,   setTopicFilter]   = useState<string[]>([])
  const [page,          setPage]          = useState(1)
  const [pageSize,     setPageSize]     = useState(20)

  const { data: resData,   isLoading, isError, refetch } = useQuery({ queryKey: ['resources-all'], queryFn: () => trainingService.getResources({ limit: 200 }) })
  const { data: topicsData }           = useQuery({ queryKey: ['list-items', 'training_topic'], queryFn: () => listService.getItems('training_topic') })

  const allResources = resData?.items ?? []

  // Pre-topic filter: base for deriving available topic options (search + status only)
  const baseFiltered = useMemo(() => {
    let items = allResources
    if (search.trim()) {
      items = items.filter((r: TrainingResource) =>
        r.title.toLowerCase().includes(search.toLowerCase()) ||
        r.topic_names.some(n => n.toLowerCase().includes(search.toLowerCase())))
    }
    if (statusFilter === 'active')   items = items.filter((r: TrainingResource) => r.is_active)
    if (statusFilter === 'inactive') items = items.filter((r: TrainingResource) => !r.is_active)
    return items
  }, [allResources, search, statusFilter])

  const filtered = useMemo(() => {
    if (topicFilter.length === 0) return baseFiltered
    return baseFiltered.filter((r: TrainingResource) =>
      topicFilter.some(t => r.topic_names.includes(t)))
  }, [baseFiltered, topicFilter])

  const { sort, dir, toggle, sorted } = useListSort(filtered)
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const resources  = sorted.slice((page - 1) * pageSize, page * pageSize)

  const onSort = (field: string) => { toggle(field); setPage(1) }

  // All active topics — used in the add/edit dialog checkbox list
  const topics: ListItem[] = topicsData ?? []

  // Topic options: only topics present in the current search+status results
  const topicOptions = useMemo(() => {
    const present = new Set(baseFiltered.flatMap((r: TrainingResource) => r.topic_names))
    return [...present].sort()
  }, [baseFiltered])

  const hasFilters  = search.trim().length > 0 || statusFilter !== 'active' || topicFilter.length > 0

  const invalidate = () => qc.invalidateQueries({ queryKey: ['resources-all'] })

  const isOpen     = editing !== null
  const isCreate   = isOpen && !('id' in (editing as object))
  const editingRes = isOpen && !isCreate ? (editing as TrainingResource) : null

  const openCreate = () => { setEditing({}); setForm(EMPTY); setUrlErr(''); setTitleErr('') }
  const openEdit   = (r: TrainingResource) => {
    setEditing(r)
    setForm({ title: r.title, resource_type: r.resource_type, url: r.url ?? '', file: null,
              description: r.description ?? '', topic_ids: r.topic_ids ?? [], is_active: r.is_active })
    setUrlErr(''); setTitleErr('')
  }

  const saveMut = useMutation({
    mutationFn: async (f: ResourceForm) => {
      const payload: Partial<TrainingResource> & { file?: File } = {
        title: f.title, resource_type: f.resource_type,
        description: f.description || undefined, topic_ids: f.topic_ids, is_active: f.is_active,
        ...(f.resource_type === 'URL' ? { url: f.url } : {}),
        ...(f.file ? { file: f.file } : {}),
      }
      return editingRes
        ? trainingService.updateResource(editingRes.id, payload)
        : trainingService.createResource(payload)
    },
    onSuccess: () => { invalidate(); setEditing(null); toast({ title: editingRes ? 'Resource updated' : 'Resource added' }) },
    onError: (err: Error) => toast({ title: 'Save failed', description: err?.message, variant: 'destructive' }),
  })

  const handleSave = () => {
    let valid = true
    if (!form.title.trim()) { setTitleErr('Title is required'); valid = false } else setTitleErr('')
    if (form.resource_type === 'URL') {
      if (!form.url.trim() || !isValidUrl(form.url)) { setUrlErr('Enter a valid URL (https://...)'); valid = false } else setUrlErr('')
    } else {
      if (!form.file && isCreate) { setUrlErr('Please select a file to upload'); valid = false } else setUrlErr('')
    }
    if (!valid) return
    saveMut.mutate(form)
  }

  const sel = 'w-full h-9 px-3 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-primary/40'

  return (
    <QualityListPage>
      <QualityPageHeader title="Resources"
        actions={
          <Button className="bg-primary hover:bg-primary/90 text-white" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> Add Resource
          </Button>
        }
      />

      <QualityFilterBar
        search={search} onSearchChange={setSearch} searchPlaceholder="Search resources..."
        hasFilters={hasFilters}
        onReset={() => { setSearch(''); setStatusFilter('active'); setTopicFilter([]); setPage(1) }}
        resultCount={{ filtered: sorted.length, total: allResources.length }}
      >
        <StagedMultiSelect
          options={topicOptions}
          selected={topicFilter}
          onApply={v => { setTopicFilter(v); setPage(1) }}
          placeholder="All Topics"
          width="w-[280px]"
        />
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v as StatusFilter); setPage(1) }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </QualityFilterBar>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? <TableLoadingSkeleton rows={6} />
        : isError ? <TableErrorState message="Failed to load resources." onRetry={refetch} />
        : (
          <Table>
            <TableHeader>
              <StandardTableHeaderRow>
                <SortableTableHead field="title"         sort={sort} dir={dir} onSort={onSort}>Title</SortableTableHead>
                <SortableTableHead field="description"   sort={sort} dir={dir} onSort={onSort}>Description</SortableTableHead>
                <SortableTableHead field="resource_type" sort={sort} dir={dir} onSort={onSort}>Type</SortableTableHead>
                <TableHead>Topics</TableHead>
                <SortableTableHead field="is_active"     sort={sort} dir={dir} onSort={onSort}>Status</SortableTableHead>
                <TableHead className="w-20" />
              </StandardTableHeaderRow>
            </TableHeader>
            <TableBody>
              {resources.length === 0 ? (
                <TableEmptyState colSpan={6} title="No resources yet" description="Add your first knowledge base resource" />
              ) : resources.map((r: TrainingResource) => (
                <TableRow key={r.id} className="hover:bg-slate-50/50">
                  <TableCell><ResourceLink resource={r} /></TableCell>
                  <TableCell className="max-w-[220px]">
                    {r.description ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-[13px] text-slate-500 truncate block max-w-[220px] cursor-default">
                            {r.description}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent
                          className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 text-[13px] text-slate-700 shadow-lg"
                          sideOffset={6}
                        >
                          {r.description}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-[13px] text-slate-300">&mdash;</span>
                    )}
                  </TableCell>
                  <TableCell><ResourceTypeBadge type={r.resource_type} /></TableCell>
                  <TableCell className="max-w-[160px]">
                    {r.topic_names.length > 0 ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-[13px] text-slate-500 truncate block max-w-[160px] cursor-default">
                            {[...r.topic_names].sort().join(', ')}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent
                          className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
                          sideOffset={6}
                        >
                          <ul className="space-y-1">
                            {[...r.topic_names].sort().map(name => (
                              <li key={name} className="flex items-center gap-2 text-[13px] text-slate-700">
                                <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                {name}
                              </li>
                            ))}
                          </ul>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-[13px] text-slate-300">&mdash;</span>
                    )}
                  </TableCell>
                  <TableCell className="text-[13px] text-slate-600">{r.is_active ? 'Active' : 'Inactive'}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]" onClick={() => openEdit(r)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <ListPagination
        page={page}
        totalPages={totalPages}
        totalItems={sorted.length}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={s => { setPageSize(s); setPage(1) }}
        pageSizeOptions={[10, 20, 50]}
      />

      {/* Add / Edit Dialog */}
      <Dialog open={isOpen} onOpenChange={v => !v && setEditing(null)}>
        <DialogContent aria-describedby={undefined} className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isCreate ? 'Add Resource' : 'Edit Resource'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">

            <div>
              <label className="text-[12px] font-medium text-slate-700 block mb-1">Title <span className="text-red-500">*</span></label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Call Wrap-Up Guide" />
              {titleErr && <p className="text-[11px] text-red-600 mt-1">{titleErr}</p>}
            </div>

            <div>
              <label className="text-[12px] font-medium text-slate-700 block mb-1">Resource Type</label>
              <select className={sel} value={form.resource_type}
                onChange={e => setForm(f => ({ ...f, resource_type: e.target.value as ResourceType, url: '', file: null }))}>
                {RESOURCE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            {form.resource_type === 'URL' ? (
              <div>
                <label className="text-[12px] font-medium text-slate-700 block mb-1">URL <span className="text-red-500">*</span></label>
                <Input type="url" value={form.url}
                  onChange={e => { setForm(f => ({ ...f, url: e.target.value })); setUrlErr('') }}
                  onBlur={() => { if (form.url && !isValidUrl(form.url)) setUrlErr('Enter a valid URL (https://...)') }}
                  placeholder="https://..." />
                {urlErr && <p className="text-[11px] text-red-600 mt-1">{urlErr}</p>}
              </div>
            ) : (
              <div>
                <label className="text-[12px] font-medium text-slate-700 block mb-1">
                  File {isCreate && <span className="text-red-500">*</span>}
                </label>
                <input ref={fileInputRef} type="file"
                  accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp,.mp4,.webm"
                  className="w-full text-[13px] text-slate-600 file:mr-3 file:py-1 file:px-3 file:border-0 file:rounded file:bg-primary/10 file:text-primary file:text-[12px] file:cursor-pointer"
                  onChange={e => setForm(f => ({ ...f, file: e.target.files?.[0] ?? null }))} />
                {editingRes && !form.file && (editingRes as TrainingResource).file_name && (
                  <p className="text-[12px] text-slate-500 mt-1">
                    Current: {(editingRes as TrainingResource).file_name}
                  </p>
                )}
                {urlErr && <p className="text-[11px] text-red-600 mt-1">{urlErr}</p>}
                <p className="text-[11px] text-slate-400 mt-1">Max 25 MB</p>
              </div>
            )}

            <div>
              <label className="text-[12px] font-medium text-slate-700 block mb-1">Description (optional)</label>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={3} placeholder="Brief description..."
                className="w-full px-3 py-2 border border-slate-200 rounded-md text-[13px] resize-none focus:outline-none focus:ring-1 focus:ring-primary/40" />
            </div>

            <div>
              <label className="text-[12px] font-medium text-slate-700 block mb-1">
                Topics <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <SearchableMultiSelect
                items={topics.map(t => ({ id: t.id, label: t.label }))}
                selectedIds={form.topic_ids}
                onChange={ids => setForm(f => ({ ...f, topic_ids: ids }))}
                placeholder="No topics selected"
                emptyMessage="No topics found"
              />
            </div>

            <div className="flex items-center gap-3">
              <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
              <span className="text-[13px] text-slate-700">Active</span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button className="bg-primary hover:bg-primary/90 text-white" onClick={handleSave} disabled={saveMut.isPending}>
              {saveMut.isPending ? 'Saving...' : 'Save Resource'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </QualityListPage>
  )
}

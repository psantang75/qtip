import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, ExternalLink } from 'lucide-react'
import trainingService, { type TrainingResource } from '@/services/trainingService'
import topicService from '@/services/topicService'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { LibraryTabNav } from '@/components/training/LibraryTabNav'

type ResourceForm = { title: string; url: string; description: string; topic_id: string; is_active: boolean }

const EMPTY: ResourceForm = { title: '', url: '', description: '', topic_id: '', is_active: true }

function isValidUrl(url: string): boolean {
  try { new URL(url); return true } catch { return false }
}

export default function LibraryResourcesPage() {
  const qc        = useQueryClient()
  const { toast } = useToast()

  const [editing, setEditing]   = useState<TrainingResource | null | {}>( null )
  const [form,    setForm]      = useState<ResourceForm>(EMPTY)
  const [urlErr,  setUrlErr]    = useState('')
  const [titleErr, setTitleErr] = useState('')

  const { data: resData,    isLoading } = useQuery({ queryKey: ['resources-all'],   queryFn: () => trainingService.getResources({ limit: 200 }) })
  const { data: topicsData }            = useQuery({ queryKey: ['topics'],           queryFn: () => topicService.getTopics(1, 200) })

  const resources = resData?.items ?? []
  const topics    = (topicsData as any)?.items ?? []

  const invalidate = () => qc.invalidateQueries({ queryKey: ['resources-all'] })

  const isOpen     = editing !== null
  const isCreate   = isOpen && !('id' in (editing as object))
  const editingRes = isOpen && !isCreate ? (editing as TrainingResource) : null

  const openCreate = () => { setEditing({}); setForm(EMPTY); setUrlErr(''); setTitleErr('') }
  const openEdit   = (r: TrainingResource) => {
    setEditing(r)
    setForm({ title: r.title, url: r.url, description: r.description ?? '', topic_id: String(r.topic_id ?? ''), is_active: r.is_active })
    setUrlErr(''); setTitleErr('')
  }

  const saveMut = useMutation({
    mutationFn: async (f: ResourceForm) => {
      const payload = { title: f.title, url: f.url, description: f.description || undefined, topic_id: f.topic_id ? Number(f.topic_id) : undefined, is_active: f.is_active }
      return editingRes
        ? trainingService.updateResource(editingRes.id, payload as any)
        : trainingService.createResource(payload as any)
    },
    onSuccess: () => { invalidate(); setEditing(null); toast({ title: editingRes ? 'Resource updated' : 'Resource added' }) },
    onError: (err: any) => toast({ title: 'Save failed', description: err?.message, variant: 'destructive' }),
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      trainingService.toggleResourceStatus(id, active),
    onSuccess: () => invalidate(),
    onError: () => toast({ title: 'Error', variant: 'destructive' }),
  })

  const handleSave = () => {
    let valid = true
    if (!form.title.trim()) { setTitleErr('Title is required'); valid = false } else setTitleErr('')
    if (!form.url.trim() || !isValidUrl(form.url)) { setUrlErr('Enter a valid URL (https://â€¦)'); valid = false } else setUrlErr('')
    if (!valid) return
    saveMut.mutate(form)
  }

  const sel = 'w-full h-9 px-3 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-primary/40'

  return (
    <QualityListPage>
      <QualityPageHeader title="Library"
        actions={
          <Button className="bg-primary hover:bg-primary/90 text-white" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> Add Resource
          </Button>
        }
      />
      <LibraryTabNav />

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? <TableLoadingSkeleton rows={6} /> : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 border-b border-slate-200">
                <TableHead>Title</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Topic</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {resources.length === 0 ? (
                <TableEmptyState colSpan={6} title="No resources yet" description="Add your first knowledge base resource" />
              ) : resources.map((r: TrainingResource) => (
                <TableRow key={r.id} className="hover:bg-slate-50/50">
                  <TableCell>
                    <a href={r.url} target="_blank" rel="noopener noreferrer"
                      className="text-[13px] font-medium text-primary hover:underline flex items-center gap-1 max-w-[220px] truncate">
                      {r.title} <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  </TableCell>
                  <TableCell className="text-[12px] text-slate-400 max-w-[180px] truncate">{r.url}</TableCell>
                  <TableCell className="text-[13px] text-slate-500">{r.topic_name ?? 'â€”'}</TableCell>
                  <TableCell><StatusBadge status={r.is_active ? 'ACTIVE' : 'INACTIVE'} /></TableCell>
                  <TableCell>
                    <Switch checked={r.is_active}
                      onCheckedChange={v => toggleMut.mutate({ id: r.id, active: v })} />
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(r)}>
                      <Pencil className="h-3.5 w-3.5 text-slate-400" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

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
              <label className="text-[12px] font-medium text-slate-700 block mb-1">URL <span className="text-red-500">*</span></label>
              <Input type="url" value={form.url}
                onChange={e => { setForm(f => ({ ...f, url: e.target.value })); setUrlErr('') }}
                onBlur={() => { if (form.url && !isValidUrl(form.url)) setUrlErr('Enter a valid URL (https://â€¦)') }}
                placeholder="https://â€¦" />
              {urlErr && <p className="text-[11px] text-red-600 mt-1">{urlErr}</p>}
            </div>
            <div>
              <label className="text-[12px] font-medium text-slate-700 block mb-1">Description (optional)</label>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={3} placeholder="Brief description of this resourceâ€¦"
                className="w-full px-3 py-2 border border-slate-200 rounded-md text-[13px] resize-none focus:outline-none focus:ring-1 focus:ring-primary/40" />
            </div>
            <div>
              <label className="text-[12px] font-medium text-slate-700 block mb-1">Topic (optional)</label>
              <select className={sel} value={form.topic_id} onChange={e => setForm(f => ({ ...f, topic_id: e.target.value }))}>
                <option value="">No topic</option>
                {topics.map((t: any) => <option key={t.id} value={t.id}>{t.topic_name}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
              <span className="text-[13px] text-slate-700">Active</span>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button className="bg-primary hover:bg-primary/90 text-white" onClick={handleSave} disabled={saveMut.isPending}>
              {saveMut.isPending ? 'Savingâ€¦' : 'Save Resource'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </QualityListPage>
  )
}


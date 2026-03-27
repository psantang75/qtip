import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, ChevronRight, ChevronDown, Pencil } from 'lucide-react'
import topicService from '@/services/topicService'
import trainingService from '@/services/trainingService'
import { ResourceLink } from '@/components/training/ResourceLink'
import { QuizPreviewModal } from '@/components/training/QuizPreviewModal'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { QualityFilterBar } from '@/components/common/QualityFilterBar'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { SearchableMultiSelect } from '@/components/common/SearchableMultiSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

type StatusFilter = 'all' | 'active' | 'inactive'

interface TopicForm {
  name: string
  is_active: boolean
  linkedResourceIds: number[]
  linkedQuizIds: number[]
}

const EMPTY_FORM: TopicForm = { name: '', is_active: true, linkedResourceIds: [], linkedQuizIds: [] }

// ── Page ─────────────────────────────────────────────────────────────────────

export default function LibraryTopicsPage() {
  const qc        = useQueryClient()
  const { toast } = useToast()

  const [expanded,      setExpanded]      = useState<Set<number>>(new Set())
  const [search,        setSearch]        = useState('')
  const [statusFilter,  setStatusFilter]  = useState<StatusFilter>('active')
  const [modalOpen,     setModalOpen]     = useState(false)
  const [editingTopic,  setEditingTopic]  = useState<any | null>(null)
  const [form,          setForm]          = useState<TopicForm>(EMPTY_FORM)
  const [nameError,     setNameError]     = useState('')
  const [previewQuiz,   setPreviewQuiz]   = useState<any | null>(null)
  const [previewOpen,   setPreviewOpen]   = useState(false)

  const { data: topicsData, isLoading } = useQuery({ queryKey: ['topics'], queryFn: () => topicService.getTopics(1, 200) })
  const { data: resourcesData }         = useQuery({ queryKey: ['resources-all'], queryFn: () => trainingService.getResources({ limit: 200 }) })
  const { data: quizData }              = useQuery({ queryKey: ['quiz-library-all'], queryFn: () => trainingService.getQuizLibrary({ limit: 200 }) })

  const allTopics   = (topicsData as any)?.items ?? []
  const allResources = (resourcesData?.items ?? []).filter((r: any) => r.is_active)
  const allQuizzes   = (quizData?.items ?? []).filter((q: any) => q.is_active)

  const filtered = useMemo(() => {
    let items = allTopics
    if (search.trim()) items = items.filter((t: any) => t.topic_name.toLowerCase().includes(search.toLowerCase()))
    if (statusFilter === 'active')   items = items.filter((t: any) => t.is_active)
    if (statusFilter === 'inactive') items = items.filter((t: any) => !t.is_active)
    return items
  }, [allTopics, search, statusFilter])

  const hasFilters = search.trim().length > 0 || statusFilter !== 'active'

  // Build lookup maps for expanded rows
  const resourcesByTopic = useMemo(() => {
    const map = new Map<number, any[]>()
    for (const r of allResources) {
      for (const tid of (r.topic_ids ?? [])) {
        if (!map.has(tid)) map.set(tid, [])
        map.get(tid)!.push(r)
      }
    }
    return map
  }, [allResources])

  const quizzesByTopic = useMemo(() => {
    const map = new Map<number, any[]>()
    for (const q of allQuizzes) {
      for (const tid of (q.topic_ids ?? [])) {
        if (!map.has(tid)) map.set(tid, [])
        map.get(tid)!.push(q)
      }
    }
    return map
  }, [allQuizzes])

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['topics'] })
    qc.invalidateQueries({ queryKey: ['resources-all'] })
    qc.invalidateQueries({ queryKey: ['quiz-library-all'] })
  }

  const toggleExpanded = (id: number) =>
    setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  const openPreview = async (quizId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const detail = await trainingService.getLibraryQuizDetail(quizId)
      setPreviewQuiz(detail)
      setPreviewOpen(true)
    } catch {
      // silently fail
    }
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  const saveMut = useMutation({
    mutationFn: async (f: TopicForm & { id?: number }) => {
      // 1. Create or update the topic
      const topicId = f.id
        ? (await topicService.updateTopic(f.id, { topic_name: f.name, is_active: f.is_active }), f.id)
        : (await topicService.createTopic({ topic_name: f.name, is_active: f.is_active })).id

      // 2. Sync resource links: compare original vs new
      const origResIds = f.id ? (resourcesByTopic.get(f.id)?.map((r: any) => r.id) ?? []) : []
      const toLink   = f.linkedResourceIds.filter(id => !origResIds.includes(id))
      const toUnlink = origResIds.filter(id => !f.linkedResourceIds.includes(id))
      for (const rid of toLink) {
        const res = (resourcesData?.items ?? []).find((r: any) => r.id === rid)
        if (res) await trainingService.updateResource(rid, { topic_ids: [...(res.topic_ids ?? []), topicId] } as any)
      }
      for (const rid of toUnlink) {
        const res = (resourcesData?.items ?? []).find((r: any) => r.id === rid)
        if (res) await trainingService.updateResource(rid, { topic_ids: (res.topic_ids ?? []).filter((x: number) => x !== topicId) } as any)
      }

      // 3. Sync quiz links
      const origQuizIds = f.id ? (quizzesByTopic.get(f.id)?.map((q: any) => q.id) ?? []) : []
      const toLinkQ   = f.linkedQuizIds.filter(id => !origQuizIds.includes(id))
      const toUnlinkQ = origQuizIds.filter(id => !f.linkedQuizIds.includes(id))
      for (const qid of toLinkQ) {
        const quiz = allQuizzes.find((q: any) => q.id === qid)
        if (quiz) await trainingService.updateLibraryQuiz(qid, { topic_ids: [...(quiz.topic_ids ?? []), topicId] })
      }
      for (const qid of toUnlinkQ) {
        const quiz = allQuizzes.find((q: any) => q.id === qid)
        if (quiz) await trainingService.updateLibraryQuiz(qid, { topic_ids: (quiz.topic_ids ?? []).filter((x: number) => x !== topicId) })
      }
    },
    onSuccess: () => {
      invalidateAll()
      setModalOpen(false)
      toast({ title: editingTopic ? 'Topic updated' : 'Topic created' })
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? 'Failed to save topic'
      if (msg.toLowerCase().includes('name') || msg.toLowerCase().includes('duplicate')) setNameError(msg)
      else toast({ title: msg, variant: 'destructive' })
    },
  })

  // ── Modal helpers ──────────────────────────────────────────────────────────

  const openAdd = () => {
    setEditingTopic(null)
    setForm(EMPTY_FORM)
    setNameError('')
    setModalOpen(true)
  }

  const openEdit = (topic: any) => {
    setEditingTopic(topic)
    setForm({
      name:              topic.topic_name,
      is_active:         !!topic.is_active,
      linkedResourceIds: resourcesByTopic.get(topic.id)?.map((r: any) => r.id) ?? [],
      linkedQuizIds:     quizzesByTopic.get(topic.id)?.map((q: any) => q.id) ?? [],
    })
    setNameError('')
    setModalOpen(true)
  }

  const handleSave = () => {
    if (!form.name.trim()) { setNameError('Topic name is required'); return }
    setNameError('')
    saveMut.mutate({ ...form, id: editingTopic?.id })
  }

  return (
    <QualityListPage>
      <QualityPageHeader title="Training Topics"
        actions={
          <Button className="bg-primary hover:bg-primary/90 text-white" onClick={openAdd}>
            <Plus className="h-4 w-4 mr-1" /> Add Topic
          </Button>
        }
      />

      <QualityFilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search topics…"
        hasFilters={hasFilters}
        onReset={() => { setSearch(''); setStatusFilter('active') }}
        resultCount={{ filtered: filtered.length, total: allTopics.length }}
      >
        <Select value={statusFilter} onValueChange={v => setStatusFilter(v as StatusFilter)}>
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
        {isLoading ? <TableLoadingSkeleton rows={6} /> : (
          <Table>
            <TableHeader>
              <StandardTableHeaderRow>
                <TableHead className="w-8" />
                <TableHead>Topic Name</TableHead>
                <TableHead className="text-center">Resources</TableHead>
                <TableHead className="text-center">Quizzes</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24" />
              </StandardTableHeaderRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableEmptyState colSpan={6} title="No topics found" description="Try adjusting your filters or add a new topic" />
              ) : filtered.map((topic: any) => {
                const isOpen         = expanded.has(topic.id)
                const topicResources = resourcesByTopic.get(topic.id) ?? []
                const topicQuizzes   = quizzesByTopic.get(topic.id) ?? []

                return (
                  <React.Fragment key={topic.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-slate-50/50"
                      onClick={() => toggleExpanded(topic.id)}
                    >
                      <TableCell>
                        {isOpen
                          ? <ChevronDown  className="h-4 w-4 text-slate-400" />
                          : <ChevronRight className="h-4 w-4 text-slate-400" />}
                      </TableCell>
                      <TableCell className="text-[13px] font-medium text-slate-900">
                        {topic.topic_name}
                      </TableCell>
                      <TableCell className="text-center text-[13px] text-slate-500">
                        {topicResources.length}
                      </TableCell>
                      <TableCell className="text-center text-[13px] text-slate-500">
                        {topicQuizzes.length}
                      </TableCell>
                      <TableCell className="text-[13px] text-slate-600">
                        {topic.is_active ? 'Active' : 'Inactive'}
                      </TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[12px] text-slate-600 gap-1"
                          onClick={() => openEdit(topic)}
                        >
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                      </TableCell>
                    </TableRow>

                    {isOpen && (
                      <TableRow>
                        <TableCell colSpan={6} className="p-0 bg-slate-50/60">
                          <div className="p-4 space-y-4 border-t border-slate-100">

                            <div>
                              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">
                                Resources
                              </p>
                              {topicResources.length === 0 ? (
                                <p className="text-[13px] text-slate-400">No resources linked</p>
                              ) : (
                                <div className="space-y-1.5">
                                  {topicResources.map((r: any) => (
                                    <div key={r.id} className="flex items-center gap-3 bg-white rounded-lg px-3 py-2 border border-slate-200"
                                      onClick={e => e.stopPropagation()}>
                                      <ResourceLink resource={r} maxWidth="max-w-none flex-1" />
                                      <span className="text-[12px] text-slate-400 shrink-0">{r.resource_type}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div>
                              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">
                                Quizzes
                              </p>
                              {topicQuizzes.length === 0 ? (
                                <p className="text-[13px] text-slate-400">No quizzes linked</p>
                              ) : (
                                <div className="space-y-1.5">
                                  {topicQuizzes.map((q: any) => (
                                    <div key={q.id} className="flex items-center gap-3 bg-white rounded-lg px-3 py-2 border border-slate-200">
                                      <button
                                        onClick={e => openPreview(q.id, e)}
                                        className="flex-1 text-[13px] font-medium text-primary hover:underline truncate text-left"
                                      >
                                        {q.quiz_title}
                                      </button>
                                      <span className="text-[12px] text-slate-500 shrink-0">{q.question_count}Q · Pass: {q.pass_score}%</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <QuizPreviewModal
        quiz={previewQuiz}
        open={previewOpen}
        onClose={() => { setPreviewOpen(false); setPreviewQuiz(null) }}
      />

      {/* ── Add / Edit Modal ────────────────────────────────────────────────── */}
      <Dialog open={modalOpen} onOpenChange={open => { if (!open) setModalOpen(false) }}>
        <DialogContent aria-describedby={undefined} className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTopic ? 'Edit Topic' : 'Add Topic'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 pt-1">

            {/* Topic name */}
            <div>
              <label className="text-[12px] font-medium text-slate-700 block mb-1">
                Topic Name <span className="text-red-500">*</span>
              </label>
              <Input
                value={form.name}
                onChange={e => { setForm(f => ({ ...f, name: e.target.value })); setNameError('') }}
                placeholder="e.g. Call Handling"
                className="text-[13px]"
                autoFocus
              />
              {nameError && <p className="text-[12px] text-red-600 mt-1">{nameError}</p>}
            </div>

            {/* Active / inactive */}
            <div className="flex items-center justify-between py-3 border-y border-slate-100">
              <div>
                <p className="text-[13px] font-medium text-slate-700">Status</p>
                <p className="text-[12px] text-slate-400">Inactive topics are hidden from quizzes and resources</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-slate-500">{form.is_active ? 'Active' : 'Inactive'}</span>
                <Switch
                  checked={form.is_active}
                  onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))}
                />
              </div>
            </div>

            {/* Linked resources */}
            <div>
              <label className="text-[12px] font-medium text-slate-700 block mb-1">
                Resources <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <SearchableMultiSelect
                items={allResources.map((r: any) => ({ id: r.id, label: r.title }))}
                selectedIds={form.linkedResourceIds}
                onChange={ids => setForm(f => ({ ...f, linkedResourceIds: ids }))}
                placeholder="No resources linked"
                emptyMessage="No resources found"
              />
            </div>

            {/* Linked quizzes */}
            <div>
              <label className="text-[12px] font-medium text-slate-700 block mb-1">
                Quizzes <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <SearchableMultiSelect
                items={allQuizzes.map((q: any) => ({ id: q.id, label: `${q.quiz_title} — ${q.question_count}Q · Pass: ${q.pass_score}%` }))}
                selectedIds={form.linkedQuizIds}
                onChange={ids => setForm(f => ({ ...f, linkedQuizIds: ids }))}
                placeholder="No quizzes linked"
                emptyMessage="No quizzes found"
              />
            </div>

          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 mt-2">
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button
              className="bg-primary hover:bg-primary/90 text-white"
              onClick={handleSave}
              disabled={saveMut.isPending}
            >
              {saveMut.isPending ? 'Saving…' : editingTopic ? 'Save Changes' : 'Add Topic'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </QualityListPage>
  )
}

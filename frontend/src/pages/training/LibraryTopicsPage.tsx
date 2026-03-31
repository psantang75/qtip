import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, ChevronDown, Pencil } from 'lucide-react'
import trainingService, { type TrainingResource, type LibraryQuiz } from '@/services/trainingService'
import listService, { type ListItem } from '@/services/listService'
import { ResourceLink } from '@/components/training/ResourceLink'
import { QuizPreviewModal } from '@/components/training/QuizPreviewModal'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { QualityFilterBar } from '@/components/common/QualityFilterBar'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { TableErrorState } from '@/components/common/TableErrorState'
import { SearchableMultiSelect } from '@/components/common/SearchableMultiSelect'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'

interface TopicForm {
  linkedResourceIds: number[]
  linkedQuizIds: number[]
}

const EMPTY_FORM: TopicForm = { linkedResourceIds: [], linkedQuizIds: [] }

// ── Page ─────────────────────────────────────────────────────────────────────

export default function LibraryTopicsPage() {
  const qc        = useQueryClient()
  const { toast } = useToast()

  const [expanded,     setExpanded]     = useState<Set<number>>(new Set())
  const [search,       setSearch]       = useState('')
  const [modalOpen,    setModalOpen]    = useState(false)
  const [editingTopic, setEditingTopic] = useState<ListItem | null>(null)
  const [form,         setForm]         = useState<TopicForm>(EMPTY_FORM)
  const [previewQuiz,  setPreviewQuiz]  = useState<{ id?: number; quiz_title: string; pass_score: number; questions: { question_text: string; options: string[]; correct_option: number }[] } | null>(null)
  const [previewOpen,  setPreviewOpen]  = useState(false)

  const previewMut = useMutation({
    mutationFn: (quizId: number) => trainingService.getLibraryQuizDetail(quizId),
    onSuccess: (detail) => { setPreviewQuiz(detail); setPreviewOpen(true) },
  })

  const { data: topicItems = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['list-items', 'training_topic', 'all'],
    queryFn:  () => listService.getItems('training_topic', true),
  })
  const { data: resourcesData } = useQuery({ queryKey: ['resources-all'], queryFn: () => trainingService.getResources({ limit: 200 }) })
  const { data: quizData }      = useQuery({ queryKey: ['quiz-library-all'], queryFn: () => trainingService.getQuizLibrary({ limit: 200 }) })

  const allResources: TrainingResource[] = (resourcesData?.items ?? []).filter(r => r.is_active)
  const allQuizzes:   LibraryQuiz[]      = (quizData?.items ?? []).filter(q => q.is_active)

  // Mirror List Management order: categories in first-appearance (sort_order) order,
  // items within each category in sort_order, uncategorized block at the bottom.
  const allTopics = useMemo(() => {
    const catOrder: string[] = []
    for (const t of topicItems) {
      if (t.category && !catOrder.includes(t.category)) catOrder.push(t.category)
    }
    const byCategory = new Map<string, typeof topicItems>()
    catOrder.forEach(c => byCategory.set(c, []))
    const uncategorized: typeof topicItems = []
    for (const t of topicItems) {
      if (t.category) byCategory.get(t.category)!.push(t)
      else uncategorized.push(t)
    }
    return [...catOrder.flatMap(c => byCategory.get(c)!), ...uncategorized]
  }, [topicItems])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? allTopics.filter(t => t.label.toLowerCase().includes(q)) : allTopics
  }, [allTopics, search])

  const hasFilters = search.trim().length > 0

  // Build resource/quiz maps keyed by topics.id (from item_key) for FK alignment
  const resourcesByTopic = useMemo(() => {
    const map = new Map<number, TrainingResource[]>()
    for (const r of allResources) {
      for (const tid of (r.topic_ids ?? [])) {
        if (!map.has(tid)) map.set(tid, [])
        map.get(tid)!.push(r)
      }
    }
    return map
  }, [allResources])

  const quizzesByTopic = useMemo(() => {
    const map = new Map<number, LibraryQuiz[]>()
    for (const q of allQuizzes) {
      for (const tid of (q.topic_ids ?? [])) {
        if (!map.has(tid)) map.set(tid, [])
        map.get(tid)!.push(q)
      }
    }
    return map
  }, [allQuizzes])

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['list-items', 'training_topic'] })
    qc.invalidateQueries({ queryKey: ['resources-all'] })
    qc.invalidateQueries({ queryKey: ['quiz-library-all'] })
  }

  const toggleExpanded = (id: number) =>
    setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  const openPreview = (quizId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    previewMut.mutate(quizId)
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  const saveMut = useMutation({
    mutationFn: async (f: TopicForm & { id: number; fkTopicId: number }) => {
      const fkTopicId = f.fkTopicId   // topics.id for FK references

      // Sync resource links
      const origResIds = resourcesByTopic.get(fkTopicId)?.map(r => r.id) ?? []
      const toLink   = f.linkedResourceIds.filter(id => !origResIds.includes(id))
      const toUnlink = origResIds.filter(id => !f.linkedResourceIds.includes(id))
      for (const rid of toLink) {
        const res = (resourcesData?.items ?? []).find(r => r.id === rid)
        if (res) await trainingService.updateResource(rid, { topic_ids: [...(res.topic_ids ?? []), fkTopicId] })
      }
      for (const rid of toUnlink) {
        const res = (resourcesData?.items ?? []).find(r => r.id === rid)
        if (res) await trainingService.updateResource(rid, { topic_ids: (res.topic_ids ?? []).filter(x => x !== fkTopicId) })
      }

      // Sync quiz links
      const origQuizIds = quizzesByTopic.get(fkTopicId)?.map(q => q.id) ?? []
      const toLinkQ   = f.linkedQuizIds.filter(id => !origQuizIds.includes(id))
      const toUnlinkQ = origQuizIds.filter(id => !f.linkedQuizIds.includes(id))
      for (const qid of toLinkQ) {
        const quiz = allQuizzes.find(q => q.id === qid)
        if (quiz) await trainingService.updateLibraryQuiz(qid, { topic_ids: [...(quiz.topic_ids ?? []), fkTopicId] })
      }
      for (const qid of toUnlinkQ) {
        const quiz = allQuizzes.find(q => q.id === qid)
        if (quiz) await trainingService.updateLibraryQuiz(qid, { topic_ids: (quiz.topic_ids ?? []).filter(x => x !== fkTopicId) })
      }
    },
    onSuccess: () => { invalidateAll(); setModalOpen(false); toast({ title: 'Topic updated' }) },
    onError:   () => toast({ title: 'Failed to save topic', variant: 'destructive' }),
  })

  const openEdit = (topic: ListItem) => {
    setEditingTopic(topic)
    const fkId = topic.item_key ? parseInt(topic.item_key) : 0
    setForm({
      linkedResourceIds: resourcesByTopic.get(fkId)?.map(r => r.id) ?? [],
      linkedQuizIds:     quizzesByTopic.get(fkId)?.map(q => q.id) ?? [],
    })
    setModalOpen(true)
  }

  const handleSave = () => {
    const fkTopicId = editingTopic.item_key ? parseInt(editingTopic.item_key) : 0
    saveMut.mutate({ ...form, id: editingTopic.id, fkTopicId })
  }

  // Group filtered topics by category for card-based rendering
  const groupedFiltered = useMemo(() => {
    const catOrder: string[] = []
    for (const t of filtered) {
      if (t.category && !catOrder.includes(t.category)) catOrder.push(t.category)
    }
    const byCategory = new Map<string, ListItem[]>()
    catOrder.forEach(c => byCategory.set(c, []))
    const uncategorized: ListItem[] = []
    for (const t of filtered) {
      if (t.category) byCategory.get(t.category)!.push(t)
      else uncategorized.push(t)
    }
    return { catOrder, byCategory, uncategorized }
  }, [filtered])

  const renderTopicRow = (topic: ListItem) => {
    const isOpen = expanded.has(topic.id)
    const fkId   = topic.item_key ? parseInt(topic.item_key) : 0
    const topicResources = resourcesByTopic.get(fkId) ?? []
    const topicQuizzes   = quizzesByTopic.get(fkId) ?? []
    return (
      <React.Fragment key={topic.id}>
        <div
          className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50/60 cursor-pointer group"
          onClick={() => toggleExpanded(topic.id)}
        >
          <span className="text-slate-300 shrink-0">
            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
          <span className="flex-1 text-[13px] text-slate-700">{topic.label}</span>
          <span className="text-[11px] text-slate-400 shrink-0 w-20 text-right">
            {topicResources.length > 0 ? `${topicResources.length} resource${topicResources.length !== 1 ? 's' : ''}` : ''}
          </span>
          <span className="text-[11px] text-slate-400 shrink-0 w-16 text-right">
            {topicQuizzes.length > 0 ? `${topicQuizzes.length} quiz${topicQuizzes.length !== 1 ? 'zes' : ''}` : ''}
          </span>
          <div onClick={e => e.stopPropagation()}>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px] text-slate-500 gap-1 opacity-0 group-hover:opacity-100"
              onClick={() => openEdit(topic)}>
              <Pencil className="h-3 w-3" /> Edit
            </Button>
          </div>
        </div>

        {isOpen && (
          <div className="mx-3 mb-2 rounded-lg border border-slate-100 bg-slate-50/60 p-3 space-y-3">
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Resources</p>
              {topicResources.length === 0 ? (
                <p className="text-[12px] text-slate-400">No resources linked</p>
              ) : (
                <div className="space-y-1">
                  {topicResources.map((r: any) => (
                    <div key={r.id} className="flex items-center gap-3 bg-white rounded-lg px-3 py-2 border border-slate-200">
                      <ResourceLink resource={r} maxWidth="max-w-none flex-1" />
                      <span className="text-[11px] text-slate-400 shrink-0">{r.resource_type}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Quizzes</p>
              {topicQuizzes.length === 0 ? (
                <p className="text-[12px] text-slate-400">No quizzes linked</p>
              ) : (
                <div className="space-y-1">
                  {topicQuizzes.map((q: any) => (
                    <div key={q.id} className="flex items-center gap-3 bg-white rounded-lg px-3 py-2 border border-slate-200">
                      <button onClick={e => openPreview(q.id, e)}
                        className="flex-1 text-[13px] font-medium text-primary hover:underline truncate text-left">
                        {q.quiz_title}
                      </button>
                      <span className="text-[11px] text-slate-500 shrink-0">{q.question_count}Q · Pass: {q.pass_score}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </React.Fragment>
    )
  }

  return (
    <QualityListPage>
      <QualityPageHeader title="Training Topics" />

      <QualityFilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search topics…"
        hasFilters={hasFilters}
        onReset={() => setSearch('')}
        resultCount={{ filtered: filtered.length, total: allTopics.length }}
      />

      {isLoading ? (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <TableLoadingSkeleton rows={6} />
        </div>
      ) : isError ? (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <TableErrorState message="Failed to load topics." onRetry={refetch} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <p className="text-[13px] text-slate-400">No topics found. Try adjusting your search.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* ── Categorised blocks ── */}
          {groupedFiltered.catOrder.map(cat => (
            <div key={cat} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">{cat}</p>
                  <span className="text-[10px] text-slate-400">{groupedFiltered.byCategory.get(cat)!.length}</span>
                </div>
              </div>
              <div className="divide-y divide-slate-100">
                {groupedFiltered.byCategory.get(cat)!.map(renderTopicRow)}
              </div>
            </div>
          ))}

          {/* ── Uncategorised block ── */}
          {groupedFiltered.uncategorized.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 border-dashed overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50/50 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Uncategorized</p>
                  <span className="text-[10px] text-slate-400">{groupedFiltered.uncategorized.length}</span>
                </div>
              </div>
              <div className="divide-y divide-slate-100">
                {groupedFiltered.uncategorized.map(renderTopicRow)}
              </div>
            </div>
          )}
        </div>
      )}

      <QuizPreviewModal
        quiz={previewQuiz}
        open={previewOpen}
        onClose={() => { setPreviewOpen(false); setPreviewQuiz(null) }}
      />

      {/* ── Add / Edit Modal ────────────────────────────────────────────────── */}
      <Dialog open={modalOpen} onOpenChange={open => { if (!open) setModalOpen(false) }}>
        <DialogContent aria-describedby={undefined} className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Link Resources &amp; Quizzes</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 pt-1">

            {/* Topic name — read-only for trainers */}
            <div className="pb-4 border-b border-slate-100">
              <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-0.5">Topic</p>
              <p className="text-[15px] font-semibold text-slate-800">{editingTopic?.label}</p>
            </div>

            {/* Linked resources */}
            <div>
              <label className="text-[12px] font-medium text-slate-700 block mb-1">
                Resources <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <SearchableMultiSelect
                items={allResources.map(r => ({ id: r.id, label: r.title }))}
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
                items={allQuizzes.map(q => ({ id: q.id, label: `${q.quiz_title} — ${q.question_count}Q · Pass: ${q.pass_score}%` }))}
                selectedIds={form.linkedQuizIds}
                onChange={ids => setForm(f => ({ ...f, linkedQuizIds: ids }))}
                placeholder="No quizzes linked"
                emptyMessage="No quizzes found"
              />
            </div>

          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 mt-2">
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button className="bg-primary hover:bg-primary/90 text-white"
              onClick={handleSave} disabled={saveMut.isPending}>
              {saveMut.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </QualityListPage>
  )
}

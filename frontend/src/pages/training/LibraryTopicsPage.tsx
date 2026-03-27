import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, ChevronRight, ChevronDown, Pencil, Check, X, ExternalLink } from 'lucide-react'
import topicService from '@/services/topicService'
import trainingService from '@/services/trainingService'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { StatusBadge } from '@/components/common/StatusBadge'
import { LibraryTabNav } from '@/components/training/LibraryTabNav'
import { cn } from '@/lib/utils'

export default function LibraryTopicsPage() {
  const qc        = useQueryClient()
  const { toast } = useToast()

  const [expanded,    setExpanded]    = useState<Set<number>>(new Set())
  const [editingId,   setEditingId]   = useState<number | null>(null)
  const [editName,    setEditName]    = useState('')
  const [showAdd,     setShowAdd]     = useState(false)
  const [newName,     setNewName]     = useState('')
  const [nameError,   setNameError]   = useState('')

  const { data: topicsData, isLoading } = useQuery({
    queryKey: ['topics'],
    queryFn: () => topicService.getTopics(1, 200),
  })
  const { data: resourcesData } = useQuery({
    queryKey: ['resources-all'],
    queryFn: () => trainingService.getResources({ limit: 200 }),
  })
  const { data: quizData } = useQuery({
    queryKey: ['quiz-library-all'],
    queryFn: () => trainingService.getQuizLibrary({ limit: 200 }),
  })

  const topics    = (topicsData as any)?.items ?? []
  const resources = resourcesData?.items ?? []
  const quizzes   = quizData?.items ?? []

  const resourcesByTopic = useMemo(() => {
    const map = new Map<number | null, typeof resources>()
    for (const r of resources) {
      const k = r.topic_id ?? null
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(r)
    }
    return map
  }, [resources])

  const quizzesByTopic = useMemo(() => {
    const map = new Map<number | null, typeof quizzes>()
    for (const q of quizzes) {
      const k = q.topic_id ?? null
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(q)
    }
    return map
  }, [quizzes])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['topics'] })
    qc.invalidateQueries({ queryKey: ['resources-all'] })
    qc.invalidateQueries({ queryKey: ['quiz-library-all'] })
  }

  const toggleExpanded = (id: number) => {
    setExpanded(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  // â”€â”€ Mutations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      topicService.toggleTopicStatus(id, active),
    onSuccess: () => invalidate(),
    onError: () => toast({ title: 'Error', variant: 'destructive' }),
  })

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      topicService.updateTopic(id, { topic_name: name }),
    onSuccess: () => { invalidate(); setEditingId(null) },
    onError: () => toast({ title: 'Failed to rename', variant: 'destructive' }),
  })

  const addMut = useMutation({
    mutationFn: (name: string) => topicService.createTopic({ topic_name: name }),
    onSuccess: () => { invalidate(); setShowAdd(false); setNewName(''); toast({ title: 'Topic added' }) },
    onError: (err: any) => setNameError(err?.response?.data?.message ?? 'Failed to create topic'),
  })

  const unlinkResourceMut = useMutation({
    mutationFn: ({ id }: { id: number }) => trainingService.updateResource(id, { topic_id: null } as any),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['resources-all'] }) },
  })

  const linkResourceMut = useMutation({
    mutationFn: ({ id, topicId }: { id: number; topicId: number }) =>
      trainingService.updateResource(id, { topic_id: topicId } as any),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['resources-all'] }) },
  })

  const unlinkQuizMut = useMutation({
    mutationFn: ({ id }: { id: number }) => trainingService.updateLibraryQuiz(id, { topic_id: null as any }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['quiz-library-all'] }) },
  })

  const linkQuizMut = useMutation({
    mutationFn: ({ id, topicId }: { id: number; topicId: number }) =>
      trainingService.updateLibraryQuiz(id, { topic_id: topicId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['quiz-library-all'] }) },
  })

  const startEdit = (id: number, name: string) => { setEditingId(id); setEditName(name) }
  const saveEdit  = () => { if (editName.trim()) renameMut.mutate({ id: editingId!, name: editName.trim() }) }

  const handleAddTopic = () => {
    if (!newName.trim()) { setNameError('Name is required'); return }
    setNameError('')
    addMut.mutate(newName.trim())
  }

  return (
    <QualityListPage>
      <QualityPageHeader title="Library"
        actions={
          <Button className="bg-primary hover:bg-primary/90 text-white" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Topic
          </Button>
        }
      />

      <LibraryTabNav />

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? <TableLoadingSkeleton rows={6} /> : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 border-b border-slate-200">
                <TableHead className="w-8" />
                <TableHead>Topic Name</TableHead>
                <TableHead className="text-center">Resources</TableHead>
                <TableHead className="text-center">Quizzes</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topics.map((topic: any) => {
                const isOpen      = expanded.has(topic.id)
                const topicResources = resourcesByTopic.get(topic.id) ?? []
                const topicQuizzes   = quizzesByTopic.get(topic.id) ?? []
                const unlinkedResources = resources.filter(r => !r.topic_id)
                const unlinkedQuizzes   = quizzes.filter(q => !q.topic_id)

                return (
                  <React.Fragment key={topic.id}>
                    <TableRow className="cursor-pointer hover:bg-slate-50/50"
                      onClick={() => toggleExpanded(topic.id)}>
                      <TableCell>
                        {isOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                      </TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        {editingId === topic.id ? (
                          <div className="flex items-center gap-2">
                            <Input value={editName} onChange={e => setEditName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null) }}
                              className="h-7 text-[13px] w-48" autoFocus />
                            <button onClick={saveEdit} className="text-emerald-600 hover:text-emerald-700"><Check className="h-4 w-4" /></button>
                            <button onClick={() => setEditingId(null)} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 group">
                            <span className="text-[13px] font-medium text-slate-900">{topic.topic_name}</span>
                            <button onClick={() => startEdit(topic.id, topic.topic_name)}
                              className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-primary transition-opacity">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-center text-[13px] text-slate-500">{topicResources.length}</TableCell>
                      <TableCell className="text-center text-[13px] text-slate-500">{topicQuizzes.length}</TableCell>
                      <TableCell>
                        <StatusBadge status={topic.is_active ? 'ACTIVE' : 'INACTIVE'} />
                      </TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <Switch checked={!!topic.is_active}
                          onCheckedChange={v => toggleMut.mutate({ id: topic.id, active: v })} />
                      </TableCell>
                    </TableRow>

                    {isOpen && (
                      <TableRow>
                        <TableCell colSpan={6} className="p-0 bg-slate-50/60">
                          <div className="p-4 space-y-4 border-t border-slate-100">

                            {/* Resources sub-section */}
                            <div>
                              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Resources</p>
                              <div className="space-y-1.5">
                                {topicResources.map(r => (
                                  <div key={r.id} className="flex items-center gap-3 bg-white rounded-lg px-3 py-2 border border-slate-200">
                                    <a href={r.url} target="_blank" rel="noopener noreferrer"
                                      className="flex-1 text-[13px] text-primary hover:underline flex items-center gap-1 truncate">
                                      {r.title} <ExternalLink className="h-3 w-3 shrink-0" />
                                    </a>
                                    <StatusBadge status={r.is_active ? 'ACTIVE' : 'INACTIVE'} />
                                    <button onClick={() => unlinkResourceMut.mutate({ id: r.id })}
                                      className="text-[12px] text-slate-400 hover:text-red-500 shrink-0">Unlink</button>
                                  </div>
                                ))}
                                {unlinkedResources.length > 0 && (
                                  <div className="flex items-center gap-2 mt-2">
                                    <select className="h-8 text-[12px] border border-slate-200 rounded px-2 bg-white"
                                      defaultValue="" onChange={e => {
                                        if (e.target.value) { linkResourceMut.mutate({ id: Number(e.target.value), topicId: topic.id }); e.target.value = '' }
                                      }}>
                                      <option value="" disabled>Link existing resourceâ€¦</option>
                                      {unlinkedResources.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
                                    </select>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Quizzes sub-section */}
                            <div>
                              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Quizzes</p>
                              <div className="space-y-1.5">
                                {topicQuizzes.map(q => (
                                  <div key={q.id} className="flex items-center gap-3 bg-white rounded-lg px-3 py-2 border border-slate-200">
                                    <span className="flex-1 text-[13px] font-medium text-slate-800 truncate">{q.quiz_title}</span>
                                    <span className="text-[12px] text-slate-500">{q.question_count}Q</span>
                                    <span className="text-[12px] text-slate-500">Pass: {q.pass_score}%</span>
                                    <button onClick={() => unlinkQuizMut.mutate({ id: q.id })}
                                      className="text-[12px] text-slate-400 hover:text-red-500 shrink-0">Unlink</button>
                                  </div>
                                ))}
                                {unlinkedQuizzes.length > 0 && (
                                  <div className="flex items-center gap-2 mt-2">
                                    <select className="h-8 text-[12px] border border-slate-200 rounded px-2 bg-white"
                                      defaultValue="" onChange={e => {
                                        if (e.target.value) { linkQuizMut.mutate({ id: Number(e.target.value), topicId: topic.id }); e.target.value = '' }
                                      }}>
                                      <option value="" disabled>Link existing quizâ€¦</option>
                                      {unlinkedQuizzes.map(q => <option key={q.id} value={q.id}>{q.quiz_title}</option>)}
                                    </select>
                                  </div>
                                )}
                              </div>
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

      {/* Add Topic Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent aria-describedby={undefined} className="max-w-sm">
          <DialogHeader><DialogTitle>Add Topic</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Input placeholder="Topic name" value={newName} onChange={e => { setNewName(e.target.value); setNameError('') }}
                onKeyDown={e => e.key === 'Enter' && handleAddTopic()} autoFocus />
              {nameError && <p className="text-[12px] text-red-600 mt-1">{nameError}</p>}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowAdd(false); setNewName(''); setNameError('') }}>Cancel</Button>
              <Button className="bg-primary hover:bg-primary/90 text-white" onClick={handleAddTopic} disabled={addMut.isPending}>
                {addMut.isPending ? 'Savingâ€¦' : 'Add Topic'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </QualityListPage>
  )
}


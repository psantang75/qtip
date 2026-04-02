import { useState, useMemo, useEffect, useRef } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Search, ChevronDown, ChevronRight, ExternalLink, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { formatQualityDate } from '@/utils/dateFormat'
import { useToast } from '@/hooks/use-toast'
import writeupService from '@/services/writeupService'
import { api } from '@/services/authService'
import type { ExampleInput } from './types'

// Question types that cannot be searched by answer value
const EXCLUDED_TYPES = ['TEXT', 'INFO_BLOCK', 'SUB_CATEGORY']

// ── Answer picker per question type ──────────────────────────────────────────

interface AnswerPickerProps {
  question: any
  value: string
  onChange: (v: string) => void
}

function AnswerPicker({ question, value, onChange }: AnswerPickerProps) {
  const chip = (label: string, val: string) => (
    <button
      key={val}
      type="button"
      onClick={() => onChange(value === val ? '' : val)}
      className={cn(
        'px-3 py-1 rounded-md border text-[12px] font-medium transition-colors',
        value === val
          ? 'bg-primary text-white border-primary'
          : 'bg-white text-slate-600 border-slate-200 hover:border-primary hover:text-primary'
      )}
    >
      {label}
    </button>
  )

  if (question.question_type === 'YES_NO') {
    return (
      <div className="flex flex-wrap gap-2 mt-2">
        {chip('Yes', 'Yes')}
        {chip('No', 'No')}
        {question.is_na_allowed && chip('N/A', 'N/A')}
      </div>
    )
  }

  if (question.question_type === 'SCALE') {
    const min = question.scale_min ?? 1
    const max = question.scale_max ?? question.max_scale ?? 5
    return (
      <div className="flex flex-wrap gap-2 mt-2">
        {Array.from({ length: max - min + 1 }, (_, i) => min + i).map(v => chip(String(v), String(v)))}
        {question.is_na_allowed && chip('N/A', 'N/A')}
      </div>
    )
  }

  if (question.question_type === 'RADIO' || question.question_type === 'MULTI_SELECT') {
    const options: any[] = question.radio_options ?? []
    return (
      <div className="flex flex-wrap gap-2 mt-2">
        {options.map((o: any) => chip(o.option_text, o.option_value))}
        {question.is_na_allowed && chip('N/A', 'N/A')}
      </div>
    )
  }

  if (question.question_type === 'N_A') {
    return <div className="flex gap-2 mt-2">{chip('N/A', 'N/A')}</div>
  }

  return null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getPrior90Days() {
  const to   = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 90)
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

// ── Types ─────────────────────────────────────────────────────────────────────

type QuestionFilter = { questionId: number; answerValue: string }

interface SubmissionRow {
  submission_id:    number
  submission_date:  string
  interaction_date: string | null
  form_name:        string
  matches:          Array<{ category_name: string | null; question_text: string; answer: string }>
}

// ── QA Search Modal ───────────────────────────────────────────────────────────

interface QaSearchModalProps {
  csrId: number
  onImport: (examples: ExampleInput[]) => void
  onClose: () => void
}

export function QaSearchModal({ csrId, onImport, onClose }: QaSearchModalProps) {
  const defaults = getPrior90Days()
  const [formId, setFormId]         = useState('')
  const [dateFrom, setDateFrom]     = useState(defaults.from)
  const [dateTo, setDateTo]         = useState(defaults.to)
  const [filters, setFilters]       = useState<QuestionFilter[]>([])
  const [expandedCats, setExpandedCats] = useState<Set<number>>(new Set())
  const [rawResults, setRawResults] = useState<any[]>([])
  const [selected, setSelected]     = useState<Set<number>>(new Set())

  // ── Fetch forms list ──────────────────────────────────────────────────────

  const { data: formsData } = useQuery({
    queryKey: ['forms-for-qa-search'],
    queryFn:  () => api.get('/forms?limit=200&is_active=true').then(r =>
      r.data?.forms ?? r.data?.data?.items ?? r.data?.data ?? []
    ),
    staleTime: Infinity,
  })
  const forms: any[] = formsData ?? []

  // ── Fetch form detail when a form is chosen ───────────────────────────────

  const { data: formDetail, isFetching: loadingForm } = useQuery({
    queryKey: ['form-detail-writeup', formId],
    queryFn:  () => api.get(`/forms/${formId}`).then(r => r.data?.data ?? r.data),
    enabled:  !!formId,
    staleTime: 5 * 60_000,
  })

  const searchableCategories = useMemo(() => {
    if (!formDetail?.categories) return []
    return formDetail.categories
      .map((cat: any) => ({
        ...cat,
        questions: (cat.questions ?? []).filter(
          (q: any) => !EXCLUDED_TYPES.includes(q.question_type)
        ),
      }))
      .filter((cat: any) => cat.questions.length > 0)
  }, [formDetail])

  // ── Derived state ─────────────────────────────────────────────────────────

  // Only filters where both question and answer are chosen
  const completeFilters = filters.filter(f => f.answerValue)
  const canSearch = !!csrId && !!formId && completeFilters.length > 0

  // Group raw results by submission — one row per submission, listing all matched Q&As
  const grouped = useMemo<SubmissionRow[]>(() => {
    const map = new Map<number, SubmissionRow>()
    for (const r of rawResults) {
      if (!map.has(r.submission_id)) {
        map.set(r.submission_id, {
          submission_id:    r.submission_id,
          submission_date:  r.submission_date,
          interaction_date: r.interaction_date,
          form_name:        r.form_name,
          matches:          [],
        })
      }
      map.get(r.submission_id)!.matches.push({
        category_name: r.category_name ?? null,
        question_text: r.question_text,
        answer:        r.answer,
      })
    }
    return Array.from(map.values())
  }, [rawResults])

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleFormChange = (v: string) => {
    setFormId(v)
    setFilters([])
    setRawResults([])
    setSelected(new Set())
    setExpandedCats(new Set())
  }

  const toggleQuestion = (id: number) => {
    setFilters(prev => {
      const exists = prev.find(f => f.questionId === id)
      if (exists) return prev.filter(f => f.questionId !== id)
      return [...prev, { questionId: id, answerValue: '' }]
    })
    setRawResults([])
    setSelected(new Set())
  }

  const setAnswer = (questionId: number, value: string) =>
    setFilters(prev => prev.map(f => f.questionId === questionId ? { ...f, answerValue: value } : f))

  const toggleSel = (id: number) => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const toggleCat = (catId: number) =>
    setExpandedCats(prev => {
      const next = new Set(prev)
      next.has(catId) ? next.delete(catId) : next.add(catId)
      return next
    })

  useEffect(() => {
    if (searchableCategories.length > 0) {
      setExpandedCats(new Set(searchableCategories.map((c: any) => c.id)))
    }
  }, [searchableCategories])

  // ── Search mutation ───────────────────────────────────────────────────────

  const { toast } = useToast()

  const searchMut = useMutation({
    mutationFn: () => writeupService.searchQaRecords({
      csr_id:           csrId,
      form_id:          formId ? Number(formId) : undefined,
      date_from:        dateFrom || undefined,
      date_to:          dateTo   || undefined,
      question_filters: completeFilters.map(f => ({
        question_id:  f.questionId,
        answer_value: f.answerValue,
      })),
    }),
    onSuccess: (data) => { setRawResults(data); setSelected(new Set()) },
    onError: (err: any) => {
      toast({
        title: 'Search failed',
        description: err?.response?.data?.message ?? err?.message ?? 'Could not fetch QA records.',
        variant: 'destructive',
      })
    },
  })

  // ── Import ────────────────────────────────────────────────────────────────

  const handleImport = () => {
    const examples: ExampleInput[] = Array.from(selected).map((submissionId, idx) => {
      const r = grouped.find(g => g.submission_id === submissionId)!
      const matchDesc = r.matches.map(m =>
        [
          `Form: ${r.form_name}`,
          m.category_name ? `Category: ${m.category_name}` : null,
          `Question: ${m.question_text}`,
          `Answer: ${formatAnswer(m.answer)}`,
        ].filter(Boolean).join('  |  ')
      ).join('\n')
      return {
        example_date:     r.interaction_date?.slice(0, 10) ?? r.submission_date?.slice(0, 10) ?? '',
        description:      matchDesc,
        source:           'QA_IMPORT' as const,
        qa_submission_id: submissionId,
        qa_question_id:   null,
        sort_order:       idx,
      }
    })
    onImport(examples)
    onClose()
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0">
      <DialogHeader className="px-5 pt-5 pb-3 border-b border-slate-100 shrink-0">
        <DialogTitle>Search QA Records</DialogTitle>
        <DialogDescription className="sr-only">
          Search QA submissions by form and question answer for the selected employee.
        </DialogDescription>
      </DialogHeader>

      {!csrId ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 py-12 px-6 text-center">
          <Search className="h-8 w-8 text-slate-200" />
          <p className="text-[14px] font-semibold text-slate-500">No employee selected</p>
          <p className="text-[13px] text-slate-400 max-w-xs">
            Select an employee at the top of the write-up form before searching QA records.
          </p>
        </div>
      ) : (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

          {/* ── Step 1: Form + Date range ──────────────────────────────────── */}
          <div className="px-5 py-3 border-b border-slate-100 shrink-0 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Form</p>
                <Select value={formId} onValueChange={handleFormChange}>
                  <SelectTrigger className="h-8 text-[13px]">
                    <SelectValue placeholder="Select a form…" />
                  </SelectTrigger>
                  <SelectContent>
                    {forms.map((f: any) => (
                      <SelectItem key={f.id} value={String(f.id)}>{f.form_name ?? f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Interaction Date Range</p>
                <div className="flex items-center gap-2">
                  <Input type="date" className="h-8 text-[12px] flex-1" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                  <span className="text-slate-400 text-[11px] shrink-0">to</span>
                  <Input type="date" className="h-8 text-[12px] flex-1" value={dateTo} onChange={e => setDateTo(e.target.value)} />
                </div>
              </div>
            </div>
          </div>

          {/* ── Step 2: Question picker (multi-select with answer per question) */}
          {formId && (
            <div className="px-5 py-3 border-b border-slate-100 shrink-0 max-h-[280px] overflow-y-auto">
              {loadingForm ? (
                <p className="text-[13px] text-slate-400 py-2">Loading questions…</p>
              ) : searchableCategories.length === 0 ? (
                <p className="text-[13px] text-slate-400 py-2">No searchable questions in this form.</p>
              ) : (
                <>
                  <p className="text-[11px] text-slate-400 mb-2">
                    Select one or more questions — results will include audits matching <span className="font-semibold text-slate-600">any</span> selection.
                  </p>
                  <div className="space-y-2">
                    {searchableCategories.map((cat: any) => (
                      <div key={cat.id} className="border border-slate-100 rounded-lg overflow-hidden">
                        <button
                          type="button"
                          className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 text-left transition-colors"
                          onClick={() => toggleCat(cat.id)}
                        >
                          <span className="text-[12px] font-semibold text-slate-600">{cat.category_name}</span>
                          {expandedCats.has(cat.id)
                            ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                            : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                          }
                        </button>

                        {expandedCats.has(cat.id) && (
                          <div className="divide-y divide-slate-50">
                            {cat.questions.map((q: any) => {
                              const qFilter = filters.find(f => f.questionId === q.id)
                              const isSelected = !!qFilter
                              return (
                                <div key={q.id} className={cn('px-3 py-2.5 transition-colors', isSelected ? 'bg-primary/5' : 'hover:bg-slate-50')}>
                                  <button
                                    type="button"
                                    className="w-full text-left"
                                    onClick={() => toggleQuestion(q.id)}
                                  >
                                    <div className="flex items-start gap-2">
                                      <span className={cn(
                                        'mt-0.5 w-4 h-4 shrink-0 rounded border-2 flex items-center justify-center',
                                        isSelected ? 'border-primary bg-primary' : 'border-slate-300'
                                      )}>
                                        {isSelected && <span className="text-white text-[9px] font-bold">✓</span>}
                                      </span>
                                      <span className={cn('text-[12px] flex-1', isSelected ? 'text-primary font-medium' : 'text-slate-700')}>
                                        {q.question_text}
                                      </span>
                                      <span className="text-[10px] text-slate-400 shrink-0 mt-0.5 uppercase tracking-wide">
                                        {q.question_type.replace('_', ' ')}
                                      </span>
                                    </div>
                                  </button>

                                  {isSelected && (
                                    <div className="mt-2 pl-6">
                                      <p className="text-[11px] text-slate-500 mb-1.5">Select the answer to search for:</p>
                                      <AnswerPicker
                                        question={q}
                                        value={qFilter?.answerValue ?? ''}
                                        onChange={v => setAnswer(q.id, v)}
                                      />
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Search button ──────────────────────────────────────────────── */}
          <div className="px-5 py-3 shrink-0 border-b border-slate-100">
            <Button
              size="sm"
              className="bg-primary hover:bg-primary/90 text-white"
              onClick={() => searchMut.mutate()}
              disabled={!canSearch || searchMut.isPending}
              title={!canSearch ? 'Select a form and at least one question with an answer' : undefined}
            >
              <Search className="h-3.5 w-3.5 mr-1.5" />
              {searchMut.isPending ? 'Searching…' : 'Search'}
            </Button>
            {!canSearch && formId && (
              <p className="text-[11px] text-slate-400 mt-1.5">
                {filters.length === 0
                  ? 'Select one or more questions above'
                  : completeFilters.length === 0
                  ? 'Select an answer for at least one question'
                  : ''}
              </p>
            )}
          </div>

          {/* ── Results ────────────────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto">
            {grouped.length === 0 ? (
              <p className="text-[13px] text-slate-400 py-6 text-center">
                {searchMut.isIdle ? 'Set your criteria above and search' : 'No matching submissions found'}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead className="w-28">Date</TableHead>
                    <TableHead>Matched Question(s) &amp; Answer(s)</TableHead>
                    <TableHead className="w-10 text-center">Form</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grouped.map(r => (
                    <TableRow
                      key={r.submission_id}
                      className="cursor-pointer"
                      onClick={() => toggleSel(r.submission_id)}
                    >
                      <TableCell>
                        <Checkbox
                          checked={selected.has(r.submission_id)}
                          onCheckedChange={() => toggleSel(r.submission_id)}
                          onClick={e => e.stopPropagation()}
                        />
                      </TableCell>
                      <TableCell className="text-slate-500 whitespace-nowrap text-[12px] align-top pt-3">
                        {formatQualityDate(r.interaction_date ?? r.submission_date)}
                      </TableCell>
                      <TableCell className="align-top pt-2.5">
                        <div className="space-y-1">
                          {r.matches.map((m, i) => (
                            <div key={i} className="text-[12px]">
                              {m.category_name && (
                                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mr-1.5">{m.category_name}</span>
                              )}
                              <span className="text-slate-600">{m.question_text}</span>
                              <span className="text-red-500 font-semibold ml-1.5">→ {formatAnswer(m.answer)}</span>
                            </div>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-center align-top pt-3">
                        <a
                          href={`/app/quality/submissions/${r.submission_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="inline-flex text-primary hover:text-primary/70 transition-colors"
                          title="View completed form"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          {/* ── Import footer ──────────────────────────────────────────────── */}
          <div className="shrink-0 flex items-center justify-between px-5 py-3 border-t border-slate-100">
            <span className="text-[13px] text-slate-500">
              {selected.size > 0
                ? `${selected.size} audit${selected.size !== 1 ? 's' : ''} selected`
                : 'No audits selected'}
            </span>
            <Button
              size="sm"
              className="bg-primary hover:bg-primary/90 text-white"
              disabled={selected.size === 0}
              onClick={handleImport}
            >
              Add to Write-Up
            </Button>
          </div>
        </div>
      )}
    </DialogContent>
  )
}

// ── Shared helpers ────────────────────────────────────────────────────────────

const formatAnswer = (answer: string) =>
  answer ? answer.charAt(0).toUpperCase() + answer.slice(1) : answer

// ── Coaching Search Modal ─────────────────────────────────────────────────────

interface CoachingSearchModalProps {
  csrId: number
  onImport?: (examples: ExampleInput[]) => void
  onImportRefs?: (refs: import('./types').PriorDisciplineRef[]) => void
  onClose: () => void
}

export function CoachingSearchModal({ csrId, onImport, onImportRefs, onClose }: CoachingSearchModalProps) {
  const defaults = getPrior90Days()
  const [dateFrom, setDateFrom]         = useState(defaults.from)
  const [dateTo, setDateTo]             = useState(defaults.to)
  const [selectedTopics, setTopics]     = useState<Set<string>>(new Set())
  const [draftTopics, setDraftTopics]   = useState<Set<string>>(new Set())
  const [topicOpen, setTopicOpen]       = useState(false)
  const [results, setResults]           = useState<any[]>([])
  const [selected, setSelected]         = useState<Set<number>>(new Set())
  const topicRef                        = useRef<HTMLDivElement>(null)

  const { data: topicItems = [] } = useQuery({
    queryKey: ['list-items', 'training_topic'],
    queryFn:  () => import('@/services/listService').then(m => m.default.getItems('training_topic')),
    staleTime: 5 * 60_000,
  })
  const activeTopics = topicItems.filter(i => i.is_active)

  // Group topics by category
  const topicCategories = useMemo(
    () => [...new Set(activeTopics.map(t => t.category).filter(Boolean))] as string[],
    [activeTopics]
  )
  const topicsByCat      = (cat: string) => activeTopics.filter(t => t.category === cat)
  const uncategorizedTopics = activeTopics.filter(t => !t.category)

  const openTopicDropdown = () => {
    setDraftTopics(new Set(selectedTopics))
    setTopicOpen(true)
  }
  const applyTopics = () => { setTopics(new Set(draftTopics)); setTopicOpen(false) }
  const cancelTopics = () => setTopicOpen(false)

  const toggleDraft = (label: string) => setDraftTopics(prev => {
    const next = new Set(prev)
    next.has(label) ? next.delete(label) : next.add(label)
    return next
  })

  const searchMut = useMutation({
    mutationFn: () => writeupService.searchCoachingSessions({
      csr_id:      csrId,
      date_from:   dateFrom || undefined,
      date_to:     dateTo   || undefined,
      topic_names: selectedTopics.size > 0 ? Array.from(selectedTopics) : undefined,
    }),
    onSuccess: (data) => { setResults(data); setSelected(new Set()) },
  })

  const toggleResult = (idx: number) => setSelected(prev => {
    const next = new Set(prev)
    next.has(idx) ? next.delete(idx) : next.add(idx)
    return next
  })

  const handleImport = () => {
    if (onImportRefs) {
      const purposeLabel: Record<string, string> = { WEEKLY: 'Weekly', PERFORMANCE: 'Performance', ONBOARDING: 'Onboarding' }
      const refs = Array.from(selected).map(idx => {
        const r = results[idx]
        const topics: string[] = Array.isArray(r.topic_names)
          ? r.topic_names.filter(Boolean)
          : r.topic_names ? [r.topic_names] : []
        return {
          reference_type: 'coaching_session' as const,
          reference_id:   r.session_id as number,
          label:          `Coaching #${r.session_id}`,
          date:           r.session_date?.slice(0, 10),
          subtype:        purposeLabel[r.coaching_purpose ?? ''] ?? (r.coaching_purpose ?? 'Coaching'),
          detail:         topics,
          notes:          r.notes as string | undefined,
          status:         r.status as string | undefined,
        }
      })
      onImportRefs(refs)
    } else if (onImport) {
      const examples: ExampleInput[] = Array.from(selected).map(idx => {
        const r = results[idx]
        const topicStr = Array.isArray(r.topic_names) ? r.topic_names.join(', ') : (r.topic_names ?? '')
        return {
          example_date: r.session_date?.slice(0, 10) ?? '',
          description:  `[${r.coaching_purpose ?? 'Coaching'}]${topicStr ? ` ${topicStr}` : ''} — ${(r.notes ?? '').slice(0, 100)}`,
          source:       'COACHING_IMPORT' as const,
          sort_order:   idx,
        }
      })
      onImport(examples)
    }
    onClose()
  }

  return (
    <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0">
      <DialogHeader className="px-5 pt-5 pb-3 border-b border-slate-100 shrink-0">
        <DialogTitle>Search Coaching Sessions</DialogTitle>
        <DialogDescription className="sr-only">
          Search coaching sessions by topic and date for the selected employee.
        </DialogDescription>
      </DialogHeader>

      {!csrId ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 py-12 px-6 text-center">
          <Search className="h-8 w-8 text-slate-200" />
          <p className="text-[14px] font-semibold text-slate-500">No employee selected</p>
          <p className="text-[13px] text-slate-400 max-w-xs">
            Select an employee at the top of the write-up form before searching coaching sessions.
          </p>
        </div>
      ) : (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

          {/* ── Step 1: Topics grouped multi-select ──────────────────────── */}
          <div className="px-5 py-3 border-b border-slate-100 shrink-0">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Topics</p>

            {/* Trigger button */}
            <button
              type="button"
              onClick={openTopicDropdown}
              className="w-full flex items-center justify-between h-9 px-3 border border-slate-200 rounded-md bg-white text-[13px] hover:border-primary/50 transition-colors"
            >
              <span className={selectedTopics.size === 0 ? 'text-slate-400' : 'text-slate-700'}>
                {selectedTopics.size === 0
                  ? 'All topics (no filter)'
                  : `${selectedTopics.size} topic${selectedTopics.size === 1 ? '' : 's'} selected`}
              </span>
              <ChevronDown className={cn('h-4 w-4 text-slate-400 shrink-0 transition-transform', topicOpen && 'rotate-180')} />
            </button>

            {/* Inline expanded panel — avoids overflow:hidden clipping in the modal */}
            {topicOpen && (
              <div className="mt-1 border border-slate-200 rounded-lg bg-white overflow-hidden">
                {/* Scrollable list */}
                <div className="overflow-y-auto" style={{ maxHeight: 200 }}>
                  {activeTopics.length === 0 && (
                    <p className="px-4 py-4 text-[13px] text-slate-400 text-center">No topics found in list management</p>
                  )}
                  {topicCategories.map(cat => (
                    <div key={cat}>
                      <p className="px-3 pt-2 pb-0.5 text-[10px] font-semibold text-slate-500 uppercase tracking-widest bg-slate-50 border-b border-slate-100">
                        {cat}
                      </p>
                      {topicsByCat(cat).map(t => (
                        <label
                          key={t.id}
                          className="flex items-center gap-2.5 px-4 py-1.5 text-[13px] text-slate-700 hover:bg-slate-50 cursor-pointer select-none"
                        >
                          <Checkbox
                            checked={draftTopics.has(t.label)}
                            onCheckedChange={() => toggleDraft(t.label)}
                          />
                          {t.label}
                        </label>
                      ))}
                    </div>
                  ))}
                  {uncategorizedTopics.length > 0 && (
                    <div>
                      {topicCategories.length > 0 && (
                        <p className="px-3 pt-2 pb-0.5 text-[10px] font-semibold text-slate-400 uppercase tracking-widest bg-slate-50 border-b border-slate-100">
                          Uncategorized
                        </p>
                      )}
                      {uncategorizedTopics.map(t => (
                        <label
                          key={t.id}
                          className="flex items-center gap-2.5 px-4 py-1.5 text-[13px] text-slate-700 hover:bg-slate-50 cursor-pointer select-none"
                        >
                          <Checkbox
                            checked={draftTopics.has(t.label)}
                            onCheckedChange={() => toggleDraft(t.label)}
                          />
                          {t.label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* Footer with Cancel / Apply */}
                <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 bg-slate-50">
                  <button
                    type="button"
                    onClick={() => setDraftTopics(new Set())}
                    className="text-[12px] text-slate-400 hover:text-slate-600"
                  >
                    Clear all
                  </button>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" className="h-7 text-[12px]" onClick={cancelTopics}>
                      Cancel
                    </Button>
                    <Button type="button" size="sm" className="h-7 text-[12px] bg-primary hover:bg-primary/90 text-white" onClick={applyTopics}>
                      Apply
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Step 2: Date range ────────────────────────────────────────── */}
          <div className="px-5 py-3 border-b border-slate-100 shrink-0">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Session Date Range</p>
            <div className="flex items-center gap-2">
              <Input type="date" className="h-8 text-[12px] flex-1" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              <span className="text-slate-400 text-[11px] shrink-0">to</span>
              <Input type="date" className="h-8 text-[12px] flex-1" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
          </div>

          {/* ── Search button ─────────────────────────────────────────────── */}
          <div className="px-5 py-3 border-b border-slate-100 shrink-0">
            <Button size="sm" className="bg-primary hover:bg-primary/90 text-white"
              onClick={() => searchMut.mutate()} disabled={searchMut.isPending}>
              <Search className="h-3.5 w-3.5 mr-1.5" />
              {searchMut.isPending ? 'Searching…' : 'Search'}
            </Button>
          </div>

          {/* ── Results ───────────────────────────────────────────────────── */}
          <div className="overflow-y-auto flex-1">
            {results.length === 0 ? (
              <p className="text-[13px] text-slate-400 py-8 text-center">
                {searchMut.isIdle ? 'Run a search to see results' : 'No results found'}
              </p>
            ) : (
              <div className="divide-y divide-slate-50">
                {results.map((r, i) => (
                  <div key={i} className="flex items-start gap-3 px-5 py-2.5 hover:bg-slate-50/50 cursor-pointer"
                    onClick={() => toggleResult(i)}>
                    <Checkbox className="mt-0.5" checked={selected.has(i)} onCheckedChange={() => toggleResult(i)} onClick={e => e.stopPropagation()} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <span className="text-[12px] font-medium text-slate-700">{r.coaching_purpose ?? '—'}</span>
                        <span className="text-[11px] text-slate-400">{formatQualityDate(r.session_date)}</span>
                      </div>
                      {r.topic_names?.length > 0 && (
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {Array.isArray(r.topic_names) ? r.topic_names.join(', ') : r.topic_names}
                        </p>
                      )}
                      {r.notes && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{r.notes.slice(0, 100)}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Import bar ────────────────────────────────────────────────── */}
          {selected.size > 0 && (
            <div className="shrink-0 flex items-center justify-between px-5 py-3 border-t border-slate-100">
              <span className="text-[13px] text-slate-500">{selected.size} selected</span>
              <Button size="sm" className="bg-primary hover:bg-primary/90 text-white" onClick={handleImport}>
                {onImportRefs ? 'Add to Prior Discipline' : 'Add to Write-Up'}
              </Button>
            </div>
          )}
        </div>
      )}
    </DialogContent>
  )
}

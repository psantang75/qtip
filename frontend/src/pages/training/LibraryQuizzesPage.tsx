import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Eye } from 'lucide-react'
import trainingService, { type LibraryQuiz } from '@/services/trainingService'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { QualityFilterBar } from '@/components/common/QualityFilterBar'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'
import { SortableTableHead } from '@/components/common/SortableTableHead'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { TableErrorState } from '@/components/common/TableErrorState'
import { ListPagination } from '@/components/common/ListPagination'
import { StagedMultiSelect } from '@/components/common/StagedMultiSelect'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { useListSort } from '@/hooks/useListSort'
import { StatusBadge } from '@/components/common/StatusBadge'
import { QuizPreviewModal } from '@/components/training/QuizPreviewModal'

type StatusFilter = 'all' | 'active' | 'inactive'

export default function LibraryQuizzesPage() {
  const navigate        = useNavigate()
  const qc              = useQueryClient()
  const { toast }       = useToast()

  const [search,        setSearch]        = useState('')
  const [statusFilter,  setStatusFilter]  = useState<StatusFilter>('active')
  const [topicFilter,   setTopicFilter]   = useState<string[]>([])
  const [page,          setPage]          = useState(1)
  const [pageSize,      setPageSize]      = useState(20)
  const [previewOpen, setPreviewOpen] = useState(false)

  const { data: quizData, isLoading, isError, refetch } = useQuery({
    queryKey: ['quiz-library-all'],
    queryFn:  () => trainingService.getQuizLibrary({ limit: 500 }),
  })

  const allQuizzes = quizData?.items ?? []

  // Base filter (search + status) — used to derive the topic option list
  const baseFiltered = useMemo(() => {
    let items = allQuizzes
    if (search.trim())
      items = items.filter((q: LibraryQuiz) =>
        q.quiz_title.toLowerCase().includes(search.toLowerCase()) ||
        q.topic_names.some(n => n.toLowerCase().includes(search.toLowerCase())))
    if (statusFilter === 'active')   items = items.filter((q: LibraryQuiz) => q.is_active)
    if (statusFilter === 'inactive') items = items.filter((q: LibraryQuiz) => !q.is_active)
    return items
  }, [allQuizzes, search, statusFilter])

  const filtered = useMemo(() => {
    if (topicFilter.length === 0) return baseFiltered
    return baseFiltered.filter((q: LibraryQuiz) =>
      topicFilter.some(t => q.topic_names.includes(t)))
  }, [baseFiltered, topicFilter])

  const { sort, dir, toggle, sorted } = useListSort(filtered)
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const quizzes    = sorted.slice((page - 1) * pageSize, page * pageSize)
  const onSort     = (field: string) => { toggle(field); setPage(1) }

  // Topic options: only those present in the current search+status results
  const topicOptions = useMemo(() => {
    const present = new Set(baseFiltered.flatMap((q: LibraryQuiz) => q.topic_names))
    return [...present].sort()
  }, [baseFiltered])

  const hasFilters = search.trim().length > 0 || statusFilter !== 'active' || topicFilter.length > 0

  const invalidate = () => qc.invalidateQueries({ queryKey: ['quiz-library-all'] })

  const toggleMut = useMutation({
    mutationFn: (id: number) => trainingService.toggleQuizStatus(id),
    onSuccess: invalidate,
    onError: () => toast({ title: 'Failed to update status', variant: 'destructive' }),
  })

  const [previewQuiz, setPreviewQuiz] = useState<{ id?: number; quiz_title: string; pass_score: number; questions: { question_text: string; options: string[]; correct_option: number }[] } | null>(null)

  const previewMut = useMutation({
    mutationFn: (id: number) => trainingService.getLibraryQuizDetail(id),
    onSuccess: (detail) => { setPreviewQuiz(detail); setPreviewOpen(true) },
    onError: () => toast({ title: 'Failed to load quiz preview', variant: 'destructive' }),
  })

  const openPreview = (id: number) => previewMut.mutate(id)

  return (
    <QualityListPage>
      <QualityPageHeader
        title="Quizzes"
        actions={
          <Button className="bg-primary hover:bg-primary/90 text-white"
            onClick={() => navigate('/app/training/library/quizzes/new')}>
            <Plus className="h-4 w-4 mr-1" /> New Quiz
          </Button>
        }
      />

      <QualityFilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search quizzes..."
        hasFilters={hasFilters}
        onReset={() => { setSearch(''); setStatusFilter('active'); setTopicFilter([]); setPage(1) }}
        resultCount={{ filtered: sorted.length, total: allQuizzes.length }}
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
        {isLoading ? <TableLoadingSkeleton rows={6} /> : isError ? (
          <TableErrorState message="Failed to load quizzes." onRetry={refetch} />
        ) : (
          <Table>
            <TableHeader>
              <StandardTableHeaderRow>
                <SortableTableHead field="quiz_title"     sort={sort} dir={dir} onSort={onSort}>Quiz Title</SortableTableHead>
                <TableHead>Topics</TableHead>
                <SortableTableHead field="question_count" sort={sort} dir={dir} onSort={onSort} className="text-center">Questions</SortableTableHead>
                <SortableTableHead field="pass_score"     sort={sort} dir={dir} onSort={onSort} className="text-center">Pass Score</SortableTableHead>
                <SortableTableHead field="times_used"     sort={sort} dir={dir} onSort={onSort} className="text-center">Times Used</SortableTableHead>
                <SortableTableHead field="is_active"      sort={sort} dir={dir} onSort={onSort}>Status</SortableTableHead>
                <TableHead className="w-32" />
              </StandardTableHeaderRow>
            </TableHeader>
            <TableBody>
              {quizzes.length === 0 ? (
                <TableEmptyState colSpan={7} title="No quizzes found" description="Try adjusting your filters or create a new quiz" />
              ) : quizzes.map((q: LibraryQuiz) => (
                <TableRow key={q.id} className="hover:bg-slate-50/50">
                  <TableCell className="text-[13px] font-medium text-slate-900">{q.quiz_title}</TableCell>

                  {/* Topics with tooltip — same as resources */}
                  <TableCell className="max-w-[180px]">
                    {q.topic_names.length > 0 ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-[13px] text-slate-500 truncate block max-w-[180px] cursor-default">
                            {[...q.topic_names].sort().join(', ')}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent
                          className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
                          sideOffset={6}
                        >
                          <ul className="space-y-1">
                            {[...q.topic_names].sort().map(name => (
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

                  <TableCell className="text-center text-[13px] text-slate-600">{q.question_count}</TableCell>
                  <TableCell className="text-center text-[13px] text-slate-600">{q.pass_score}%</TableCell>
                  <TableCell className="text-center text-[13px] text-slate-600">{q.times_used}</TableCell>
                  <TableCell><StatusBadge status={q.is_active ? 'ACTIVE' : 'INACTIVE'} /></TableCell>

                  <TableCell>
                    <div className="flex items-center gap-1 justify-end">
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px] text-slate-600 gap-1"
                        onClick={() => openPreview(q.id)}>
                        <Eye className="h-3.5 w-3.5" /> Preview
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px] text-slate-600 gap-1"
                        onClick={() => navigate(`/app/training/library/quizzes/${q.id}/edit`)}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                    </div>
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
        onPageSizeChange={size => { setPageSize(size); setPage(1) }}
      />

      <QuizPreviewModal
        quiz={previewQuiz}
        open={previewOpen}
        onClose={() => { setPreviewOpen(false); setPreviewQuiz(null) }}
      />
    </QualityListPage>
  )
}

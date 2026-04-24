import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Eye } from 'lucide-react'
import trainingService, { type LibraryQuiz } from '@/services/trainingService'
import { ListPageShell } from '@/components/common/ListPageShell'
import { ListPageHeader } from '@/components/common/ListPageHeader'
import { ListFilterBar } from '@/components/common/ListFilterBar'
import { ListCard } from '@/components/common/ListCard'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'
import { SortableTableHead } from '@/components/common/SortableTableHead'
import { ListLoadingSkeleton } from '@/components/common/ListLoadingSkeleton'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { TableErrorState } from '@/components/common/TableErrorState'
import { ListPagination } from '@/components/common/ListPagination'
import { StagedMultiSelect } from '@/components/common/StagedMultiSelect'
import { RowActionButton } from '@/components/common/RowActionButton'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusActiveFilter } from '@/components/common/StatusActiveFilter'
import { useToast } from '@/hooks/use-toast'
import { useListSort } from '@/hooks/useListSort'
import { QuizPreviewModal } from '@/components/training/QuizPreviewModal'
import { TopicListTooltip } from '@/components/training/TopicListTooltip'

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
    queryFn:  () => trainingService.getQuizLibrary({ limit: 1000 }),
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
    <ListPageShell>
      <ListPageHeader
        title="Quizzes"
        actions={
          <Button variant="primary"
            onClick={() => navigate('/app/training/library/quizzes/new')}>
            <Plus className="h-4 w-4 mr-1" /> New Quiz
          </Button>
        }
      />

      <ListFilterBar
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
        <StatusActiveFilter
          value={statusFilter}
          onChange={v => { setStatusFilter(v); setPage(1) }}
          allLabel="All Statuses"
          widthClass="w-[160px]"
        />
      </ListFilterBar>

      <ListCard>
        {isLoading ? <ListLoadingSkeleton rows={6} /> : isError ? (
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
                  <TableCell className="text-[13px] text-slate-600">{q.quiz_title}</TableCell>

                  {/* Topics with tooltip — same as resources */}
                  <TableCell className="max-w-[180px]">
                    <TopicListTooltip topics={q.topic_names} />
                  </TableCell>

                  <TableCell className="text-center text-[13px] text-slate-600">{q.question_count}</TableCell>
                  <TableCell className="text-center text-[13px] text-slate-600">{q.pass_score}%</TableCell>
                  <TableCell className="text-center text-[13px] text-slate-600">{q.times_used}</TableCell>
                  <TableCell className="text-[13px] text-slate-600">{q.is_active ? 'Active' : 'Inactive'}</TableCell>

                  <TableCell>
                    <div className="flex items-center gap-1 justify-end">
                      <RowActionButton icon={Eye} onClick={() => openPreview(q.id)}>
                        Preview
                      </RowActionButton>
                      <RowActionButton icon={Pencil}
                        onClick={() => navigate(`/app/training/library/quizzes/${q.id}/edit`)}>
                        Edit
                      </RowActionButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ListCard>

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
    </ListPageShell>
  )
}

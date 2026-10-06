import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { optionCls } from '@/utils/forms/optionCls'
import { InsightsSection } from '@/components/insights'
import SortableTable from '@/components/insights/agentActivity/SortableTable'
import { answerLabel } from './agentProfileHelpers'
import { getManagerReviewAnswers, type HiddenAnswerRow, type QCParams } from '@/services/insightsQCService'

const VIEWS = [
  { key: 'flagged', label: 'Notes Only' },
  { key: 'all',     label: 'All Answers' },
] as const
type View = typeof VIEWS[number]['key']

function AnswerCell({ row }: { row: HiddenAnswerRow }) {
  const answer = row.answer?.trim()
  const notes  = row.notes?.trim()
  const shown  = answer ? (row.type === 'TEXT' ? answer : answerLabel(answer.toLowerCase())) : null
  return (
    <div className="whitespace-pre-wrap break-words">
      {shown
        ? <span className="text-slate-800">{shown}</span>
        : <span className="text-slate-400">—</span>}
      {notes && <div className="mt-1 text-[12px] text-slate-500"><span className="uppercase text-[10px] text-slate-400 mr-1">Note</span>{notes}</div>}
    </div>
  )
}

export default function ManagerReviewAnswersSection({ params }: { params: QCParams }) {
  const navigate = useNavigate()
  const [view, setView] = useState<View>('flagged')
  const apiParams = useMemo(() => (view === 'all' ? { ...params, all: '1' as const } : params), [params, view])

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['insights', 'qc-manager-review', 'answers', apiParams],
    queryFn:  () => getManagerReviewAnswers(apiParams),
  })

  const columns = useMemo<ColumnDef<HiddenAnswerRow, unknown>[]>(() => [
    {
      accessorKey: 'submissionId', header: 'Review ID', meta: { width: 'w-[9%]' },
      cell: ({ row }) => (
        <a href={`/app/quality/submissions/${row.original.submissionId}`} target="_blank" rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
          #{row.original.submissionId}<ExternalLink size={12} />
        </a>
      ),
    },
    { accessorKey: 'date', header: 'Review Date', meta: { width: 'w-[10%]' } },
    { accessorKey: 'agent', header: 'Agent', meta: { width: 'w-[13%]' },
      cell: ({ row }) => <span className="font-medium text-primary hover:underline">{row.original.agent}</span> },
    { accessorKey: 'dept', header: 'Department', meta: { width: 'w-[12%]' } },
    { accessorKey: 'question', header: 'Question', meta: { width: 'w-[22%]' },
      cell: ({ row }) => (
        <div className="break-words">
          <div className="text-slate-800">{row.original.question}</div>
          <div className="text-[11px] text-slate-400">{row.original.form}</div>
        </div>
      ) },
    { id: 'answer', accessorFn: r => r.answer ?? '', header: 'Answer / Note', meta: { width: 'w-[34%]' },
      cell: ({ row }) => <AnswerCell row={row.original} /> },
  ], [])

  return (
    <InsightsSection
      title="Manager-Only Answers"
      infoKpiCodes={['mr_answers_list']}
      description={rows.length > 0 ? `${rows.length} ${rows.length === 1 ? 'item' : 'items'} in the selected period` : undefined}
    >
      <div className="mb-3 flex flex-wrap items-center justify-end gap-1.5">
        <span className="text-[11px] uppercase tracking-wide text-slate-400 mr-0.5">View</span>
        {VIEWS.map(v => (
          <button key={v.key} type="button" onClick={() => setView(v.key)}
            className={cn('rounded-full border px-3 py-1 text-[12px] font-medium transition-colors', optionCls(view === v.key))}>
            {v.label}
          </button>
        ))}
      </div>
      {isLoading
        ? <p className="text-sm text-slate-400 text-center py-4">Loading…</p>
        : rows.length === 0
          ? <p className="text-sm text-slate-400 text-center py-4">No manager items for the selected period.</p>
          : (
            <SortableTable<HiddenAnswerRow>
              columns={columns}
              data={rows}
              initialSorting={[{ id: 'date', desc: true }]}
              minWidth="min-w-[900px]"
              paginated
              onRowClick={r => navigate(`/app/insights/qc-agents?agent=${r.userId}`)}
            />
          )}
    </InsightsSection>
  )
}

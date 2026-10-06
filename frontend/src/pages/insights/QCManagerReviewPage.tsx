import { useQuery } from '@tanstack/react-query'
import { InsightsFilterBar, KpiTile, QCPageSkeleton, ErrorCard } from '@/components/insights'
import ManagerReviewQuestionsSection from '@/components/insights/ManagerReviewQuestionsSection'
import ManagerReviewAnswersSection from '@/components/insights/ManagerReviewAnswersSection'
import { useQCFilters } from '@/hooks/useQCFilters'
import { getFilterOptions, getManagerReviewSummary } from '@/services/insightsQCService'

export default function QCManagerReviewPage() {
  const { departments, setDepartments, period, setPeriod,
          customStart, setCustomStart, customEnd, setCustomEnd,
          forms, setForms, resetFilters, params } = useQCFilters()

  const { data: filterOpts } = useQuery({
    queryKey: ['insights', 'qc-manager-review', 'filter-options', params],
    queryFn:  () => getFilterOptions(params),
  })
  const { data: summary, isLoading, isError, refetch } = useQuery({
    queryKey: ['insights', 'qc-manager-review', 'summary', params],
    queryFn:  () => getManagerReviewSummary(params),
  })

  const kpis = summary?.kpis
  const filterContext = { dept: departments.length > 0, form: forms.length > 0 }

  return (
    <div>
      <InsightsFilterBar
        selectedDepts={departments} onDeptsChange={setDepartments}
        availableDepts={filterOpts?.departments ?? []}
        period={period} onPeriodChange={setPeriod}
        customStart={customStart} customEnd={customEnd}
        onCustomStartChange={setCustomStart} onCustomEndChange={setCustomEnd}
        showFormFilter selectedForms={forms} onFormsChange={setForms}
        availableForms={filterOpts?.forms ?? []}
        currentDateRange={summary?.range ? { start: summary.range.startDate, end: summary.range.endDate } : undefined}
        onReset={resetFilters}
      />
      {isLoading && <QCPageSkeleton tiles={2} />}
      {isError   && <ErrorCard onRetry={refetch} />}
      {!isLoading && !isError && <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Manager Review Items</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Answers to form questions hidden from agents (Agent Visible = No), such as coaching questions and manager-only notes. Management only.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <KpiTile kpiCode="mr_reviews_flagged" value={kpis?.reviewsFlagged ?? null} filterContext={filterContext} />
          <KpiTile kpiCode="mr_notes"           value={kpis?.notes ?? null}          filterContext={filterContext} />
        </div>

        <ManagerReviewQuestionsSection questions={summary?.questions ?? []} />
        <ManagerReviewAnswersSection params={params} />
      </div>}
    </div>
  )
}

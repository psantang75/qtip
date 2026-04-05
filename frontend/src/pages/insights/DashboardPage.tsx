import { useQuery } from '@tanstack/react-query'
import { BarChart3, Clock, Database } from 'lucide-react'
import { getDataFreshness } from '@/services/insightsService'
import { useInsightsNavigation } from '@/hooks/useInsightsNavigation'

export default function DashboardPage() {
  const { categories } = useInsightsNavigation()
  const { data: freshness } = useQuery({
    queryKey: ['insights-data-freshness'],
    queryFn: getDataFreshness,
    staleTime: 60_000,
  })

  const hasSections = categories.length > 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-primary" />
          Insights Engine
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Performance analytics and reporting platform
        </p>
      </div>

      {!hasSections && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <Database className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-slate-700">No Analytics Sections Configured</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            Sections will appear here as they are built. The Insights Engine foundation is ready and
            waiting for section blueprints to be deployed.
          </p>
        </div>
      )}

      {freshness && freshness.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-1.5">
            <Clock className="h-4 w-4" /> Data Freshness
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {freshness.map((f) => (
              <div key={f.source_system} className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-sm font-medium text-slate-700 capitalize">{f.source_system}</span>
                <span className={`text-xs ${(f.hours_since ?? 999) > 24 ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {f.last_success_at
                    ? `${f.hours_since?.toFixed(1)}h ago`
                    : 'No data yet'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

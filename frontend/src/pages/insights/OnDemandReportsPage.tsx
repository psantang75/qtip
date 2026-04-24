import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { MousePointerClick, Loader2, FileSpreadsheet } from 'lucide-react'

import { RowActionButton } from '@/components/common/RowActionButton'

import { listReports } from '@/services/onDemandReportsService'

export default function OnDemandReportsPage() {
  const navigate = useNavigate()
  const { data: reports, isLoading, isError } = useQuery({
    queryKey: ['on-demand-reports', 'list'],
    queryFn: listReports,
  })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">On Demand Reports</h1>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-slate-500 text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading reports…
          </div>
        ) : isError ? (
          <div className="py-10 text-center text-sm text-red-600">
            Failed to load reports. Please try again.
          </div>
        ) : !reports || reports.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400">
            No reports available for your role.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-200">
                <th className="text-left py-2 px-2 font-medium">Report</th>
                <th className="text-left py-2 px-2 font-medium">Description</th>
                <th className="text-right py-2 px-2 font-medium w-[100px]">Action</th>
              </tr>
            </thead>
            <tbody>
              {reports.map(r => (
                <tr
                  key={r.id}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer"
                  onClick={() => navigate(`/app/insights/on-demand-reports/${encodeURIComponent(r.id)}`)}
                >
                  <td className="py-2 px-2 align-top">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="h-4 w-4 text-primary" />
                      <span className="font-medium text-slate-800">{r.name}</span>
                    </div>
                  </td>
                  <td className="py-2 px-2 align-top text-slate-500">
                    {r.description}
                  </td>
                  <td className="py-2 px-2 align-top text-right">
                    <RowActionButton
                      icon={MousePointerClick}
                      onClick={(e) => {
                        e.stopPropagation()
                        navigate(`/app/insights/on-demand-reports/${encodeURIComponent(r.id)}`)
                      }}
                    >
                      Select
                    </RowActionButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

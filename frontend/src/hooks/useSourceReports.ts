import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getSourceReports,
  updateSourceReport,
  runSourceReportNow,
  type SourceReport,
  type SourceReportUpdate,
} from '@/services/insightsService'

export type { SourceReport, SourceReportUpdate }

const KEY = ['ie-source-reports']

/** Fetch all ingestion source reports with their full scheduling state. */
export function useSourceReports() {
  return useQuery({
    queryKey: KEY,
    queryFn:  getSourceReports,
    staleTime: 30_000,
  })
}

/** Mutation to update a source report's scheduling fields. */
export function useUpdateSourceReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: SourceReportUpdate }) =>
      updateSourceReport(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }) },
  })
}

/** Mutation to queue a source report to run on the dispatcher's next tick. */
export function useRunSourceReportNow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => runSourceReportNow(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }) },
  })
}

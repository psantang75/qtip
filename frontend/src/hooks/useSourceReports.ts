import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getSourceReports,
  updateSourceReport,
  runSourceReportNow,
  getEmailFeeds,
  createEmailFeed,
  updateEmailFeed,
  deleteEmailFeed,
  type SourceReport,
  type SourceReportUpdate,
  type EmailFeed,
  type EmailFeedCreate,
  type EmailFeedUpdate,
} from '@/services/insightsService'

export type { SourceReport, SourceReportUpdate, EmailFeed, EmailFeedCreate, EmailFeedUpdate }

const KEY = ['ie-source-reports']
const EMAIL_FEEDS_KEY = ['ie-email-feeds']

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

/** Fetch the configured email pickup feeds with their latest import status. */
export function useEmailFeeds() {
  return useQuery({
    queryKey: EMAIL_FEEDS_KEY,
    queryFn:  getEmailFeeds,
    staleTime: 30_000,
  })
}

/** Mutation to add a new email feed to the registry. */
export function useCreateEmailFeed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: EmailFeedCreate) => createEmailFeed(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: EMAIL_FEEDS_KEY }) },
  })
}

/** Mutation to edit an email feed's name / cadence / active flag. */
export function useUpdateEmailFeed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: EmailFeedUpdate }) =>
      updateEmailFeed(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: EMAIL_FEEDS_KEY }) },
  })
}

/** Mutation to remove an email feed from the registry. */
export function useDeleteEmailFeed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteEmailFeed(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: EMAIL_FEEDS_KEY }) },
  })
}

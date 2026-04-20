import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/hooks/use-toast'
import writeupService from '@/services/writeupService'
import { openWriteUpPdf } from '../writeup-pdf/openPdf'

/**
 * Shared data-fetching, cache-invalidation, and PDF logic
 * used by both WriteUpDetailPage and MyWriteUpDetailPage.
 */
export function useWriteUpDetail(id: string | undefined, extraInvalidateKeys?: string[][]) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [pdfLoading, setPdfLoading] = useState(false)

  const { data: writeup, isLoading, isError, refetch } = useQuery({
    queryKey: ['writeup', id],
    queryFn: () => writeupService.getWriteUpById(Number(id)),
    enabled: !!id,
    staleTime: 0,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['writeup', id] })
    if (extraInvalidateKeys) {
      extraInvalidateKeys.forEach(key => qc.invalidateQueries({ queryKey: key }))
    }
  }

  const handleViewPdf = async () => {
    if (!writeup) return
    setPdfLoading(true)
    try { await openWriteUpPdf(writeup) }
    catch { toast({ title: 'PDF generation failed', variant: 'destructive' }) }
    finally { setPdfLoading(false) }
  }

  return { writeup, isLoading, isError, refetch, invalidate, pdfLoading, handleViewPdf }
}

import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { getInsightsAccess } from '@/services/insightsService'
import type { DataScope } from '@/services/insightsService'

interface InsightsAccess {
  canAccess: boolean
  dataScope: DataScope | null
  isLoading: boolean
  error: Error | null
}

export function useInsightsAccess(pageKey: string): InsightsAccess {
  const { user } = useAuth()

  const { data, isLoading, error } = useQuery({
    queryKey: ['insights-access', pageKey, user?.id],
    queryFn: () => getInsightsAccess(pageKey),
    enabled: !!user && !!pageKey,
    staleTime: 5 * 60 * 1000,
  })

  return {
    canAccess: data?.canAccess ?? false,
    dataScope: data?.dataScope ?? null,
    isLoading,
    error: error as Error | null,
  }
}

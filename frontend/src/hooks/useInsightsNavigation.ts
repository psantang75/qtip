import { useQuery } from '@tanstack/react-query'
import { getInsightsNavigation } from '@/services/insightsService'
import type { InsightsNavCategory } from '@/services/insightsService'

export function useInsightsNavigation() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['insights-navigation'],
    queryFn: getInsightsNavigation,
    staleTime: 10 * 60 * 1000,
  })

  return {
    categories: (data ?? []) as InsightsNavCategory[],
    isLoading,
    error: error as Error | null,
  }
}

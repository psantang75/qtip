import { QueryClient } from '@tanstack/react-query'

/**
 * Global TanStack Query client.
 *
 * Extracted from `App.tsx` during the pre-production review (item #75) so
 * the top-level component stays focused on provider composition.
 *
 * Query-key conventions live in `docs/frontend/query_key_conventions.md`
 * (pre-production review item #77).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

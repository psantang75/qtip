import { MutationCache, QueryClient } from '@tanstack/react-query'
import { toast } from '@/hooks/use-toast'
import { mapErrorToToast } from '@/lib/errorMessages'

/**
 * Global TanStack Query client.
 *
 * Extracted from `App.tsx` during the pre-production review (item #75) so
 * the top-level component stays focused on provider composition.
 *
 * Query-key conventions live in `docs/frontend/query_key_conventions.md`
 * (pre-production review item #77).
 *
 * ── Global error handling ──────────────────────────────────────────────────
 *
 * The `MutationCache.onError` below is the centerpiece of QTIP's standardized
 * user-facing error story (see `docs/error-messages-catalog.md`). It auto-
 * surfaces a canonical destructive toast for any mutation that fails, so the
 * dozens of "silent failure" mutations identified in the catalog now show a
 * proper message without per-call-site wiring.
 *
 * Opt-out / override (see module augmentation below):
 *   useMutation({ ..., meta: { silent: true } })
 *     └─ disables the auto-toast entirely (e.g. background polling)
 *   useMutation({ ..., meta: { errorTitle: "Couldn't archive prompt" } })
 *     └─ replaces the canonical title; description still derives from the
 *        HTTP status / backend envelope
 *   useMutation({ ..., onError: (e) => { ... } })
 *     └─ if you supply your own onError, the global handler defers to it.
 *        Use this when you need anything richer than a toast (set form
 *        errors, custom UI, etc.).
 */

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      silent?: boolean
      errorTitle?: string
    }
    queryMeta: {
      silent?: boolean
      errorTitle?: string
    }
  }
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      // Caller is opting out of the global toast (e.g. background polling).
      if (mutation.meta?.silent) return

      // Caller supplied their own onError — they handle the UX. Defer to them
      // so we never double-toast.
      if (mutation.options.onError) return

      // 401 is handled centrally by the apiClient response interceptor
      // (clears storage and redirects to /login). No toast needed; the user
      // is about to be redirected.
      const status =
        (error as { response?: { status?: number } })?.response?.status
      if (status === 401) return

      const t = mapErrorToToast(error)
      const overrideTitle = mutation.meta?.errorTitle
      toast({
        variant: t.variant,
        title: typeof overrideTitle === 'string' ? overrideTitle : t.title,
        description: t.description,
      })
    },
  }),
})

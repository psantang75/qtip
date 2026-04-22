/**
 * PageSpinner — the centred primary-coloured spinner used as the page-level
 * loading indicator. Used by both the Suspense fallback in App.tsx and any
 * page that needs a "loading the page itself" state.
 */
export function PageSpinner() {
  return (
    <div className="flex items-center justify-center h-40">
      <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  )
}

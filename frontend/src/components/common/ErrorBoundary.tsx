import React from 'react'
import { AlertTriangle } from 'lucide-react'
import { logError } from '@/utils/errorHandling'

/**
 * Application error boundary.
 *
 * Pre-production review item #76 — without a boundary, any thrown error
 * inside a React render would unmount the whole tree and leave the user
 * staring at a blank screen. This captures render-time errors, logs them
 * through the shared dev-only logger, and renders a minimal fallback with
 * a "Reload" affordance so the user can recover without closing the tab.
 *
 * Async errors (promise rejections, TanStack Query errors, event handlers)
 * are NOT caught by error boundaries — each page is responsible for
 * rendering its own query-error state. This guards render + lifecycle only.
 */
interface ErrorBoundaryProps {
  children: React.ReactNode
  /** Optional custom fallback. Receives the captured error + a reset callback. */
  fallback?: (error: Error, reset: () => void) => React.ReactNode
  /** Optional scope tag for `logError`; defaults to "ErrorBoundary". */
  scope?: string
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    logError(this.props.scope ?? 'ErrorBoundary', error, info.componentStack)
  }

  private reset = (): void => {
    this.setState({ error: null })
  }

  render(): React.ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    if (this.props.fallback) return this.props.fallback(error, this.reset)

    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-lg border border-red-200 bg-red-50 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-red-800">Something went wrong</h2>
              <p className="text-xs text-red-700">
                The page ran into an unexpected error. You can try again, or refresh to
                reload the latest version.
              </p>
              {import.meta.env.DEV && (
                <pre className="mt-2 text-[11px] text-red-700 whitespace-pre-wrap break-words">
                  {error.message}
                </pre>
              )}
            </div>
          </div>
          <div className="mt-4 flex gap-2 justify-end">
            <button
              type="button"
              onClick={this.reset}
              className="text-xs px-3 py-1.5 rounded border border-red-300 text-red-700 hover:bg-red-100"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="text-xs px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700"
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    )
  }
}

export default ErrorBoundary

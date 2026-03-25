import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface TableErrorStateProps {
  message?: string
  onRetry?: () => void
}

export function TableErrorState({
  message = 'Failed to load data.',
  onRetry,
}: TableErrorStateProps) {
  return (
    <div className="p-6 bg-red-50 border border-red-200 flex items-center justify-between">
      <p className="text-[13px] text-red-700 font-medium">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="h-4 w-4 mr-1" /> Retry
        </Button>
      )}
    </div>
  )
}

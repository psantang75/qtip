import { useNavigate } from 'react-router-dom'
import { FileQuestion, Home } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export default function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
          <div className="rounded-full bg-muted p-4">
            <FileQuestion size={32} className="text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-4xl font-bold text-slate-900">404</h1>
            <p className="text-lg font-medium text-slate-700 mt-1">Page not found</p>
            <p className="text-sm text-muted-foreground mt-2 max-w-xs">
              The page you're looking for doesn't exist or has been moved.
            </p>
          </div>
          <Button
            onClick={() => navigate('/')}
            className="mt-2"
          >
            <Home size={15} className="mr-2" />
            Go Home
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

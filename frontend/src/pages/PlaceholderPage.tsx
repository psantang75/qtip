import { Hammer } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface PlaceholderPageProps {
  title: string
  subtitle?: string
  /** Tailwind text-color class for the heading, e.g. "text-[#00aeef]" */
  colorClass?: string
}

export default function PlaceholderPage({
  title,
  subtitle = 'This section is under construction.',
  colorClass = 'text-primary',
}: PlaceholderPageProps) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className={cn('text-2xl font-bold', colorClass)}>{title}</h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
        )}
      </div>

      <Card className="mt-6">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="rounded-full bg-muted p-4">
            <Hammer size={28} className="text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-muted-foreground">Coming Soon</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            This page is being built. Check back soon.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

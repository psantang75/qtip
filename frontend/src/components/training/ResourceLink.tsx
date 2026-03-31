import { useState } from 'react'
import trainingService, { type TrainingResource } from '@/services/trainingService'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ResourceLinkProps {
  resource: TrainingResource
  maxWidth?: string
}

/**
 * Renders the resource title as a clickable link / button.
 * URLs open in a new tab directly.
 * All file types are fetched with auth headers as a blob — PDFs/images/videos
 * open in a new browser tab; Word/Excel/PPT the browser prompts to open or save.
 */
export function ResourceLink({ resource, maxWidth = 'max-w-[200px]' }: ResourceLinkProps) {
  const [loading, setLoading] = useState(false)

  const cls = cn('text-[13px] font-medium text-primary hover:underline truncate block text-left h-auto p-0', maxWidth)

  if (resource.resource_type === 'URL') {
    return (
      <Button variant="link" asChild className={cls}>
        <a href={resource.url ?? '#'} target="_blank" rel="noopener noreferrer">
          {resource.title}
        </a>
      </Button>
    )
  }

  const handleOpen = async (e: React.MouseEvent) => {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    try {
      const isOfficeType =
        resource.resource_type === 'WORD' ||
        resource.resource_type === 'POWERPOINT' ||
        resource.resource_type === 'EXCEL'

      const isPublicHost =
        window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1'

      if (isOfficeType && isPublicHost) {
        const viewUrl   = await trainingService.getResourceViewUrl(resource.id)
        const officeUrl = `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(viewUrl)}`
        window.open(officeUrl, '_blank')
        return
      }

      const blob    = await trainingService.downloadResourceFile(resource.id)
      const blobUrl = URL.createObjectURL(blob)

      if (
        resource.resource_type === 'PDF' ||
        resource.resource_type === 'IMAGE' ||
        resource.resource_type === 'VIDEO'
      ) {
        window.open(blobUrl, '_blank')
        setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000)
      } else {
        const a    = document.createElement('a')
        a.href     = blobUrl
        a.download = resource.file_name ?? resource.title
        a.click()
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000)
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant="link" disabled={loading} className={cn(cls, 'disabled:opacity-60')} onClick={handleOpen}>
      {loading ? 'Opening…' : resource.title}
    </Button>
  )
}

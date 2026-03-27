import { useState } from 'react'
import trainingService, { type TrainingResource } from '@/services/trainingService'

interface ResourceLinkProps {
  resource: TrainingResource
  /** Optional max width Tailwind class (default max-w-[200px]) */
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

  const cls = `text-[13px] font-medium text-primary hover:underline truncate ${maxWidth} block`

  if (resource.resource_type === 'URL') {
    return (
      <a
        href={resource.url ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        className={cls}
      >
        {resource.title}
      </a>
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

      // Office Online Viewer requires a publicly reachable URL.
      // It works on any deployed domain but not on localhost.
      const isPublicHost =
        window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1'

      if (isOfficeType && isPublicHost) {
        const viewUrl   = await trainingService.getResourceViewUrl(resource.id)
        const officeUrl = `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(viewUrl)}`
        window.open(officeUrl, '_blank')
        return
      }

      // PDF / Image / Video — open inline in a new tab.
      // Office files on localhost, or any other file type — download.
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
    <button
      onClick={handleOpen}
      disabled={loading}
      className={`${cls} text-left disabled:opacity-60`}
    >
      {loading ? 'Opening…' : resource.title}
    </button>
  )
}

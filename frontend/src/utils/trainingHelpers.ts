import trainingService from '@/services/trainingService'

/**
 * Returns the correct href for a coaching-session resource.
 * URL-type resources use their url field; uploaded files route through the API.
 */
export function resourceHref(
  r: { id: number; resource_type?: string; url?: string },
  forAgent = false,
): string {
  if (r.resource_type === 'URL' && r.url) return r.url
  if (r.url) return r.url
  return forAgent
    ? `/api/csr/resources/${r.id}/file`
    : `/api/trainer/resources/${r.id}/file`
}

/**
 * Downloads a coaching-session attachment via a temporary object URL.
 * Callers should wrap in try/catch for error handling / toast.
 */
export async function downloadSessionAttachment(sessionId: number, filename: string) {
  const blob = URL.createObjectURL(
    await trainingService.downloadAttachment(sessionId),
  )
  const a = Object.assign(document.createElement('a'), {
    href: blob,
    download: filename,
  })
  a.click()
  URL.revokeObjectURL(blob)
}

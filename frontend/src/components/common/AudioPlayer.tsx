import { useEffect, useState } from 'react'
import { MicOff } from 'lucide-react'
import apiClient from '@/services/apiClient'

/**
 * Player for a single audio recording. The PhoneSystem streaming
 * endpoint (`/api/phone-system/audio/:recordingId`) is protected by
 * the same JWT auth as every other API route, but `<audio src>` won't
 * carry the Authorization header. So when `url` is a relative `/api/*`
 * path we fetch the file as a blob through the authenticated
 * `apiClient` and feed the resulting object URL into the native
 * player. Direct (non-API) URLs — e.g. legacy values already stored on
 * `calls.recording_url` — are passed straight through.
 */
export function AudioPlayer({ url, label }: { url: string; label?: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!url) return
    if (!url.startsWith('/api/')) {
      setSrc(url)
      return
    }
    let revokeUrl: string | null = null
    let cancelled = false
    setSrc(null)
    setErr(null)
    apiClient
      .get(url.replace(/^\/api/, ''), { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return
        const blob = res.data instanceof Blob ? res.data : new Blob([res.data])
        revokeUrl = URL.createObjectURL(blob)
        setSrc(revokeUrl)
      })
      .catch(() => { if (!cancelled) setErr('Failed to load audio') })
    return () => {
      cancelled = true
      if (revokeUrl) URL.revokeObjectURL(revokeUrl)
    }
  }, [url])

  if (err) {
    return (
      <div className="flex items-center gap-2 py-2 px-3 bg-red-50 rounded-lg">
        <MicOff className="h-4 w-4 text-red-400 shrink-0" />
        <p className="text-[12px] text-red-600">{err}</p>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {label && <p className="text-[11px] text-slate-500">{label}</p>}
      {src
        ? <audio controls className="w-full h-9 rounded-lg" src={src} />
        : <div className="h-9 w-full rounded-lg bg-slate-100 animate-pulse" aria-label="Loading audio" />}
    </div>
  )
}

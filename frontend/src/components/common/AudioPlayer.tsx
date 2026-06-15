import { useEffect, useState } from 'react'
import { MicOff } from 'lucide-react'
import apiClient from '@/services/apiClient'
import { useQualityRole } from '@/hooks/useQualityRole'

/**
 * Player for a single audio recording. The PhoneSystem streaming
 * endpoint (`/api/phone-system/audio/:recordingId`) is protected by
 * the same JWT auth as every other API route, but `<audio src>` won't
 * carry the Authorization header. So when `url` is a relative `/api/*`
 * path we fetch the file as a blob through the authenticated
 * `apiClient` and feed the resulting object URL into the native
 * player. Direct (non-API) URLs — e.g. legacy values already stored on
 * `calls.recording_url` — are passed straight through.
 *
 * CSRs/Agents (role_id=3) are not permitted to listen to recordings.
 * For them this component renders the same neutral "no audio" panel
 * the rest of the app shows when a call has no recording, so the page
 * never tries to fetch the protected blob. The backend rejects those
 * calls anyway (`authorizeRecordingAccess` middleware on
 * `/api/phone-system/*`); this is the matching UX side of the policy.
 */
export function AudioPlayer({ url, label }: { url: string; label?: string }) {
  const { isAgent } = useQualityRole()
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (isAgent) return
    if (!url) return
    if (!url.startsWith('/api/')) {
      setSrc(url)
      return
    }
    let revokeUrl: string | null = null
    let cancelled = false
    setSrc(null)
    setFailed(false)
    apiClient
      .get(url.replace(/^\/api/, ''), { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return
        const blob = res.data instanceof Blob ? res.data : new Blob([res.data])
        revokeUrl = URL.createObjectURL(blob)
        setSrc(revokeUrl)
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => {
      cancelled = true
      if (revokeUrl) URL.revokeObjectURL(revokeUrl)
    }
  }, [url, isAgent])

  if (isAgent) {
    return (
      <div className="flex items-center gap-2 py-2 px-3 bg-slate-50 rounded-lg">
        <MicOff className="h-4 w-4 text-slate-400 shrink-0" />
        <p className="text-[12px] text-slate-400">Audio recording not available to your role</p>
      </div>
    )
  }

  // Render the same neutral "No audio recording available" panel that
  // CallDetailsPanel shows when there are no recordings at all. From the
  // reviewer's perspective both states mean "no audio is playing", so a
  // red error here would look like a bug (and was the source of the
  // dev-vs-stage UX delta when stage's PhoneSystem share is unreachable).
  if (failed) {
    return (
      <div className="flex items-center gap-2 py-2 px-3 bg-slate-50 rounded-lg">
        <MicOff className="h-4 w-4 text-slate-400 shrink-0" />
        <p className="text-[12px] text-slate-400">No audio recording available</p>
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

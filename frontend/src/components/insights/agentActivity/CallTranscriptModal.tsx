/**
 * Audio + transcript for one Genesys conversation, opened from a call id in the
 * Activity Timeline hover. The recording and transcript are pulled live from
 * PhoneSystem by conversation id — the same real-time lookup the QA audit flow
 * uses (`/calls/search?external_id=`) — then rendered through the shared
 * `CallDetailsPanel`, so the player, transcript toggle, and CSR audio-gating all
 * behave exactly as they do on a completed QA form. Nothing call-rendering is
 * duplicated here.
 */
import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CallDetailsPanel } from '@/pages/quality/submission-detail/CallDetailsPanel'
import callService from '@/services/callService'

export default function CallTranscriptModal({ conversationId, onClose }: {
  /** The conversation id that was clicked. `null` keeps the dialog closed. */
  conversationId: string | null
  onClose: () => void
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['call-transcript', conversationId],
    queryFn:  () => callService.searchCalls({ external_id: conversationId! }),
    enabled:  !!conversationId,
    staleTime: 5 * 60_000,
  })

  const call = data?.[0] ?? null

  return (
    <Dialog open={!!conversationId} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-slate-100 shrink-0">
          <DialogTitle>Call {conversationId}</DialogTitle>
          <DialogDescription className="text-[12.5px] text-slate-500">
            Recording and transcript, pulled live from the phone system.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-5">
          {isLoading ? (
            <p className="py-8 text-center text-sm text-slate-400">Loading call…</p>
          ) : isError ? (
            <p className="py-8 text-center text-sm text-danger">Couldn't load this call. Close and try again.</p>
          ) : !call ? (
            <p className="py-8 text-center text-sm text-slate-400">No recording or transcript found for this conversation.</p>
          ) : (
            <CallDetailsPanel calls={[call]} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

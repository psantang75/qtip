import { useState } from 'react'
import { Phone, MicOff, FileDown, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatTranscriptText } from '@/utils/transcriptUtils'
import { formatQualityDate as fmtDate } from '@/utils/dateFormat'

interface Props {
  calls: any[]
}

export function CallDetailsPanel({ calls }: Props) {
  const [activeCallIndex, setActiveCallIndex] = useState(0)
  const [transcriptOpen,  setTranscriptOpen]  = useState(false)

  if (!calls || calls.length === 0) return null

  const call = calls[activeCallIndex] ?? calls[0]

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      {/* Header — always shown */}
      <div className="px-4 py-3 bg-white border-b border-slate-100">
        <h3 className="text-[15px] font-semibold text-slate-800">Call Details</h3>
      </div>

      {/* Tabs — only when multiple calls */}
      {calls.length > 1 && (
        <div className="flex border-b border-slate-100">
          {calls.map((c: any, i: number) => (
            <button
              key={i}
              onClick={() => { setActiveCallIndex(i); setTranscriptOpen(false) }}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-[12px] font-semibold border-b-2 transition-colors',
                activeCallIndex === i
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              )}
            >
              <Phone className="h-3 w-3" />
              Call {i + 1}
              {c.recording_url && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Active call content */}
      {call && (
        <div className="px-4 py-3 space-y-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {call.call_id && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Conversation ID</p>
                <p className="text-[12px] font-medium text-slate-700 mt-0.5 truncate">{call.call_id}</p>
              </div>
            )}
            {call.call_date && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Call Date</p>
                <p className="text-[12px] font-medium text-slate-700 mt-0.5">{fmtDate(call.call_date)}</p>
              </div>
            )}
          </div>

          {call.recording_url ? (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Audio Recording</p>
              <audio controls className="w-full h-9 rounded-lg">
                <source src={call.recording_url} type="audio/mpeg" />
              </audio>
            </div>
          ) : (
            <div className="flex items-center gap-2 py-2 px-3 bg-slate-50 rounded-lg">
              <MicOff className="h-4 w-4 text-slate-400 shrink-0" />
              <p className="text-[12px] text-slate-400">No audio recording available</p>
            </div>
          )}

          {call.transcript && (
            <div>
              <button
                onClick={() => setTranscriptOpen(v => !v)}
                className="w-full flex items-center justify-between py-2 px-3 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors text-left"
              >
                <div className="flex items-center gap-2">
                  <FileDown className="h-3.5 w-3.5 text-slate-500" />
                  <span className="text-[12px] font-medium text-slate-700">
                    {transcriptOpen ? 'Hide' : 'Show'} Transcript
                  </span>
                </div>
                {transcriptOpen
                  ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
                  : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                }
              </button>
              {transcriptOpen && (
                <div className="mt-2 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50"
                  style={{ maxHeight: '40vh' }}>
                  <div className="p-3 text-[12px] text-slate-700 whitespace-pre-wrap break-words leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: formatTranscriptText(call.transcript) }} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Multi-call summary */}
      {calls.length > 1 && (
        <div className="px-4 py-2 border-t border-slate-100 bg-slate-50/50 flex items-center gap-3">
          <span className="text-[11px] text-slate-400">{calls.length} calls</span>
          {calls.filter((c: any) => c.recording_url).length > 0 && (
            <span className="text-[11px] text-emerald-600">
              {calls.filter((c: any) => c.recording_url).length} with audio
            </span>
          )}
          {calls.filter((c: any) => c.transcript).length > 0 && (
            <span className="text-[11px] text-blue-600">
              {calls.filter((c: any) => c.transcript).length} with transcript
            </span>
          )}
        </div>
      )}
    </div>
  )
}

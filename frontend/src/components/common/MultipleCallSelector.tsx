import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Phone, MicOff, Plus, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import callService, { type Call } from '@/services/callService'
import { formatQualityDate as fmtDate } from '@/utils/dateFormat'

interface MultipleCallSelectorProps {
  selectedCalls: Call[]
  onCallsChange: (calls: Call[]) => void
  disabled?: boolean
}

export default function MultipleCallSelector({ selectedCalls, onCallsChange, disabled }: MultipleCallSelectorProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [adding,   setAdding]   = useState(false)
  const [callId,   setCallId]   = useState('')
  const [callDate, setCallDate] = useState('')
  const [error,    setError]    = useState('')

  const addMut = useMutation({
    mutationFn: () => callService.searchCalls({
      external_id: callId.trim() || undefined,
      date_start:  callDate || undefined,
      date_end:    callDate || undefined,
    }),
    onSuccess: (results) => {
      // Use found call if available, otherwise create a manual entry from the entered fields
      // Negative ID signals to the backend that this call needs to be created (not looked up)
      const call: Call = results.length > 0
        ? results[0]
        : {
            id:            -(selectedCalls.length + 1),
            call_id:       callId.trim(),
            csr_id:        0,
            customer_id:   null,
            call_date:     callDate || new Date().toISOString(),
            duration:      0,
            recording_url: null,
            transcript:    null,
          }
      if (results.length > 0 && selectedCalls.some(c => c.id === call.id)) {
        setError('This call has already been added.')
        return
      }
      const updated = [...selectedCalls, call]
      onCallsChange(updated)
      setActiveIndex(updated.length - 1)
      setAdding(false)
      setCallId('')
      setCallDate('')
      setError('')
    },
    onError: () => {
      // On network error also fall back to manual entry
      const call: Call = {
        id:            -(selectedCalls.length + 1),
        call_id:       callId.trim(),
        csr_id:        0,
        customer_id:   null,
        call_date:     callDate || new Date().toISOString(),
        duration:      0,
        recording_url: null,
        transcript:    null,
      }
      const updated = [...selectedCalls, call]
      onCallsChange(updated)
      setActiveIndex(updated.length - 1)
      setAdding(false)
      setCallId('')
      setCallDate('')
      setError('')
    },
  })

  const removeCall = (idx: number) => {
    const updated = selectedCalls.filter((_, i) => i !== idx)
    onCallsChange(updated)
    setActiveIndex(Math.min(activeIndex, updated.length - 1))
  }

  const handleAdd = () => {
    setError('')
    if (!callId.trim()) { setError('Call ID is required.'); return }
    addMut.mutate()
  }

  const handleCancel = () => {
    setAdding(false)
    setCallId('')
    setCallDate('')
    setError('')
  }

  const activeCall = selectedCalls[activeIndex] ?? null

  return (
    <div className="space-y-0">

      {/* ── Call tabs — only when multiple calls ─────────────────────── */}
      {selectedCalls.length > 1 && (
        <div className="flex border-b border-slate-100">
          {selectedCalls.map((c, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActiveIndex(i)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-[12px] font-semibold border-b-2 transition-colors',
                activeIndex === i
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

      {/* ── Active call details ───────────────────────────────────────── */}
      {activeCall && (
        <div className="space-y-3 py-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {activeCall.call_id && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Conversation ID</p>
                <p className="text-[12px] font-medium text-slate-700 mt-0.5 truncate">{activeCall.call_id}</p>
              </div>
            )}
            {activeCall.call_date && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Call Date</p>
                <p className="text-[12px] font-medium text-slate-700 mt-0.5">{fmtDate(activeCall.call_date)}</p>
              </div>
            )}
          </div>

          {activeCall.recording_url ? (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Audio Recording</p>
              <audio controls className="w-full h-9 rounded-lg">
                <source src={activeCall.recording_url} type="audio/mpeg" />
              </audio>
            </div>
          ) : (
            <div className="flex items-center gap-2 py-2 px-3 bg-slate-50 rounded-lg">
              <MicOff className="h-4 w-4 text-slate-400 shrink-0" />
              <p className="text-[12px] text-slate-400">No audio recording available</p>
            </div>
          )}

          {!disabled && (
            <div className="flex justify-end">
              <Button type="button" variant="ghost" size="sm"
                className="h-7 text-[11px] text-red-400 hover:text-red-600 hover:bg-red-50 gap-1"
                onClick={() => removeCall(activeIndex)}>
                <X className="h-3 w-3" /> Remove call
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Add call form ─────────────────────────────────────────────── */}
      {adding ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 space-y-2 mt-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Call ID</label>
              <Input
                placeholder="e.g. 4567894"
                value={callId}
                onChange={e => setCallId(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                disabled={addMut.isPending}
                className="h-9 text-[13px]"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Call Date</label>
              <Input
                type="date"
                value={callDate}
                onChange={e => setCallDate(e.target.value)}
                disabled={addMut.isPending}
                className="h-9 text-[13px]"
              />
            </div>
          </div>
          {error && <p className="text-[12px] text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" className="h-8"
              onClick={handleCancel} disabled={addMut.isPending}>
              Cancel
            </Button>
            <Button type="button" size="sm" className="h-8 bg-primary hover:bg-primary/90 text-white"
              onClick={handleAdd} disabled={addMut.isPending}>
              {addMut.isPending ? 'Searching…' : 'Add'}
            </Button>
          </div>
        </div>
      ) : (
        !disabled && (
          <Button type="button" variant="outline" size="sm"
            className="h-8 text-[12px] text-slate-600 gap-1.5 mt-2"
            onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> Add Call
          </Button>
        )
      )}

    </div>
  )
}

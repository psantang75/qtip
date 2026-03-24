import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, AlertTriangle, CheckCircle, Edit3, Pencil, FileText, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import qaService, { scoreColor, type SubmissionDetail } from '@/services/qaService'
import { api } from '@/services/authService'
import { ScoreRenderer } from '@/utils/forms/scoreRenderer'
import {
  processConditionalLogic,
  calculateFormScore,
  prepareFormForRender,
  FormRenderer,
} from '@/utils/forms'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { formatTranscriptText } from '@/utils/transcriptUtils'

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

// ── Shared row ────────────────────────────────────────────────────────────────
function Row({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="flex justify-between gap-4 text-[13px]">
      <span className="text-slate-500 shrink-0">{label}:</span>
      <span className="font-medium text-slate-800 text-right">{value ?? '—'}</span>
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl overflow-hidden">
      <div className="px-4 py-3 bg-white border border-slate-200 rounded-t-lg border-b border-slate-200">
        <h3 className="text-[15px] font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="border border-t-0 border-slate-200 rounded-b-lg bg-white px-4 py-4">
        {children}
      </div>
    </div>
  )
}

// ── Category breakdown fallback ───────────────────────────────────────────────
function CategoryBreakdown({ detail }: { detail: SubmissionDetail }) {
  const categories = detail.answers.reduce<Record<string, typeof detail.answers>>((acc, a) => {
    const cat = a.category_name ?? 'General'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(a)
    return acc
  }, {})
  return (
    <div className="space-y-3">
      {Object.entries(categories).map(([cat, answers]) => (
        <div key={cat} className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="flex items-center gap-2.5 bg-slate-50 border-b border-slate-200 px-4 py-2.5">
            <span className="w-[3px] h-4 rounded-full bg-[#00aeef] shrink-0" />
            <span className="text-[12px] font-semibold text-slate-600 uppercase tracking-wider">{cat}</span>
          </div>
          <div className="divide-y divide-slate-100">
            {answers.map((a, i) => (
              <div key={i} className="px-4 py-2.5 flex items-start justify-between gap-4">
                <p className="text-[13px] text-slate-700 flex-1">{a.question_text}</p>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={cn('text-[13px] font-medium',
                    a.answer?.toUpperCase() === 'YES' ? 'text-emerald-600' :
                    a.answer?.toUpperCase() === 'NO'  ? 'text-red-600' : 'text-slate-600'
                  )}>{a.answer ?? '—'}</span>
                  {a.score != null && (
                    <span className={cn('text-[12px] font-semibold', scoreColor(a.score))}>
                      {a.score.toFixed(0)} pts
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── CSR submit dispute form ───────────────────────────────────────────────────
function DisputeForm({ submissionId, onSuccess }: { submissionId: number; onSuccess: () => void }) {
  const [reason, setReason] = useState('')
  const { toast } = useToast()
  const qc = useQueryClient()
  const { mutate, isPending } = useMutation({
    mutationFn: () => qaService.submitCSRDispute({ submission_id: submissionId, reason }),
    onSuccess: () => {
      toast({ title: 'Dispute submitted', description: 'Sent to your manager for review.' })
      qc.invalidateQueries({ queryKey: ['submission-detail'] })
      qc.invalidateQueries({ queryKey: ['submissions'] })
      onSuccess()
    },
    onError: () => toast({ title: 'Error', description: 'Failed to submit dispute.', variant: 'destructive' }),
  })
  const minLen = 10
  return (
    <div className="space-y-3 border border-amber-200 bg-amber-50 rounded-lg p-4">
      <h4 className="text-[13px] font-semibold text-amber-800">Submit a Dispute</h4>
      <Textarea value={reason} onChange={e => setReason(e.target.value)}
        placeholder="Explain why you believe this score is incorrect…" rows={3}
        className="text-[13px] bg-white" />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-amber-700">{reason.trim().length < minLen ? `${minLen - reason.trim().length} more characters needed` : ''}</span>
        <Button size="sm" onClick={() => mutate()} disabled={isPending || reason.trim().length < minLen}
          className="bg-amber-600 hover:bg-amber-700 text-white">
          {isPending ? 'Submitting…' : 'Submit Dispute'}
        </Button>
      </div>
    </div>
  )
}

// ── CSR edit dispute form ─────────────────────────────────────────────────────
function EditDisputeForm({
  dispute,
  onSuccess,
  onCancel,
}: {
  dispute: { id: number; reason: string; attachment_url?: string | null }
  onSuccess: () => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState(dispute.reason)
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const { toast } = useToast()
  const qc = useQueryClient()

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => qaService.updateCSRDispute(dispute.id, reason, file),
    onSuccess: () => {
      toast({ title: 'Dispute updated' })
      qc.invalidateQueries({ queryKey: ['submission-detail'] })
      onSuccess()
    },
    onError: (err: any) =>
      toast({ title: 'Error', description: err?.response?.data?.message ?? 'Failed to update dispute.', variant: 'destructive' }),
  })

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null)
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 5 * 1024 * 1024) { setFileError('File must be under 5 MB'); return }
    const allowed = ['application/pdf','application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg','image/jpg','image/png']
    if (!allowed.includes(f.type)) { setFileError('Only PDF, DOC, DOCX, JPG, PNG allowed'); return }
    setFile(f)
  }

  return (
    <div className="space-y-3 border border-[#00aeef]/30 bg-[#00aeef]/5 rounded-lg p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-[13px] font-semibold text-slate-800">Edit Dispute</h4>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
      </div>
      <div>
        <Textarea value={reason} onChange={e => setReason(e.target.value)}
          rows={4} className="text-[13px] bg-white" maxLength={1000} />
        <p className="text-[11px] text-slate-400 mt-1 text-right">{reason.length}/1000</p>
      </div>
      <div>
        <label className="text-[11px] font-medium text-slate-500 uppercase tracking-wide block mb-1">
          Supporting Evidence (optional)
        </label>
        <input type="file" onChange={handleFileChange}
          accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
          className="text-[12px] w-full text-slate-600 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-[12px] file:font-medium file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200" />
        {dispute.attachment_url && !file && (
          <p className="text-[11px] text-slate-500 mt-1">Current: {dispute.attachment_url.split('/').pop()}</p>
        )}
        {file && <p className="text-[11px] text-[#00aeef] mt-1">New file: {file.name}</p>}
        {fileError && <p className="text-[11px] text-red-600 mt-1">{fileError}</p>}
      </div>
      {error && (
        <p className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded p-2">
          {(error as any)?.response?.data?.message ?? 'Failed to update dispute.'}
        </p>
      )}
      <div className="flex gap-2 justify-end pt-1">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={isPending}>Cancel</Button>
        <Button size="sm" onClick={() => mutate()} disabled={isPending || !reason.trim()}
          className="bg-[#00aeef] hover:bg-[#0095cc] text-white">
          {isPending ? 'Saving…' : 'Save Changes'}
        </Button>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SubmissionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate  = useNavigate()
  const { user }  = useAuth()
  const qc        = useQueryClient()
  const { toast } = useToast()

  const roleId    = user?.role_id ?? 0
  const isCSR     = roleId === 3
  const isManager = roleId === 5

  // ── CSR finalize / dispute state
  const [showDisputeForm,  setShowDisputeForm]  = useState(false)
  const [finalizeSuccess,  setFinalizeSuccess]  = useState(false)
  const [editingDispute,   setEditingDispute]   = useState(false)

  // ── Manager resolution state
  const [resolutionMode,   setResolutionMode]   = useState(false)
  const [resNotes,         setResNotes]         = useState('')
  const [resError,         setResError]         = useState<string | null>(null)
  const [resSubmitting,    setResSubmitting]     = useState(false)
  // Edited answers + live score for adjustment mode
  const [editedAnswers,    setEditedAnswers]     = useState<Record<number, any>>({})
  const [editRenderData,   setEditRenderData]    = useState<any>(null)
  const [liveScore,        setLiveScore]         = useState(0)

  // ── Data fetch
  const { data: detail, isLoading, isError } = useQuery<SubmissionDetail | null>({
    queryKey: ['submission-detail', id, roleId],
    queryFn: async () => {
      if (!id) return null
      const submission = isCSR
        ? await qaService.getCSRAuditDetail(Number(id))
        : isManager
        ? await qaService.getTeamAuditDetail(Number(id))
        : await qaService.getSubmissionDetail(Number(id))
      if (submission?.form_id) {
        try {
          const res = await api.get(`/forms/${submission.form_id}?include_inactive=true`)
          ;(submission as any).formData = res.data
        } catch { /* fall back */ }
      }
      return submission
    },
    enabled: !!id && !!user,
  })

  // ── CSR finalize
  const { mutate: finalize, isPending: finalizing } = useMutation({
    mutationFn: () => qaService.finalizeCSRReview(Number(id)),
    onSuccess: () => {
      setFinalizeSuccess(true)
      qc.invalidateQueries({ queryKey: ['submission-detail', id] })
      qc.invalidateQueries({ queryKey: ['submissions'] })
    },
  })

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-slate-100 animate-pulse rounded-xl" />)}
      </div>
    )
  }
  if (isError || !detail) {
    return (
      <div className="p-6">
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-[13px] text-red-700">
          Failed to load submission details.
        </div>
      </div>
    )
  }

  const formData  = (detail as any).formData
  const calls     = (detail as any).calls as any[] | undefined
  const score     = typeof detail.score === 'string' ? parseFloat(detail.score) || 0 : Number(detail.score) || 0
  const canDispute      = isCSR && detail.status === 'SUBMITTED' && !detail.dispute
  const canAcceptReview = isCSR && detail.status !== 'FINALIZED' && detail.status !== 'DISPUTED' && detail.status !== 'RESOLVED'

  // Build read-only answers map for ScoreRenderer
  const answersMap: Record<number, any> = {}
  detail.answers.forEach((a: any) => {
    if (a.question_id) answersMap[a.question_id] = { answer: a.answer, score: a.score, notes: '' }
  })

  // Metadata rows
  const fmtMetaValue = (name: string, raw: string) => {
    if (/date/i.test(name) && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [y, m, d] = raw.split('-')
      return new Date(Number(y), Number(m) - 1, Number(d))
        .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }
    return raw
  }
  const metaRows: Array<{ field_name: string; value: string }> = Array.isArray(detail.metadata)
    ? (detail.metadata as any[]).map((m: any) => {
        const name = m.field_name ?? m.key ?? ''
        return { field_name: name, value: fmtMetaValue(name, String(m.value ?? '')) }
      })
    : Object.entries(detail.metadata ?? {}).map(([k, v]) => {
        const val = typeof v === 'object' ? String((v as any)?.value ?? '') : String(v)
        return { field_name: k, value: fmtMetaValue(k, val) }
      })

  // ── Enter resolution / editing mode ─────────────────────────────────────────
  const enterResolutionMode = () => {
    if (!formData) return
    // Seed editable answers from the submitted answers
    const initial: Record<number, any> = {}
    detail.answers.forEach((a: any) => {
      if (a.question_id) {
        initial[a.question_id] = { question_id: a.question_id, answer: a.answer || '', score: a.score || 0, notes: a.notes || '' }
      }
    })
    setEditedAnswers(initial)
    // Calculate initial live score
    const { totalScore, categoryScores } = calculateFormScore(formData, initial)
    setLiveScore(totalScore)
    const ansStrings: Record<number, string> = {}
    Object.entries(initial).forEach(([k, v]) => { ansStrings[Number(k)] = (v as any).answer || '' })
    const visibility = processConditionalLogic(formData, ansStrings)
    setEditRenderData(prepareFormForRender(formData, initial, visibility, categoryScores, totalScore, roleId))
    setResolutionMode(true)
  }

  // ── Manager edits an answer in resolution mode ───────────────────────────────
  const handleEditAnswer = (questionId: number, value: string, questionType: string) => {
    if (!formData) return
    let qScore = 0
    for (const cat of formData.categories ?? []) {
      const q = cat.questions?.find((q: any) => q.id === questionId)
      if (q) {
        if (questionType === 'yes_no') {
          if (value === 'yes') qScore = q.yes_value ?? 0
          else if (value === 'no') qScore = q.no_value ?? 0
          else if (value === 'na') qScore = q.na_value ?? 0
        } else if (questionType === 'scale') {
          qScore = parseInt(value) || 0
        } else if (questionType === 'radio' || questionType === 'multi_select') {
          const opt = (q.radio_options ?? []).find((o: any) => o.option_value === value)
          if (opt) qScore = opt.score || 0
        }
        break
      }
    }
    const newAnswers = {
      ...editedAnswers,
      [questionId]: { question_id: questionId, answer: value, score: qScore, notes: editedAnswers[questionId]?.notes || '' }
    }
    setEditedAnswers(newAnswers)
    // Recalculate live score
    const { totalScore, categoryScores } = calculateFormScore(formData, newAnswers)
    setLiveScore(totalScore)
    const ansStrings: Record<number, string> = {}
    Object.entries(newAnswers).forEach(([k, v]) => { ansStrings[Number(k)] = (v as any).answer || '' })
    const visibility = processConditionalLogic(formData, ansStrings)
    setEditRenderData(prepareFormForRender(formData, newAnswers, visibility, categoryScores, totalScore, roleId))
  }

  // ── Submit resolution ────────────────────────────────────────────────────────
  // Always uses POST /manager/disputes/:id/resolve — the PUT endpoint has a
  // nested-transaction bug in the backend. The frontend-calculated liveScore
  // is passed as new_score for adjustments, which is correct and sufficient.
  const submitResolution = async (action: 'UPHOLD' | 'REJECTED' | 'ADJUST') => {
    if (!detail.dispute?.id) return
    if (!resNotes.trim()) { setResError('Resolution notes are required.'); return }
    setResError(null)
    setResSubmitting(true)
    try {
      await qaService.resolveDispute(detail.dispute.id, {
        resolution_action: action,
        resolution_notes: resNotes,
        // For adjustments, pass the score the manager calculated on the frontend
        new_score: action === 'ADJUST' ? liveScore : undefined,
      })
      toast({ title: 'Dispute resolved' })
      qc.invalidateQueries({ queryKey: ['submission-detail', id] })
      qc.invalidateQueries({ queryKey: ['submissions'] })
      qc.invalidateQueries({ queryKey: ['manager-disputes'] })
      setResolutionMode(false)
      setResNotes('')
    } catch (err: any) {
      setResError(err?.response?.data?.message ?? err?.message ?? 'Failed to resolve dispute.')
    } finally {
      setResSubmitting(false)
    }
  }

  return (
    <div className="p-6 space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-slate-500 hover:text-slate-700 transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-900">Completed Review Form Detail</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{detail.form_name}{!isCSR ? ` · ${detail.csr_name}` : ''}</p>
        </div>
        {resolutionMode && (
          <span className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg">
            <Edit3 className="h-3.5 w-3.5" /> Resolution Mode
          </span>
        )}
      </div>

      {/* ── Form Title Card ── */}
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-xl font-bold text-slate-800 truncate">{detail.form_name}</h2>
          {formData?.version && (
            <span className="text-[12px] text-slate-500 bg-slate-100 px-3 py-1 rounded-full shrink-0">
              Version {formData.version}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {canAcceptReview && !finalizeSuccess && (
            <Button size="sm" variant="outline"
              className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              disabled={finalizing} onClick={() => finalize()}>
              <CheckCircle className="h-4 w-4 mr-1.5" />
              {finalizing ? 'Accepting…' : 'Accept Review'}
            </Button>
          )}
          {canDispute && !showDisputeForm && !finalizeSuccess && (
            <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white"
              onClick={() => setShowDisputeForm(true)}>
              <AlertTriangle className="h-4 w-4 mr-1.5" /> Dispute Score
            </Button>
          )}
          {!canAcceptReview && !canDispute && !resolutionMode && (
            <span className="text-[13px] text-slate-500">
              Status: {detail.status.charAt(0) + detail.status.slice(1).toLowerCase()}
            </span>
          )}
          {finalizeSuccess && (
            <span className="flex items-center gap-1.5 text-[13px] text-emerald-600 font-medium">
              <CheckCircle className="h-4 w-4" /> Review Accepted
            </span>
          )}
        </div>
      </div>

      {/* Inline dispute form for CSR */}
      {showDisputeForm && (
        <DisputeForm submissionId={detail.id} onSuccess={() => setShowDisputeForm(false)} />
      )}

      {/* ── 4 / 8 grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

        {/* ── Left column (4) ── */}
        <div className="lg:col-span-4 space-y-6 lg:sticky lg:top-4 lg:self-start">

          {/* Form Details */}
          <Panel title="Form Details">
            <div className="space-y-2.5">
              <Row label="Submission ID" value={detail.id} />
              <Row label="Form ID"       value={detail.form_id} />
              <Row label="Interaction Type" value={formData?.interaction_type ?? (detail as any).interaction_type} />
              {metaRows.length > 0 && (
                <>
                  <div className="border-t border-slate-100 my-1" />
                  {metaRows.map((m, i) => <Row key={i} label={m.field_name} value={m.value} />)}
                </>
              )}
              {metaRows.length === 0 && <Row label="Metadata" value="No metadata available" />}
            </div>
          </Panel>

          {/* Call Details */}
          <Panel title="Call Details">
            {calls && calls.length > 0 ? (
              <div className="space-y-5">
                {calls.map((call: any, i: number) => (
                  <div key={call.call_id || i} className="border border-slate-200 rounded-lg overflow-hidden">
                    <div className="flex items-center gap-2.5 bg-slate-50 border-b border-slate-200 px-3 py-2">
                      <span className="w-[3px] h-4 rounded-full bg-[#00aeef] shrink-0" />
                      <span className="text-[12px] font-semibold text-slate-600 uppercase tracking-wider">Call {i + 1}</span>
                    </div>
                    <div className="px-3 py-3 space-y-3">
                      {call.call_id   && <Row label="Conversation ID" value={call.call_id} />}
                      {call.call_date && <Row label="Call Date" value={fmtDate(call.call_date)} />}
                      {call.recording_url ? (
                        <div>
                          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">Audio</p>
                          <audio controls className="w-full h-8">
                            <source src={call.recording_url} type="audio/mpeg" />
                          </audio>
                        </div>
                      ) : <p className="text-[12px] text-slate-400">No audio available</p>}
                      {call.transcript ? (
                        <div>
                          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">Transcript</p>
                          <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-md p-2.5 bg-slate-50">
                            <div className="text-[12px] text-slate-700 whitespace-pre-wrap break-words leading-relaxed"
                              dangerouslySetInnerHTML={{ __html: formatTranscriptText(call.transcript) }} />
                          </div>
                        </div>
                      ) : <p className="text-[12px] text-slate-400">No transcript available</p>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-slate-400">No call records attached to this submission</p>
            )}
          </Panel>

          {/* Dispute Information */}
          {detail.dispute && (
            <Panel title="Dispute Information">
              <div className="space-y-3">

                {/* Status + dates */}
                <div className="flex items-center justify-between">
                  <span className={cn(
                    'inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-full',
                    detail.dispute.status === 'OPEN'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-emerald-100 text-emerald-800'
                  )}>
                    <span className={cn('w-1.5 h-1.5 rounded-full', detail.dispute.status === 'OPEN' ? 'bg-amber-500' : 'bg-emerald-500')} />
                    {detail.dispute.status === 'OPEN' ? 'Open — Under Review' : 'Resolved'}
                  </span>
                  {/* CSR can edit while OPEN and not yet resolved by manager */}
                  {isCSR && detail.dispute.status === 'OPEN' && !detail.dispute.resolved_by && !editingDispute && (
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px] text-slate-500 hover:text-slate-700"
                      onClick={() => setEditingDispute(true)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                    </Button>
                  )}
                </div>

                <div className="space-y-1.5 text-[13px]">
                  {detail.dispute.created_at && (
                    <Row label="Submitted" value={fmtDate(detail.dispute.created_at)} />
                  )}
                  {detail.dispute.resolved_at && (
                    <Row label="Resolved" value={fmtDate(detail.dispute.resolved_at)} />
                  )}
                </div>

                <div className="border-t border-slate-100 pt-2.5">
                  <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">Dispute Reason</p>
                  {editingDispute ? (
                    <EditDisputeForm
                      dispute={detail.dispute}
                      onSuccess={() => setEditingDispute(false)}
                      onCancel={() => setEditingDispute(false)}
                    />
                  ) : (
                    <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-[13px] text-amber-800 whitespace-pre-wrap">
                      {detail.dispute.reason}
                    </div>
                  )}
                </div>

                {/* Attachment */}
                {detail.dispute.attachment_url && !editingDispute && (
                  <div>
                    <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">Supporting Evidence</p>
                    <button
                      onClick={() => qaService.downloadDisputeAttachment(
                        detail.dispute!.id,
                        detail.dispute!.attachment_url!.split('/').pop() || 'attachment'
                      )}
                      className="flex items-center gap-2 text-[13px] text-[#00aeef] hover:underline"
                    >
                      <FileText className="h-4 w-4 shrink-0" />
                      {detail.dispute.attachment_url.split('/').pop()}
                    </button>
                  </div>
                )}

                {/* Resolution section */}
                <div className="border-t border-slate-100 pt-2.5">
                  <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1.5">Resolution</p>
                  {detail.dispute.status === 'OPEN' ? (
                    <p className="text-[13px] text-slate-400 italic">Awaiting manager review.</p>
                  ) : (
                    <div className="space-y-2">
                      {detail.dispute.resolution_action && (
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            'text-[12px] font-semibold px-2.5 py-1 rounded-full',
                            detail.dispute.resolution_action === 'UPHOLD'   ? 'bg-emerald-100 text-emerald-800' :
                            detail.dispute.resolution_action === 'REJECTED' ? 'bg-red-100 text-red-800' :
                            detail.dispute.resolution_action === 'ADJUST'   ? 'bg-blue-100 text-blue-800' :
                            'bg-slate-100 text-slate-700'
                          )}>
                            {detail.dispute.resolution_action === 'UPHOLD'   ? 'Score Upheld' :
                             detail.dispute.resolution_action === 'REJECTED' ? 'Dispute Rejected' :
                             detail.dispute.resolution_action === 'ADJUST'   ? 'Score Adjusted' :
                             detail.dispute.resolution_action}
                          </span>
                          {detail.dispute.new_score != null && (
                            <span className={cn('text-[14px] font-bold', scoreColor(detail.dispute.new_score))}>
                              → {detail.dispute.new_score.toFixed(1)}%
                            </span>
                          )}
                        </div>
                      )}
                      {detail.dispute.resolution_notes && (
                        <div className="bg-slate-50 rounded-md p-3 text-[13px] text-slate-700 whitespace-pre-wrap">
                          {detail.dispute.resolution_notes}
                        </div>
                      )}
                      {!detail.dispute.resolution_notes && !detail.dispute.resolution_action && (
                        <p className="text-[13px] text-slate-400 italic">No resolution notes provided.</p>
                      )}
                    </div>
                  )}
                </div>

              </div>
            </Panel>
          )}

          {/* Manager — dispute resolution controls */}
          {isManager && detail.dispute?.status === 'OPEN' && (
            <Panel title="Resolve Dispute">
              {!resolutionMode ? (
                <div className="space-y-3">
                  <p className="text-[13px] text-slate-600">
                    Review the score breakdown on the right, then choose how to resolve this dispute.
                  </p>
                  <Button size="sm" className="w-full bg-[#00aeef] hover:bg-[#0095cc] text-white"
                    onClick={enterResolutionMode} disabled={!formData}>
                    <Edit3 className="h-4 w-4 mr-1.5" />
                    Start Resolution
                  </Button>
                  {!formData && (
                    <p className="text-[12px] text-amber-600">Form data is loading…</p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-[13px] text-slate-600">
                    Edit answers on the right to adjust the score, or uphold/reject below.
                  </p>

                  <div>
                    <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1">Resolution Notes <span className="text-red-400 normal-case tracking-normal">*</span></p>
                    <textarea
                      rows={3}
                      value={resNotes}
                      onChange={e => setResNotes(e.target.value)}
                      placeholder="Explain your decision…"
                      className="w-full text-[13px] border border-slate-200 rounded-md px-2.5 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-[#00aeef]"
                    />
                  </div>

                  {resError && (
                    <p className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded p-2">{resError}</p>
                  )}

                  {/* Live updated score display */}
                  <div className="flex items-center justify-between p-3 bg-[#00aeef]/5 border border-[#00aeef]/20 rounded-lg">
                    <span className="text-[13px] font-medium text-slate-700">Updated Score:</span>
                    <span className={cn('text-xl font-bold', scoreColor(liveScore))}>{liveScore.toFixed(1)}%</span>
                  </div>

                  <div className="flex flex-col gap-2 pt-1">
                    <Button size="sm" variant="outline"
                      className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                      disabled={resSubmitting}
                      onClick={() => submitResolution('UPHOLD')}>
                      Uphold — Keep Original Score
                    </Button>
                    <Button size="sm" variant="outline"
                      className="border-red-300 text-red-700 hover:bg-red-50"
                      disabled={resSubmitting}
                      onClick={() => submitResolution('REJECTED')}>
                      Reject Dispute
                    </Button>
                    <Button size="sm"
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                      disabled={resSubmitting}
                      onClick={() => submitResolution('ADJUST')}>
                      {resSubmitting ? 'Saving…' : `Save Adjustment (${liveScore.toFixed(1)}%)`}
                    </Button>
                  </div>

                  <button
                    onClick={() => { setResolutionMode(false); setResNotes(''); setResError(null) }}
                    className="text-[12px] text-slate-400 hover:text-slate-600 w-full text-center pt-1"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </Panel>
          )}
        </div>

        {/* ── Right column (8) ── */}
        <div className="lg:col-span-8 space-y-6">

          {/* Overall Score Summary */}
          <div className="bg-white border border-slate-200 rounded-xl px-5 py-5">
            <div className="flex items-center mb-4 border-b border-slate-200 pb-3">
              <h2 className="text-[15px] font-semibold text-slate-800">Overall Score Summary</h2>
              {resolutionMode && (
                <span className="ml-auto text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
                  Original Score
                </span>
              )}
            </div>
            <div className="flex flex-col items-center justify-center py-4">
              <div className={cn('text-6xl font-bold mb-2', scoreColor(score))}>
                {score.toFixed(2)}%
              </div>
              <div className="text-[13px] text-slate-500">Final Score</div>
            </div>
          </div>

          {/* Score breakdown OR editable form in resolution mode */}
          {resolutionMode && editRenderData ? (
            <Panel title="Edit Review Form — Adjusting Answers">
              <p className="text-[13px] text-slate-500 mb-4">
                Change any answers below. The score will update live in the left panel.
              </p>
              <FormRenderer
                formRenderData={editRenderData}
                isDisabled={false}
                onAnswerChange={handleEditAnswer}
                onNotesChange={() => {}}
              />
              <div className="mt-5 p-4 bg-[#00aeef]/5 border border-[#00aeef]/20 rounded-xl flex items-center justify-between">
                <span className="text-[14px] font-semibold text-slate-700">Updated Total Score:</span>
                <span className={cn('text-3xl font-bold', scoreColor(liveScore))}>{liveScore.toFixed(1)}%</span>
              </div>
            </Panel>
          ) : (
            <Panel title="Score Breakdown">
              {formData ? (
                <ScoreRenderer
                  formData={formData}
                  answers={answersMap}
                  backendScore={score}
                  userRole={roleId}
                  showCategoryBreakdown={true}
                  showDetailedScores={true}
                />
              ) : (
                <CategoryBreakdown detail={detail} />
              )}
            </Panel>
          )}
        </div>
      </div>
    </div>
  )
}

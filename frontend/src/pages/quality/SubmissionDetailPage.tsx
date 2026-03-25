import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, AlertTriangle, CheckCircle, Edit3, Pencil, FileText, X, ChevronDown, ChevronUp, TrendingUp, TrendingDown } from 'lucide-react'
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
import { StatusBadge } from '@/components/common/StatusBadge'

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
            <span className="w-[3px] h-4 rounded-full bg-primary shrink-0" />
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
    <div className="space-y-3 border border-primary/30 bg-primary/5 rounded-lg p-4">
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
        {file && <p className="text-[11px] text-primary mt-1">New file: {file.name}</p>}
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
          className="bg-primary hover:bg-primary/90 text-white">
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

  const roleId          = user?.role_id ?? 0
  const isCSR           = roleId === 3
  const isManager       = roleId === 5
  const canResolveDispute = roleId === 1 || roleId === 5

  // ── CSR finalize / dispute state
  const [showDisputeForm,  setShowDisputeForm]  = useState(false)
  const [finalizeSuccess,  setFinalizeSuccess]  = useState(false)
  const [editingDispute,   setEditingDispute]   = useState(false)
  const [transcriptOpen,   setTranscriptOpen]   = useState(false)

  // Pass threshold — suggested industry baseline of 85%.
  // TODO: make this configurable per-form once form settings are extended.
  const PASS_THRESHOLD = 85

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
  const submitResolution = async (action: 'UPHOLD' | 'ADJUST') => {
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

  const isPassing      = score >= PASS_THRESHOLD
  const disputeAdjusted = detail.dispute?.resolution_action === 'ADJUST' &&
    detail.dispute.previous_score != null && detail.dispute.new_score != null
  const scoreDelta = disputeAdjusted
    ? (detail.dispute!.new_score! - detail.dispute!.previous_score!)
    : 0

  // Score accent colours for the left panel header
  const scoreAccent = score >= 85
    ? 'bg-emerald-50 border-emerald-200'
    : score >= 70
    ? 'bg-amber-50 border-amber-200'
    : 'bg-red-50 border-red-200'

  return (
    // Break out of main's p-6 padding and take full available height
    // This gives us true independent-scroll two-pane layout
    <div className="-m-6 h-full flex flex-col overflow-hidden">

      {/* ── Fixed header bar ───────────────────────────────────────────────── */}
      <div className="shrink-0 bg-white border-b border-slate-200 px-5 py-3 z-10">
        <div className="flex items-start gap-4">

          {/* Back to Submissions */}
          <button onClick={() => navigate(-1)}
            className="shrink-0 flex items-center gap-1.5 text-[12px] font-medium text-slate-500 hover:text-primary transition-colors mt-1.5 whitespace-nowrap">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Submissions
          </button>

          <div className="w-px self-stretch bg-slate-200 shrink-0" />

          {/* Form name + key metadata */}
          <div className="flex-1 min-w-0">
            <h1 className="text-[20px] font-bold text-slate-900 leading-tight truncate">
              {detail.form_name}
            </h1>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {!isCSR && detail.csr_name && (
                <span className="text-[13px] text-slate-600 font-medium">{detail.csr_name}</span>
              )}
              {detail.created_at && (
                <span className="text-[12px] text-slate-400">· {fmtDate(detail.created_at)}</span>
              )}
              {(detail as any).reviewer_name && (
                <span className="text-[12px] text-slate-400">· Reviewed by {(detail as any).reviewer_name}</span>
              )}
              {!isCSR && (
                <span className="text-[12px] text-slate-400">· #{detail.id}</span>
              )}
            </div>
          </div>

          {/* Status + actions */}
          <div className="flex items-center gap-2.5 shrink-0 mt-0.5">
            <StatusBadge status={detail.status} className="text-[13px] px-3 py-1 rounded-full" />
            {resolutionMode && (
              <span className="flex items-center gap-1 text-[12px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full">
                <Edit3 className="h-3.5 w-3.5" /> Resolving
              </span>
            )}
            {canAcceptReview && !finalizeSuccess && (
              <Button size="sm" disabled={finalizing} onClick={() => finalize()}
                className="bg-emerald-600 hover:bg-emerald-700 text-white">
                <CheckCircle className="h-4 w-4 mr-1.5" />
                {finalizing ? 'Accepting…' : 'Accept Review'}
              </Button>
            )}
            {canDispute && !showDisputeForm && !finalizeSuccess && (
              <Button size="sm" variant="outline"
                className="border-amber-400 text-amber-700 hover:bg-amber-50"
                onClick={() => setShowDisputeForm(true)}>
                <AlertTriangle className="h-4 w-4 mr-1.5" /> Dispute Score
              </Button>
            )}
            {finalizeSuccess && (
              <span className="flex items-center gap-1.5 text-[13px] text-emerald-600 font-semibold">
                <CheckCircle className="h-4 w-4" /> Accepted
              </span>
            )}
          </div>

        </div>
      </div>

      {/* ── Resolution mode banner ─────────────────────────────────────────── */}
      {resolutionMode && (
        <div className="shrink-0 bg-amber-50 border-b border-amber-200 px-5 py-2.5 flex items-center gap-3">
          <Edit3 className="h-4 w-4 text-amber-600 shrink-0" />
          <p className="flex-1 text-[12px] font-medium text-amber-800">
            <span className="font-bold">Resolution Mode</span> — edit answers in the right panel to adjust the score,
            then submit your decision in the left panel.
          </p>
          <button onClick={() => { setResolutionMode(false); setResNotes(''); setResError(null) }}
            className="shrink-0 text-amber-500 hover:text-amber-700 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Two-pane split (each pane scrolls independently) ──────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ════ LEFT PANE ═══════════════════════════════════════════════════ */}
        <div className="w-1/2 shrink-0 border-r border-slate-200 bg-slate-50 overflow-y-auto">
          <div className="p-4 space-y-4">

            {/* ── Score card ──────────────────────────────────────────────── */}
            <div className={cn('rounded-xl border overflow-hidden', scoreAccent)}>
              {/* Coloured score header */}
              <div className="px-5 pt-5 pb-4 text-center">
                <div className={cn('text-6xl font-bold tracking-tight', scoreColor(score))}>
                  {score.toFixed(1)}
                  <span className="text-3xl font-semibold ml-0.5 opacity-70">%</span>
                </div>
                <div className="flex items-center justify-center gap-2 mt-2">
                  <span className={cn(
                    'text-[11px] font-bold px-2.5 py-0.5 rounded-full',
                    isPassing ? 'bg-emerald-600 text-white' : 'bg-red-500 text-white'
                  )}>
                    {isPassing ? '✓ PASS' : '✗ BELOW THRESHOLD'}
                  </span>
                </div>
                {/* Score bar */}
                <div className="mt-3 h-1.5 bg-white/60 rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all', scoreColor(score).replace('text-', 'bg-'))}
                    style={{ width: `${Math.min(100, score)}%` }}
                  />
                </div>
                <p className="text-[10px] text-current opacity-50 mt-1">
                  Pass threshold: {PASS_THRESHOLD}% · configurable per form
                </p>
              </div>

              {/* Before/After comparison */}
              {disputeAdjusted && (
                <div className="bg-white/70 border-t border-current/10 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Score After Dispute</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 text-center">
                      <p className="text-[10px] text-slate-400 uppercase tracking-wide">Before</p>
                      <p className={cn('text-[18px] font-bold line-through opacity-60', scoreColor(detail.dispute!.previous_score!))}>
                        {detail.dispute!.previous_score!.toFixed(1)}%
                      </p>
                    </div>
                    <div className={cn('flex items-center gap-0.5 font-bold text-[13px]', scoreDelta > 0 ? 'text-emerald-600' : 'text-red-600')}>
                      {scoreDelta > 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                      {scoreDelta > 0 ? '+' : ''}{scoreDelta.toFixed(1)}%
                    </div>
                    <div className="flex-1 text-center">
                      <p className="text-[10px] text-slate-400 uppercase tracking-wide">After</p>
                      <p className={cn('text-[18px] font-bold', scoreColor(detail.dispute!.new_score!))}>
                        {detail.dispute!.new_score!.toFixed(1)}%
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Live score in resolution mode */}
              {resolutionMode && (
                <div className="bg-amber-50 border-t border-amber-200 px-4 py-3 flex items-center justify-between">
                  <span className="text-[12px] font-medium text-amber-800">Live adjusted score</span>
                  <span className={cn('text-[20px] font-bold', scoreColor(liveScore))}>{liveScore.toFixed(1)}%</span>
                </div>
              )}
            </div>

            {/* ── CSR dispute submission form ─────────────────────────────── */}
            {showDisputeForm && (
              <DisputeForm submissionId={detail.id} onSuccess={() => setShowDisputeForm(false)} />
            )}

            {/* ── Dispute information ──────────────────────────────────────── */}
            {detail.dispute && (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    <span className="text-[13px] font-semibold text-slate-800">Dispute</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge
                      status={detail.dispute.status}
                      label={detail.dispute.status === 'OPEN' ? 'Open' : undefined}
                    />
                    {isCSR && detail.dispute.status === 'OPEN' && !detail.dispute.resolved_by && !editingDispute && (
                      <button className="text-[11px] text-slate-400 hover:text-primary flex items-center gap-1"
                        onClick={() => setEditingDispute(true)}>
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                    )}
                  </div>
                </div>
                <div className="px-4 py-3 space-y-3">
                  <div className="flex gap-4 text-[11px] text-slate-500">
                    {detail.dispute.created_at && <span>Filed {fmtDate(detail.dispute.created_at)}</span>}
                    {detail.dispute.resolved_at && <span>· Resolved {fmtDate(detail.dispute.resolved_at)}</span>}
                  </div>

                  {editingDispute ? (
                    <EditDisputeForm
                      dispute={detail.dispute}
                      onSuccess={() => setEditingDispute(false)}
                      onCancel={() => setEditingDispute(false)}
                    />
                  ) : (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-[13px] text-amber-900 leading-relaxed">
                      {detail.dispute.reason}
                    </div>
                  )}

                  {detail.dispute.attachment_url && !editingDispute && (
                    <button
                      onClick={() => qaService.downloadDisputeAttachment(
                        detail.dispute!.id,
                        detail.dispute!.attachment_url!.split('/').pop() || 'attachment'
                      )}
                      className="flex items-center gap-1.5 text-[12px] text-primary hover:underline"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      {detail.dispute.attachment_url.split('/').pop()}
                    </button>
                  )}

                  {detail.dispute.status !== 'OPEN' && detail.dispute.resolution_action && (
                    <div className="border-t border-slate-100 pt-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          'text-[11px] font-bold px-2.5 py-0.5 rounded-full',
                          detail.dispute.resolution_action === 'UPHOLD' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'
                        )}>
                          {detail.dispute.resolution_action === 'UPHOLD' ? 'Score Upheld' : 'Score Adjusted'}
                        </span>
                      </div>
                      {detail.dispute.resolution_notes && (
                        <p className="text-[12px] text-slate-600 bg-slate-50 rounded-lg p-3 leading-relaxed">
                          {detail.dispute.resolution_notes}
                        </p>
                      )}
                    </div>
                  )}
                  {detail.dispute.status === 'OPEN' && !editingDispute && (
                    <p className="text-[12px] text-slate-400 italic">Awaiting manager review.</p>
                  )}
                </div>
              </div>
            )}

            {/* ── Resolve dispute (manager / admin) ───────────────────────── */}
            {canResolveDispute && detail.dispute?.status === 'OPEN' && (
              <div className={cn('rounded-xl border overflow-hidden',
                resolutionMode ? 'border-amber-300' : 'border-slate-200 bg-white')}>
                <div className={cn('px-4 py-3 border-b',
                  resolutionMode ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-100')}>
                  <span className="text-[13px] font-semibold text-slate-800">Resolve Dispute</span>
                </div>
                <div className={cn('px-4 py-3 space-y-3', resolutionMode ? 'bg-amber-50/50' : 'bg-white')}>
                  {!resolutionMode ? (
                    <>
                      <p className="text-[12px] text-slate-500">
                        Review the dispute reason and score breakdown, then choose how to resolve.
                      </p>
                      <Button size="sm" className="w-full bg-primary hover:bg-primary/90 text-white"
                        onClick={enterResolutionMode} disabled={!formData}>
                        <Edit3 className="h-3.5 w-3.5 mr-1.5" /> Start Resolution
                      </Button>
                      {!formData && <p className="text-[11px] text-amber-600">Loading form data…</p>}
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">
                          Resolution Notes <span className="text-red-400 normal-case font-normal">required</span>
                        </label>
                        <textarea
                          rows={4}
                          value={resNotes}
                          onChange={e => setResNotes(e.target.value)}
                          placeholder="Explain your decision…"
                          className="mt-1.5 w-full text-[13px] border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                        />
                      </div>
                      {resError && (
                        <p className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">{resError}</p>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <Button size="sm" variant="outline"
                          className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                          disabled={resSubmitting} onClick={() => submitResolution('UPHOLD')}>
                          Uphold Score
                        </Button>
                        <Button size="sm"
                          className="bg-blue-600 hover:bg-blue-700 text-white"
                          disabled={resSubmitting} onClick={() => submitResolution('ADJUST')}>
                          {resSubmitting ? 'Saving…' : 'Adjust Score'}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ── Review metadata ──────────────────────────────────────────── */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <span className="text-[13px] font-semibold text-slate-700">Review Details</span>
              </div>
              <div className="px-4 py-3 space-y-2">
                {!isCSR && <Row label="CSR"      value={detail.csr_name} />}
                {(detail as any).reviewer_name && <Row label="Reviewer" value={(detail as any).reviewer_name} />}
                <Row label="Form"        value={detail.form_name} />
                <Row label="Interaction" value={formData?.interaction_type ?? (detail as any).interaction_type} />
                <Row label="Submission"  value={`#${detail.id}`} />
                {detail.created_at && <Row label="Date" value={fmtDate(detail.created_at)} />}
                {metaRows.length > 0 && (
                  <>
                    <div className="border-t border-slate-100 my-2" />
                    {metaRows.map((m, i) => <Row key={i} label={m.field_name} value={m.value} />)}
                  </>
                )}
              </div>
            </div>

            {/* ── Call details (transcript collapsible) ───────────────────── */}
            {calls && calls.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100">
                  <span className="text-[13px] font-semibold text-slate-700">Call Details</span>
                </div>
                <div className="px-4 py-3 space-y-4">
                  {calls.map((call: any, i: number) => (
                    <div key={call.call_id || i} className="space-y-2.5">
                      {calls.length > 1 && (
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Call {i + 1}</p>
                      )}
                      {call.call_id   && <Row label="Conversation ID" value={call.call_id} />}
                      {call.call_date && <Row label="Call Date"       value={fmtDate(call.call_date)} />}
                      {call.recording_url ? (
                        <audio controls className="w-full h-8 mt-1">
                          <source src={call.recording_url} type="audio/mpeg" />
                        </audio>
                      ) : <p className="text-[12px] text-slate-400">No audio available</p>}
                      {call.transcript && (
                        <div>
                          <button
                            onClick={() => setTranscriptOpen(v => !v)}
                            className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                          >
                            {transcriptOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            {transcriptOpen ? 'Hide' : 'Show'} Transcript
                          </button>
                          {transcriptOpen && (
                            <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-slate-200 p-2.5 bg-slate-50">
                              <div className="text-[12px] text-slate-700 whitespace-pre-wrap break-words leading-relaxed"
                                dangerouslySetInnerHTML={{ __html: formatTranscriptText(call.transcript) }} />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>{/* end left pane inner padding */}
        </div>{/* end left pane */}

        {/* ════ RIGHT PANE ══════════════════════════════════════════════════ */}
        <div className="flex-1 bg-white overflow-y-auto">
          <div className="p-6">
            {resolutionMode && editRenderData ? (
              <div className="rounded-xl overflow-hidden border border-amber-300">
                <div className="px-4 py-3 bg-amber-50 border-b border-amber-200">
                  <h3 className="text-[14px] font-semibold text-amber-900">Adjusting Answers</h3>
                  <p className="text-[12px] text-amber-700 mt-0.5">
                    Change any answers below — the adjusted score updates in real time on the left.
                  </p>
                </div>
                <div className="bg-white">
                  <FormRenderer
                    formRenderData={editRenderData}
                    isDisabled={false}
                    onAnswerChange={handleEditAnswer}
                    onNotesChange={() => {}}
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-xl overflow-hidden border border-slate-200">
                <div className="px-4 py-3 bg-white border-b border-slate-100">
                  <h3 className="text-[14px] font-semibold text-slate-800">Score Breakdown</h3>
                </div>
                <div className="bg-white">
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
                    <div className="p-4">
                      <CategoryBreakdown detail={detail} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>{/* end right pane */}

      </div>{/* end split pane */}
    </div>
  )
}

import React, { useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, AlertTriangle, CheckCircle, Edit3, Pencil, FileText, ChevronDown, ChevronUp, Phone, Mic, MicOff, FileDown, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import qaService, { type SubmissionDetail } from '@/services/qaService'
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
import { formatQualityDate as fmtDate } from '@/utils/dateFormat'
import { Row, Panel, CategoryBreakdown } from './submission-detail/SubmissionDetailPrimitives'
import { DisputeForm, EditDisputeForm } from './submission-detail/DisputeForms'

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SubmissionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate  = useNavigate()
  const location  = useLocation()
  const { user }  = useAuth()
  // Label passed via navigation state — falls back to 'Submissions'
  const backLabel = (location.state as any)?.from ?? 'Submissions'
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
  const [activeCallIndex,  setActiveCallIndex]  = useState(0)

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
  // All metadata rows — now includes field_type and sort_order from backend
  const metaRows: Array<{ field_name: string; value: string; field_type?: string }> = Array.isArray(detail.metadata)
    ? (detail.metadata as any[]).map((m: any) => {
        const name = m.field_name ?? m.key ?? ''
        return { field_name: name, value: fmtMetaValue(name, String(m.value ?? '')), field_type: m.field_type }
      })
    : Object.entries(detail.metadata ?? {}).map(([k, v]) => {
        const val = typeof v === 'object' ? String((v as any)?.value ?? '') : String(v)
        return { field_name: k, value: fmtMetaValue(k, val) }
      })

  // Build the Review Details grid from formData.metadata_fields (includes SPACER definitions)
  // sorted by sort_order, with values looked up from metaRows by field_name.
  // Using formData as the template is the only reliable way to get SPACERs since they
  // never appear in submission_metadata (no value to store).
  const metaValueMap = new Map(metaRows.map(r => [r.field_name.toLowerCase(), r.value]))
  const reviewDetailsFields: Array<{ field_name: string; field_type: string; value: string }> =
    formData?.metadata_fields
      ? [...formData.metadata_fields]
          .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map((f: any) => ({
            field_name: f.field_name ?? '',
            field_type: f.field_type ?? 'TEXT',
            value: metaValueMap.get((f.field_name ?? '').toLowerCase()) ?? '',
          }))
      : metaRows.map(r => ({ field_name: r.field_name, field_type: r.field_type ?? 'TEXT', value: r.value }))

  // ── Split Review Details at the first SPACER (mirrors form-builder section break) ──
  const firstSpacerIdx = reviewDetailsFields.findIndex(f => f.field_type === 'SPACER')
  const topReviewFields    = firstSpacerIdx >= 0 ? reviewDetailsFields.slice(0, firstSpacerIdx)     : reviewDetailsFields
  const bottomReviewFields = firstSpacerIdx >= 0 ? reviewDetailsFields.slice(firstSpacerIdx + 1)    : []
  const hasBottomReviewFields = bottomReviewFields.some(f => f.field_type !== 'SPACER')

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
  const submitResolution = async (action: 'UPHOLD' | 'ADJUST') => {
    if (!detail.dispute?.id) return
    if (!resNotes.trim()) { setResError('Resolution notes are required.'); return }
    setResError(null)
    setResSubmitting(true)
    try {
      await qaService.resolveDispute(detail.dispute.id, {
        resolution_action: action,
        resolution_notes: resNotes,
        // For adjustments, pass both the new total score AND the individual edited answers
        // so the backend can update submission_answers and show the correct breakdown
        new_score: action === 'ADJUST' ? liveScore : undefined,
        answers: action === 'ADJUST'
          ? Object.entries(editedAnswers).map(([qId, a]) => ({
              question_id: Number(qId),
              answer: (a as any).answer ?? '',
              notes: (a as any).notes ?? '',
            }))
          : undefined,
      })
      toast({ title: 'Dispute resolved' })
      qc.invalidateQueries({ queryKey: ['submission-detail', id] })
      qc.invalidateQueries({ queryKey: ['submissions'] })
      qc.invalidateQueries({ queryKey: ['manager-disputes'] })
      qc.invalidateQueries({ queryKey: ['csr-dispute-history'] })
      setResolutionMode(false)
      setResNotes('')
    } catch (err: any) {
      setResError(err?.response?.data?.message ?? err?.message ?? 'Failed to resolve dispute.')
    } finally {
      setResSubmitting(false)
    }
  }

  const isPassing      = score >= PASS_THRESHOLD
  // MySQL Decimal columns come back as strings — parse to numbers before arithmetic/toFixed
  const prevScore = detail.dispute?.previous_score != null ? Number(detail.dispute.previous_score) : null
  const adjScore  = detail.dispute?.new_score       != null ? Number(detail.dispute.new_score)      : null
  // status === 'ADJUSTED' means the manager changed the score
  const disputeAdjusted = detail.dispute?.status === 'ADJUSTED' &&
    prevScore != null && adjScore != null

  return (
    // Header lives inside main's natural p-6 — same position as list page.
    // Only the split panes break out with -mx-6 -mb-6.
    <div className="flex flex-col" style={{ height: 'calc(100% + 24px)', marginBottom: '-24px' }}>

      {/* ── Page header — px-6 matches SubmissionsPage's own <div className="p-6 space-y-5">
           Back link + title are grouped tightly so the back link reads as a breadcrumb
           without pushing the title down visually */}
      <div className="shrink-0 px-6 pb-5">

        {/* Back link + title grouped with tight gap — info card separated by mb-5 */}
        <div className="flex flex-col gap-1 mb-5">
          <button onClick={() => navigate(-1)}
            className="self-start flex items-center gap-1 text-[11px] text-slate-400 hover:text-primary transition-colors">
            <ArrowLeft className="h-3 w-3" />
            {backLabel}
          </button>

          {/* Title row — QualityPageHeader identical classes */}
          <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold text-slate-900">Completed Review</h1>
          <div className="flex items-center gap-2 shrink-0 mt-0.5">
            {resolutionMode && (
              <span className="flex items-center gap-1 text-[12px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full">
                <Edit3 className="h-3.5 w-3.5" /> Resolving
              </span>
            )}
            {canAcceptReview && !finalizeSuccess && (
              <Button size="sm" disabled={finalizing} onClick={() => finalize()}
                className="bg-primary hover:bg-primary/90 text-white">
                <CheckCircle className="h-4 w-4 mr-1.5" />
                {finalizing ? 'Accepting…' : 'Accept Review'}
              </Button>
            )}
            {canDispute && !showDisputeForm && !finalizeSuccess && (
              <Button size="sm" variant="outline"
                className="border-primary text-slate-600 hover:bg-primary/5"
                onClick={() => setShowDisputeForm(true)}>
                <AlertTriangle className="h-4 w-4 mr-1.5" /> Dispute Score
              </Button>
            )}
            {finalizeSuccess && (
              <span className="flex items-center gap-1.5 text-[13px] text-primary font-semibold pr-2">
                <CheckCircle className="h-4 w-4" /> Accepted
              </span>
            )}
          </div>
        </div>{/* end title row */}
        </div>{/* end back+title group */}

        {/* Info card */}
        <div className="bg-white rounded-xl border border-slate-200 pl-4 pr-11 py-3 flex items-center justify-between">
          <span className="text-[15px] font-semibold text-slate-900 truncate">Review #: {detail.id} — {detail.form_name}</span>
          <span className="text-[15px] text-slate-600 shrink-0">
            Status: <span className="font-bold text-slate-900">{detail.status.charAt(0) + detail.status.slice(1).toLowerCase()}</span>
          </span>
        </div>

      </div>{/* end page header */}

      {/* ── Resolution mode banner ─────────────────────────────────────────── */}
      {resolutionMode && (
        <div className="shrink-0 bg-amber-50 border border-amber-200 rounded-xl mx-6 px-4 py-2.5 flex items-center gap-3 mb-2">
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

      {/* ── Two-pane split — px-6 pb-6 so left/right edges align with info card ── */}
      <div className="px-6 pb-6 flex flex-1 min-h-0 overflow-hidden gap-4">

        {/* ════ LEFT PANE ═══════════════════════════════════════════════════ */}
        <div className="w-1/2 shrink-0 rounded-xl border border-slate-200 bg-slate-100 overflow-y-auto">
          <div className="p-3 space-y-2.5">

            {/* ── CSR dispute submission form ─────────────────────────────── */}
            {showDisputeForm && (
              <DisputeForm submissionId={detail.id} onSuccess={() => setShowDisputeForm(false)} />
            )}

            {/* ── Review Details — key fields pinned at top, form fields below ── */}
            {reviewDetailsFields.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 bg-white border-b border-slate-100">
                  <h3 className="text-[15px] font-semibold text-slate-800">Review Details</h3>
                </div>

                {/* Fields above the first SPACER — larger key fields (Reviewer, Date, CSR) */}
                {topReviewFields.length > 0 && (
                  <div className="px-4 py-3">
                    <div className="grid grid-cols-3 gap-x-4 gap-y-2">
                      {topReviewFields.map((f, i) => {
                        // CSR endpoint doesn't return csr_name for the CSR's own record;
                        // fall back to the logged-in user's username in that case.
                        const displayValue = f.field_name === 'CSR'
                          ? (detail.csr_name ?? (isCSR ? user?.username : null) ?? f.value ?? '—')
                          : (f.value || '—')
                        return (
                          <div key={i} className="min-w-0">
                            <p className="text-[11px] text-slate-400 mb-0.5">{f.field_name}</p>
                            <p className="text-[14px] font-semibold text-slate-900 truncate" title={displayValue}>
                              {displayValue}
                            </p>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Divider — mirrors the SPACER boundary from the form builder */}
                {topReviewFields.length > 0 && hasBottomReviewFields && (
                  <div className="border-t border-slate-100" />
                )}

                {/* Fields below the first SPACER — form-defined metadata */}
                {hasBottomReviewFields && (
                  <div className="px-4 py-3">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                      {bottomReviewFields.map((f, i) => {
                        if (f.field_type === 'SPACER') {
                          return <div key={`spacer-${i}`} />
                        }
                        return (
                          <div key={i} className="min-w-0 flex items-baseline gap-1.5">
                            <span className="text-[12px] text-slate-500 shrink-0">{f.field_name}:</span>
                            <span className="text-[14px] font-semibold text-slate-800 truncate" title={f.value || '—'}>
                              {f.value || '—'}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Dispute information (third) ──────────────────────────────── */}
            {detail.dispute && (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-100">
                  <h3 className="text-[15px] font-semibold text-slate-800">Dispute</h3>
                  <div className="flex items-center gap-3">
                    <span className="text-[13px] text-slate-600">
                      Status: <span className="font-semibold text-slate-800">
                        {detail.dispute.status.charAt(0) + detail.dispute.status.slice(1).toLowerCase()}
                      </span>
                    </span>
                    {isCSR && detail.dispute.status === 'OPEN' && !detail.dispute.resolved_by && !editingDispute && (
                      <button className="text-[11px] text-slate-400 hover:text-primary flex items-center gap-1"
                        onClick={() => setEditingDispute(true)}>
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                    )}
                  </div>
                </div>
                <div className="px-4 py-3 space-y-3">
                  {/* Dates */}
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
                    <>
                      {/* Dispute Reason */}
                      <div>
                        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Dispute Reason</p>
                        <p className="text-[12px] text-slate-600 bg-slate-50 rounded-lg p-3 leading-relaxed">
                          {detail.dispute.reason}
                        </p>
                      </div>

                      {/* Supporting Evidence */}
                      {detail.dispute.attachment_url && (
                        <div>
                          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Supporting Evidence</p>
                          <button
                            onClick={() => qaService.downloadDisputeAttachment(
                              detail.dispute!.id,
                              detail.dispute!.attachment_url!.split('/').pop() || 'attachment'
                            )}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors w-full text-left"
                          >
                            <FileText className="h-4 w-4 text-primary shrink-0" />
                            <div className="min-w-0">
                              <p className="text-[12px] text-primary font-medium truncate">
                                {detail.dispute.attachment_url.split('/').pop()}
                              </p>
                              <p className="text-[11px] text-slate-400">Supporting evidence uploaded with dispute</p>
                            </div>
                          </button>
                        </div>
                      )}

                      {/* Resolution Notes */}
                      {detail.dispute.status !== 'OPEN' ? (
                        detail.dispute.resolution_notes && (
                          <div className="border-t border-slate-100 pt-3">
                            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Resolution Notes</p>
                            <p className="text-[12px] text-slate-600 bg-slate-50 rounded-lg p-3 leading-relaxed">
                              {detail.dispute.resolution_notes}
                            </p>
                          </div>
                        )
                      ) : (
                        <p className="text-[12px] text-slate-400 italic">Awaiting manager review.</p>
                      )}
                    </>
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
                  <h3 className="text-[15px] font-semibold text-slate-800">Resolve Dispute</h3>
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

            {/* ── Call Details (last) ──────────────────────────────────────── */}
            {calls && calls.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                {/* Header — always shown */}
                <div className="px-4 py-3 bg-white border-b border-slate-100">
                  <h3 className="text-[15px] font-semibold text-slate-800">Call Details</h3>
                </div>

                {/* Tabs — only shown when multiple calls */}
                {calls.length > 1 && (
                  <div className="flex border-b border-slate-100">
                    {calls.map((call: any, i: number) => (
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
                        {call.recording_url && (
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {/* Active call content */}
                {(() => {
                  const call = calls[activeCallIndex] ?? calls[0]
                  if (!call) return null
                  return (
                    <div className="px-4 py-3 space-y-3">
                      {/* Call identifiers */}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                        {call.call_id   && (
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

                      {/* Audio */}
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

                      {/* Transcript */}
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
                  )
                })()}

                {/* Multi-call status summary */}
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
            )}

          </div>{/* end left pane inner padding */}
        </div>{/* end left pane */}

        {/* ════ RIGHT PANE ══════════════════════════════════════════════════ */}
        <div className="flex-1 rounded-xl border border-slate-200 bg-slate-100 overflow-y-auto min-w-0">
          <div className="p-3 space-y-2.5">

            {/* ── Overall Score ────────────────────────────────────────────── */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <h3 className="text-[15px] font-semibold text-slate-800">Overall Score</h3>
              </div>
              {disputeAdjusted ? (
                <div className="px-5 py-4">
                  <div className="flex items-center gap-6">
                    <div className="flex-1 text-center">
                      <p className="text-[11px] text-slate-400 mb-1">Original</p>
                      <p className="text-[36px] font-bold text-slate-400 leading-none line-through">
                        {prevScore!.toFixed(1)}%
                      </p>
                    </div>
                    <div className="w-px self-stretch bg-slate-100" />
                    <div className="flex-1 text-center">
                      <p className="text-[11px] text-slate-400 mb-1">Updated</p>
                      <p className="text-[36px] font-bold text-slate-900 leading-none">
                        {adjScore!.toFixed(1)}%
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="px-5 py-4 text-center">
                  <div className="text-[44px] font-bold tracking-tight text-slate-900 leading-none">
                    {score.toFixed(1)}
                    <span className="text-2xl font-semibold ml-0.5 opacity-50">%</span>
                  </div>
                </div>
              )}

              {/* Live score shown only during resolution mode */}
              {resolutionMode && (
                <div className="border-t border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between">
                  <span className="text-[12px] font-medium text-amber-800">Live adjusted score</span>
                  <span className="text-[20px] font-bold text-slate-900">{liveScore.toFixed(1)}%</span>
                </div>
              )}
            </div>

            {/* ── Score breakdown / editable form ─────────────────────────── */}
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

import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/hooks/use-toast'
import writeupService from '@/services/writeupService'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { TableErrorState } from '@/components/common/TableErrorState'
import { Button } from '@/components/ui/button'
import { emptyForm, type WriteUpFormState } from './writeup-form/types'
import { EmployeeSection, CorrectiveSection, AttachmentsSection, MeetingNotesSection } from './writeup-form/BasicSections'
import { IncidentsSection } from './writeup-form/IncidentsSection'
import { PriorDisciplineSection } from './writeup-form/PriorDisciplineSection'

export default function WriteUpFormPage() {
  const navigate  = useNavigate()
  const { id }    = useParams<{ id: string }>()
  const isEdit    = !!id
  const { toast } = useToast()
  const qc        = useQueryClient()

  const [form, setForm] = useState<WriteUpFormState>(emptyForm())

  const update = <K extends keyof WriteUpFormState>(key: K, value: WriteUpFormState[K]) =>
    setForm(prev => ({ ...prev, [key]: value }))

  // ── Load existing in edit mode ─────────────────────────────────────────────

  const { data: existing, isError: loadError, refetch: loadRefetch } = useQuery({
    queryKey: ['writeup', id],
    queryFn:  () => writeupService.getWriteUpById(Number(id)),
    enabled:  isEdit,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (!existing) return
    setForm({
      csr_id:              existing.csr_id,
      document_type:       existing.document_type,
      manager_id:          existing.manager_id   ?? 0,
      hr_witness_id:       existing.hr_witness_id ?? 0,
      meeting_date:        existing.meeting_date?.slice(0, 10) ?? '',
      corrective_action:   existing.corrective_action ?? '',
      correction_timeline: existing.correction_timeline ?? '',
      checkin_date:        existing.checkin_date?.slice(0, 10) ?? '',
      consequence:         existing.consequence ?? '',
      linked_coaching_id:  existing.linked_coaching_id ?? null,
      linked_coaching_label: existing.linked_coaching_id
        ? `Session #${existing.linked_coaching_id}`
        : '',
      incidents: (existing.incidents ?? []).map(inc => ({
        id:          inc.id,
        description: inc.description,
        sort_order:    inc.sort_order,
        violations:    (inc.violations ?? []).map(v => ({
          id:                v.id,
          policy_violated:   v.policy_violated,
          reference_material: v.reference_material ?? '',
          sort_order:        v.sort_order,
          examples:          (v.examples ?? []).map(e => ({
            id:               e.id,
            example_date:     e.example_date?.slice(0, 10) ?? '',
            description:      e.description,
            source:           e.source,
            qa_submission_id: e.qa_submission_id ?? null,
            qa_question_id:   e.qa_question_id ?? null,
            sort_order:       e.sort_order,
          })),
        })),
      })),
      prior_discipline: (existing.prior_discipline ?? []).map((pd: any) => {
        const isWriteUp = pd.reference_type === 'write_up'
        const TYPE_LABELS: Record<string, string> = {
          VERBAL_WARNING: 'Verbal Warning', WRITTEN_WARNING: 'Written Warning', FINAL_WARNING: 'Final Warning',
        }
        const PURPOSE_LABELS: Record<string, string> = {
          WEEKLY: 'Weekly', PERFORMANCE: 'Performance', ONBOARDING: 'Onboarding',
        }
        return {
          reference_type: pd.reference_type,
          reference_id:   pd.reference_id,
          label:          `${isWriteUp ? 'Write-Up' : 'Coaching'} #${pd.reference_id}`,
          subtype:        isWriteUp
            ? (TYPE_LABELS[pd.document_type] ?? pd.document_type)
            : (PURPOSE_LABELS[pd.coaching_purpose] ?? pd.coaching_purpose),
          status:         isWriteUp ? pd.status : pd.status,
          date:           pd.date
            ? String(pd.date).slice(0, 10)
            : undefined,
          detail:         isWriteUp
            ? (pd.policies_violated ?? [])
            : (pd.topic_names ?? []),
          notes:          isWriteUp
            ? (pd.incident_descriptions ?? []).join(' | ')
            : pd.notes,
        }
      }),
      meeting_notes:    existing.meeting_notes ?? '',
      attachment_files: [],
      existing_attachments: (existing.attachments ?? []).map(a => ({
        id:              a.id,
        filename:        a.filename,
        file_size:       a.file_size ?? null,
        mime_type:       a.mime_type ?? null,
        attachment_type: a.attachment_type,
      })),
    })
  }, [existing])

  // ── Validation ─────────────────────────────────────────────────────────────

  const validate = (): string | null => {
    if (!form.csr_id)        return 'Please select an employee'
    if (!form.document_type) return 'Please select a document type'
    if (
      form.manager_id > 0 &&
      form.hr_witness_id > 0 &&
      form.manager_id === form.hr_witness_id
    ) return 'Manager and HR Witness cannot be the same person'
    return null
  }

  const buildPayload = () => ({
    csr_id:              form.csr_id,
    document_type:       form.document_type,
    meeting_date:        form.meeting_date || null,
    corrective_action:   form.corrective_action || null,
    correction_timeline: form.correction_timeline || null,
    checkin_date:        form.checkin_date || null,
    consequence:         form.consequence || null,
    linked_coaching_id:  form.linked_coaching_id,
    manager_id:          form.manager_id   || null,
    hr_witness_id:       form.hr_witness_id || null,
    meeting_notes:       form.meeting_notes || null,
    incidents:           form.incidents,
    prior_discipline:    form.prior_discipline.map(pd => ({
      reference_type: pd.reference_type,
      reference_id:   pd.reference_id,
    })),
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const saveMut = useMutation({
    mutationFn: async () => {
      const err = validate()
      if (err) throw new Error(err)
      const payload = buildPayload()
      let savedId: number
      if (isEdit) {
        await writeupService.updateWriteUp(Number(id), payload as any)
        savedId = Number(id)
      } else {
        const result = await writeupService.createWriteUp(payload as any)
        savedId = result.id
      }
      if (form.attachment_files.length > 0) {
        await Promise.all(form.attachment_files.map(f => writeupService.uploadAttachment(savedId, f)))
      }
      return { id: savedId }
    },
    onSuccess: ({ id: savedId }) => {
      qc.invalidateQueries({ queryKey: ['writeups'] })
      qc.invalidateQueries({ queryKey: ['writeup', String(savedId)] })
      toast({ title: isEdit ? 'Write-up saved' : 'Draft created' })
      navigate(`/app/writeups/${savedId}`)
    },
    onError: (err: any) => {
      toast({ title: 'Save failed', description: err?.message ?? 'Please try again.', variant: 'destructive' })
    },
  })

  const scheduleMut = useMutation({
    mutationFn: async () => {
      const err = validate()
      if (err) throw new Error(err)
      if (!form.meeting_date) throw new Error('Meeting date is required to schedule')
      const payload = buildPayload()
      let savedId: number
      if (isEdit) {
        await writeupService.updateWriteUp(Number(id), payload as any)
        savedId = Number(id)
      } else {
        const result = await writeupService.createWriteUp(payload as any)
        savedId = result.id
      }
      if (form.attachment_files.length > 0) {
        await Promise.all(form.attachment_files.map(f => writeupService.uploadAttachment(savedId, f)))
      }
      // Only transition to SCHEDULED when the write-up is currently DRAFT.
      // If it's already SCHEDULED, updateWriteUp above already persisted the changes.
      if (!isEdit || existing?.status === 'DRAFT') {
        await writeupService.transitionStatus(savedId, { status: 'SCHEDULED', meeting_date: form.meeting_date })
      }
      return { id: savedId }
    },
    onSuccess: ({ id: savedId }) => {
      qc.invalidateQueries({ queryKey: ['writeups'] })
      qc.invalidateQueries({ queryKey: ['writeup', String(savedId)] })
      toast({ title: 'Write-up scheduled' })
      navigate(`/app/writeups/${savedId}`)
    },
    onError: (err: any) => {
      toast({ title: 'Save failed', description: err?.message ?? 'Please try again.', variant: 'destructive' })
    },
  })

  const isSaving       = saveMut.isPending || scheduleMut.isPending
  const canSchedule    = !!form.meeting_date
  const isScheduled    = isEdit && existing?.status === 'SCHEDULED'
  const showMeetingNotes = isEdit && existing?.status === 'DELIVERED'

  const LOCKED_STATUSES = ['AWAITING_SIGNATURE', 'SIGNED', 'FOLLOW_UP_PENDING', 'CLOSED']

  if (isEdit && loadError) {
    return (
      <QualityListPage>
        <TableErrorState message="Failed to load write-up." onRetry={loadRefetch} />
      </QualityListPage>
    )
  }

  if (isEdit && existing && LOCKED_STATUSES.includes(existing.status)) {
    return (
      <QualityListPage>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 max-w-lg mt-4">
          <p className="text-[14px] font-semibold text-amber-900 mb-1">Document locked for editing</p>
          <p className="text-[13px] text-amber-700 mb-4">
            This write-up cannot be edited once it has been sent for signature.
          </p>
          <Button variant="outline" onClick={() => navigate(`/app/writeups/${id}`)}>
            View Write-Up
          </Button>
        </div>
      </QualityListPage>
    )
  }

  return (
    <QualityListPage>
      <QualityPageHeader
        title={isEdit ? 'Edit Write-Up' : 'New Write-Up'}
        actions={<Button variant="outline" onClick={() => navigate(-1)}>Cancel</Button>}
      />

      <div className="space-y-4">
        <EmployeeSection form={form} update={update} />
        <IncidentsSection form={form} update={update} />
        <CorrectiveSection form={form} update={update} />
        <PriorDisciplineSection form={form} update={update} />
        <AttachmentsSection form={form} update={update} writeUpId={isEdit ? Number(id) : undefined} />
        {showMeetingNotes && <MeetingNotesSection form={form} update={update} />}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between mt-4">
        <Button variant="outline" onClick={() => navigate(-1)} disabled={isSaving}>
          Cancel
        </Button>
        <div className="flex items-center gap-3">
          {isScheduled ? (
            <Button
              className="bg-primary hover:bg-primary/90 text-white"
              onClick={() => saveMut.mutate()}
              disabled={isSaving}
            >
              {saveMut.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => saveMut.mutate()} disabled={isSaving}>
                {saveMut.isPending ? 'Saving…' : 'Save as Draft'}
              </Button>
              <Button
                className="bg-primary hover:bg-primary/90 text-white"
                onClick={() => scheduleMut.mutate()}
                disabled={isSaving || !canSchedule}
                title={!canSchedule ? 'Set a meeting date to schedule' : undefined}
              >
                {scheduleMut.isPending ? 'Saving…' : 'Save & Schedule'}
              </Button>
            </>
          )}
        </div>
      </div>
    </QualityListPage>
  )
}

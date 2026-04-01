import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ChevronRight, ChevronLeft } from 'lucide-react'
import { FormBuilderList } from './FormBuilderList'
import { MetadataStep }   from './form-builder/MetadataStep'
import { CategoriesStep } from './form-builder/CategoriesStep'
import { QuestionsStep }  from './form-builder/QuestionsStep'
import { PreviewStep }    from './form-builder/PreviewStep'
import { STEPS, StepBar, freshForm, normalizeFormMetadata, totalCategoryWeight, type Step } from './form-builder/formBuilderUtils'
import { useAuth } from '@/contexts/AuthContext'
import { useQualityRole } from '@/hooks/useQualityRole'
import { getFormById, createForm, updateForm } from '@/services/formService'
import type { Form } from '@/types/form.types'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'

export default function FormsPage() {
  const { user } = useAuth()
  const { toast } = useToast()

  const [view, setView]           = useState<'list' | 'builder'>('list')
  const [step, setStep]           = useState<Step>('metadata')
  const [form, setForm]           = useState<Form>(freshForm())
  const [saving, setSaving]       = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  const { isAdmin } = useQualityRole()
  if (user && !isAdmin) {
    return (
      <div className="p-6">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-amber-700">
          You don't have permission to access Form Builder.
        </div>
      </div>
    )
  }

  const handleChange = (updated: Form) => { setForm(updated); setHasChanges(true) }

  const editMut = useMutation({
    mutationFn: (formId: number) => getFormById(formId, true),
    onSuccess: (data) => { setForm(normalizeFormMetadata(data)); setStep('metadata'); setView('builder'); setHasChanges(false) },
    onError: () => toast({ title: 'Error', description: 'Failed to load form.', variant: 'destructive' }),
  })

  const previewMut = useMutation({
    mutationFn: (formId: number) => getFormById(formId, true),
    onSuccess: (data) => { setForm(normalizeFormMetadata(data)); setStep('preview'); setView('builder'); setHasChanges(false) },
    onError: () => toast({ title: 'Error', description: 'Failed to load form.', variant: 'destructive' }),
  })

  const duplicateMut = useMutation({
    mutationFn: (formId: number) => getFormById(formId),
    onSuccess: (data) => {
      const normalized = normalizeFormMetadata(data)
      const copy: Form = {
        ...normalized, id: undefined, form_name: `${normalized.form_name} (Copy)`, version: 1,
        categories: normalized.categories.map(c => ({
          ...c, id: undefined, form_id: undefined,
          questions: c.questions.map(q => ({ ...q, id: undefined, category_id: undefined })),
        })),
        metadata_fields: normalized.metadata_fields?.map(f => ({ ...f, id: undefined, form_id: undefined })) || [],
      }
      setForm(copy); setStep('metadata'); setView('builder'); setHasChanges(true)
    },
    onError: () => toast({ title: 'Error', description: 'Failed to duplicate form.', variant: 'destructive' }),
  })

  const openEdit      = (formId: number) => editMut.mutate(formId)
  const openPreview   = (formId: number) => previewMut.mutate(formId)
  const openDuplicate = (formId: number) => duplicateMut.mutate(formId)

  const validateStep = (): { ok: boolean; message?: string } => {
    if (step === 'metadata' && !form.form_name.trim()) return { ok: false, message: 'Form name is required.' }
    if (step === 'categories') {
      if (form.categories.length === 0) return { ok: false, message: 'Add at least one category.' }
      const total = totalCategoryWeight(form.categories)
      if (Math.abs(total - 1) > 0.005) return { ok: false, message: `Weights sum to ${(total * 100).toFixed(0)}% — must be 100%.` }
    }
    if (step === 'questions' && !form.categories.some(c => c.questions?.length > 0)) {
      return { ok: false, message: 'Add at least one question.' }
    }
    return { ok: true }
  }

  const nextStep = () => {
    const v = validateStep()
    if (!v.ok) { toast({ title: 'Validation error', description: v.message, variant: 'destructive' }); return }
    const idx = STEPS.indexOf(step)
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1])
  }

  const prevStep = () => {
    const idx = STEPS.indexOf(step)
    if (idx > 0) setStep(STEPS[idx - 1]); else setView('list')
  }

  const saveForm = async () => {
    if (Math.abs(totalCategoryWeight(form.categories) - 1) > 0.005) {
      toast({ title: 'Weight error', description: 'Category weights must sum to 100%.', variant: 'destructive' }); return
    }
    setSaving(true)
    try {
      const payload: Form = {
        ...form,
        metadata_fields: (form.metadata_fields || []).map((f, i) => ({ ...f, sort_order: i })),
      }
      if (form.id) {
        await updateForm(form.id, payload)
        toast({ title: 'Form updated', description: `"${form.form_name}" saved as new version.` })
      } else {
        await createForm(payload)
        toast({ title: 'Form created', description: `"${form.form_name}" is now live.` })
      }
      setHasChanges(false)
      setTimeout(() => { setView('list') }, 1500)
    } catch (e: any) {
      toast({ title: 'Save failed', description: e.message || 'Please try again.', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  if (view === 'list') {
    return (
      <FormBuilderList
        onEdit={openEdit}
        onCreate={() => { setForm(freshForm()); setStep('metadata'); setHasChanges(false); setView('builder') }}
        onPreview={openPreview}
        onDuplicate={openDuplicate}
      />
    )
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{form.id ? `Edit Form: ${form.form_name}` : 'Create New Form'}</h1>
          {hasChanges && <p className="text-xs text-amber-600 mt-0.5">* Unsaved changes</p>}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setView('list')}>Cancel</Button>
      </div>

      <StepBar current={step} />

      <div className="min-h-[300px]">
        {step === 'metadata'   && <MetadataStep   form={form} onChange={handleChange} />}
        {step === 'categories' && <CategoriesStep form={form} onChange={handleChange} />}
        {step === 'questions'  && <QuestionsStep  form={form} onChange={handleChange} />}
        {step === 'preview'    && <PreviewStep    form={form} />}
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-slate-200">
        <Button variant="outline" onClick={prevStep}>
          <ChevronLeft className="h-4 w-4 mr-1" />{step === 'metadata' ? 'Cancel' : 'Back'}
        </Button>
        {step !== 'preview' ? (
          <Button onClick={nextStep} className="bg-primary hover:bg-primary/90 text-white">
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button onClick={saveForm} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {saving ? 'Saving…' : form.id ? 'Save as New Version' : 'Create Form'}
          </Button>
        )}
      </div>
    </div>
  )
}

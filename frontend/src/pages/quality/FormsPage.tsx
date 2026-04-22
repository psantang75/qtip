import { useState, useEffect } from 'react'
import { useParams, useSearchParams, useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, ChevronLeft } from 'lucide-react'
import { FormBuilderList } from './FormBuilderList'
import { MetadataStep }   from './form-builder/MetadataStep'
import { CategoriesStep } from './form-builder/CategoriesStep'
import { QuestionsStep }  from './form-builder/QuestionsStep'
import { PreviewStep }    from './form-builder/PreviewStep'
import { STEPS, StepBar, freshForm, normalizeFormBuilderPayload, normalizeFormMetadata, totalCategoryWeight, type Step } from './form-builder/formBuilderUtils'
import { useAuth } from '@/contexts/AuthContext'
import { useQualityRole } from '@/hooks/useQualityRole'
import { getFormById, createForm, updateForm } from '@/services/formService'
import type { Form } from '@/types/form.types'
import { Button } from '@/components/ui/button'
import { PageSpinner } from '@/components/common/PageSpinner'
import { useToast } from '@/hooks/use-toast'

const FORMS_BASE = '/app/quality/forms'

function isValidStep(s: string | null): s is Step {
  return s !== null && STEPS.includes(s as Step)
}

export default function FormsPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()

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

  const path = location.pathname
  const isNew       = path.endsWith('/new')
  const isEdit      = path.includes('/edit')
  const isPreview   = path.includes('/preview')
  const isDuplicate = path.includes('/duplicate')
  const isBuilder   = isNew || isEdit || isPreview || isDuplicate
  const formId      = id ? Number(id) : undefined

  const stepParam = searchParams.get('step')
  const step: Step = isValidStep(stepParam) ? stepParam : (isPreview ? 'preview' : 'metadata')

  const [form, setForm]           = useState<Form>(freshForm())
  const [saving, setSaving]       = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [loaded, setLoaded]       = useState(false)

  const { data: loadedForm, isLoading } = useQuery({
    queryKey: ['form-builder', formId],
    queryFn: () => getFormById(formId!, true),
    enabled: !!formId && isBuilder,
  })

  useEffect(() => {
    if (!loadedForm || loaded) return
    const normalized = normalizeFormBuilderPayload(normalizeFormMetadata(loadedForm))
    if (isDuplicate) {
      setForm({
        ...normalized, id: undefined, form_name: `${normalized.form_name} (Copy)`, version: 1,
        categories: normalized.categories.map(c => ({
          ...c, id: undefined, form_id: undefined,
          questions: c.questions.map(q => ({ ...q, id: undefined, category_id: undefined })),
        })),
        metadata_fields: normalized.metadata_fields?.map(f => ({ ...f, id: undefined, form_id: undefined })) || [],
      })
      setHasChanges(true)
    } else {
      setForm(normalized)
      setHasChanges(false)
    }
    setLoaded(true)
  }, [loadedForm, loaded, isDuplicate])

  useEffect(() => {
    if (isNew && !formId) {
      setForm(freshForm())
      setHasChanges(false)
      setLoaded(true)
    }
  }, [isNew, formId])

  const handleChange = (updated: Form) => { setForm(updated); setHasChanges(true) }

  const setStep = (newStep: Step) => {
    const base = isNew ? `${FORMS_BASE}/new` : `${FORMS_BASE}/${formId}/edit`
    navigate(`${base}?step=${newStep}`, { replace: true })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

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
    if (idx > 0) { setStep(STEPS[idx - 1]) } else { navigate(FORMS_BASE) }
  }

  const saveForm = async () => {
    if (Math.abs(totalCategoryWeight(form.categories) - 1) > 0.005) {
      toast({ title: 'Weight error', description: 'Category weights must sum to 100%.', variant: 'destructive' }); return
    }
    setSaving(true)
    try {
      const payload: Form = normalizeFormBuilderPayload(form)
      if (form.id) {
        await updateForm(form.id, payload)
        toast({ title: 'Form updated', description: `"${form.form_name}" saved as new version.` })
      } else {
        await createForm(payload)
        toast({ title: 'Form created', description: `"${form.form_name}" is now live.` })
      }
      setHasChanges(false)
      setTimeout(() => navigate(FORMS_BASE), 1500)
    } catch (e: any) {
      toast({ title: 'Save failed', description: e.message || 'Please try again.', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  if (!isBuilder) {
    return <FormBuilderList />
  }

  if (isLoading && formId) {
    return <PageSpinner />
  }

  if (step === 'preview') {
    return (
      <div className="flex flex-col" style={{ height: 'calc(100% + 24px)', marginBottom: '-24px' }}>
        <div className="shrink-0 px-6 pt-6 pb-3 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{form.id ? `Edit Form: ${form.form_name}` : 'Create New Form'}</h1>
              {hasChanges && <p className="text-xs text-amber-600 mt-0.5">* Unsaved changes</p>}
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate(FORMS_BASE)}>Cancel</Button>
          </div>
          <StepBar current={step} />
        </div>

        <div className="flex-1 min-h-0 px-6 pb-6">
          <PreviewStep form={form} onBack={prevStep} onSave={saveForm} saving={saving} />
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{form.id ? `Edit Form: ${form.form_name}` : 'Create New Form'}</h1>
          {hasChanges && <p className="text-xs text-amber-600 mt-0.5">* Unsaved changes</p>}
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate(FORMS_BASE)}>Cancel</Button>
      </div>

      <StepBar current={step} />

      <div className="bg-white rounded-xl border border-slate-200 p-6 min-h-[300px]">
        {step === 'metadata'   && <MetadataStep   form={form} onChange={handleChange} />}
        {step === 'categories' && <CategoriesStep form={form} onChange={handleChange} />}
        {step === 'questions'  && <QuestionsStep  form={form} onChange={handleChange} />}

        <div className="flex items-center justify-between pt-6 mt-6 border-t border-slate-200">
          <Button variant="outline" onClick={prevStep}>
            <ChevronLeft className="h-4 w-4 mr-1" />{step === 'metadata' ? 'Cancel' : 'Back'}
          </Button>
          <Button onClick={nextStep} className="bg-primary hover:bg-primary/90 text-white">
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  )
}

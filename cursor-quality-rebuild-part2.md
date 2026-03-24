# CURSOR PROMPT — Quality Section Rebuild (Part 2 of 3)
## FormsPage (Form Builder) + DisputesPage

Continue from Part 1. Same global rules apply.

---

## FILE 3: `frontend/src/pages/quality/FormsPage.tsx`

Four-step wizard: Metadata → Categories → Questions → Preview & Save.
Category weights MUST sum to 1.0. Accessible to Admin (role 1) and QA (role 2) only.

```tsx
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Pencil, Copy, Trash2, ChevronRight, ChevronLeft,
  ClipboardList, CheckCircle2, AlertCircle, GripVertical,
  RefreshCw, Eye, EyeOff,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import qaService, { type FormSummary, type FormDetail, type FormCategory, type FormQuestion } from '@/services/qaService'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────
type Step = 'metadata' | 'categories' | 'questions' | 'preview'
const STEPS: Step[] = ['metadata', 'categories', 'questions', 'preview']
const STEP_LABELS: Record<Step, string> = {
  metadata: '1. Details',
  categories: '2. Categories',
  questions: '3. Questions',
  preview: '4. Preview & Save',
}

interface DraftForm {
  id?: number
  form_name: string
  interaction_type: string
  is_active: boolean
  categories: (FormCategory & { _tempId?: string })[]
}

function freshForm(): DraftForm {
  return { form_name: '', interaction_type: 'CALL', is_active: true, categories: [] }
}

function totalWeight(categories: DraftForm['categories']): number {
  return categories.reduce((s, c) => s + (c.weight || 0), 0)
}

// ── Step indicator ─────────────────────────────────────────────────────────────
function StepBar({ current }: { current: Step }) {
  return (
    <div className="flex items-center gap-1 mb-6">
      {STEPS.map((s, i) => {
        const idx = STEPS.indexOf(current)
        const done = i < idx
        const active = s === current
        return (
          <div key={s} className="flex items-center gap-1 flex-1">
            <div className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
              active ? 'bg-[#00aeef] text-white'
              : done  ? 'bg-[#00aeef]/20 text-[#00aeef]'
              : 'bg-slate-100 text-slate-400',
            )}>
              {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span>{i + 1}</span>}
              <span className="hidden sm:inline">{STEP_LABELS[s].split('. ')[1]}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={cn('flex-1 h-px', i < idx ? 'bg-[#00aeef]/40' : 'bg-slate-200')} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Step 1: Metadata ──────────────────────────────────────────────────────────
function MetadataStep({ draft, onChange }: { draft: DraftForm; onChange: (d: DraftForm) => void }) {
  return (
    <div className="max-w-lg space-y-5">
      <div className="space-y-1.5">
        <Label>Form Name <span className="text-red-500">*</span></Label>
        <Input
          value={draft.form_name}
          onChange={e => onChange({ ...draft, form_name: e.target.value })}
          placeholder="e.g. Customer Service Call Review"
          className="h-9"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Interaction Type</Label>
        <Select
          value={draft.interaction_type}
          onValueChange={v => onChange({ ...draft, interaction_type: v })}
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="CALL">Call</SelectItem>
            <SelectItem value="CHAT">Chat</SelectItem>
            <SelectItem value="EMAIL">Email</SelectItem>
            <SelectItem value="TICKET">Ticket</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-3">
        <Switch
          checked={draft.is_active}
          onCheckedChange={v => onChange({ ...draft, is_active: v })}
        />
        <Label className="cursor-pointer">Active (available for use in audits)</Label>
      </div>
    </div>
  )
}

// ── Step 2: Categories ─────────────────────────────────────────────────────────
function CategoriesStep({ draft, onChange }: { draft: DraftForm; onChange: (d: DraftForm) => void }) {
  const [name, setName] = useState('')
  const [weight, setWeight] = useState('')
  const [editIdx, setEditIdx] = useState<number | null>(null)

  const total = totalWeight(draft.categories)
  const remaining = Math.max(0, 1 - total)

  const addOrUpdate = () => {
    const w = parseFloat(weight)
    if (!name.trim() || isNaN(w) || w <= 0) return
    if (editIdx !== null) {
      const cats = [...draft.categories]
      cats[editIdx] = { ...cats[editIdx], category_name: name.trim(), weight: w }
      onChange({ ...draft, categories: cats })
      setEditIdx(null)
    } else {
      onChange({
        ...draft,
        categories: [
          ...draft.categories,
          {
            category_name: name.trim(),
            weight: w,
            questions: [],
            _tempId: crypto.randomUUID(),
          } as any,
        ],
      })
    }
    setName('')
    setWeight('')
  }

  const startEdit = (i: number) => {
    const c = draft.categories[i]
    setName(c.category_name)
    setWeight(String(c.weight))
    setEditIdx(i)
  }

  const remove = (i: number) => {
    onChange({ ...draft, categories: draft.categories.filter((_, idx) => idx !== i) })
    if (editIdx === i) { setEditIdx(null); setName(''); setWeight('') }
  }

  const weightOk = Math.abs(total - 1) < 0.005

  return (
    <div className="max-w-2xl space-y-5">
      {/* Weight indicator */}
      <div className={cn(
        'flex items-center justify-between rounded-lg px-4 py-2.5 text-sm border',
        weightOk ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
        : 'bg-amber-50 border-amber-200 text-amber-700',
      )}>
        <span>Total weight: {(total * 100).toFixed(0)}%</span>
        {!weightOk && (
          <span className="font-medium">
            {total < 1 ? `${(remaining * 100).toFixed(0)}% remaining` : 'Exceeds 100%'}
          </span>
        )}
        {weightOk && <CheckCircle2 className="h-4 w-4" />}
      </div>

      {/* Add/Edit form */}
      <div className="flex gap-2 items-end">
        <div className="flex-1 space-y-1">
          <Label className="text-xs">Category Name</Label>
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Greeting & Opening"
            className="h-9 text-sm"
            onKeyDown={e => e.key === 'Enter' && addOrUpdate()}
          />
        </div>
        <div className="w-32 space-y-1">
          <Label className="text-xs">Weight (0–1)</Label>
          <Input
            type="number" min={0} max={1} step={0.05}
            value={weight}
            onChange={e => setWeight(e.target.value)}
            placeholder={remaining.toFixed(2)}
            className="h-9 text-sm"
            onKeyDown={e => e.key === 'Enter' && addOrUpdate()}
          />
        </div>
        <Button
          size="sm"
          onClick={addOrUpdate}
          disabled={!name.trim() || !weight}
          className="bg-[#00aeef] hover:bg-[#0095cc] text-white h-9"
        >
          {editIdx !== null ? 'Update' : <><Plus className="h-4 w-4 mr-1" />Add</>}
        </Button>
        {editIdx !== null && (
          <Button variant="ghost" size="sm" className="h-9" onClick={() => { setEditIdx(null); setName(''); setWeight('') }}>
            Cancel
          </Button>
        )}
      </div>

      {/* Category list */}
      {draft.categories.length > 0 && (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Weight</TableHead>
                <TableHead className="text-right">Questions</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {draft.categories.map((c, i) => (
                <TableRow key={(c as any)._tempId || c.id || i}>
                  <TableCell className="font-medium text-sm">{c.category_name}</TableCell>
                  <TableCell className="text-right text-sm">{(c.weight * 100).toFixed(0)}%</TableCell>
                  <TableCell className="text-right text-sm">{c.questions?.length ?? 0}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(i)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => remove(i)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {draft.categories.length === 0 && (
        <div className="border-2 border-dashed border-slate-200 rounded-lg py-10 text-center text-slate-400">
          <ClipboardList className="h-8 w-8 mx-auto mb-2 text-slate-300" />
          <p className="text-sm">No categories yet. Add at least one.</p>
        </div>
      )}
    </div>
  )
}

// ── Step 3: Questions ─────────────────────────────────────────────────────────
function QuestionsStep({ draft, onChange }: { draft: DraftForm; onChange: (d: DraftForm) => void }) {
  const [activeCatIdx, setActiveCatIdx] = useState(0)
  const [qText, setQText] = useState('')
  const [qType, setQType] = useState<'YES_NO' | 'TEXT' | 'SCALE'>('YES_NO')
  const [qRequired, setQRequired] = useState(true)
  const [editQIdx, setEditQIdx] = useState<number | null>(null)

  const cat = draft.categories[activeCatIdx]

  const addOrUpdateQ = () => {
    if (!qText.trim()) return
    const cats = [...draft.categories]
    const questions = [...(cats[activeCatIdx].questions || [])]
    const q: FormQuestion = {
      id: (editQIdx !== null ? questions[editQIdx].id : undefined) as any,
      question_text: qText.trim(),
      question_type: qType,
      is_required: qRequired,
      order_index: editQIdx !== null ? questions[editQIdx].order_index : questions.length,
    }
    if (editQIdx !== null) {
      questions[editQIdx] = q
    } else {
      questions.push(q)
    }
    cats[activeCatIdx] = { ...cats[activeCatIdx], questions }
    onChange({ ...draft, categories: cats })
    setQText(''); setEditQIdx(null); setQRequired(true); setQType('YES_NO')
  }

  const removeQ = (qi: number) => {
    const cats = [...draft.categories]
    cats[activeCatIdx] = {
      ...cats[activeCatIdx],
      questions: cats[activeCatIdx].questions.filter((_, i) => i !== qi),
    }
    onChange({ ...draft, categories: cats })
    if (editQIdx === qi) { setEditQIdx(null); setQText('') }
  }

  const startEditQ = (qi: number) => {
    const q = cat.questions[qi]
    setQText(q.question_text)
    setQType(q.question_type as any)
    setQRequired(q.is_required)
    setEditQIdx(qi)
  }

  return (
    <div className="flex gap-6 max-w-4xl">
      {/* Category sidebar */}
      <div className="w-48 shrink-0 space-y-1">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Categories</p>
        {draft.categories.map((c, i) => (
          <button
            key={(c as any)._tempId || c.id || i}
            onClick={() => { setActiveCatIdx(i); setEditQIdx(null); setQText('') }}
            className={cn(
              'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors',
              i === activeCatIdx
                ? 'bg-[#00aeef]/10 text-[#00aeef] font-semibold'
                : 'text-slate-600 hover:bg-slate-100',
            )}
          >
            <div className="truncate">{c.category_name}</div>
            <div className="text-xs text-slate-400">{c.questions?.length ?? 0} questions</div>
          </button>
        ))}
      </div>

      {/* Question editor */}
      <div className="flex-1 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">{cat?.category_name}</h3>
        </div>

        {/* Add question */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Question Text</Label>
            <Textarea
              value={qText}
              onChange={e => setQText(e.target.value)}
              placeholder="Enter question text..."
              rows={2}
              className="text-sm resize-none"
            />
          </div>
          <div className="flex gap-3 items-end flex-wrap">
            <div className="space-y-1">
              <Label className="text-xs">Type</Label>
              <Select value={qType} onValueChange={v => setQType(v as any)}>
                <SelectTrigger className="h-8 text-xs w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="YES_NO">Yes / No</SelectItem>
                  <SelectItem value="TEXT">Text</SelectItem>
                  <SelectItem value="SCALE">Scale (1–10)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={qRequired} onCheckedChange={setQRequired} />
              <Label className="text-xs">Required</Label>
            </div>
            <Button
              size="sm"
              onClick={addOrUpdateQ}
              disabled={!qText.trim()}
              className="bg-[#00aeef] hover:bg-[#0095cc] text-white h-8"
            >
              {editQIdx !== null ? 'Update Question' : <><Plus className="h-3.5 w-3.5 mr-1" />Add</>}
            </Button>
            {editQIdx !== null && (
              <Button variant="ghost" size="sm" className="h-8" onClick={() => { setEditQIdx(null); setQText('') }}>
                Cancel
              </Button>
            )}
          </div>
        </div>

        {/* Question list */}
        {cat?.questions?.length ? (
          <div className="space-y-1.5">
            {cat.questions.map((q, qi) => (
              <div key={qi} className="flex items-start gap-3 bg-white border border-slate-200 rounded-lg p-3">
                <GripVertical className="h-4 w-4 text-slate-300 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-800">{q.question_text}</p>
                  <div className="flex gap-2 mt-1">
                    <Badge variant="outline" className="text-[10px] h-4 px-1.5">{q.question_type}</Badge>
                    {q.is_required && <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-red-600 border-red-200">Required</Badge>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEditQ(qi)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => removeQ(qi)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="border-2 border-dashed border-slate-200 rounded-lg py-8 text-center text-slate-400 text-sm">
            No questions yet. Add at least one.
          </div>
        )}
      </div>
    </div>
  )
}

// ── Step 4: Preview ───────────────────────────────────────────────────────────
function PreviewStep({ draft }: { draft: DraftForm }) {
  const total = totalWeight(draft.categories)
  const weightOk = Math.abs(total - 1) < 0.005

  return (
    <div className="max-w-2xl space-y-4">
      {!weightOk && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2 text-amber-700 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Category weights sum to {(total * 100).toFixed(0)}% — must be exactly 100% before saving.
        </div>
      )}

      <div className="bg-slate-50 rounded-lg border border-slate-200 p-4 space-y-1.5 text-sm">
        <div><span className="text-slate-500">Form Name: </span><span className="font-semibold">{draft.form_name || '—'}</span></div>
        <div><span className="text-slate-500">Type: </span><span className="font-medium">{draft.interaction_type}</span></div>
        <div><span className="text-slate-500">Status: </span><Badge variant="outline">{draft.is_active ? 'Active' : 'Inactive'}</Badge></div>
      </div>

      {draft.categories.map((cat, ci) => (
        <div key={ci} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
            <span className="font-semibold text-sm">{cat.category_name}</span>
            <span className="text-xs text-slate-400">Weight: {(cat.weight * 100).toFixed(0)}%</span>
          </div>
          {cat.questions?.length ? (
            <div className="divide-y divide-slate-100">
              {cat.questions.map((q, qi) => (
                <div key={qi} className="px-4 py-2.5 flex items-center justify-between">
                  <span className="text-sm text-slate-700">{q.question_text}</span>
                  <div className="flex gap-1.5 shrink-0 ml-3">
                    <Badge variant="outline" className="text-[10px]">{q.question_type}</Badge>
                    {q.is_required && <Badge variant="outline" className="text-[10px] text-red-600 border-red-200">Req</Badge>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-4 py-3 text-sm text-slate-400 italic">No questions added.</p>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Forms list ─────────────────────────────────────────────────────────────────
function FormsList({ onEdit, onCreate }: { onEdit: (id: number) => void; onCreate: () => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [deactivateId, setDeactivateId] = useState<number | null>(null)

  const { data: forms = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['qa-forms'],
    queryFn: () => qaService.getForms({ limit: 200 }),
  })

  const { mutate: deactivate } = useMutation({
    mutationFn: (id: number) => qaService.deactivateForm(id),
    onSuccess: () => {
      toast({ title: 'Form deactivated' })
      qc.invalidateQueries({ queryKey: ['qa-forms'] })
      setDeactivateId(null)
    },
    onError: () => toast({ title: 'Error', description: 'Failed to deactivate form.', variant: 'destructive' }),
  })

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Form Builder</h1>
          <p className="text-sm text-slate-500 mt-0.5">{forms.length} forms</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button onClick={onCreate} className="bg-[#00aeef] hover:bg-[#0095cc] text-white">
            <Plus className="h-4 w-4 mr-2" /> New Form
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-slate-100 animate-pulse rounded" />)}
          </div>
        ) : isError ? (
          <div className="p-6 flex items-center justify-between bg-red-50">
            <p className="text-red-700 text-sm font-medium">Failed to load forms.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </div>
        ) : forms.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <ClipboardList className="h-10 w-10 mx-auto mb-3 text-slate-300" />
            <p className="font-medium">No forms yet</p>
            <p className="text-sm mt-1">Create your first QA form to get started.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Form Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Categories</TableHead>
                <TableHead className="text-right">Questions</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(forms as FormSummary[]).map(f => (
                <TableRow key={f.id} className="hover:bg-slate-50">
                  <TableCell className="font-medium text-sm">{f.form_name}</TableCell>
                  <TableCell className="text-sm">{f.interaction_type ?? '—'}</TableCell>
                  <TableCell className="text-right text-sm">{f.category_count ?? '—'}</TableCell>
                  <TableCell className="text-right text-sm">{f.question_count ?? '—'}</TableCell>
                  <TableCell className="text-sm">v{f.version ?? 1}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={f.is_active ? 'text-emerald-600 border-emerald-200 bg-emerald-50' : 'text-slate-500'}>
                      {f.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit" onClick={() => onEdit(f.id)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {f.is_active && (
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                          title="Deactivate"
                          onClick={() => setDeactivateId(f.id)}
                        >
                          <EyeOff className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <AlertDialog open={deactivateId !== null} onOpenChange={() => setDeactivateId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate Form?</AlertDialogTitle>
            <AlertDialogDescription>
              This will make the form unavailable for new audits. Existing submissions are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deactivateId && deactivate(deactivateId)}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function FormsPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()

  const [view, setView] = useState<'list' | 'builder'>('list')
  const [step, setStep] = useState<Step>('metadata')
  const [draft, setDraft] = useState<DraftForm>(freshForm())
  const [saving, setSaving] = useState(false)

  // Access guard
  if (user && user.role_id !== 1 && user.role_id !== 2) {
    return (
      <div className="p-6">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-amber-700">
          You don't have permission to access Form Builder.
        </div>
      </div>
    )
  }

  const openCreate = () => {
    setDraft(freshForm())
    setStep('metadata')
    setView('builder')
  }

  const openEdit = async (formId: number) => {
    try {
      const detail = await qaService.getFormDetail(formId)
      setDraft({
        id: detail.id,
        form_name: detail.form_name,
        interaction_type: detail.interaction_type ?? 'CALL',
        is_active: detail.is_active,
        categories: detail.categories ?? [],
      })
      setStep('metadata')
      setView('builder')
    } catch {
      toast({ title: 'Error', description: 'Failed to load form.', variant: 'destructive' })
    }
  }

  const validateStep = (): { ok: boolean; message?: string } => {
    if (step === 'metadata') {
      if (!draft.form_name.trim()) return { ok: false, message: 'Form name is required.' }
    }
    if (step === 'categories') {
      if (draft.categories.length === 0) return { ok: false, message: 'Add at least one category.' }
      const total = totalWeight(draft.categories)
      if (Math.abs(total - 1) > 0.005) return { ok: false, message: `Weights sum to ${(total * 100).toFixed(0)}% — must be 100%.` }
    }
    if (step === 'questions') {
      const hasQ = draft.categories.some(c => c.questions?.length > 0)
      if (!hasQ) return { ok: false, message: 'Add at least one question.' }
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
    if (idx > 0) setStep(STEPS[idx - 1])
    else { setView('list') }
  }

  const saveForm = async () => {
    const total = totalWeight(draft.categories)
    if (Math.abs(total - 1) > 0.005) {
      toast({ title: 'Weight error', description: 'Category weights must sum to 100%.', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const payload = {
        form_name: draft.form_name,
        interaction_type: draft.interaction_type,
        is_active: draft.is_active,
        categories: draft.categories.map((c, ci) => ({
          ...c,
          _tempId: undefined,
          questions: c.questions.map((q, qi) => ({ ...q, order_index: qi })),
        })),
      }
      if (draft.id) {
        await qaService.updateForm(draft.id, payload)
        toast({ title: 'Form updated', description: `${draft.form_name} saved as new version.` })
      } else {
        await qaService.createForm(payload)
        toast({ title: 'Form created', description: `${draft.form_name} is now live.` })
      }
      qc.invalidateQueries({ queryKey: ['qa-forms'] })
      setView('list')
    } catch {
      toast({ title: 'Save failed', description: 'Please try again.', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  if (view === 'list') {
    return <FormsList onEdit={openEdit} onCreate={openCreate} />
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {draft.id ? `Edit Form: ${draft.form_name}` : 'Create New Form'}
          </h1>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setView('list')}>Cancel</Button>
      </div>

      <StepBar current={step} />

      <div className="min-h-[300px]">
        {step === 'metadata'   && <MetadataStep   draft={draft} onChange={setDraft} />}
        {step === 'categories' && <CategoriesStep draft={draft} onChange={setDraft} />}
        {step === 'questions'  && <QuestionsStep  draft={draft} onChange={setDraft} />}
        {step === 'preview'    && <PreviewStep    draft={draft} />}
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-slate-200">
        <Button variant="outline" onClick={prevStep}>
          <ChevronLeft className="h-4 w-4 mr-1" />
          {step === 'metadata' ? 'Cancel' : 'Back'}
        </Button>
        {step !== 'preview' ? (
          <Button onClick={nextStep} className="bg-[#00aeef] hover:bg-[#0095cc] text-white">
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button
            onClick={saveForm}
            disabled={saving}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {saving ? 'Saving...' : draft.id ? 'Save as New Version' : 'Create Form'}
          </Button>
        )}
      </div>
    </div>
  )
}
```

---

## FILE 4: `frontend/src/pages/quality/DisputesPage.tsx`

Role-based:
- **Manager (5)**: paginated dispute list + resolve action inline
- **CSR (3)**: their own dispute history (read-only)
- **Admin/QA (1, 2)**: all disputes, read-only

```tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, CheckCircle2, Clock, ChevronLeft, ChevronRight,
  RefreshCw, Eye,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import qaService, { scoreColor, type DisputeRecord } from '@/services/qaService'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

function DisputeStatusBadge({ status }: { status: string }) {
  const isOpen = status === 'OPEN'
  return (
    <Badge variant="outline" className={cn(
      'text-xs',
      isOpen ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-emerald-700 bg-emerald-50 border-emerald-200',
    )}>
      {isOpen ? <><Clock className="h-3 w-3 mr-1" />Open</> : <><CheckCircle2 className="h-3 w-3 mr-1" />Resolved</>}
    </Badge>
  )
}

// ── Dispute detail + resolve sheet ─────────────────────────────────────────────
function DisputeSheet({
  dispute, open, onClose, canResolve,
}: { dispute: DisputeRecord | null; open: boolean; onClose: () => void; canResolve: boolean }) {
  const [action, setAction] = useState<'UPHOLD' | 'ADJUST' | 'ASSIGN_TRAINING'>('UPHOLD')
  const [notes, setNotes] = useState('')
  const [newScore, setNewScore] = useState('')
  const { toast } = useToast()
  const qc = useQueryClient()

  const { mutate, isPending } = useMutation({
    mutationFn: () => qaService.resolveDispute(dispute!.id, {
      resolution_action: action,
      resolution_notes: notes,
      new_score: action === 'ADJUST' ? parseFloat(newScore) : undefined,
    }),
    onSuccess: () => {
      toast({ title: 'Dispute resolved', description: `Resolved as: ${action}` })
      qc.invalidateQueries({ queryKey: ['manager-disputes'] })
      qc.invalidateQueries({ queryKey: ['qa-overview-stats'] })
      onClose()
    },
    onError: () => toast({ title: 'Error', description: 'Failed to resolve.', variant: 'destructive' }),
  })

  if (!dispute) return null

  const alreadyResolved = dispute.status === 'RESOLVED'

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>Dispute #{dispute.id}</SheetTitle>
          <SheetDescription>
            Submitted {new Date(dispute.created_at).toLocaleDateString()}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5">
          {/* Summary */}
          <div className="bg-slate-50 rounded-lg border border-slate-200 p-4 space-y-2 text-sm">
            <div><span className="text-slate-500">CSR: </span><span className="font-medium">{dispute.csr_name ?? '—'}</span></div>
            <div><span className="text-slate-500">Form: </span><span className="font-medium">{dispute.form_name ?? '—'}</span></div>
            <div>
              <span className="text-slate-500">Original Score: </span>
              <span className={cn('font-semibold', scoreColor(dispute.original_score ?? 0))}>
                {dispute.original_score?.toFixed(1) ?? '—'}%
              </span>
            </div>
            <div><span className="text-slate-500">Status: </span><DisputeStatusBadge status={dispute.status} /></div>
          </div>

          {/* Reason */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Dispute Reason</p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              {dispute.reason}
            </div>
          </div>

          {/* Existing resolution */}
          {alreadyResolved && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 space-y-2 text-sm">
              <p className="font-semibold text-emerald-800">Resolution</p>
              <p><span className="text-slate-500">Action: </span><span className="font-medium">{dispute.resolution_action}</span></p>
              {dispute.resolution_notes && (
                <p><span className="text-slate-500">Notes: </span>{dispute.resolution_notes}</p>
              )}
              {dispute.new_score != null && (
                <p>
                  <span className="text-slate-500">New Score: </span>
                  <span className={cn('font-semibold', scoreColor(dispute.new_score))}>
                    {dispute.new_score.toFixed(1)}%
                  </span>
                </p>
              )}
              {dispute.resolved_at && (
                <p><span className="text-slate-500">Resolved: </span>{new Date(dispute.resolved_at).toLocaleDateString()}</p>
              )}
            </div>
          )}

          {/* Resolve form */}
          {canResolve && !alreadyResolved && (
            <div className="border border-blue-200 bg-blue-50 rounded-lg p-4 space-y-4">
              <p className="font-semibold text-blue-800 text-sm">Resolve Dispute</p>

              <div className="space-y-1.5">
                <Label className="text-xs text-blue-700">Action</Label>
                <Select value={action} onValueChange={v => setAction(v as typeof action)}>
                  <SelectTrigger className="bg-white h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UPHOLD">Uphold — keep original score</SelectItem>
                    <SelectItem value="ADJUST">Adjust — change the score</SelectItem>
                    <SelectItem value="ASSIGN_TRAINING">Assign Training</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {action === 'ADJUST' && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-blue-700">New Score (%)</Label>
                  <Input
                    type="number" min={0} max={100} step={0.1}
                    value={newScore}
                    onChange={e => setNewScore(e.target.value)}
                    placeholder={String(dispute.original_score ?? '')}
                    className="bg-white h-9 text-sm w-36"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs text-blue-700">Notes (required)</Label>
                <Textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Explain your decision..."
                  rows={3}
                  className="bg-white text-sm"
                />
              </div>

              <Button
                onClick={() => mutate()}
                disabled={isPending || notes.trim().length < 5}
                className="bg-blue-600 hover:bg-blue-700 text-white w-full"
              >
                {isPending ? 'Saving...' : 'Confirm Resolution'}
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── CSR dispute history ───────────────────────────────────────────────────────
function CSRDisputeHistory() {
  const [selected, setSelected] = useState<DisputeRecord | null>(null)

  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['csr-dispute-history'],
    queryFn: () => qaService.getCSRDisputeHistory(),
  })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My Disputes</h1>
        <p className="text-sm text-slate-500 mt-0.5">Your dispute history</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-slate-100 animate-pulse rounded" />)}
          </div>
        ) : isError ? (
          <div className="p-6 bg-red-50 flex items-center justify-between">
            <p className="text-red-700 text-sm">Failed to load disputes.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </div>
        ) : data.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-slate-300" />
            <p>You haven't submitted any disputes.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Form</TableHead>
                <TableHead className="text-right">Original Score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Resolution</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map(d => (
                <TableRow key={d.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSelected(d)}>
                  <TableCell className="text-sm">{new Date(d.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className="text-sm font-medium">{d.form_name ?? '—'}</TableCell>
                  <TableCell className="text-right">
                    <span className={cn('font-semibold text-sm', scoreColor(d.original_score ?? 0))}>
                      {d.original_score?.toFixed(1) ?? '—'}%
                    </span>
                  </TableCell>
                  <TableCell><DisputeStatusBadge status={d.status} /></TableCell>
                  <TableCell className="text-sm text-slate-500">{d.resolution_action ?? '—'}</TableCell>
                  <TableCell><Eye className="h-4 w-4 text-slate-400" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <DisputeSheet dispute={selected} open={!!selected} onClose={() => setSelected(null)} canResolve={false} />
    </div>
  )
}

// ── Manager / Admin dispute list ──────────────────────────────────────────────
function ManagerDisputeList({ canResolve }: { canResolve: boolean }) {
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [selected, setSelected] = useState<DisputeRecord | null>(null)
  const PAGE_SIZE = 20

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['manager-disputes', page, statusFilter],
    queryFn: () => qaService.getManagerDisputes({
      page, limit: PAGE_SIZE,
      status: statusFilter || undefined,
    }),
    placeholderData: prev => prev,
  })

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Disputes</h1>
          <p className="text-sm text-slate-500 mt-0.5">{data ? `${data.total} total` : ''}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      {/* Filter */}
      <div>
        <Select
          value={statusFilter}
          onValueChange={v => { setStatusFilter(v); setPage(1) }}
        >
          <SelectTrigger className="h-9 text-sm w-44">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All statuses</SelectItem>
            <SelectItem value="OPEN">Open</SelectItem>
            <SelectItem value="RESOLVED">Resolved</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(6)].map((_, i) => <div key={i} className="h-10 bg-slate-100 animate-pulse rounded" />)}
          </div>
        ) : isError ? (
          <div className="p-6 bg-red-50 flex items-center justify-between">
            <p className="text-red-700 text-sm">Failed to load disputes.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>CSR</TableHead>
                <TableHead>Form</TableHead>
                <TableHead className="text-right">Orig. Score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Action</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items?.length ? (
                data.items.map(d => (
                  <TableRow key={d.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSelected(d)}>
                    <TableCell className="text-sm">{new Date(d.created_at).toLocaleDateString()}</TableCell>
                    <TableCell className="font-medium text-sm">{d.csr_name ?? '—'}</TableCell>
                    <TableCell className="text-sm">{d.form_name ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      <span className={cn('font-semibold text-sm', scoreColor(d.original_score ?? 0))}>
                        {d.original_score?.toFixed(1) ?? '—'}%
                      </span>
                    </TableCell>
                    <TableCell><DisputeStatusBadge status={d.status} /></TableCell>
                    <TableCell className="text-sm text-slate-500">{d.resolution_action ?? '—'}</TableCell>
                    <TableCell><Eye className="h-4 w-4 text-slate-400" /></TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-slate-400">
                    <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                    No disputes found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <DisputeSheet
        dispute={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
        canResolve={canResolve}
      />
    </div>
  )
}

// ── Router ────────────────────────────────────────────────────────────────────
export default function DisputesPage() {
  const { user } = useAuth()
  const roleId = user?.role_id ?? 0

  if (roleId === 3) return <CSRDisputeHistory />
  return <ManagerDisputeList canResolve={roleId === 5} />
}
```

---

**END OF PART 2** — Continue with Part 3 for QualityAnalyticsPage + ScoringPage removal + routing updates.

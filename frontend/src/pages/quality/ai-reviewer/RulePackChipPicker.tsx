/**
 * Rule pack chip picker for the AI Reviewer detail page.
 *
 * QA admins use this to pick which DB-managed Rule Packs the AI applies
 * when grading interactions on this form. Pack content lives in the
 * `ai_rule_pack` table (authored via the Rule Pack Library page). Pack
 * ASSIGNMENT to a form persists to the `ai_form_rule_pack_assignment`
 * table via PUT /api/ai-reviewer/forms/:formId/rule-packs.
 *
 * Why chips instead of a dropdown: most forms get 0-3 packs and the
 * grouping by owner department is the primary affordance. Chips show
 * everything at a glance.
 */

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Save } from 'lucide-react'
import aiReviewerService from '@/services/aiReviewerService'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { useIsAdmin } from '@/hooks/useIsAdmin'

interface RulePackChipPickerProps {
  formId: number
}

export function RulePackChipPicker({ formId }: RulePackChipPickerProps) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const isAdmin = useIsAdmin()

  const packsQ = useQuery({
    queryKey: ['ai-reviewer-rule-packs'],
    queryFn: () => aiReviewerService.listRulePacks(),
    staleTime: 5 * 60 * 1000,
  })

  const assignedQ = useQuery({
    queryKey: ['ai-reviewer-form-rule-packs', formId],
    queryFn: () => aiReviewerService.getFormRulePackKeys(formId),
    enabled: Number.isFinite(formId) && formId > 0,
    staleTime: 30 * 1000,
  })

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    if (assignedQ.data && !hydrated) {
      setSelected(new Set(assignedQ.data))
      setHydrated(true)
    }
  }, [assignedQ.data, hydrated])

  const saveMut = useMutation({
    mutationFn: (keys: string[]) => aiReviewerService.setFormRulePackKeys(formId, keys),
    onSuccess: (saved) => {
      setSelected(new Set(saved))
      qc.invalidateQueries({ queryKey: ['ai-reviewer-form-rule-packs', formId] })
      toast({ title: 'Rule packs saved' })
    },
    onError: (e: any) => {
      toast({
        variant: 'destructive',
        title: "Couldn't save assignments",
        description: e?.response?.data?.error ?? e?.message ?? 'Try again.',
      })
    },
  })

  const toggle = (key: string) => {
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setSelected(next)
  }

  const dirty =
    !assignedQ.data ||
    assignedQ.data.length !== selected.size ||
    assignedQ.data.some((k) => !selected.has(k))

  // Pack list grouped by owner_dept for visual organization.
  const groups: Record<string, typeof packsQ.data> = {}
  for (const p of packsQ.data ?? []) {
    if (!groups[p.owner_dept]) groups[p.owner_dept] = []
    groups[p.owner_dept]!.push(p)
  }
  const groupNames = Object.keys(groups).sort()

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-900 flex items-center gap-1.5">
            <BookOpen className="h-4 w-4 text-primary" /> Rule Packs
          </h2>
          <p className="text-[12px] text-slate-500">
            Reusable grading rules the AI applies on this form. Pack content is text-only and version-controlled. Assign as many as
            apply.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => saveMut.mutate(Array.from(selected))}
          disabled={!isAdmin || !dirty || saveMut.isPending || !hydrated}
          title={!isAdmin ? 'Admin only' : undefined}
          className="bg-primary hover:bg-primary/90 text-white"
        >
          <Save className="h-3.5 w-3.5 mr-1" />
          {saveMut.isPending ? 'Saving…' : dirty ? 'Save assignment' : 'Saved'}
        </Button>
      </div>

      <div className="p-4 space-y-4">
        {packsQ.isLoading && <p className="text-[12px] text-slate-500">Loading packs…</p>}
        {packsQ.isError && (
          <p className="text-[12px] text-rose-600">Couldn't load rule packs. Refresh to try again.</p>
        )}
        {!packsQ.isLoading && (packsQ.data ?? []).length === 0 && (
          <p className="text-[12px] text-slate-500">
            No rule packs in the library yet. Open the Rule Pack Library page to author one.
          </p>
        )}
        {groupNames.map((dept) => (
          <div key={dept}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">{dept}</div>
            <div className="flex flex-wrap gap-1.5">
              {(groups[dept] ?? []).map((p) => {
                const on = selected.has(p.key)
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => toggle(p.key)}
                    disabled={!isAdmin}
                    title={!isAdmin ? 'Admin only' : undefined}
                    className={
                      'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[12px] transition ' +
                      (on
                        ? 'border-primary bg-primary text-white shadow-sm'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400') +
                      (!isAdmin ? ' opacity-60 cursor-not-allowed' : '')
                    }
                  >
                    {p.name}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export default RulePackChipPicker

/**
 * Per-form golden set management card.
 *
 * Lists the active golden submissions for the form (auto-seeded
 * + manually marked), with archive / restore controls. Lives next
 * to the eval-run card on AIReviewerFormDetail rather than as a
 * separate page so all golden-set context is one place.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getErrorMessage } from '@/utils/errorHandling'
import { Archive, Sparkles } from 'lucide-react'
import aiReviewerService, { type GoldenSetItem } from '@/services/aiReviewerService'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'

interface Props {
  formId: number
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function GoldenSetCard({ formId }: Props) {
  const qc = useQueryClient()
  const { toast } = useToast()

  const q = useQuery({
    queryKey: ['ai-reviewer-golden-set', formId],
    queryFn: () => aiReviewerService.getGoldenSet(formId),
    enabled: Number.isFinite(formId) && formId > 0,
    staleTime: 30 * 1000,
  })

  const archiveMut = useMutation({
    mutationFn: (id: number) => aiReviewerService.archiveGolden(id, 'Archived by user'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-reviewer-golden-set', formId] })
      toast({ title: 'Archived' })
    },
    onError: (e) => toast({
      variant: 'destructive',
      title: "Couldn't archive item",
      description: getErrorMessage(e, 'Try again.'),
    }),
  })

  const items = q.data ?? []

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-900 flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-amber-500" />
            Golden submissions ({items.length})
          </h2>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Held-out submissions used by the regression eval. Auto-seeded when AI + human agree exactly and the score
            is above the critical-fail cap; humans can also mark a submission golden from its detail page.
          </p>
        </div>
      </div>
      <div className="p-4">
        {q.isLoading ? (
          <div className="h-12 bg-slate-100 animate-pulse rounded" />
        ) : items.length === 0 ? (
          <p className="text-[12px] text-slate-400 italic">
            No golden submissions yet. The seeder runs on every server boot + daily; review more AI submissions and
            promote/agree with them to grow the set automatically.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 max-h-[320px] overflow-y-auto">
            {items.map((g) => (
              <GoldenRow key={g.id} g={g} onArchive={() => archiveMut.mutate(g.id)} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function GoldenRow({ g, onArchive }: { g: GoldenSetItem; onArchive: () => void }) {
  return (
    <li className="py-2 flex items-center justify-between gap-3 text-[12px]">
      <div className="min-w-0">
        <div className="text-slate-700">
          submission #{g.submission_id}
          {g.ticket_id != null && <span className="text-slate-400"> · ticket {g.ticket_id}</span>}
        </div>
        <div className="text-[11px] text-slate-500">
          marked {fmtDate(g.marked_at)} · {g.source === 'auto_seed' ? 'auto-seeded' : 'manual'}
          {g.total_score != null && <span> · score {g.total_score.toFixed(1)}</span>}
        </div>
      </div>
      <Button size="sm" variant="ghost" onClick={onArchive} className="text-[11px] text-slate-500 hover:text-rose-700 shrink-0">
        <Archive className="h-3 w-3 mr-1" />
        Archive
      </Button>
    </li>
  )
}

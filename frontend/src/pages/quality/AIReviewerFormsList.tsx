/**
 * AI Reviewer — list of AI-enabled forms.
 *
 * Sidebar entry point for QA admins to manage everything AI-related on
 * a per-form basis WITHOUT bumping `forms.version`. Each row shows the
 * form's current mode (Calibrating | Trusted), rolling agreement, and
 * a button into the per-form management page where guidance, draft
 * mode, and Trusted-mode sampling are edited.
 *
 * Form-builder still owns the on/off toggle (`ai_enabled`); flipping
 * AI on for a new form here is intentionally out of scope.
 */

import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Bot, Sliders } from 'lucide-react'
import { ListPageShell } from '@/components/common/ListPageShell'
import { ListPageHeader } from '@/components/common/ListPageHeader'
import { ListCard } from '@/components/common/ListCard'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { TableErrorState } from '@/components/common/TableErrorState'
import { ListLoadingSkeleton } from '@/components/common/ListLoadingSkeleton'
import aiReviewerService, { type AiFormSummary } from '@/services/aiReviewerService'

function pctOrDash(v: number | null): string {
  if (v == null || !isFinite(v)) return '—'
  return `${Math.round(v * 1000) / 10}%`
}

function ModeBadge({ submitAsDraft }: { submitAsDraft: boolean }) {
  if (submitAsDraft) {
    return (
      <span className="inline-flex items-center text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
        Calibrating
      </span>
    )
  }
  return (
    <span className="inline-flex items-center text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
      Trusted
    </span>
  )
}

export default function AIReviewerFormsList() {
  const navigate = useNavigate()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['ai-reviewer-forms'],
    queryFn: () => aiReviewerService.listAiForms(),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  })

  const items: AiFormSummary[] = data ?? []

  return (
    <ListPageShell>
      <ListPageHeader
        title="AI Reviewer"
        subtitle="Manage AI guidance, mode, and Trusted-mode sampling per form. Edits here do not bump the form version."
      />

      {isLoading && <ListLoadingSkeleton rows={4} />}
      {isError && <TableErrorState message="Failed to load AI-enabled forms." onRetry={refetch} />}

      {!isLoading && !isError && (
        <ListCard>
          <div className="px-4 pt-3 pb-2 flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <h2 className="text-[14px] font-semibold text-slate-900">AI-enabled forms</h2>
            <span className="text-[12px] text-slate-500">({items.length})</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Form</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead className="text-right">Rolling agreement</TableHead>
                <TableHead className="text-right">Samples</TableHead>
                <TableHead className="text-right">Last 30d</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableEmptyState
                  colSpan={8}
                  icon={Bot}
                  title="No AI-enabled forms"
                  description="Toggle 'Enable AI Reviewer' on a form in Form Builder to make it appear here."
                />
              ) : (
                items.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="text-[13px] font-medium text-slate-800">{f.form_name}</TableCell>
                    <TableCell className="text-[12px] text-slate-600">{f.interaction_type}</TableCell>
                    <TableCell className="font-mono text-[12px] text-slate-500">v{f.version}</TableCell>
                    <TableCell><ModeBadge submitAsDraft={f.ai_submit_as_draft} /></TableCell>
                    <TableCell className="text-right font-mono text-[12px]">{pctOrDash(f.overall_agreement)}</TableCell>
                    <TableCell className="text-right font-mono text-[12px]">{f.sample_count}</TableCell>
                    <TableCell className="text-right font-mono text-[12px]">{f.last_30d_count}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        onClick={() => navigate(`/app/quality/ai-reviewer/${f.id}`)}
                        className="bg-primary hover:bg-primary/90 text-white"
                      >
                        <Sliders className="h-3.5 w-3.5 mr-1" />
                        Manage
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ListCard>
      )}
    </ListPageShell>
  )
}

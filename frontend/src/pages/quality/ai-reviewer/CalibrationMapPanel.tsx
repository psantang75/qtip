/**
 * CalibrationMapPanel — empirical confidence calibration UI.
 *
 * Shows the form's active calibration map (nominal → calibrated table)
 * and lets an admin fit a new version when there's enough data. Fit
 * produces an INACTIVE row; the admin previews the bins before
 * clicking "Activate" to flip it on. Routing then uses the calibrated
 * confidence value for the low-confidence routing decision.
 *
 * Sample-count gate: backend returns `coverage.ready_to_fit` based on
 * the 200-sample minimum. The Fit button is disabled (with the
 * shortfall called out) until that's met.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Loader2, PlayCircle } from 'lucide-react'
import aiReviewerService, {
  type CalibrationBin,
  type CalibrationMapVersion,
} from '@/services/aiReviewerService'
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

export function CalibrationMapPanel({ formId }: Props) {
  const qc = useQueryClient()
  const { toast } = useToast()

  const mapQ = useQuery({
    queryKey: ['ai-reviewer-calibration-map', formId],
    queryFn: () => aiReviewerService.getCalibrationMap(formId),
    enabled: Number.isFinite(formId) && formId > 0,
    staleTime: 30 * 1000,
  })

  const fitMut = useMutation({
    mutationFn: () => aiReviewerService.fitCalibrationMap(formId),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['ai-reviewer-calibration-map', formId] })
      toast({
        title: `Fit complete — version ${data.version}`,
        description: `${data.sample_count} samples, ${data.bins_with_data} bins with data. Review and activate when ready.`,
      })
    },
    onError: (e: any) =>
      toast({
        variant: 'destructive',
        title: "Couldn't fit calibration",
        description: e?.response?.data?.error ?? e?.message ?? 'Try again.',
      }),
  })

  const activateMut = useMutation({
    mutationFn: (mapId: number) => aiReviewerService.activateCalibrationMap(formId, mapId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-reviewer-calibration-map', formId] })
      toast({ title: 'Activated' })
    },
    onError: (e: any) =>
      toast({
        variant: 'destructive',
        title: "Couldn't activate calibration",
        description: e?.response?.data?.error ?? e?.message ?? 'Try again.',
      }),
  })

  const detail = mapQ.data
  const coverage = detail?.coverage
  const versions = detail?.versions ?? []

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-900 flex items-center gap-1.5">
            <Activity className="h-4 w-4 text-primary" />
            Confidence calibration map
          </h2>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Maps the model's nominal confidence to an empirical agreement rate (isotonic regression). Inbox routing
            uses the calibrated value when an active map exists. Identity (no transformation) until fit.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => fitMut.mutate()}
          disabled={fitMut.isPending || !coverage?.ready_to_fit}
          title={
            !coverage?.ready_to_fit
              ? `Need ${coverage?.min_samples ?? 200} reviewed submissions; have ${coverage?.sample_count ?? 0}`
              : 'Fit a new (inactive) calibration map version'
          }
          className="text-[12px] shrink-0"
        >
          {fitMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5 mr-1" />}
          Fit calibration map
        </Button>
      </div>

      <div className="p-4 space-y-4">
        {mapQ.isLoading ? (
          <div className="h-12 bg-slate-100 animate-pulse rounded" />
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px]">
              <Stat label="Reviewed samples" value={coverage?.sample_count ?? 0} />
              <Stat label="Min to fit" value={coverage?.min_samples ?? 200} />
              <Stat
                label="Active map"
                value={coverage?.active_map_version != null ? `v${coverage.active_map_version}` : 'identity'}
              />
              <Stat
                label="Active fitted"
                value={fmtDate(coverage?.active_map_fitted_at ?? null)}
              />
            </div>

            {detail?.active && detail.active.bins.length > 0 ? (
              <BinsTable bins={detail.active.bins} title="Active bins (nominal → calibrated)" />
            ) : (
              <p className="text-[12px] text-slate-400 italic">
                No active map. Routing uses nominal confidence directly. Fit + activate a map once you have ~{coverage?.min_samples ?? 200} reviewed submissions to start using empirical calibration.
              </p>
            )}

            {versions.length > 0 && (
              <div className="border-t border-slate-100 pt-3">
                <h3 className="text-[12px] font-semibold text-slate-700 mb-2">Versions</h3>
                <ul className="divide-y divide-slate-100">
                  {versions.map((v) => (
                    <VersionRow
                      key={v.id}
                      v={v}
                      onActivate={() => activateMut.mutate(v.id)}
                      isActivating={activateMut.isPending && activateMut.variables === v.id}
                    />
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-[14px] font-mono text-slate-800">{value}</div>
    </div>
  )
}

function BinsTable({ bins, title }: { bins: CalibrationBin[]; title: string }) {
  return (
    <div className="rounded-md border border-slate-200">
      <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-600 bg-slate-50 border-b border-slate-200">
        {title}
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-slate-500">
            <th className="text-left font-medium px-3 py-1">Nominal range</th>
            <th className="text-right font-medium px-3 py-1">Calibrated</th>
            <th className="text-right font-medium px-3 py-1">n</th>
          </tr>
        </thead>
        <tbody>
          {bins.map((b, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td className="px-3 py-1 font-mono text-slate-700">
                [{b.low.toFixed(2)} – {b.high.toFixed(2)})
              </td>
              <td className="px-3 py-1 text-right font-mono text-emerald-700">{b.calibrated.toFixed(2)}</td>
              <td className="px-3 py-1 text-right text-slate-500">{b.sample_count ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function VersionRow({
  v,
  onActivate,
  isActivating,
}: {
  v: CalibrationMapVersion
  onActivate: () => void
  isActivating: boolean
}) {
  return (
    <li className="py-2 flex items-center justify-between gap-3 text-[12px]">
      <div className="min-w-0">
        <div className="text-slate-700">
          v{v.version}
          {v.is_active && (
            <span className="ml-2 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
              ACTIVE
            </span>
          )}
        </div>
        <div className="text-[11px] text-slate-500">
          fit {fmtDate(v.fitted_at)} · {v.sample_count} samples
          {v.notes && <span className="text-slate-400"> · {v.notes}</span>}
        </div>
      </div>
      {!v.is_active && (
        <Button
          size="sm"
          variant="outline"
          onClick={onActivate}
          disabled={isActivating}
          className="text-[11px] shrink-0"
        >
          {isActivating ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
          Activate
        </Button>
      )}
    </li>
  )
}

/**
 * Coverage thresholds — per-department staffing expectations behind the
 * scheduling heatmap.
 *
 * Two layers per department:
 *   Default (all day) — the flat green/yellow, used when no time frames exist.
 *                       This is the legacy behavior and the fallback.
 *   Time frames       — start/stop windows, each with its own green/yellow, for
 *                       departments whose staffing bar changes across the day
 *                       (nothing before open, full bar mid-day, thinner after
 *                       the evening drop). Minutes outside every frame are
 *                       unmonitored, so the open and close stop reading red.
 *
 * Read-open, admin-write; the backend re-checks admin and validates ranges /
 * overlaps on every save.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Clock, Plus, Trash2 } from 'lucide-react'

import { ListLoadingSkeleton } from '@/components/common/ListLoadingSkeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import { t } from '@/lib/t'
import { hhmmOf, minutesOf } from '@/components/scheduling/scheduleTime'
import schedulingService, { type ApiCoverageThreshold, type ApiCoverageWindow } from '@/services/schedulingService'

const CARD = 'bg-white rounded-xl border border-slate-200 p-4'
const SUBHEAD = 'text-[10px] font-semibold uppercase tracking-wide text-slate-400'
const DAY_END = 24 * 60 - 1

type FlatBody = { department_id: number; green_min: number; yellow_min: number; is_enabled: boolean }

/** Order- and id-insensitive signature, so a saved set stops reading as dirty. */
const canon = (ws: ApiCoverageWindow[]) =>
  [...ws]
    .sort((a, b) => a.start.localeCompare(b.start))
    .map(w => `${w.start}|${w.end}|${w.green_min}|${w.yellow_min}`)
    .join(';')

function DeptRow({ row }: { row: ApiCoverageThreshold }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-coverage'] })

  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState(row.is_enabled)
  const [green, setGreen] = useState(row.green_min)
  const [yellow, setYellow] = useState(row.yellow_min)
  const [frames, setFrames] = useState<ApiCoverageWindow[]>(row.windows)

  const saveFlat = useMutation({
    mutationFn: (body: FlatBody) => schedulingService.upsertCoverageThreshold(body),
    onSuccess: invalidate,
    onError: (e) => toast(t.fromError(e)),
  })
  const saveFrames = useMutation({
    mutationFn: (windows: ApiCoverageWindow[]) => schedulingService.saveCoverageWindows(row.department_id, windows),
    // The server sorts and re-ids the set, so adopt what it stored rather than
    // leaving the local copy looking unsaved.
    onSuccess: (rows) => {
      const mine = rows.find(r => r.department_id === row.department_id)
      if (mine) setFrames(mine.windows)
      invalidate()
      toast({ title: 'Time frames saved' })
    },
    onError: (e) => toast(t.fromError(e)),
  })

  const commitFlat = (next: Partial<{ green: number; yellow: number; enabled: boolean }>) => saveFlat.mutate({
    department_id: row.department_id,
    green_min: next.green ?? green,
    yellow_min: next.yellow ?? yellow,
    is_enabled: next.enabled ?? enabled,
  })

  const patchFrame = (i: number, patch: Partial<ApiCoverageWindow>) =>
    setFrames(fs => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
  // New frames stack after the latest existing one — a fixed default would
  // collide with what's already there and the save would come back OVERLAP.
  const addFrame = () => setFrames(fs => {
    const startMin = fs.length ? Math.max(...fs.map(f => minutesOf(f.end))) : minutesOf('08:30')
    const endMin = Math.min(startMin + 8 * 60, DAY_END)
    if (endMin <= startMin) return fs
    return [...fs, { start: hhmmOf(startMin), end: hhmmOf(endMin), green_min: green, yellow_min: yellow }]
  })
  const removeFrame = (i: number) => setFrames(fs => fs.filter((_, idx) => idx !== i))

  const framesDirty = canon(frames) !== canon(row.windows)
  const dayFull = frames.some(f => minutesOf(f.end) >= DAY_END)

  return (
    <>
      <TableRow className={enabled ? '' : 'opacity-60'}>
        <TableCell className="w-8 pr-0">
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100"
            aria-label={open ? 'Collapse time frames' : 'Expand time frames'}
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </TableCell>
        <TableCell className="font-medium text-neutral-900">{row.department_name}</TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <Switch checked={enabled} onCheckedChange={v => { setEnabled(v); commitFlat({ enabled: v }) }} aria-label="Toggle coverage" />
            <span className="text-[12px] text-slate-500">{enabled ? 'On' : 'Off — no heatmap'}</span>
          </div>
        </TableCell>
      </TableRow>

      {open && (
        <TableRow className="bg-slate-50/60 hover:bg-slate-50/60">
          <TableCell />
          <TableCell colSpan={2} className="py-3">
            <p className={SUBHEAD}>All day default</p>
            <p className="mb-2 mt-1 text-[12px] text-slate-500">
              Applies whenever no time frame covers the minute. Below yellow reads red.
            </p>
            <div className="mb-4 flex items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor={`green-${row.department_id}`} className="text-[12px] text-slate-600">Green at</Label>
                <Input
                  id={`green-${row.department_id}`}
                  type="number" min={0} value={green} disabled={!enabled} className="h-8 w-24"
                  onChange={e => setGreen(Number(e.target.value))}
                  onBlur={() => commitFlat({ green })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`yellow-${row.department_id}`} className="text-[12px] text-slate-600">Yellow at</Label>
                <Input
                  id={`yellow-${row.department_id}`}
                  type="number" min={0} value={yellow} disabled={!enabled} className="h-8 w-24"
                  onChange={e => setYellow(Number(e.target.value))}
                  onBlur={() => commitFlat({ yellow })}
                />
              </div>
            </div>

            <p className={SUBHEAD}>
              <Clock className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
              Time frames
            </p>
            <p className="mb-2 mt-1 text-[12px] text-slate-500">
              Time frames override the all-day default within their hours. Any time not covered by a
              frame is unmonitored — no color, no warning. Frames cannot overlap.
            </p>

            {frames.length === 0 ? (
              <p className="mb-3 text-[12.5px] italic text-slate-400">No time frames — the all-day default applies.</p>
            ) : (
              <div className="mb-3 space-y-2">
                <div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] items-center gap-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  <span>Start</span><span>End</span><span>Green at</span><span>Yellow at</span><span />
                </div>
                {frames.map((f, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] items-center gap-2">
                    <Input type="time" value={f.start} className="h-8" onChange={e => patchFrame(i, { start: e.target.value })} />
                    <Input type="time" value={f.end} className="h-8" onChange={e => patchFrame(i, { end: e.target.value })} />
                    <Input type="number" min={0} value={f.green_min} className="h-8" onChange={e => patchFrame(i, { green_min: Number(e.target.value) })} />
                    <Input type="number" min={0} value={f.yellow_min} className="h-8" onChange={e => patchFrame(i, { yellow_min: Number(e.target.value) })} />
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-400 hover:text-destructive" onClick={() => removeFrame(i)} aria-label="Delete time frame">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8" onClick={addFrame} disabled={dayFull}>
                <Plus className="mr-1 h-4 w-4" /> Add time frame
              </Button>
              <Button
                size="sm"
                variant="primary"
                className="h-8"
                disabled={!framesDirty || saveFrames.isPending}
                onClick={() => saveFrames.mutate(frames)}
              >
                {saveFrames.isPending ? 'Saving…' : 'Save time frames'}
              </Button>
              {framesDirty && <span className="text-[11px] text-amber-600">Unsaved changes</span>}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

export function CoverageThresholdsEditor() {
  const { data, isLoading } = useQuery({ queryKey: ['admin-coverage'], queryFn: () => schedulingService.listCoverageThresholds() })

  return (
    <div className={CARD}>
      <p className="mb-3 text-[12.5px] text-slate-500">
        Turn a department’s coverage heatmap on or off here. Expand a department to set its all-day
        <span className="font-medium text-emerald-600"> green</span> /
        <span className="font-medium text-amber-600"> yellow</span> minimums (below yellow reads red) and to add
        <span className="font-medium"> time frames</span> — start/stop windows with their own minimums — so the open
        and close of the day stop showing false warnings.
      </p>
      {isLoading ? <ListLoadingSkeleton rows={4} /> : (
        <Table>
          <TableHeader>
            <TableRow className="border-b bg-slate-50">
              <TableHead className="w-8" />
              <TableHead>Department</TableHead>
              <TableHead>Coverage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).map(row => (
              <DeptRow key={row.department_id} row={row} />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

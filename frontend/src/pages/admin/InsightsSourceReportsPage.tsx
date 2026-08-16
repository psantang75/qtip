import { useMemo, useState } from 'react'
import { Clock, Pencil, Play, RefreshCw } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import {
  useSourceReports, useUpdateSourceReport, useRunSourceReportNow, type SourceReport,
} from '@/hooks/useSourceReports'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { EmailFeedsCard } from '@/components/insights/EmailFeedsCard'

const STATUS_STYLES: Record<string, string> = {
  SUCCESS: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  FAILED:  'bg-red-50 text-red-700 border-red-200',
  PARTIAL: 'bg-amber-50 text-amber-700 border-amber-200',
}

// The only off-peak window we expose: overnight 2-5 AM (server time).
const OFF_PEAK_VALUE = '2-5'
const OFF_PEAK_LABEL = '2–5 AM'

type FreqUnit = 'minutes' | 'hours' | 'days'

/** Human cadence label: 60 -> "1h", 120 -> "2h", 1440 -> "Daily", 45 -> "45m". */
function formatEvery(minutes: number | null): string {
  if (!minutes || minutes <= 0) return '—'
  if (minutes === 1440) return 'Daily'
  if (minutes % 1440 === 0) return `${minutes / 1440}d`
  if (minutes % 60 === 0) return `${minutes / 60}h`
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** Split a minute count into the largest exact unit for the edit form. */
function decomposeMinutes(minutes: number): { value: number; unit: FreqUnit } {
  if (minutes % 1440 === 0) return { value: minutes / 1440, unit: 'days' }
  if (minutes % 60 === 0)   return { value: minutes / 60,   unit: 'hours' }
  return { value: minutes, unit: 'minutes' }
}

function toMinutes(value: number, unit: FreqUnit): number {
  const mult = unit === 'days' ? 1440 : unit === 'hours' ? 60 : 1
  return Math.round(value * mult)
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// Tickets & Tasks are two ingestion jobs (ticket_open + task_open) that both
// load ie_fact_ticket_task — split only to stay under the CRM source's 25s
// session cap. To the user it's ONE report, so we collapse the two registry
// rows into a single scheduler row here. Edits / Run-now fan out to both ids
// (see `ids`), keeping their cadence in lockstep. Timing fields use the
// `ticket_open` member as representative so this row matches the Tickets &
// Tasks report header (which sources freshness from `ticket_open`).
const MERGED_GROUP = {
  codes: ['ticket_open', 'task_open'],
  representativeCode: 'ticket_open',
  name: 'Tickets & Tasks',
}

/** A scheduler table row — either a single report or a merged group (>1 id). */
interface DisplayRow {
  key: string
  ids: number[]
  report_name: string
  load_mode: SourceReport['load_mode']
  frequency_minutes: number
  run_only_hours: string | null
  last_run_at: string | null
  next_run_at: string | null
  last_status: SourceReport['last_status']
}

/** Worst-case roll-up of the members' statuses so a failure in either job shows. */
function combineStatus(statuses: SourceReport['last_status'][]): SourceReport['last_status'] {
  if (statuses.some(s => s === 'FAILED')) return 'FAILED'
  if (statuses.some(s => s === 'PARTIAL')) return 'PARTIAL'
  if (statuses.length > 0 && statuses.every(s => s === 'SUCCESS')) return 'SUCCESS'
  return null
}

function buildDisplayRows(reports: SourceReport[]): DisplayRow[] {
  const rows: DisplayRow[] = []
  let groupEmitted = false

  for (const r of reports) {
    if (MERGED_GROUP.codes.includes(r.report_code)) {
      if (groupEmitted) continue
      groupEmitted = true
      const members = reports.filter(m => MERGED_GROUP.codes.includes(m.report_code))
      const rep = members.find(m => m.report_code === MERGED_GROUP.representativeCode) ?? members[0]
      rows.push({
        key: MERGED_GROUP.codes.join('+'),
        ids: members.map(m => m.id),
        report_name: MERGED_GROUP.name,
        load_mode: rep.load_mode,
        frequency_minutes: rep.frequency_minutes,
        run_only_hours: rep.run_only_hours,
        last_run_at: rep.last_run_at,
        next_run_at: rep.next_run_at,
        last_status: combineStatus(members.map(m => m.last_status)),
      })
    } else {
      rows.push({
        key: r.report_code,
        ids: [r.id],
        report_name: r.report_name,
        load_mode: r.load_mode,
        frequency_minutes: r.frequency_minutes,
        run_only_hours: r.run_only_hours,
        last_run_at: r.last_run_at,
        next_run_at: r.next_run_at,
        last_status: r.last_status,
      })
    }
  }

  return rows
}

export default function InsightsSourceReportsPage() {
  const { toast } = useToast()
  const { data: reports = [], isLoading, refetch, dataUpdatedAt } = useSourceReports()
  const updateMut = useUpdateSourceReport()
  const runNowMut = useRunSourceReportNow()

  const displayRows = useMemo(() => buildDisplayRows(reports), [reports])

  const [editing, setEditing] = useState<DisplayRow | null>(null)
  const [freqValue, setFreqValue] = useState('1')
  const [freqUnit, setFreqUnit] = useState<FreqUnit>('hours')
  const [offPeak, setOffPeak] = useState<'any' | 'offpeak'>('any')
  const [runTarget, setRunTarget] = useState<DisplayRow | null>(null)

  function openEdit(r: DisplayRow) {
    setEditing(r)
    const { value, unit } = decomposeMinutes(r.frequency_minutes)
    setFreqValue(String(value))
    setFreqUnit(unit)
    setOffPeak(r.run_only_hours ? 'offpeak' : 'any')
  }

  async function saveEdit() {
    if (!editing) return
    const value = Number(freqValue)
    if (!Number.isFinite(value) || value <= 0) {
      toast({ title: 'Invalid frequency', description: 'Enter a number greater than zero.', variant: 'destructive' })
      return
    }
    const minutes = toMinutes(value, freqUnit)
    if (minutes < 5) {
      toast({ title: 'Too frequent', description: 'Minimum interval is 5 minutes.', variant: 'destructive' })
      return
    }
    try {
      // A merged row (Tickets & Tasks) carries >1 id — update both so the two
      // underlying jobs stay on the same cadence.
      await Promise.all(
        editing.ids.map((id) =>
          updateMut.mutateAsync({
            id,
            data: {
              frequency_minutes: minutes,
              run_only_hours: offPeak === 'offpeak' ? OFF_PEAK_VALUE : null,
            },
          }),
        ),
      )
      toast({ title: 'Schedule updated', description: `${editing.report_name} now runs every ${formatEvery(minutes)}.` })
      setEditing(null)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Try again.'
      toast({
        variant: 'destructive',
        title: "Couldn't save schedule",
        description: msg,
      })
    }
  }

  async function confirmRunNow() {
    if (!runTarget) return
    const name = runTarget.report_name
    try {
      // Fan out to every underlying job (Tickets & Tasks = two ids).
      await Promise.all(runTarget.ids.map((id) => runNowMut.mutateAsync(id)))
      toast({ title: 'Running now', description: `${name} is re-ingesting. Status updates when it finishes — Refresh in a moment.` })
      // Pull updated last_run/status once the run has had time to finish.
      window.setTimeout(() => { void refetch() }, 8000)
      window.setTimeout(() => { void refetch() }, 30000)
    } catch {
      toast({
        variant: 'destructive',
        title: `Couldn't start ${name}`,
        description: 'Try again.',
      })
    } finally {
      setRunTarget(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <Clock className="h-5 w-5 text-primary" /> Report Schedules
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            How often each Insights Engine source report re-ingests. Cadence is applied on the dispatcher&apos;s next tick — no redeploy.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            Updated {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : '—'}
          </span>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => refetch()}>
            <RefreshCw size={13} /> Refresh
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/60">
              <TableHead className="py-4">Report</TableHead>
              <TableHead className="py-4">Load Mode</TableHead>
              <TableHead className="py-4">Frequency</TableHead>
              <TableHead className="py-4">Off-peak</TableHead>
              <TableHead className="py-4">Last Run</TableHead>
              <TableHead className="py-4">Next Run</TableHead>
              <TableHead className="py-4">Status</TableHead>
              <TableHead className="py-4 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : displayRows.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">No source reports registered</TableCell></TableRow>
            ) : displayRows.map(row => (
              <TableRow key={row.key} className="hover:bg-slate-50/50">
                <TableCell className="text-[13px]">
                  <div className="font-medium text-slate-800">{row.report_name}</div>
                </TableCell>
                <TableCell className="text-[12px] text-slate-600">{row.load_mode.replace(/_/g, ' ').toLowerCase()}</TableCell>
                <TableCell className="text-[13px] font-medium text-slate-700">Every {formatEvery(row.frequency_minutes)}</TableCell>
                <TableCell className="text-[13px] text-slate-600">{row.run_only_hours ? OFF_PEAK_LABEL : 'Any hour'}</TableCell>
                <TableCell className="text-[13px] text-slate-600">{formatDateTime(row.last_run_at)}</TableCell>
                <TableCell className="text-[13px] text-slate-600">{formatDateTime(row.next_run_at)}</TableCell>
                <TableCell>
                  {row.last_status ? (
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border ${STATUS_STYLES[row.last_status] ?? 'bg-slate-50 text-slate-600'}`}>
                      {row.last_status}
                    </span>
                  ) : <span className="text-[12px] text-slate-400">never run</span>}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-slate-600" onClick={() => openEdit(row)}>
                    <Pencil size={13} /> Edit
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-primary" onClick={() => setRunTarget(row)}>
                    <Play size={13} /> Run now
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <EmailFeedsCard />

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit schedule — {editing?.report_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Run every</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={1}
                  className="w-28"
                  value={freqValue}
                  onChange={(e) => setFreqValue(e.target.value)}
                />
                <Select value={freqUnit} onValueChange={(v) => setFreqUnit(v as FreqUnit)}>
                  <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutes">Minutes</SelectItem>
                    <SelectItem value="hours">Hours</SelectItem>
                    <SelectItem value="days">Days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-[11px] text-slate-400">Minimum interval is 5 minutes.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Off-peak window</Label>
              <Select value={offPeak} onValueChange={(v) => setOffPeak(v as 'any' | 'offpeak')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any hour</SelectItem>
                  <SelectItem value="offpeak">{OFF_PEAK_LABEL} (overnight)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-400">Off-peak restricts runs to the overnight window (server time).</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={updateMut.isPending}>
              {updateMut.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!runTarget} onOpenChange={(o) => !o && setRunTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run {runTarget?.report_name} now?</AlertDialogTitle>
            <AlertDialogDescription>
              This re-ingests the report immediately (re-extract → stage → load). For a full reload it may take a little while; the report&apos;s normal cadence is unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRunNow} disabled={runNowMut.isPending}>
              {runNowMut.isPending ? 'Queuing…' : 'Run now'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

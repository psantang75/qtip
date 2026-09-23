/**
 * Daily-run schedule for the Missed Opportunities Settings tab.
 *
 * This used to be a PM2 cron on the server, which meant the schedule could not
 * be seen or paused without shell access. It now lives in `ie_config` alongside
 * the other engine settings, and the run history is on Admin → Insights →
 * Ingestion Log. The server re-validates the hour, so this form is a
 * convenience, not the guard.
 */
import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { MissedOpportunitySettings } from '@/types/missedOpportunities'

/** Every hour of the day, labelled in the business timezone the server runs in. */
const HOURS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: `${String(h).padStart(2, '0')}:00`,
}))

interface ScheduleCardProps {
  settings: MissedOpportunitySettings
  canEdit: boolean
  saving: boolean
  onSave: (patch: Partial<MissedOpportunitySettings>) => void
}

export default function ScheduleCard({ settings, canEdit, saving, onSave }: ScheduleCardProps) {
  const [enabled, setEnabled] = useState(settings.scheduleEnabled)
  const [hour, setHour] = useState(String(settings.scheduleHour))

  useEffect(() => {
    setEnabled(settings.scheduleEnabled)
    setHour(String(settings.scheduleHour))
  }, [settings])

  const dirty = enabled !== settings.scheduleEnabled || hour !== String(settings.scheduleHour)

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-900">Daily schedule</h2>
          <p className="text-[12px] text-slate-500">
            When the prior business day is graded automatically. Every run is recorded on the
            Ingestion Log.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => onSave({ scheduleEnabled: enabled, scheduleHour: Number(hour) })}
          disabled={!canEdit || !dirty || saving}
          title={!canEdit ? 'Admin only' : undefined}
          className="bg-primary text-white hover:bg-primary/90"
        >
          <Save className="mr-1 h-3.5 w-3.5" />
          {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
        <div>
          <Label className="text-[12px] font-medium text-slate-800">Grade automatically</Label>
          <p className="text-[11px] text-slate-500">
            Off means the report only updates when an Administrator re-grades a day by hand.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={!canEdit}
              aria-label="Grade the prior business day automatically"
            />
            <span className="text-[12.5px] text-slate-600">{enabled ? 'On' : 'Off'}</span>
          </div>
        </div>

        <div>
          <Label className="text-[12px] font-medium text-slate-800">Run after</Label>
          <p className="text-[11px] text-slate-500">
            Earliest hour the day may be graded, Eastern. The day is picked up on the next check if
            the server was down at this hour, and is never graded twice.
          </p>
          <Select value={hour} onValueChange={setHour} disabled={!canEdit || !enabled}>
            <SelectTrigger className="mt-1 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOURS.map((h) => (
                <SelectItem key={h.value} value={h.value}>
                  {h.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </section>
  )
}

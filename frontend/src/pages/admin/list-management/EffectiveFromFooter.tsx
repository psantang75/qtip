/**
 * The "Effective From" save footer shared by the effective-dated policy editors
 * (Attendance, Adherence). Its own file so the constants/formatters module can
 * stay component-free for Fast Refresh.
 */
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SUBHEAD } from './listEditorShared'

export function EffectiveFromFooter({ effectiveFrom, onChange, onSave, saving }: {
  effectiveFrom: string
  onChange: (v: string) => void
  onSave: () => void
  saving: boolean
}) {
  return (
    <div className="flex items-end justify-between gap-4 mt-4 pt-4 border-t border-slate-100">
      <div className="space-y-1">
        <Label htmlFor="effective-from" className={SUBHEAD}>Effective From</Label>
        <Input
          id="effective-from"
          type="date"
          value={effectiveFrom}
          onChange={e => onChange(e.target.value)}
          className="h-8 w-[160px] text-[13px]"
        />
        <p className="text-[11px] text-slate-400">Days before this date keep the rules they were scored under.</p>
      </div>
      <Button type="button" size="sm" className="gap-1.5 shrink-0" disabled={saving} onClick={onSave}>
        <Save className="h-3.5 w-3.5" />
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </div>
  )
}

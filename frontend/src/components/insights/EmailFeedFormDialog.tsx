import { useEffect, useState } from 'react'
import { useCreateEmailFeed, useUpdateEmailFeed, type EmailFeed } from '@/hooks/useSourceReports'
import { MANUAL_UPLOAD_TYPES } from '@/services/manualImportService'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Present = edit mode; absent = create mode. */
  feed?: EmailFeed | null
  /** data_types already configured — excluded from the create picker (one feed per type). */
  usedDataTypes: string[]
}

/**
 * Add / edit an email feed. `data_type` is chosen only at create time (it's the
 * key that ties the feed to its import history) and is read-only when editing.
 */
export function EmailFeedFormDialog({ open, onOpenChange, feed, usedDataTypes }: Props) {
  const isEdit = !!feed
  const create = useCreateEmailFeed()
  const update = useUpdateEmailFeed()
  const pending = create.isPending || update.isPending

  const available = MANUAL_UPLOAD_TYPES.filter(t => !usedDataTypes.includes(t.code))

  const [dataType, setDataType] = useState('')
  const [name, setName] = useState('')
  const [cadence, setCadence] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (feed) {
      setDataType(feed.data_type)
      setName(feed.name)
      setCadence(feed.cadence_label ?? '')
      setIsActive(feed.is_active)
    } else {
      const first = available[0]?.code ?? ''
      setDataType(first)
      setName(available[0]?.label ?? '')
      setCadence('')
      setIsActive(true)
    }
    // Reset only when the dialog opens or switches target feed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, feed])

  // When the picked type changes during create, default the name to its label.
  function pickType(code: string) {
    setDataType(code)
    const label = MANUAL_UPLOAD_TYPES.find(t => t.code === code)?.label ?? ''
    if (!name.trim() || name === MANUAL_UPLOAD_TYPES.find(t => t.code === dataType)?.label) {
      setName(label)
    }
  }

  async function handleSave() {
    setError(null)
    if (!name.trim()) { setError('Name is required.'); return }
    try {
      if (isEdit && feed) {
        await update.mutateAsync({ id: feed.id, data: { name: name.trim(), cadence_label: cadence.trim() || null, is_active: isActive } })
      } else {
        if (!dataType) { setError('Pick a data type.'); return }
        await create.mutateAsync({ data_type: dataType, name: name.trim(), cadence_label: cadence.trim() || null, is_active: isActive })
      }
      onOpenChange(false)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg ?? 'Could not save the feed.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit email feed' : 'Add email feed'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update the display name, expected cadence, or active state. The data type is fixed.'
              : 'Register a data file expected to arrive by email at the QTIP mailbox.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label className="text-[12px] font-medium text-slate-700">Data type</Label>
            {isEdit ? (
              <Input value={dataType} disabled className="bg-slate-50 text-slate-500" />
            ) : available.length === 0 ? (
              <p className="text-[12px] text-amber-600">Every known data type already has a feed.</p>
            ) : (
              <Select value={dataType} onValueChange={pickType}>
                <SelectTrigger><SelectValue placeholder="Select a data type" /></SelectTrigger>
                <SelectContent>
                  {available.map(t => (
                    <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="feed-name" className="text-[12px] font-medium text-slate-700">Display name</Label>
            <Input id="feed-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Paychex Punch Data" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="feed-cadence" className="text-[12px] font-medium text-slate-700">Expected cadence <span className="text-slate-400">(optional)</span></Label>
            <Input id="feed-cadence" value={cadence} onChange={e => setCadence(e.target.value)} placeholder="e.g. Daily ~6:00 AM" />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
            <div>
              <div className="text-[13px] font-medium text-slate-800">Active</div>
              <div className="text-[11px] text-slate-400">Inactive feeds stay listed but are muted.</div>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>

          {error && <p className="text-[12px] text-red-600">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button
            className="bg-primary hover:bg-primary/90 text-white"
            onClick={handleSave}
            disabled={pending || (!isEdit && available.length === 0)}
          >
            {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Add feed'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

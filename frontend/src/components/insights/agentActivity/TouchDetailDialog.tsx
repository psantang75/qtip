import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import TouchDetailPanel from './TouchDetailPanel'
import { type TouchDetailParams } from '@/services/insightsService'

interface TouchDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Null while closed; the panel only reads the CRM once this is set. */
  params: TouchDetailParams | null
  agentName?: string
}

/**
 * Modal drill-down behind a Workload "Touched" number: opens the individual CRM
 * task actions / ticket notes for one agent on one day. The CRM read fires only
 * while the dialog is open (the panel is mounted on open), keeping it on-demand.
 */
export default function TouchDetailDialog({ open, onOpenChange, params, agentName }: TouchDetailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Touched detail{agentName ? ` — ${agentName}` : ''}{params ? ` · ${params.date}` : ''}
          </DialogTitle>
          <DialogDescription>
            The individual task actions and ticket notes that make up this day’s Touched count, read live from the CRM.
          </DialogDescription>
        </DialogHeader>
        {open && <TouchDetailPanel params={params} />}
      </DialogContent>
    </Dialog>
  )
}

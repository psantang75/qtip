import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { MOCK_TEMPLATES, type MockTemplate } from './mockScheduleData'
import { TemplateTable } from './TemplateTable'

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  onNew: () => void
  onEdit: (t: MockTemplate) => void
  onView: (t: MockTemplate) => void
}

export function TemplateLibraryDialog({ open, onOpenChange, onNew, onEdit, onView }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Schedule templates</DialogTitle>
          <DialogDescription>
            A template is one saved week. Apply it to any set of employees from the
            schedule grid. Editing a template never changes schedules already generated
            from it.
          </DialogDescription>
        </DialogHeader>

        <TemplateTable
          templates={MOCK_TEMPLATES}
          onView={onView}
          onEdit={onEdit}
          onDuplicate={t => onEdit({ ...t, name: `${t.name} (copy)` })}
          action={
            <Button variant="primary" size="sm" className="h-9" onClick={onNew}>
              <Plus className="mr-1.5 h-4 w-4" /> New template
            </Button>
          }
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

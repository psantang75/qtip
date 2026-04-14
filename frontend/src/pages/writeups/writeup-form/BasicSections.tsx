import { useState, useRef, useCallback } from 'react'
import { Download, Paperclip, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RichTextEditor } from '@/components/common/RichTextEditor'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FormSection, Field } from '@/pages/training/coaching-form/CoachingFormSections'
import { useToast } from '@/hooks/use-toast'
import writeupService from '@/services/writeupService'
import type { WriteUpFormState } from './types'

type Updater = <K extends keyof WriteUpFormState>(key: K, value: WriteUpFormState[K]) => void

// ── Section 5: Attachments ────────────────────────────────────────────────────

export function AttachmentsSection({
  form,
  update,
  writeUpId,
}: {
  form: WriteUpFormState
  update: Updater
  writeUpId?: number
}) {
  const [dragging, setDragging]   = useState(false)
  const [deleting, setDeleting]   = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()

  const addFiles = useCallback((incoming: File[]) => {
    if (!incoming.length) return
    update('attachment_files', [...form.attachment_files, ...incoming])
  }, [form.attachment_files, update])

  const removeNewFile = (idx: number) =>
    update('attachment_files', form.attachment_files.filter((_, i) => i !== idx))

  const removeExisting = async (attachmentId: number) => {
    if (!writeUpId) return
    setDeleting(attachmentId)
    try {
      await writeupService.deleteAttachment(writeUpId, attachmentId)
      update('existing_attachments', form.existing_attachments.filter(a => a.id !== attachmentId))
    } catch {
      toast({ title: 'Delete failed', description: 'Could not remove attachment.', variant: 'destructive' })
    } finally {
      setDeleting(null)
    }
  }

  const handleDragOver  = (e: React.DragEvent) => { e.preventDefault(); setDragging(true) }
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setDragging(false) }
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    addFiles(Array.from(e.dataTransfer.files))
  }

  return (
    <FormSection title="Attachments">
      <Tabs defaultValue="upload">
        <TabsList className="mb-4">
          <TabsTrigger value="upload">Upload Files</TabsTrigger>
          <TabsTrigger value="system">From System Records</TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="mt-0">
          {form.existing_attachments.length > 0 && (
            <ul className="mb-3 space-y-1">
              {form.existing_attachments.map(a => (
                <li key={a.id} className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg border border-blue-100">
                  <Paperclip className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="flex-1 text-[13px] text-slate-700 truncate">{a.filename}</span>
                  {a.file_size && <span className="text-[11px] text-slate-400">{(a.file_size / 1024).toFixed(0)} KB</span>}
                  {writeUpId && (
                    <a href={`/api/writeups/${writeUpId}/attachments/${a.id}`} target="_blank" rel="noopener noreferrer"
                      className="text-primary hover:text-primary/80" title="View / Download">
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  )}
                  <Button type="button" variant="ghost" size="sm"
                    className="h-auto w-auto p-0 text-slate-400 hover:text-red-500 hover:bg-transparent"
                    disabled={deleting === a.id} onClick={() => removeExisting(a.id)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div role="button" tabIndex={0} aria-label="Upload files"
            onClick={() => inputRef.current?.click()}
            onKeyDown={e => e.key === 'Enter' && inputRef.current?.click()}
            onDragOver={handleDragOver} onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave} onDrop={handleDrop}
            className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg p-6 cursor-pointer transition-colors select-none ${
              dragging ? 'border-primary bg-primary/5' : 'border-slate-200 hover:border-primary/40 hover:bg-slate-50/50'
            }`}>
            <Paperclip className={`h-5 w-5 ${dragging ? 'text-primary' : 'text-slate-400'}`} />
            <span className="text-[13px] text-slate-600 font-medium">
              {dragging ? 'Drop files here' : 'Click to upload or drag and drop'}
            </span>
            <span className="text-[11px] text-slate-400">PDF, DOCX, XLSX, JPG, PNG</span>
          </div>
          <input ref={inputRef} type="file" className="sr-only" multiple
            accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png"
            onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />

          {form.attachment_files.length > 0 && (
            <ul className="mt-3 space-y-1">
              {form.attachment_files.map((f, i) => (
                <li key={i} className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg border border-slate-100">
                  <Paperclip className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  <span className="flex-1 text-[13px] text-slate-700 truncate">{f.name}</span>
                  <span className="text-[11px] text-slate-400">{(f.size / 1024).toFixed(0)} KB</span>
                  <Button type="button" variant="ghost" size="sm"
                    className="h-auto w-auto p-0 text-slate-400 hover:text-red-500 hover:bg-transparent"
                    onClick={() => removeNewFile(i)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="system" className="mt-0">
          <p className="text-[13px] text-slate-400 py-4 text-center">
            System record attachments will be available after saving the write-up.
          </p>
        </TabsContent>
      </Tabs>
    </FormSection>
  )
}

// ── Section 6: Meeting Notes ──────────────────────────────────────────────────

export function MeetingNotesSection({ form, update }: { form: WriteUpFormState; update: Updater }) {
  return (
    <FormSection title="Meeting Notes">
      <Field label="Post-Meeting Notes">
        <RichTextEditor className="text-[13px]"
          placeholder="Record notes from the meeting…"
          value={form.meeting_notes}
          onChange={html => update('meeting_notes', html)} />
      </Field>
    </FormSection>
  )
}

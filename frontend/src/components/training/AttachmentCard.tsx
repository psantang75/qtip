import { Download, X, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface AttachmentCardProps {
  filename?: string | null
  onDownload?: () => void
  editable?: boolean
  onEdit?: () => void
  onFileSelect?: (f: File) => void
  onRemove?: () => void
}

export function AttachmentCard({
  filename, onDownload, editable, onEdit, onFileSelect, onRemove,
}: AttachmentCardProps) {
  const hasFile = !!filename

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <h3 className="text-[15px] font-semibold text-slate-800">Attachment</h3>
          {hasFile && (
            <span className="text-[11px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">1 file</span>
          )}
        </div>
        {onEdit && (
          <button type="button" onClick={onEdit}
            className="flex items-center gap-1 text-slate-400 hover:text-primary transition-colors text-[12px]">
            <Pencil className="h-3 w-3" /> Edit
          </button>
        )}
      </div>

      <div className="px-5 py-4">
        {hasFile && (
          <div className="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
            <span className="text-[14px] font-semibold text-slate-900 truncate max-w-[280px]">{filename}</span>
            <div className="flex items-center gap-2 shrink-0 ml-3">
              {onDownload && (
                <Button type="button" variant="outline" size="sm" onClick={onDownload}>
                  <Download className="h-3.5 w-3.5 mr-1.5" /> Download
                </Button>
              )}
              {editable && onRemove && (
                <Button type="button" variant="ghost" size="sm"
                  className="text-[12px] text-red-500 hover:text-red-700 h-auto"
                  onClick={onRemove}>
                  <X className="h-3.5 w-3.5 mr-1" /> Remove
                </Button>
              )}
            </div>
          </div>
        )}

        {!hasFile && !editable && (
          <p className="text-[13px] text-slate-400">No attachments</p>
        )}

        {editable && (
          <div className={hasFile ? 'mt-3' : ''}>
            <Input
              type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
              className="text-[13px] text-slate-600 file:mr-3 file:py-1 file:px-3 file:border-0 file:rounded file:bg-primary/10 file:text-primary file:text-[12px] file:cursor-pointer"
              onChange={e => onFileSelect?.(e.target.files?.[0]!)}
            />
            <p className="text-[11px] text-slate-400 mt-1">Max 10 MB · PDF, Word, Images</p>
          </div>
        )}
      </div>
    </div>
  )
}

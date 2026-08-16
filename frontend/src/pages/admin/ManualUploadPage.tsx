import { useState } from 'react'
import { Upload } from 'lucide-react'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { ManualUploadPanel } from '@/components/insights/ManualUploadPanel'
import { MANUAL_UPLOAD_TYPES } from '@/services/manualImportService'

export default function ManualUploadPage() {
  const [dataType, setDataType] = useState(MANUAL_UPLOAD_TYPES[0].code)
  const activeType = MANUAL_UPLOAD_TYPES.find(t => t.code === dataType) ?? MANUAL_UPLOAD_TYPES[0]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <Upload className="h-5 w-5 text-primary" /> Manual Upload
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Upload a curated data file as a backup to the automated inbox pickup. Rows are matched to
          users by email; duplicates are prevented automatically.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="space-y-1.5 max-w-md">
          <label className="text-[12px] font-medium text-slate-700">Data type</label>
          <Select value={dataType} onValueChange={setDataType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {MANUAL_UPLOAD_TYPES.map(t => (
                <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-slate-400">{activeType.description}</p>
        </div>
      </div>

      {/* Remount on type change so the file/preview state resets cleanly. */}
      <ManualUploadPanel key={dataType} dataType={dataType} />
    </div>
  )
}

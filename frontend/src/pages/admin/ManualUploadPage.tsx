import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/utils/errorHandling'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  MANUAL_UPLOAD_TYPES, previewImport, uploadImport, getImportHistory,
  type ImportPreview, type ImportResult, type ImportLogRow,
} from '@/services/manualImportService'

const STATUS_STYLES: Record<string, string> = {
  COMPLETE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  FAILED:   'bg-red-50 text-red-700 border-red-200',
  PENDING:  'bg-amber-50 text-amber-700 border-amber-200',
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function ManualUploadPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [dataType, setDataType] = useState(MANUAL_UPLOAD_TYPES[0].code)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)

  const activeType = MANUAL_UPLOAD_TYPES.find(t => t.code === dataType) ?? MANUAL_UPLOAD_TYPES[0]

  const { data: history = [], isLoading: historyLoading, refetch } = useQuery({
    queryKey: ['manual-import-history', dataType],
    queryFn: () => getImportHistory(dataType),
  })

  const previewMut = useMutation({
    mutationFn: () => previewImport(file as File, dataType),
    onSuccess: setPreview,
    onError: (err: Error) => toast({
      variant: 'destructive', title: "Couldn't preview file",
      description: getErrorMessage(err, 'Check the file and try again.'),
    }),
  })

  const uploadMut = useMutation({
    mutationFn: () => uploadImport(file as File, dataType),
    onSuccess: (res: ImportResult) => {
      toast({
        title: 'Import complete',
        description: `${res.rows_imported} imported, ${res.rows_skipped} skipped, ${res.rows_errored} errored.`,
      })
      if (res.warnings?.length) {
        toast({ title: 'Import warnings', description: res.warnings.join(' ') })
      }
      resetFile()
      qc.invalidateQueries({ queryKey: ['manual-import-history', dataType] })
    },
    onError: (err: Error) => toast({
      variant: 'destructive', title: 'Import failed',
      description: getErrorMessage(err, 'Try again.'),
    }),
  })

  function resetFile() {
    setFile(null)
    setPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function onTypeChange(v: string) {
    setDataType(v)
    resetFile()
  }

  const canImport = !!preview && preview.column_check.valid && !uploadMut.isPending

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

      {/* Upload card */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-slate-700">Data type</label>
            <Select value={dataType} onValueChange={onTypeChange}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MANUAL_UPLOAD_TYPES.map(t => (
                  <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-slate-400">{activeType.description}</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-slate-700">Excel file (.xlsx, .xls)</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="w-full text-[13px] text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:border-0 file:rounded file:bg-primary/10 file:text-primary file:text-[12px] file:cursor-pointer"
              onChange={e => { setFile(e.target.files?.[0] ?? null); setPreview(null) }}
            />
            <p className="text-[11px] text-slate-400">
              Required columns: {activeType.requiredColumns.join(', ')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => previewMut.mutate()}
            disabled={!file || previewMut.isPending}
          >
            <FileSpreadsheet className="h-4 w-4 mr-1.5" />
            {previewMut.isPending ? 'Reading…' : 'Preview'}
          </Button>
          <Button variant="primary" onClick={() => uploadMut.mutate()} disabled={!canImport}>
            <Upload className="h-4 w-4 mr-1.5" />
            {uploadMut.isPending ? 'Importing…' : 'Import'}
          </Button>
          {file && (
            <span className="text-[12px] text-slate-500 truncate">{file.name}</span>
          )}
        </div>

        {preview && <PreviewPanel preview={preview} />}
      </div>

      {/* History card */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h2 className="text-[14px] font-semibold text-slate-800">Recent imports</h2>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => refetch()}>
            <RefreshCw size={13} /> Refresh
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/60">
              <TableHead className="py-3">File</TableHead>
              <TableHead className="py-3">Status</TableHead>
              <TableHead className="py-3">Imported</TableHead>
              <TableHead className="py-3">Skipped</TableHead>
              <TableHead className="py-3">Errored</TableHead>
              <TableHead className="py-3">By</TableHead>
              <TableHead className="py-3">When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {historyLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : history.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">No imports yet</TableCell></TableRow>
            ) : history.map((h: ImportLogRow) => (
              <TableRow key={h.id} className="hover:bg-slate-50/50">
                <TableCell className="text-[13px] font-medium text-slate-800 max-w-[220px] truncate">{h.file_name}</TableCell>
                <TableCell>
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border ${STATUS_STYLES[h.status] ?? 'bg-slate-50 text-slate-600'}`}>
                    {h.status}
                  </span>
                </TableCell>
                <TableCell className="text-[13px] text-slate-600">{h.rows_imported}</TableCell>
                <TableCell className="text-[13px] text-slate-600">{h.rows_skipped}</TableCell>
                <TableCell className="text-[13px] text-slate-600">{h.rows_errored}</TableCell>
                <TableCell className="text-[13px] text-slate-600">{h.importer?.username ?? '—'}</TableCell>
                <TableCell className="text-[13px] text-slate-500">{formatDate(h.created_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function PreviewPanel({ preview }: { preview: ImportPreview }) {
  const { column_check, email_match_summary, preview_rows, total_rows } = preview
  const valid = column_check.valid
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/40 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[13px]">
        <span className={`inline-flex items-center gap-1.5 font-semibold ${valid ? 'text-emerald-700' : 'text-red-700'}`}>
          {valid ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {valid ? 'Columns valid' : `Missing columns: ${column_check.missing.join(', ')}`}
        </span>
        <span className="text-slate-600">{total_rows} total rows</span>
        <span className="text-slate-600">
          Emails: {email_match_summary.matched} matched / {email_match_summary.unmatched} unmatched (first 100)
        </span>
      </div>

      {email_match_summary.unmatched_emails.length > 0 && (
        <p className="text-[12px] text-amber-700">
          Unmatched (skipped): {email_match_summary.unmatched_emails.slice(0, 8).join(', ')}
          {email_match_summary.unmatched_emails.length > 8 ? '…' : ''}
        </p>
      )}

      {preview_rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/60">
                {preview.columns.map(c => (
                  <TableHead key={c} className="py-2 text-[11px] whitespace-nowrap">{c}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview_rows.map((row, i) => (
                <TableRow key={i}>
                  {preview.columns.map(c => (
                    <TableCell key={c} className="text-[12px] text-slate-600 whitespace-nowrap">
                      {row[c] == null ? '' : String(row[c])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

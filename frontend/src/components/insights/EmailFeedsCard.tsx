import { useState } from 'react'
import { Mail, Upload, RefreshCw, Plus, Pencil, Trash2 } from 'lucide-react'
import {
  useEmailFeeds, useDeleteEmailFeed, type EmailFeed,
} from '@/hooks/useSourceReports'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ManualUploadPanel } from './ManualUploadPanel'
import { EmailFeedFormDialog } from './EmailFeedFormDialog'

const STATUS_STYLES: Record<string, string> = {
  SUCCESS: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  FAILED:  'bg-red-50 text-red-700 border-red-200',
  RUNNING: 'bg-blue-50 text-blue-700 border-blue-200',
  PARTIAL: 'bg-amber-50 text-amber-700 border-amber-200',
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/**
 * Email pickup feeds shown next to the SQL Report Schedules, backed by the
 * `mailbox_import_feed` table. Admins add / edit / remove feeds here (a feed's
 * data arrives by email via the mailbox poller, so there is no Run now); Manual
 * upload is the operator's fallback when an expected file didn't arrive.
 */
export function EmailFeedsCard() {
  const { toast } = useToast()
  const { data: feeds = [], isLoading, refetch, dataUpdatedAt } = useEmailFeeds()
  const deleteMut = useDeleteEmailFeed()

  const [uploadFeed, setUploadFeed] = useState<EmailFeed | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editFeed, setEditFeed] = useState<EmailFeed | null>(null)
  const [deleteFeed, setDeleteFeed] = useState<EmailFeed | null>(null)

  const usedDataTypes = feeds.map(f => f.data_type)

  function openAdd() { setEditFeed(null); setFormOpen(true) }
  function openEdit(feed: EmailFeed) { setEditFeed(feed); setFormOpen(true) }

  async function confirmDelete() {
    if (!deleteFeed) return
    const name = deleteFeed.name
    try {
      await deleteMut.mutateAsync(deleteFeed.id)
      toast({ title: 'Feed removed', description: `${name} is no longer listed.` })
    } catch {
      toast({ variant: 'destructive', title: `Couldn't remove ${name}`, description: 'Try again.' })
    } finally {
      setDeleteFeed(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <Mail className="h-4 w-4 text-primary" /> Email Feeds
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Data files picked up from the QTIP mailbox. Use Manual upload if an expected file didn&apos;t arrive.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            Updated {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : '—'}
          </span>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => refetch()}>
            <RefreshCw size={13} /> Refresh
          </Button>
          <Button size="sm" className="h-8 gap-1.5 bg-primary hover:bg-primary/90 text-white" onClick={openAdd}>
            <Plus size={13} /> Add feed
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/60">
              <TableHead className="py-4">Feed</TableHead>
              <TableHead className="py-4">Cadence</TableHead>
              <TableHead className="py-4">Last Pickup</TableHead>
              <TableHead className="py-4">Source</TableHead>
              <TableHead className="py-4">Status</TableHead>
              <TableHead className="py-4 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : feeds.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">No email feeds configured — use &ldquo;Add feed&rdquo; to register one</TableCell></TableRow>
            ) : feeds.map(feed => (
              <TableRow key={feed.id} className={`hover:bg-slate-50/50 ${feed.is_active ? '' : 'opacity-60'}`}>
                <TableCell className="text-[13px]">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800">{feed.name}</span>
                    {!feed.is_active && (
                      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500 border border-slate-200">Inactive</span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400">{feed.data_type}</div>
                </TableCell>
                <TableCell className="text-[13px] text-slate-600">
                  {feed.cadence_label || <span className="text-slate-400">Every {feed.poll_minutes}m</span>}
                </TableCell>
                <TableCell className="text-[13px] text-slate-600">{formatDateTime(feed.last_pickup_at)}</TableCell>
                <TableCell className="text-[13px] text-slate-600">
                  {feed.last_source === 'email' ? 'Email' : feed.last_source === 'manual' ? 'Manual' : '—'}
                </TableCell>
                <TableCell>
                  {feed.last_status ? (
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border ${STATUS_STYLES[feed.last_status] ?? 'bg-slate-50 text-slate-600'}`}>
                      {feed.last_status}
                    </span>
                  ) : <span className="text-[12px] text-slate-400">no pickups yet</span>}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-primary" onClick={() => setUploadFeed(feed)}>
                    <Upload size={13} /> Manual upload
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-slate-600" onClick={() => openEdit(feed)}>
                    <Pencil size={13} /> Edit
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-500 hover:text-red-600" onClick={() => setDeleteFeed(feed)} aria-label={`Delete ${feed.name}`}>
                    <Trash2 size={14} />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <EmailFeedFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        feed={editFeed}
        usedDataTypes={editFeed ? usedDataTypes.filter(t => t !== editFeed.data_type) : usedDataTypes}
      />

      <AlertDialog open={!!deleteFeed} onOpenChange={(o) => !o && setDeleteFeed(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteFeed?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the feed from Report Schedules. Past imports stay in the Ingestion Log, and you can re-add the feed later. It does not delete any imported data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={confirmDelete} disabled={deleteMut.isPending}>
              {deleteMut.isPending ? 'Removing…' : 'Remove feed'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={!!uploadFeed} onOpenChange={(o) => !o && setUploadFeed(null)}>
        <SheetContent side="right" className="w-[92vw] sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Manual upload — {uploadFeed?.name}</SheetTitle>
            <SheetDescription>
              Upload the {uploadFeed?.name} file directly when the emailed copy didn&apos;t arrive. It loads exactly as the mailbox pickup would.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            {uploadFeed && <ManualUploadPanel dataType={uploadFeed.data_type} />}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

/**
 * Paging for the Cycle Performance invoice list, and the count it used to hide.
 *
 * The grid fetched a capped 500 rows and rendered whatever came back, so a cohort
 * larger than the cap simply ended — August's declined population runs past it, and
 * nothing on the page said rows were missing. Showing the range against the true total
 * is the point of this component; the buttons are secondary.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { fmtNum } from '@/components/insights/agentActivity/format'

interface Props {
  page: number
  pageCount: number
  pageSize: number
  total: number
  onPage: (page: number) => void
}

export function InvoicePager({ page, pageCount, pageSize, total, onPage }: Props) {
  if (total === 0) return null

  const first = page * pageSize + 1
  const last = Math.min((page + 1) * pageSize, total)

  return (
    <div className="mt-3 flex items-center justify-between">
      <p className="text-[12px] text-slate-500">
        Showing {fmtNum(first)}–{fmtNum(last)} of {fmtNum(total)} invoices
      </p>
      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => onPage(page - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <span className="text-[12px] text-slate-600">
            Page {fmtNum(page + 1)} of {fmtNum(pageCount)}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pageCount - 1}
            onClick={() => onPage(page + 1)}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}

export default InvoicePager

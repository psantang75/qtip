import { cn } from '@/lib/utils'

interface StatusConfig {
  label: string
  classes: string
}

const STATUS_MAP: Record<string, StatusConfig> = {
  // QA Submission statuses
  SUBMITTED:           { label: 'Submitted',          classes: 'bg-slate-100   text-slate-700'   },
  FINALIZED:           { label: 'Finalized',          classes: 'bg-emerald-100 text-emerald-800' },
  DISPUTED:            { label: 'Disputed',           classes: 'bg-amber-100   text-amber-800'   },
  RESOLVED:            { label: 'Resolved',           classes: 'bg-blue-100    text-blue-800'    },
  // Dispute statuses
  OPEN:                { label: 'Open',               classes: 'bg-amber-100   text-amber-800'   },
  UPHELD:              { label: 'Upheld',             classes: 'bg-emerald-100 text-emerald-800' },
  REJECTED:            { label: 'Rejected',           classes: 'bg-red-100     text-red-800'     },
  ADJUSTED:            { label: 'Adjusted',           classes: 'bg-blue-100    text-blue-800'    },
  // Shared statuses (forms, coaching, write-ups)
  ACTIVE:              { label: 'Active',             classes: 'bg-emerald-100 text-emerald-800' },
  INACTIVE:            { label: 'Inactive',           classes: 'bg-slate-100   text-slate-500'   },
  DRAFT:               { label: 'Draft',              classes: 'bg-slate-100   text-slate-600'   },
  SCHEDULED:           { label: 'Scheduled',          classes: 'bg-indigo-100  text-indigo-800'  },
  COMPLETED:           { label: 'Completed',          classes: 'bg-emerald-100 text-emerald-800' },
  CLOSED:              { label: 'Closed',             classes: 'bg-slate-100   text-slate-500'   },
  // Coaching-specific
  IN_PROCESS:          { label: 'In Process',         classes: 'bg-blue-100    text-blue-800'    },
  IN_PROGRESS:         { label: 'In Progress',        classes: 'bg-blue-100    text-blue-800'    },
  AWAITING_CSR_ACTION: { label: 'Awaiting CSR',       classes: 'bg-amber-100   text-amber-800'   },
  QUIZ_PENDING:        { label: 'Quiz Pending',       classes: 'bg-indigo-100  text-indigo-800'  },
  FOLLOW_UP_REQUIRED:  { label: 'Follow-Up',          classes: 'bg-orange-100  text-orange-800'  },
  // Write-up-specific
  AWAITING_SIGNATURE:  { label: 'Awaiting Signature', classes: 'bg-amber-100   text-amber-800'   },
  SIGNED:              { label: 'Signed',             classes: 'bg-emerald-100 text-emerald-800' },
  FOLLOW_UP_PENDING:   { label: 'Follow-Up Pending',  classes: 'bg-orange-100  text-orange-800'  },
}

interface StatusBadgeProps {
  status: string
  className?: string
  /** Override the display label */
  label?: string
}

export function StatusBadge({ status, className, label }: StatusBadgeProps) {
  const key = status?.toUpperCase()
  const cfg = STATUS_MAP[key] ?? {
    label: status ? status.charAt(0) + status.slice(1).toLowerCase() : '—',
    classes: 'bg-slate-100 text-slate-600',
  }

  return (
    <span className={cn(
      'inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wide',
      cfg.classes,
      className,
    )}>
      {label ?? cfg.label}
    </span>
  )
}

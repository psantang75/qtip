import { cn } from '@/lib/utils'

export function Section({
  title, children, onEdit,
}: { title: string; children: React.ReactNode; onEdit?: () => void }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        {onEdit && (
          <button type="button" onClick={onEdit}
            className="text-[12px] text-primary hover:text-primary/80 transition-colors font-medium">
            Edit
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

export function Sub({
  title, icon: Icon, children,
}: {
  title: string
  icon?: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <div className="pt-4 mt-4 border-t border-slate-100">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
        {Icon && <Icon className="h-3 w-3" />}{title}
      </p>
      {children}
    </div>
  )
}

export function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-0.5">{label}</p>
      <div className="text-[13px] text-slate-800 font-medium">{value ?? '—'}</div>
    </div>
  )
}

export function SideCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('bg-white rounded-xl border border-slate-200 p-4', className)}>{children}</div>
}

export function SideTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-slate-700 border-b border-slate-100 pb-2.5 mb-3">{children}</h3>
}

export function ProgressRow({
  label, value, muted,
}: { label: string; value: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-slate-50 last:border-0">
      <span className={cn('text-[12px] font-medium', muted ? 'text-slate-400' : 'text-slate-500')}>{label}</span>
      <span className="text-[12px] text-slate-700 text-right">{value}</span>
    </div>
  )
}

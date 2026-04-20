import { cn } from '@/lib/utils'
import { RichTextDisplay } from '@/components/common/RichTextDisplay'

/**
 * Shared detail-page primitives used across Quality, Training, and Write-ups.
 * All font sizes, colors, and spacing are defined here as the single source
 * of truth so every detail view renders consistently.
 */

// ── Topic list (bullet dots + optional bold / multi-column) ─────────────────

export function TopicList({ topics, columns = 1, bold }: { topics: string[]; columns?: 1 | 3; bold?: boolean }) {
  if (!topics.length) return <span className="text-sm text-slate-400">None</span>
  const textCls = bold ? 'text-[14px] font-semibold text-slate-900' : 'text-sm text-slate-700'
  return (
    <div className={columns === 3 ? 'grid grid-cols-3 gap-y-1.5 gap-x-4' : 'space-y-1'}>
      {topics.map(t => (
        <div key={t} className={`flex items-center gap-2 ${textCls}`}>
          <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />{t}
        </div>
      ))}
    </div>
  )
}

// ── Read-only list-item display (categorized or flat) ───────────────────────

export function ListItemReadOnly({ label, items, legacyText }: {
  label: string
  items?: { id: number; category?: string; label: string }[]
  legacyText?: string | null
}) {
  const hasItems = (items?.length ?? 0) > 0
  const hasLegacy = !hasItems && !!legacyText
  const categories = hasItems ? [...new Set(items!.map(f => f.category ?? 'Other'))] : []
  return (
    <div>
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3">{label}</p>
      {hasItems ? (
        <div className="space-y-3">
          {categories.map(cat => (
            <div key={cat}>
              {categories.length > 1 && (
                <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-1.5">{cat}</p>
              )}
              <ul className="space-y-1">
                {items!.filter(f => (f.category ?? 'Other') === cat).map(f => (
                  <li key={f.id} className="flex items-center gap-2 text-[14px] font-semibold text-slate-900">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                    {f.label}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : hasLegacy ? (
        <NoteBlock text={legacyText} placeholder="—" bold />
      ) : (
        <p className="text-[13px] text-slate-400 italic">None recorded</p>
      )}
    </div>
  )
}

// ── Section card ─────────────────────────────────────────────────────────────

export function Section({
  title, children, onEdit, badge, headerRight,
}: {
  title: string
  children: React.ReactNode
  onEdit?: () => void
  badge?: React.ReactNode
  headerRight?: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-[15px] font-semibold text-slate-800">{title}</h3>
          {badge}
        </div>
        {headerRight ?? (onEdit && (
          <button type="button" onClick={onEdit}
            className="text-[12px] text-primary hover:text-primary/80 transition-colors font-medium">
            Edit
          </button>
        ))}
      </div>
      {children}
    </div>
  )
}

// ── Sub-section divider ──────────────────────────────────────────────────────

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

// ── Standalone sub-label (no divider, unlike Sub) ────────────────────────────

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-1.5">{children}</p>
  )
}

// ── Label + value row (stacked) ──────────────────────────────────────────────

export function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-0.5">{label}</p>
      <div className="text-[14px] font-semibold text-slate-900">
        {value ?? <span className="text-slate-400 font-normal">—</span>}
      </div>
    </div>
  )
}

// ── Note / long-text block ───────────────────────────────────────────────────

export function NoteBlock({ text, placeholder, bold }: { text?: string | null; placeholder: string; bold?: boolean }) {
  return <RichTextDisplay html={text} placeholder={placeholder} bold={bold} />
}

// ── Sidebar card ─────────────────────────────────────────────────────────────

export function SideCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('bg-white rounded-xl border border-slate-200 p-4', className)}>{children}</div>
}

// ── Sidebar section title ────────────────────────────────────────────────────

export function SideTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[15px] font-semibold text-slate-800 border-b border-slate-100 pb-2.5 mb-3">{children}</h3>
}

// ── Key/value row (inline, used in sidebars) ─────────────────────────────────

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

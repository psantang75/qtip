import type { WriteUpDetail } from '@/services/writeupService'

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="border-b border-slate-100 pb-3 mb-4">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      </div>
      {children}
    </div>
  )
}

export function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pt-4 mt-4 border-t border-slate-100">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-3">{title}</p>
      {children}
    </div>
  )
}

export function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-0.5">{label}</p>
      <div className="text-[13px] text-slate-800 font-medium">
        {value ?? <span className="text-slate-400 font-normal">—</span>}
      </div>
    </div>
  )
}

export function NoteBlock({ text, placeholder }: { text?: string | null; placeholder: string }) {
  return text
    ? <p className="text-[13px] text-slate-700 whitespace-pre-wrap leading-relaxed">{text}</p>
    : <p className="text-[13px] text-slate-400 italic">{placeholder}</p>
}

export type DetailSectionProps = { writeup: WriteUpDetail }

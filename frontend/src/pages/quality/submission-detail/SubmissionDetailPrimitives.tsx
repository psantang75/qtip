import React from 'react'
import type { SubmissionDetail } from '@/services/qaService'

/** Inline label:value row used throughout the detail view */
export function Row({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="flex justify-between gap-4 text-[13px]">
      <span className="text-slate-500 shrink-0">{label}:</span>
      <span className="font-medium text-slate-800 text-right">{value ?? '—'}</span>
    </div>
  )
}

/** White card panel with header */
export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl overflow-hidden">
      <div className="px-4 py-3 bg-white border border-slate-200 rounded-t-lg border-b border-slate-200">
        <h3 className="text-[15px] font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="border border-t-0 border-slate-200 rounded-b-lg bg-white px-4 py-4">
        {children}
      </div>
    </div>
  )
}

/** Fallback score breakdown grouped by category (no formData available) */
export function CategoryBreakdown({ detail }: { detail: SubmissionDetail }) {
  const categories = detail.answers.reduce<Record<string, typeof detail.answers>>((acc, a) => {
    const cat = a.category_name ?? 'General'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(a)
    return acc
  }, {})
  return (
    <div className="space-y-3">
      {Object.entries(categories).map(([cat, answers]) => (
        <div key={cat} className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="flex items-center gap-2.5 bg-slate-50 border-b border-slate-200 px-4 py-2.5">
            <span className="w-[3px] h-4 rounded-full bg-primary shrink-0" />
            <span className="text-[12px] font-semibold text-slate-600 uppercase tracking-wider">{cat}</span>
          </div>
          <div className="divide-y divide-slate-100">
            {answers.map((a, i) => (
              <div key={i} className="px-4 py-2.5 flex items-start justify-between gap-4">
                <p className="text-[13px] text-slate-700 flex-1">{a.question_text}</p>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[13px] font-medium text-slate-600">{a.answer ?? '—'}</span>
                  {a.score != null && (
                    <span className="text-[12px] font-semibold text-slate-600">
                      {a.score.toFixed(0)} pts
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

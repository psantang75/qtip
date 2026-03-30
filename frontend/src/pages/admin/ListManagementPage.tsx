import { useState } from 'react'
import { ChevronRight, ChevronDown, List, Settings2 } from 'lucide-react'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { cn } from '@/lib/utils'

// ── List catalogue ────────────────────────────────────────────────────────────
// Each entry describes a managed list. backend_key ties it to the DB when
// we implement each one. tier distinguishes label-override lists from
// fully-dynamic lists (add/remove/reorder).

type ListTier = 'label-override' | 'dynamic'

interface ManagedList {
  key: string
  label: string
  description: string
  tier: ListTier
  itemCount?: number        // populated once backend is wired
  implemented?: boolean     // true once conversion is done
}

interface ListSection {
  id: string
  label: string
  lists: ManagedList[]
}

const SECTIONS: ListSection[] = [
  {
    id: 'quality',
    label: 'Quality',
    lists: [
      {
        key: 'dispute_reasons',
        label: 'Dispute Reasons',
        description: 'Reasons a CSR can select when disputing a QA audit.',
        tier: 'dynamic',
        implemented: false,
      },
      {
        key: 'qa_form_types',
        label: 'QA Form Types',
        description: 'Categories used to classify quality audit forms.',
        tier: 'dynamic',
        implemented: false,
      },
    ],
  },
  {
    id: 'training',
    label: 'Training',
    lists: [
      {
        key: 'coaching_purpose',
        label: 'Coaching Purpose',
        description: 'Labels for coaching session purpose (Weekly, Performance, Onboarding). Values are fixed; labels are customisable.',
        tier: 'label-override',
        implemented: false,
      },
      {
        key: 'coaching_format',
        label: 'Coaching Format',
        description: 'Labels for session format (1-on-1, Side-by-Side, Team Session). Values are fixed; labels are customisable.',
        tier: 'label-override',
        implemented: false,
      },
      {
        key: 'coaching_source',
        label: 'Coaching Source',
        description: 'Labels for the reason a session was created (QA Audit, Trend, Dispute, etc.).',
        tier: 'label-override',
        implemented: false,
      },
      {
        key: 'behavior_flags',
        label: 'Behavior Flags',
        description: 'Structured flags trainers can attach to Internal Notes (Risk Signals, Observational, Positive). Fully customisable.',
        tier: 'dynamic',
        implemented: false,
      },
    ],
  },
]

// ── Tier badge ─────────────────────────────────────────────────────────────────

function TierBadge({ tier }: { tier: ListTier }) {
  return tier === 'dynamic' ? (
    <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
      Dynamic
    </span>
  ) : (
    <span className="text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
      Label Override
    </span>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ListManagementPage() {
  const [openSection, setOpenSection] = useState<string>('training')
  const [selectedList, setSelectedList] = useState<ManagedList | null>(null)

  const currentSection = SECTIONS.find(s => s.id === openSection)

  return (
    <QualityListPage>
      <QualityPageHeader
        title="List Management"
        subtitle="Manage dropdown values, labels and ordering used throughout the system."
      />

      <div className="grid grid-cols-4 gap-6">

        {/* ── Left nav ──────────────────────────────────────────────────── */}
        <div className="col-span-1 space-y-1">
          {SECTIONS.map(section => {
            const isOpen = openSection === section.id
            return (
              <div key={section.id}>
                <button
                  type="button"
                  onClick={() => { setOpenSection(section.id); setSelectedList(null) }}
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-colors',
                    isOpen
                      ? 'bg-primary/10 text-primary'
                      : 'text-slate-600 hover:bg-slate-50'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <List className="h-4 w-4 shrink-0" />
                    {section.label}
                  </div>
                  {isOpen
                    ? <ChevronDown className="h-3.5 w-3.5" />
                    : <ChevronRight className="h-3.5 w-3.5" />
                  }
                </button>

                {isOpen && (
                  <div className="ml-3 mt-1 space-y-0.5 pl-3 border-l border-slate-200">
                    {section.lists.map(list => (
                      <button
                        key={list.key}
                        type="button"
                        onClick={() => setSelectedList(list)}
                        className={cn(
                          'w-full text-left px-2 py-2 rounded-md text-[13px] transition-colors',
                          selectedList?.key === list.key
                            ? 'bg-primary/10 text-primary font-medium'
                            : 'text-slate-600 hover:bg-slate-50'
                        )}
                      >
                        {list.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ── Right content ─────────────────────────────────────────────── */}
        <div className="col-span-3">

          {!selectedList ? (
            /* Section overview */
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h2 className="text-base font-semibold text-slate-800 mb-1">
                {currentSection?.label} Lists
              </h2>
              <p className="text-[13px] text-slate-500 mb-5">
                Select a list from the left to manage its items.
              </p>
              <div className="space-y-3">
                {currentSection?.lists.map(list => (
                  <button
                    key={list.key}
                    type="button"
                    onClick={() => setSelectedList(list)}
                    className="w-full text-left flex items-start justify-between gap-4 p-4 rounded-lg border border-slate-200 hover:border-primary/40 hover:bg-slate-50 transition-colors group"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-[13px] font-semibold text-slate-800">{list.label}</p>
                        <TierBadge tier={list.tier} />
                        {!list.implemented && (
                          <span className="text-[11px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                            Coming soon
                          </span>
                        )}
                      </div>
                      <p className="text-[12px] text-slate-500 leading-snug">{list.description}</p>
                    </div>
                    <Settings2 className="h-4 w-4 text-slate-300 group-hover:text-primary shrink-0 mt-0.5 transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Individual list detail */
            <div className="space-y-4">
              {/* Header card */}
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h2 className="text-base font-semibold text-slate-800">{selectedList.label}</h2>
                      <TierBadge tier={selectedList.tier} />
                    </div>
                    <p className="text-[13px] text-slate-500">{selectedList.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedList(null)}
                    className="text-[12px] text-slate-400 hover:text-slate-600 shrink-0"
                  >
                    ← Back
                  </button>
                </div>

                {selectedList.tier === 'label-override' && (
                  <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                    <p className="text-[12px] text-blue-700">
                      <span className="font-semibold">Label Override list</span> — The underlying values (e.g.{' '}
                      <code className="bg-blue-100 px-1 rounded text-[11px]">WEEKLY</code>) are fixed in the database schema.
                      You can customise how they appear to users, change their sort order, and hide unused items.
                    </p>
                  </div>
                )}

                {selectedList.tier === 'dynamic' && (
                  <div className="mt-4 p-3 bg-emerald-50 border border-emerald-100 rounded-lg">
                    <p className="text-[12px] text-emerald-700">
                      <span className="font-semibold">Dynamic list</span> — Items can be freely added, edited,
                      reordered, and deactivated. Changes take effect immediately across the system.
                    </p>
                  </div>
                )}
              </div>

              {/* Coming soon placeholder */}
              {!selectedList.implemented && (
                <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center">
                  <Settings2 className="h-8 w-8 text-slate-300 mx-auto mb-3" />
                  <p className="text-[14px] font-semibold text-slate-500 mb-1">
                    {selectedList.label} — Not yet converted
                  </p>
                  <p className="text-[13px] text-slate-400 max-w-sm mx-auto">
                    This list is currently hardcoded in the system. It will be moved here and made
                    configurable in a future update.
                  </p>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </QualityListPage>
  )
}

import { useState } from 'react'
import { ChevronRight, ChevronDown, List, Settings2, ArrowLeft } from 'lucide-react'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { GenericListEditor } from './list-management/GenericListEditor'

// ── List catalogue ────────────────────────────────────────────────────────────

type ListTier = 'label-override' | 'dynamic'

interface ManagedList {
  key: string
  label: string
  description: string
  tier: ListTier
  implemented: boolean
  listType?: string
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
      { key: 'dispute_reasons', label: 'Dispute Reasons', description: 'Reasons a CSR can select when disputing a QA audit.', tier: 'dynamic', implemented: false },
      { key: 'qa_form_types',  label: 'QA Form Types',   description: 'Categories used to classify quality audit forms.',  tier: 'dynamic', implemented: false },
    ],
  },
  {
    id: 'training',
    label: 'Training',
    lists: [
      { key: 'topics',           label: 'Training Topics',  description: '', tier: 'dynamic',        implemented: true,  listType: 'training_topic'   },
      { key: 'coaching_purpose', label: 'Coaching Purpose', description: '', tier: 'label-override', implemented: true,  listType: 'coaching_purpose' },
      { key: 'coaching_format',  label: 'Coaching Format',  description: '', tier: 'label-override', implemented: true,  listType: 'coaching_format'  },
      { key: 'coaching_source',  label: 'Coaching Source',  description: '', tier: 'label-override', implemented: true,  listType: 'coaching_source'  },
      { key: 'behavior_flags',   label: 'Behavior Flags',   description: '', tier: 'dynamic',        implemented: true,  listType: 'behavior_flag'    },
    ],
  },
]

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ListManagementPage() {
  const [openSection,  setOpenSection]  = useState<string>('training')
  const [selectedList, setSelectedList] = useState<ManagedList | null>(
    SECTIONS.find(s => s.id === 'training')?.lists.find(l => l.key === 'behavior_flags') ?? null
  )

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
                <button type="button"
                  onClick={() => { setOpenSection(section.id); setSelectedList(null) }}
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-colors',
                    isOpen ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50'
                  )}
                >
                  <div className="flex items-center gap-2"><List className="h-4 w-4 shrink-0" />{section.label}</div>
                  {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>

                {isOpen && (
                  <div className="ml-3 mt-1 space-y-0.5 pl-3 border-l border-slate-200">
                    {section.lists.map(list => (
                      <button key={list.key} type="button" onClick={() => setSelectedList(list)}
                        className={cn(
                          'w-full text-left px-2 py-2 rounded-md text-[13px] transition-colors flex items-center justify-between gap-2',
                          selectedList?.key === list.key ? 'bg-primary/10 text-primary font-medium' : 'text-slate-600 hover:bg-slate-50'
                        )}
                      >
                        <span>{list.label}</span>
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
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h2 className="text-base font-semibold text-slate-800 mb-1">{currentSection?.label} Lists</h2>
              <p className="text-[13px] text-slate-500 mb-5">Select a list from the left to manage its items.</p>
              <div className="space-y-3">
                {currentSection?.lists.map(list => (
                  <button key={list.key} type="button" onClick={() => setSelectedList(list)}
                    className="w-full text-left flex items-start justify-between gap-4 p-4 rounded-lg border border-slate-200 hover:border-primary/40 hover:bg-slate-50 transition-colors group">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-slate-800 mb-1">{list.label}</p>
                      <p className="text-[12px] text-slate-500 leading-snug">{list.description}</p>
                    </div>
                    <Settings2 className="h-4 w-4 text-slate-300 group-hover:text-primary shrink-0 mt-0.5 transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-slate-800 mb-1">{selectedList.label}</h2>
                    <p className="text-[13px] text-slate-500">{selectedList.description}</p>
                  </div>
                  <Button type="button" variant="ghost" size="sm"
                    className="text-[12px] text-slate-400 hover:text-slate-600 h-auto gap-1 shrink-0"
                    onClick={() => setSelectedList(null)}>
                    <ArrowLeft className="h-3.5 w-3.5" /> Back
                  </Button>
                </div>
              </div>

              {selectedList.implemented && selectedList.listType ? (
                <GenericListEditor listType={selectedList.listType} listLabel={selectedList.label} />
              ) : (
                <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center">
                  <Settings2 className="h-8 w-8 text-slate-300 mx-auto mb-3" />
                  <p className="text-[14px] font-semibold text-slate-500 mb-1">{selectedList.label} — Not yet converted</p>
                  <p className="text-[13px] text-slate-400 max-w-sm mx-auto">
                    This list is currently hardcoded in the system and will be moved here in a future update.
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

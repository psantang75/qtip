import { useState } from 'react'
import { ChevronRight, ChevronDown, List, Settings2, ArrowLeft } from 'lucide-react'
import { ListPageShell } from '@/components/common/ListPageShell'
import { ListPageHeader } from '@/components/common/ListPageHeader'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { GenericListEditor } from './list-management/GenericListEditor'
import {
  ExceptionTypesEditor,
  ActivityTypesEditor,
  CoverageThresholdsEditor,
} from './list-management/SchedulingListEditors'
import { CampaignListEditor } from './list-management/CampaignListEditor'
import { PhoneQueueListEditor } from './list-management/PhoneQueueListEditor'
import {
  AttendancePointBandsEditor,
  AttendanceThresholdsEditor,
} from './list-management/AttendanceListEditors'

// ── List catalogue ────────────────────────────────────────────────────────────

type ListTier = 'dynamic'

/**
 * Custom editors for lists that live in their own tables (richer than the
 * generic list-items system). When set, the right panel renders this instead of
 * GenericListEditor.
 */
const CUSTOM_EDITORS = {
  sched_exception_type: ExceptionTypesEditor,
  sched_activity_type: ActivityTypesEditor,
  sched_coverage: CoverageThresholdsEditor,
  campaign_library: CampaignListEditor,
  phone_queue_library: PhoneQueueListEditor,
  attendance_bands: AttendancePointBandsEditor,
  attendance_thresholds: AttendanceThresholdsEditor,
} as const

interface ManagedList {
  key: string
  label: string
  description: string
  tier: ListTier
  implemented: boolean
  listType?: string
  editor?: keyof typeof CUSTOM_EDITORS
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
      { key: 'qa_form_types', label: 'QA Form Types', description: 'Form type categories used to classify quality audit forms.', tier: 'dynamic', implemented: true, listType: 'qa_form_type' },
      { key: 'unlock_reasons', label: 'Unlock / Reopen Reasons', description: 'Reasons an admin can pick when reopening a scored review or dispute. Shown in the reopen dialog and the Unlock Register.', tier: 'dynamic', implemented: true, listType: 'unlock_reason' },
    ],
  },
  {
    id: 'training',
    label: 'Training',
    lists: [
      { key: 'topics',           label: 'Training Topics',  description: '', tier: 'dynamic',        implemented: true,  listType: 'training_topic'   },
      { key: 'coaching_purpose', label: 'Coaching Purpose', description: 'Purpose options selectable when creating a coaching session.', tier: 'dynamic', implemented: true,  listType: 'coaching_purpose' },
      { key: 'coaching_format',  label: 'Coaching Format',  description: 'Format options selectable when creating a coaching session.',  tier: 'dynamic', implemented: true,  listType: 'coaching_format'  },
      { key: 'coaching_source',  label: 'Coaching Source',  description: 'Source options selectable when creating a coaching session.',  tier: 'dynamic', implemented: true,  listType: 'coaching_source'  },
      { key: 'behavior_flags',   label: 'Behavior Flags',   description: '', tier: 'dynamic',        implemented: true,  listType: 'behavior_flag'    },
      { key: 'root_causes',      label: 'Root Causes',      description: 'Predefined root cause options selectable by trainers during coaching sessions.', tier: 'dynamic', implemented: true, listType: 'root_cause' },
      { key: 'support_needed',   label: 'Support Needed',   description: 'Predefined support options selectable by trainers during coaching sessions.',    tier: 'dynamic', implemented: true, listType: 'support_needed' },
    ],
  },
  {
    id: 'performancewarnings',
    label: 'Performance Warnings',
    lists: [
      { key: 'writeup_policy',      label: 'Policy Violated',        description: 'Policies selectable when documenting a policy violation in a write-up.',                       tier: 'dynamic', implemented: true, listType: 'writeup_policy'      },
      { key: 'writeup_reference',   label: 'Reference Material',     description: 'Reference materials (e.g. handbook sections) that can be cited in a write-up violation.',      tier: 'dynamic', implemented: true, listType: 'writeup_reference'   },
      { key: 'writeup_timeline',    label: 'Timeline for Correction', description: 'Correction timeline options available when setting expectations in a write-up.',              tier: 'dynamic', implemented: true, listType: 'writeup_timeline'    },
      { key: 'writeup_consequence', label: 'Consequence if Not Met', description: 'Consequence options displayed when the corrective action is not met in a write-up.',            tier: 'dynamic', implemented: true, listType: 'writeup_consequence' },
    ],
  },
  {
    id: 'scheduling',
    label: 'Scheduling',
    lists: [
      { key: 'sched_exception_types', label: 'Attendance Exception Types', description: 'Exception reasons (absence, late, early leave, PTO…) selectable when logging attendance exceptions.', tier: 'dynamic', implemented: true, editor: 'sched_exception_type' },
      { key: 'sched_activity_types',  label: 'Shift Activity Types',       description: 'Break/lunch (and future) segment types available when building shifts and templates.',              tier: 'dynamic', implemented: true, editor: 'sched_activity_type' },
      { key: 'sched_coverage',        label: 'Coverage Thresholds',        description: 'Per-department green/yellow staffing minimums that drive the schedule coverage heatmap.',              tier: 'dynamic', implemented: true, editor: 'sched_coverage' },
      { key: 'campaign_library',      label: 'Call Campaigns',             description: 'Campaign categories (with a color) and campaigns (with a timing rule) projected onto the call-campaign calendar.', tier: 'dynamic', implemented: true, editor: 'campaign_library' },
      { key: 'phone_queue_library',   label: 'Phone Queues',               description: 'The phone queues that exist company-wide. Each department picks which of them it staffs, and its own minimums, on the Phone Queues page.', tier: 'dynamic', implemented: true, editor: 'phone_queue_library' },
    ],
  },
  {
    id: 'attendance',
    label: 'Attendance',
    lists: [
      { key: 'attendance_bands',      label: 'Point Bands',          description: 'How much a late arrival, an early departure or an absence is worth. Drives the rolling 90-day point totals on the Attendance report.', tier: 'dynamic', implemented: true, editor: 'attendance_bands' },
      { key: 'attendance_thresholds', label: 'Discipline Thresholds', description: 'Point totals at which Coaching, Verbal, Written, Final and Separation are recommended.', tier: 'dynamic', implemented: true, editor: 'attendance_thresholds' },
    ],
  },
  {
    id: 'imports',
    label: 'Data Imports',
    lists: [
      { key: 'mailbox_senders', label: 'Import Email Senders', description: 'Addresses allowed to email an Excel report to the QTIP mailbox for automatic import. Anything from another sender is filed as Failed and never read.', tier: 'dynamic', implemented: true, listType: 'mailbox_import_sender' },
    ],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    lists: [
      { key: 'alert_recipients', label: 'Alert Recipients', description: 'Addresses of the specific people who should receive operational alerts, for templates where "every admin" is too many. Each address must belong to an active QTIP user. Choose which alerts use this list under Admin > Email Templates.', tier: 'dynamic', implemented: true, listType: 'notification_recipient' },
    ],
  },
]

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ListManagementPage() {
  const [openSection,  setOpenSection]  = useState<string>('quality')
  const [selectedList, setSelectedList] = useState<ManagedList | null>(
    SECTIONS.find(s => s.id === 'quality')?.lists.find(l => l.key === 'qa_form_types') ?? null
  )

  const currentSection = SECTIONS.find(s => s.id === openSection)

  return (
    <ListPageShell>
      <ListPageHeader
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

              {selectedList.editor ? (
                (() => { const Editor = CUSTOM_EDITORS[selectedList.editor]; return <Editor /> })()
              ) : selectedList.implemented && selectedList.listType ? (
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
    </ListPageShell>
  )
}

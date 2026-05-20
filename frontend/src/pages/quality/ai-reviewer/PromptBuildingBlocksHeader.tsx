/**
 * Prompt Building Blocks header — 4-step numbered explainer rendered at
 * the top of the AI Prompt tab. Tells the admin EXACTLY what they are
 * authoring, what's authored elsewhere, and which order things compose
 * in at runtime.
 *
 * The numbers (1-4) match the badges on the section cards below so a
 * new admin reading the page top-to-bottom can map "Step 2 in the
 * header" to "the Rule packs card." This is the documentation
 * scaffolding the layered-prompt system has needed since day one.
 */

import { FileText, Library, ClipboardList, ListChecks } from 'lucide-react'

interface BlockSpec {
  num: number
  title: string
  scope: string
  owner: string
  Icon: typeof FileText
}

const BLOCKS: BlockSpec[] = [
  {
    num: 1,
    title: 'Base prompt',
    scope: 'Common to every AI review on every form.',
    owner: 'AI / QA lead',
    Icon: FileText,
  },
  {
    num: 2,
    title: 'Rule packs',
    scope: 'Reusable across forms in the same domain or process.',
    owner: 'Process owner',
    Icon: Library,
  },
  {
    num: 3,
    title: 'Form guidance',
    scope: 'Just this form — exceptions, edge cases, local rules.',
    owner: 'Form author',
    Icon: ClipboardList,
  },
  {
    num: 4,
    title: 'Question rubrics',
    scope: 'Just this question on this form — explicit pass/fail criteria.',
    owner: 'Form author',
    Icon: ListChecks,
  },
]

export function PromptBuildingBlocksHeader() {
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="text-[14px] font-semibold text-slate-900">How this prompt is built</h2>
        <p className="text-[12px] text-slate-500 mt-0.5">
          Four authored building blocks compose into the system prompt the AI sees, in the order shown below. Beneath
          them, learned corrections from QA disagreements are auto-applied (no authoring required).
        </p>
      </div>
      <div className="px-4 py-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {BLOCKS.map(({ num, title, scope, owner, Icon }) => (
          <div
            key={num}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 flex flex-col gap-1.5"
          >
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary text-white text-[11px] font-semibold">
                {num}
              </span>
              <Icon className="h-4 w-4 text-primary" />
              <span className="text-[13px] font-semibold text-slate-900">{title}</span>
            </div>
            <p className="text-[12px] text-neutral-700 leading-snug">{scope}</p>
            <p className="text-[11px] text-slate-500">
              Owner: <span className="font-medium text-slate-700">{owner}</span>
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

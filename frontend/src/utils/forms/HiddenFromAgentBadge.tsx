import { EyeOff } from 'lucide-react'

/** Pill shown on questions set to Agent Visible = No (form_questions.visible_to_csr = 0). */
export function HiddenFromAgentBadge() {
  return (
    <span
      title="Agent Visible = No - the agent will not see this question or its answer."
      className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-600 border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap"
    >
      <EyeOff size={10} aria-hidden />
      Hidden from agent
    </span>
  )
}

/**
 * Canonical QTIP "pick one of N" pill classes. Exported so other segmented
 * pickers (e.g. writeup QA-search answer chips) reuse the exact style rather
 * than reimplementing it.
 *
 * Lives in its own module (not `formRendererComponents.tsx`) so that component
 * file only exports components — keeps Vite fast-refresh working.
 */
export const optionCls = (selected: boolean) =>
  selected
    ? 'bg-[#00aeef] text-white border-[#00aeef]'
    : 'bg-white text-slate-600 border-slate-200 hover:border-[#00aeef] hover:text-[#00aeef]'

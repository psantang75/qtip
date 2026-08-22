import { cn } from '@/lib/utils'
import { CheckCircle2 } from 'lucide-react'
import { STEPS, STEP_LABELS, type Step } from './formBuilderUtils'

export function StepBar({ current }: { current: Step }) {
  return (
    <div className="flex items-center gap-1 mb-6">
      {STEPS.map((s, i) => {
        const idx = STEPS.indexOf(current)
        const done = i < idx; const active = s === current
        return (
          <div key={s} className="flex items-center gap-1 flex-1">
            <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
              active ? 'bg-primary text-white' : done ? 'bg-primary/20 text-primary' : 'bg-slate-100 text-slate-400')}>
              {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span>{i + 1}</span>}
              <span className="hidden sm:inline">{STEP_LABELS[s].split('. ')[1]}</span>
            </div>
            {i < STEPS.length - 1 && <div className={cn('flex-1 h-px', i < idx ? 'bg-primary/40' : 'bg-slate-200')} />}
          </div>
        )
      })}
    </div>
  )
}

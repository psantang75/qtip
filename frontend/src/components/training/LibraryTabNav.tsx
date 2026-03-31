import { useNavigate, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const TABS = [
  { label: 'Topics',    path: '/app/training/library/topics'    },
  { label: 'Quizzes',   path: '/app/training/library/quizzes'   },
  { label: 'Resources', path: '/app/training/library/resources' },
]

export function LibraryTabNav() {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <div className="flex gap-1 border-b border-slate-200 mb-6">
      {TABS.map(tab => (
        <Button
          key={tab.path}
          variant="ghost"
          onClick={() => navigate(tab.path)}
          className={cn(
            'px-4 py-2.5 h-auto text-sm font-medium border-b-2 -mb-px rounded-none transition-colors hover:bg-transparent',
            location.pathname === tab.path
              ? 'border-primary text-primary'
              : 'border-transparent text-slate-500 hover:text-slate-700',
          )}
        >
          {tab.label}
        </Button>
      ))}
    </div>
  )
}

import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'

const ROLES = [
  { id: 1, label: 'Admin',   color: 'bg-purple-500' },
  { id: 2, label: 'QA',      color: 'bg-blue-500'   },
  { id: 3, label: 'User',    color: 'bg-slate-500'  },
  { id: 4, label: 'Trainer', color: 'bg-amber-500'  },
  { id: 5, label: 'Manager', color: 'bg-emerald-500' },
]

export default function DevRoleSwitcher() {
  const { user, setDevRole } = useAuth()
  if (!user) return null

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-1.5 bg-white border border-slate-200 shadow-lg rounded-xl p-3">
      <p className="text-[10px] font-bold text-slate-400 tracking-widest uppercase mb-1">
        DEV · Role Preview
      </p>
      {ROLES.map(r => (
        <button
          key={r.id}
          onClick={() => setDevRole(r.id)}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white transition-opacity',
            r.color,
            user.role_id === r.id ? 'opacity-100 ring-2 ring-offset-1 ring-slate-400' : 'opacity-50 hover:opacity-80'
          )}
        >
          {r.label}
        </button>
      ))}
      <p className="text-[9px] text-slate-300 mt-1 text-center">dev only · not in prod</p>
    </div>
  )
}

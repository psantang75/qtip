import { Outlet, NavLink } from 'react-router-dom'
import { Users, Building2, ShieldCheck, List, BarChart3, FileText, Activity, CalendarDays } from 'lucide-react'
import TopBar from './TopBar'
import { cn } from '@/lib/utils'

const ADMIN_NAV = [
  { label: 'Users',           path: '/app/admin/users',           icon: Users },
  { label: 'Departments',     path: '/app/admin/departments',      icon: Building2 },
  { label: 'Roles',           path: '/app/admin/roles',            icon: ShieldCheck },
  { label: 'List Management', path: '/app/admin/list-management',  icon: List },
]

const INSIGHTS_NAV = [
  { label: 'KPIs',              path: '/app/admin/insights/kpis',       icon: BarChart3 },
  { label: 'Pages & Access',    path: '/app/admin/insights/pages',      icon: FileText },
  { label: 'Business Calendar', path: '/app/admin/insights/calendar',   icon: CalendarDays },
  { label: 'Ingestion Log',     path: '/app/admin/insights/ingestion',  icon: Activity },
]

const ACTIVE   = 'border-l-[3px] border-l-primary bg-primary/[0.08] text-primary font-semibold'
const INACTIVE = 'border-l-[3px] border-l-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-800'

export default function AdminLayout() {
  return (
    <div className="flex flex-col h-screen bg-surface">
      <TopBar />
      {/* pt-[72px] — no SectionNav in admin */}
      <div className="flex flex-1 overflow-hidden pt-[72px]">

        {/* Admin sidebar */}
        <aside className="fixed left-0 top-[72px] bottom-0 w-[280px] bg-white border-r border-slate-200 flex flex-col z-30">
          <div className="px-4 pt-4 pb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full shrink-0 bg-primary" />
            <span className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase">
              Administration
            </span>
          </div>
          <nav className="flex-1 px-2 pb-4 space-y-0.5 overflow-y-auto">
            {ADMIN_NAV.map(({ label, path, icon: Icon }) => (
              <NavLink
                key={path}
                to={path}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 px-3 py-2.5 rounded-r-md text-[14px] transition-colors',
                    isActive ? ACTIVE : INACTIVE,
                  )
                }
              >
                <Icon size={16} />
                <span>{label}</span>
              </NavLink>
            ))}

            <div className="pt-4 pb-1 px-3">
              <span className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase">
                Insights Engine
              </span>
            </div>
            {INSIGHTS_NAV.map(({ label, path, icon: Icon }) => (
              <NavLink
                key={path}
                to={path}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 px-3 py-2.5 rounded-r-md text-[14px] transition-colors',
                    isActive ? ACTIVE : INACTIVE,
                  )
                }
              >
                <Icon size={16} />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>

        </aside>

        <main className="flex-1 overflow-y-auto ml-[280px] p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

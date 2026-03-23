import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { Users, Building2, ShieldCheck, ArrowLeft } from 'lucide-react'
import TopBar from './TopBar'
import { cn } from '@/lib/utils'

const ADMIN_NAV = [
  { label: 'Users',       path: '/app/admin/users',       icon: Users },
  { label: 'Departments', path: '/app/admin/departments',  icon: Building2 },
  { label: 'Roles',       path: '/app/admin/roles',        icon: ShieldCheck },
]

const ACTIVE   = 'border-l-[3px] border-l-[#00aeef] bg-[#00aeef]/8 text-[#00aeef] font-semibold'
const INACTIVE = 'border-l-[3px] border-l-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-800'

export default function AdminLayout() {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col h-screen bg-[#f5f7f8]">
      <TopBar />
      {/* pt-[72px] — no SectionNav in admin */}
      <div className="flex flex-1 overflow-hidden pt-[72px]">

        {/* Admin sidebar */}
        <aside className="fixed left-0 top-[72px] bottom-0 w-56 bg-white border-r border-slate-200 flex flex-col z-30">
          <div className="px-4 pt-4 pb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full shrink-0 bg-[#00aeef]" />
            <span className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase">
              Administration
            </span>
          </div>
          <nav className="flex-1 px-2 pb-4 space-y-0.5">
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
          </nav>

          {/* Back to main app */}
          <div className="border-t border-slate-100 p-3">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-[13px] text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition-colors"
            >
              <ArrowLeft size={15} />
              <span>Back to App</span>
            </button>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto ml-56 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

import { NavLink, useLocation } from 'react-router-dom'
import * as LucideIcons from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  getNavItemsForRole,
  getSectionFromPath,
  getSectionConfig,
} from '@/config/navConfig'
import { cn } from '@/lib/utils'

function DynamicIcon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const Icon = (LucideIcons as unknown as Record<string, React.ComponentType<LucideProps>>)[name]
  if (!Icon) return <LucideIcons.Circle size={size} className={className} />
  return <Icon size={size} className={className} />
}

const ACTIVE_ITEM_CLASS   = 'border-l-[3px] border-l-[#00aeef] bg-[#00aeef]/8 text-[#00aeef] font-semibold'
const INACTIVE_ITEM_CLASS = 'border-l-[3px] border-l-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-800'

export default function Sidebar() {
  const { user } = useAuth()
  const location = useLocation()

  const currentSection = getSectionFromPath(location.pathname) ?? 'quality'
  const sectionConfig  = getSectionConfig(currentSection)
  const navItems       = user ? getNavItemsForRole(currentSection, user.role_id) : []

  // When navigating to a detail page, location.state.fromPath holds the
  // originating list page path so that nav item stays highlighted instead of
  // a prefix-matched sibling lighting up.
  const originPath = (location.state as any)?.fromPath as string | undefined

  return (
    <aside className="fixed left-0 top-[124px] bottom-0 w-[280px] bg-white border-r border-slate-200 flex flex-col z-30 overflow-y-auto">

      {/* Section header — full-width accent block */}
      <div className="mx-3 mt-4 mb-3 rounded-lg bg-gradient-to-r from-[#00aeef]/15 to-[#00aeef]/5 border border-[#00aeef]/20 px-3 py-2.5 flex items-center gap-2.5">
        <div className="h-7 w-7 rounded-md bg-[#00aeef] flex items-center justify-center shrink-0 shadow-sm">
          <DynamicIcon name={sectionConfig.icon} size={14} className="text-white" />
        </div>
        <span className="text-[15px] font-bold text-slate-800 leading-none tracking-tight">
          {sectionConfig.label}
        </span>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-2 pb-4 space-y-0.5">
        {navItems.map(item => (
          <NavLink
            key={item.label}
            to={item.path}
            end
            className={({ isActive }) => {
              // If we arrived here from a known list page, highlight that item
              // rather than relying on prefix URL matching
              const active = originPath ? item.path === originPath : isActive
              return cn(
                'flex items-center gap-2.5 px-3 py-2.5 rounded-r-md text-[13.5px] transition-colors',
                active ? ACTIVE_ITEM_CLASS : INACTIVE_ITEM_CLASS,
              )
            }}
          >
            <DynamicIcon name={item.icon} size={15} />
            <span className="flex-1 truncate">{item.label}</span>
            {item.badge && (
              <span className="ml-auto min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
                {item.badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Collapse toggle placeholder */}
      <div className="border-t border-slate-100 p-2">
        <button
          className="w-full flex items-center justify-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-600 py-1.5 rounded transition-colors"
          aria-label="Collapse sidebar"
        >
          <LucideIcons.PanelLeftClose size={14} />
          <span>Collapse</span>
        </button>
      </div>

    </aside>
  )
}

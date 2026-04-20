import { useMemo, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import * as LucideIcons from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import { ChevronDown } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import {
  getNavItemsForRole,
  getSectionFromPath,
  getSectionConfig,
} from '@/config/navConfig'
import { getInsightsNavigation } from '@/services/insightsService'
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
  const rawNavItems    = user ? getNavItemsForRole(currentSection, user.role_id) : []

  // Pull the user's accessible Insights pages from the backend so items
  // tagged with `pageKey` are gated by ie_page_role_access. Only fetch when
  // we're actually in the Insights section to avoid unnecessary requests.
  const { data: insightsNav } = useQuery({
    queryKey: ['insights-navigation'],
    queryFn: getInsightsNavigation,
    enabled: !!user && currentSection === 'insights',
    staleTime: 5 * 60 * 1000,
  })

  const accessiblePageKeys = useMemo(() => {
    const set = new Set<string>()
    for (const cat of insightsNav ?? []) {
      for (const p of cat.pages) set.add(p.page_key)
    }
    return set
  }, [insightsNav])

  const navItems = useMemo(() => {
    if (currentSection !== 'insights') return rawNavItems
    return rawNavItems.filter(item => {
      if (!item.pageKey) return true
      return accessiblePageKeys.has(item.pageKey)
    })
  }, [rawNavItems, currentSection, accessiblePageKeys])

  const originPath = (location.state as { fromPath?: string } | null)?.fromPath

  // Track which groups are collapsed — all expanded by default
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const grouped = navItems.reduce((acc: Record<string, typeof navItems>, item) => {
    const key = item.group ?? '__ungrouped__'
    if (!acc[key]) acc[key] = []
    acc[key].push(item)
    return acc
  }, {})

  function toggleGroup(group: string) {
    setCollapsed(prev => ({ ...prev, [group]: !prev[group] }))
  }

  return (
    <aside className="fixed left-0 top-[72px] bottom-0 w-[280px] bg-white border-r border-slate-200 flex flex-col z-30 overflow-y-auto">

      {/* Section header */}
      <div className="mx-3 mt-4 mb-3 rounded-lg bg-gradient-to-r from-[#00aeef]/15 to-[#00aeef]/5 border border-[#00aeef]/20 px-3 py-2.5 flex items-center gap-2.5">
        <div className="h-7 w-7 rounded-md bg-[#00aeef] flex items-center justify-center shrink-0 shadow-sm">
          <DynamicIcon name={sectionConfig.icon} size={14} className="text-white" />
        </div>
        <span className="text-[15px] font-bold text-slate-800 leading-none tracking-tight">
          {sectionConfig.label}
        </span>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-2 pb-4 space-y-1.5">
        {Object.entries(grouped).map(([group, items]) => {
          const isUngrouped = group === '__ungrouped__'
          const isCollapsed = collapsed[group] ?? false

          if (isUngrouped) {
            return (
              <div key={group} className="space-y-0.5">
                {items.map(item => (
                  <NavLink
                    key={item.label}
                    to={item.path}
                    end
                    className={({ isActive }) => {
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
              </div>
            )
          }

          return (
            <div key={group} className="rounded-lg border border-slate-200 overflow-hidden">
              {/* Group heading — acts as collapse toggle */}
              <button
                onClick={() => toggleGroup(group)}
                className="w-full flex items-center gap-2 px-3 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
              >
                <span className="flex-1 text-[12px] font-bold text-slate-700 leading-tight">
                  {group}
                </span>
                <ChevronDown
                  size={14}
                  className={cn(
                    'text-slate-400 shrink-0 transition-transform duration-200',
                    isCollapsed && '-rotate-90',
                  )}
                />
              </button>

              {/* Collapsible items */}
              {!isCollapsed && (
                <div className="py-1 space-y-0.5">
                  {items.map(item => (
                    <NavLink
                      key={item.label}
                      to={item.path}
                      end
                      className={({ isActive }) => {
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
                </div>
              )}
            </div>
          )
        })}
      </nav>

    </aside>
  )
}

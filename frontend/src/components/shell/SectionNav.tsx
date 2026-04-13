import { useNavigate, useLocation } from 'react-router-dom'
import { Shield, GraduationCap, AlertTriangle, BarChart2, BarChart3 } from 'lucide-react'
import { NAV_CONFIG, getSectionFromPath } from '@/config/navConfig'

const SECTION_ICONS = {
  quality:              Shield,
  training:             GraduationCap,
  performancewarnings:  AlertTriangle,
  insights:             BarChart2,
  analytics:            BarChart3,
}

export default function SectionNav() {
  const navigate       = useNavigate()
  const location       = useLocation()
  const currentSection = getSectionFromPath(location.pathname)

  return (
    <nav className="fixed top-[72px] left-0 right-0 z-40 h-[52px] flex items-center justify-center bg-white border-b border-slate-200 gap-1">
      {NAV_CONFIG.map(section => {
        const Icon     = SECTION_ICONS[section.id]
        const isActive = currentSection === section.id

        return (
          <button
            key={section.id}
            type="button"
            onClick={() => navigate(section.defaultPath)}
            className="h-[52px] px-2 flex flex-col items-center justify-center relative group"
          >
            {/* Chip — light blue pill on active, subtle hover on inactive */}
            <span
              className={`flex items-center gap-2 px-6 py-[9px] rounded-md text-[15px] transition-all duration-150 ${
                isActive
                  ? 'bg-[#00aeef]/10 text-[#00aeef] font-semibold'
                  : 'text-slate-500 font-medium group-hover:bg-slate-100 group-hover:text-slate-700'
              }`}
            >
              <Icon size={16} className="shrink-0" />
              {section.label}
            </span>

            {/* Underline — narrow, rounded, sits flush on bar bottom */}
            <span
              className={`absolute bottom-0 left-1/2 -translate-x-1/2 h-[2.5px] rounded-full transition-all duration-200 ${
                isActive ? 'w-12 bg-[#00aeef]' : 'w-0 bg-transparent'
              }`}
            />
          </button>
        )
      })}
    </nav>
  )
}

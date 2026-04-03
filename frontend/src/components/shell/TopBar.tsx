import { useNavigate, useLocation } from 'react-router-dom'
import { ChevronDown, LogOut, User, Settings, ArrowLeft } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { useAuth } from '@/contexts/AuthContext'
import { ROLE_DISPLAY } from '@/config/navConfig'

function getInitials(username: string): string {
  const parts = username.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return username.substring(0, 2).toUpperCase()
}

export default function TopBar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const isInAdmin = location.pathname.startsWith('/app/admin')

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const initials = user ? getInitials(user.username) : 'U'
  const roleName = user ? (ROLE_DISPLAY[user.role_id] ?? 'USER') : ''

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-[72px] flex items-center px-6 bg-neutral-900 border-b border-white/5">

      {/* ── Logo (left) ─────────────────────────────────────────────────── */}
      <div className="flex flex-col shrink-0">
        <span className="text-white font-bold text-[17px] tracking-tight leading-tight">
          QTIP
          <span className="text-primary">+</span>
          Insights
        </span>
        <span className="text-[10px] text-slate-500 tracking-widest leading-tight mt-0.5">
          Quality · Training · Insights · Analytics
        </span>
      </div>

      {/* ── Center spacer ───────────────────────────────────────────────── */}
      <div className="flex-1" />

      {/* ── Admin shortcut / back-to-app (role_id 1 only) ───────────────── */}
      {user?.role_id === 1 && (
        isInAdmin ? (
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg px-3 py-1.5 text-[13px] transition-colors mr-2"
          >
            <ArrowLeft size={15} />
            <span className="hidden sm:inline">Back to App</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => navigate('/app/admin/users')}
            className="flex items-center gap-1.5 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg px-3 py-1.5 text-[13px] transition-colors mr-2"
          >
            <Settings size={15} />
            <span className="hidden sm:inline">Settings</span>
          </button>
        )
      )}

      {/* ── User panel (right) ──────────────────────────────────────────── */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-3 hover:bg-white/5 rounded-lg px-3 py-1.5 transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          >
            {/* Avatar */}
            <Avatar className="h-9 w-9 shrink-0">
              <AvatarFallback className="bg-gradient-to-br from-primary to-primary/70 text-white text-sm font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>

            {/* Name + email stack */}
            {user && (
              <div className="flex flex-col items-start min-w-0 hidden sm:flex">
                <span className="text-[14px] font-semibold text-white leading-tight truncate max-w-[140px]">
                  {user.username}
                </span>
                <span className="text-[11px] text-slate-400 leading-tight truncate max-w-[140px]">
                  {user.email}
                </span>
              </div>
            )}

            {/* Chevron */}
            <ChevronDown size={14} className="text-slate-400 shrink-0" />
          </button>
        </DropdownMenuTrigger>

        {/* ── Dropdown ────────────────────────────────────────────────── */}
        <DropdownMenuContent align="end" className="w-72">

          {/* Header block — non-clickable user info */}
          {user && (
            <div className="flex items-center gap-3 px-3 py-3">
              <Avatar className="h-11 w-11 shrink-0">
                <AvatarFallback className="bg-gradient-to-br from-[#00aeef] to-[#0095cc] text-white text-base font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col min-w-0">
                <span className="text-[15px] font-bold text-foreground leading-tight truncate">
                  {user.username}
                </span>
                <span className="text-[12px] text-muted-foreground leading-tight truncate mt-0.5">
                  {user.email}
                </span>
                <span className="mt-1.5 inline-flex self-start text-[10px] font-semibold tracking-wide text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                  {roleName}
                </span>
              </div>
            </div>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={() => navigate('/app/profile')}>
            <User size={14} className="mr-2.5 text-muted-foreground" />
            My Profile
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={handleLogout}
            className="text-red-600 focus:text-red-600 focus:bg-red-50"
          >
            <LogOut size={14} className="mr-2.5" />
            Sign Out
          </DropdownMenuItem>

        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}

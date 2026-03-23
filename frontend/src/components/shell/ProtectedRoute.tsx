import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { AlertTriangle, ArrowLeft } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

// ── Loading skeleton ──────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="flex flex-col h-screen">
      {/* Skeleton topbar */}
      <div className="fixed top-0 left-0 right-0 h-[72px] bg-[#1a2332] flex items-center px-6 gap-4 z-50">
        <Skeleton className="h-5 w-32 bg-white/10" />
        <div className="flex-1 flex justify-center gap-2">
          <Skeleton className="h-8 w-24 bg-white/10" />
          <Skeleton className="h-8 w-24 bg-white/10" />
          <Skeleton className="h-8 w-24 bg-white/10" />
        </div>
        <Skeleton className="h-8 w-8 rounded-full bg-white/10" />
      </div>

      <div className="flex flex-1 pt-[124px]">
        {/* Skeleton sidebar */}
        <div className="fixed left-0 top-[124px] bottom-0 w-56 bg-white border-r border-slate-100 p-3 space-y-2">
          <Skeleton className="h-3 w-20 mb-4" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-md" />
          ))}
        </div>

        {/* Skeleton content */}
        <main className="flex-1 ml-56 p-6 bg-surface space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-40" />
          <div className="grid grid-cols-3 gap-4 mt-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-xl mt-4" />
        </main>
      </div>
    </div>
  )
}

// ── ProtectedRoute ────────────────────────────────────────────────────────────

export default function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) return <LoadingSkeleton />

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location }}
      />
    )
  }

  return <Outlet />
}

// ── RoleRoute ─────────────────────────────────────────────────────────────────

interface RoleRouteProps {
  allowedRoles: number[]
}

export function RoleRoute({ allowedRoles }: RoleRouteProps) {
  const { user } = useAuth()

  if (!user || !allowedRoles.includes(user.role_id)) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-4 pt-8 pb-8 text-center">
            <div className="rounded-full bg-destructive/10 p-3">
              <AlertTriangle size={28} className="text-destructive" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Access Restricted</h2>
              <p className="text-sm text-muted-foreground mt-1">
                You don't have permission to view this page.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.history.back()}
              className="mt-2"
            >
              <ArrowLeft size={14} className="mr-1.5" />
              Go Back
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return <Outlet />
}

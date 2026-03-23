import { useQuery } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import userService from '@/services/userService'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

const ROLE_META: Record<number, { name: string; description: string; access: string[] }> = {
  1: {
    name: 'Admin',
    description: 'Full system access — all sections, all data, all configuration.',
    access: ['User management', 'Department management', 'Form builder', 'All submissions', 'All disputes', 'All reports', 'Import center', 'System settings'],
  },
  2: {
    name: 'QA',
    description: 'Quality section — form builder, audit submissions, and dispute management.',
    access: ['Form builder', 'Submissions', 'Disputes', 'Scoring rules', 'QA analytics'],
  },
  3: {
    name: 'User',
    description: 'Own quality scores, own training records, own certificates.',
    access: ['Quality overview (own)', 'Course library', 'Own certificates', 'My dashboard', 'Raw export'],
  },
  4: {
    name: 'Trainer',
    description: 'Training section — course creation, training paths, coaching sessions.',
    access: ['Course library', 'Training paths', 'Enrollments', 'Coaching sessions', 'Quizzes'],
  },
  5: {
    name: 'Manager',
    description: 'Team oversight — manages one or more departments, sees team audits, training, and metrics.',
    access: ['Submissions (team)', 'Disputes (team)', 'QA analytics (team)', 'Enrollments', 'Coaching', 'Team dashboard', 'Saved reports', 'Data explorer'],
  },
}

export default function AdminRolesPage() {
  const { data: users = [] } = useQuery({
    queryKey: ['admin-users-all'],
    queryFn:  () => userService.getUsers(1, 200),
    select:   d => d.items,
  })

  // Count per role
  const counts: Record<number, number> = {}
  users.forEach((u: any) => {
    counts[u.role_id] = (counts[u.role_id] ?? 0) + 1
  })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Roles</h1>
        <p className="text-sm text-muted-foreground mt-0.5">System-defined roles and their access levels</p>
      </div>

      <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg px-4 py-3 text-[13px]">
        <Info size={14} className="mt-0.5 shrink-0" />
        Roles are system-defined and cannot be edited. To change a user's role, edit the user.
      </div>

      <div className="grid gap-4">
        {Object.entries(ROLE_META).map(([idStr, meta]) => {
          const id = Number(idStr)
          const count = counts[id] ?? 0
          return (
            <Card key={id} className="border-slate-200">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1.5">
                      <span className="w-7 h-7 rounded-full bg-[#00aeef]/10 text-[#00aeef] text-[11px] font-bold flex items-center justify-center">
                        {id}
                      </span>
                      <span className="text-[15px] font-semibold text-slate-900">{meta.name}</span>
                      <Badge variant="outline" className="text-[11px] text-muted-foreground">
                        {count} user{count !== 1 ? 's' : ''}
                      </Badge>
                    </div>
                    <p className="text-[13px] text-slate-600 mb-3">{meta.description}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {meta.access.map(a => (
                        <span key={a} className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">
                          {a}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

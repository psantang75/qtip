import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Pencil, Eye, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/hooks/use-toast'
import userService from '@/services/userService'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'

const ROLE_NAMES: Record<number, string> = {
  1: 'Admin', 2: 'QA', 3: 'User', 4: 'Trainer', 5: 'Manager',
}

function getInitials(username: string) {
  const parts = username.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return username.substring(0, 2).toUpperCase()
}

function formatDate(d?: string | null) {
  if (!d) return 'Never'
  return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// ── Profile update schema ─────────────────────────────────────────────────────
const profileSchema = z.object({
  username: z.string().min(3, 'Min 3 characters'),
  email:    z.string().email('Valid email required'),
  title:    z.string().optional(),
})

// ── Password change schema ────────────────────────────────────────────────────
const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Required'),
  newPassword:     z.string().min(6, 'Min 6 characters'),
  confirmPassword: z.string().min(1, 'Required'),
}).refine(d => d.newPassword === d.confirmPassword, {
  message: 'Passwords do not match',
  path:    ['confirmPassword'],
})

type ProfileValues  = z.infer<typeof profileSchema>
type PasswordValues = z.infer<typeof passwordSchema>

// ── Component ─────────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const { user }    = useAuth()
  const { toast }   = useToast()
  const queryClient = useQueryClient()

  const [editingProfile, setEditingProfile]       = useState(false)
  const [showCurrentPw, setShowCurrentPw]         = useState(false)
  const [showNewPw, setShowNewPw]                 = useState(false)
  const [profileError, setProfileError]           = useState<string | null>(null)
  const [passwordError, setPasswordError]         = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess]     = useState(false)

  // ── Profile form ─────────────────────────────────────────────────────────
  const profileForm = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema as any),
    defaultValues: {
      username: user?.username ?? '',
      email:    user?.email ?? '',
      title:    user?.title ?? '',
    },
  })

  const profileMutation = useMutation({
    mutationFn: (v: ProfileValues) => userService.updateUser(user!.id, {
      username: v.username,
      email:    v.email,
      title:    v.title || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      toast({ title: 'Profile updated', description: 'Your changes have been saved.' })
      setEditingProfile(false)
      setProfileError(null)
    },
    onError: (e: Error) => setProfileError(e.message),
  })

  // ── Password form ─────────────────────────────────────────────────────────
  const passwordForm = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema as any),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })

  const passwordMutation = useMutation({
    mutationFn: (v: PasswordValues) =>
      userService.changePassword(v.currentPassword, v.newPassword),
    onSuccess: () => {
      setPasswordSuccess(true)
      setPasswordError(null)
      passwordForm.reset()
      toast({ title: 'Password changed', description: 'Your new password is active.' })
    },
    onError: (e: Error) => setPasswordError(e.message),
  })

  if (!user) return null

  const roleName = ROLE_NAMES[user.role_id] ?? 'User'
  const initials = getInitials(user.username)

  return (
    <div className="max-w-2xl space-y-6">

      <div>
        <h1 className="text-2xl font-bold text-slate-900">My Profile</h1>
        <p className="text-sm text-muted-foreground mt-0.5">View and update your account information</p>
      </div>

      {/* ── Profile card ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-0">
          <div className="flex items-start justify-between">
            <CardTitle className="text-[15px]">Profile Information</CardTitle>
            {!editingProfile && (
              <Button variant="ghost" size="sm" className="gap-1.5 text-[13px]" onClick={() => setEditingProfile(true)}>
                <Pencil size={13} /> Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-4">

          {/* Avatar + identity */}
          <div className="flex items-center gap-4 mb-5">
            <div className="h-16 w-16 rounded-full bg-gradient-to-br from-[#00aeef] to-[#0095cc] flex items-center justify-center text-white text-xl font-bold shrink-0">
              {initials}
            </div>
            <div>
              <p className="text-[17px] font-bold text-slate-900">{user.username}</p>
              <p className="text-[13px] text-slate-500">{user.email}</p>
              <Badge className="mt-1 text-[10px] bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                {roleName}
              </Badge>
            </div>
          </div>

          <Separator className="mb-5" />

          {!editingProfile ? (
            <div className="grid grid-cols-2 gap-4 text-[13px]">
              <div>
                <p className="text-muted-foreground mb-0.5">Username</p>
                <p className="font-medium">{user.username}</p>
              </div>
              <div>
                <p className="text-muted-foreground mb-0.5">Email</p>
                <p className="font-medium">{user.email}</p>
              </div>
              <div>
                <p className="text-muted-foreground mb-0.5">Role</p>
                <p className="font-medium">{roleName}</p>
              </div>
              <div>
                <p className="text-muted-foreground mb-0.5">Department</p>
                <p className="font-medium">{user.department_name ?? '—'}</p>
              </div>
              <div>
                <p className="text-muted-foreground mb-0.5">Job Title</p>
                <p className="font-medium">{user.title || '—'}</p>
              </div>
            </div>
          ) : (
            <>
              {profileError && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2.5 mb-4 text-[13px]">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  {profileError}
                </div>
              )}
              <Form {...profileForm}>
                <form onSubmit={profileForm.handleSubmit(v => profileMutation.mutate(v))} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={profileForm.control} name="username" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Display Name</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={profileForm.control} name="email" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl><Input type="email" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={profileForm.control} name="title" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Job Title <span className="text-muted-foreground">(optional)</span></FormLabel>
                      <FormControl><Input placeholder="e.g. Senior QA Analyst" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="flex gap-3 pt-1">
                    <Button type="button" variant="outline" size="sm" onClick={() => { setEditingProfile(false); setProfileError(null) }}>
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" disabled={profileMutation.isPending}>
                      {profileMutation.isPending ? 'Saving…' : 'Save Changes'}
                    </Button>
                  </div>
                </form>
              </Form>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Change password card ───────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-[15px]">Change Password</CardTitle>
        </CardHeader>
        <CardContent>
          {passwordSuccess && (
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-3 py-2.5 mb-4 text-[13px]">
              <CheckCircle2 size={14} className="shrink-0" />
              Password changed successfully.
            </div>
          )}
          {passwordError && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2.5 mb-4 text-[13px]">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              {passwordError}
            </div>
          )}
          <Form {...passwordForm}>
            <form onSubmit={passwordForm.handleSubmit(v => { setPasswordSuccess(false); passwordMutation.mutate(v) })} className="space-y-4">
              <FormField control={passwordForm.control} name="currentPassword" render={({ field }) => (
                <FormItem>
                  <FormLabel>Current Password</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input type={showCurrentPw ? 'text' : 'password'} className="pr-9" {...field} />
                      <button type="button" tabIndex={-1} onClick={() => setShowCurrentPw(v => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        {showCurrentPw ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={passwordForm.control} name="newPassword" render={({ field }) => (
                  <FormItem>
                    <FormLabel>New Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input type={showNewPw ? 'text' : 'password'} className="pr-9" {...field} />
                        <button type="button" tabIndex={-1} onClick={() => setShowNewPw(v => !v)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                          {showNewPw ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={passwordForm.control} name="confirmPassword" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm New Password</FormLabel>
                    <FormControl><Input type="password" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <Button type="submit" size="sm" disabled={passwordMutation.isPending}>
                {passwordMutation.isPending ? 'Updating…' : 'Update Password'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* ── Account info card ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-[15px]">Account Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-[13px]">
            <div>
              <p className="text-muted-foreground mb-0.5">Account Created</p>
              <p className="font-medium">{formatDate(user.created_at)}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-0.5">Last Login</p>
              <p className="font-medium">{formatDate(user.last_login)}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-0.5">Account Status</p>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="font-medium text-emerald-700">Active</span>
              </div>
            </div>
            <div>
              <p className="text-muted-foreground mb-0.5">User ID</p>
              <p className="font-medium text-slate-400">#{user.id}</p>
            </div>
          </div>
        </CardContent>
      </Card>

    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Eye, EyeOff, CheckCircle2, AlertCircle } from 'lucide-react'
import authService from '@/services/authService'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'
import { Card, CardContent } from '@/components/ui/card'
import { t } from '@/lib/t'

const schema = z.object({
  newPassword: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain an uppercase letter')
    .regex(/[a-z]/, 'Must contain a lowercase letter')
    .regex(/[0-9]/, 'Must contain a number')
    .regex(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/, 'Must contain a special character'),
  confirmPassword: z.string(),
}).refine(d => d.newPassword === d.confirmPassword, {
  message: "Passwords don't match", path: ['confirmPassword'],
})
type Values = z.infer<typeof schema>

export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') ?? ''
  const [tokenState, setTokenState] = useState<'checking' | 'valid' | 'invalid' | 'expired' | 'used'>('checking')
  const [showPw, setShowPw] = useState(false)
  const [done, setDone] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  })

  useEffect(() => {
    let alive = true
    if (!token) { setTokenState('invalid'); return }
    authService.validateResetToken(token).then(r => {
      if (!alive) return
      if (r.valid) setTokenState('valid')
      else setTokenState((r.reason ?? 'invalid') as typeof tokenState)
    })
    return () => { alive = false }
  }, [token])

  const onSubmit = async (values: Values) => {
    setApiError(null)
    const result = await authService.resetPassword(token, values.newPassword, values.confirmPassword)
    if (result.ok) {
      setDone(true)
      setTimeout(() => navigate('/login', { replace: true }), 2500)
      return
    }
    setApiError(result.message)
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <Card className="w-full max-w-sm shadow-sm">
        <CardContent className="pt-8 pb-8 px-8">
          <div className="text-center mb-6">
            <span className="text-[20px] font-bold tracking-tight text-slate-900">
              QTIP<span className="text-primary">+</span>Insights
            </span>
          </div>

          {tokenState === 'checking' && (
            <div className="text-center py-6">
              <Loader2 size={24} className="animate-spin mx-auto text-muted-foreground" />
              <p className="text-[13px] text-muted-foreground mt-3">Verifying link…</p>
            </div>
          )}

          {(tokenState === 'invalid' || tokenState === 'expired' || tokenState === 'used') && (
            <div className="text-center">
              <div className="flex justify-center mb-3">
                <AlertCircle size={40} className="text-destructive" />
              </div>
              <h1 className="text-xl font-semibold text-slate-900 mb-2">
                {tokenState === 'expired' ? 'Link expired' : tokenState === 'used' ? 'Link already used' : 'Invalid link'}
              </h1>
              <p className="text-[13px] text-muted-foreground mb-4">
                {tokenState === 'expired'
                  ? t.msg.auth.resetLinkExpired
                  : tokenState === 'used'
                  ? t.msg.auth.resetLinkUsed
                  : t.msg.auth.resetLinkInvalid}
              </p>
              <Link to="/forgot-password" className="text-[13px] text-primary hover:underline">
                Request a new link
              </Link>
            </div>
          )}

          {tokenState === 'valid' && !done && (
            <>
              <div className="text-center mb-6">
                <h1 className="text-xl font-semibold text-slate-900">Set a new password</h1>
                <p className="text-[13px] text-muted-foreground mt-1">
                  At least 8 characters with uppercase, lowercase, number, and symbol.
                </p>
              </div>

              {apiError && (
                <p className="text-[13px] text-destructive bg-destructive/10 rounded-md px-3 py-2 mb-4 text-center">
                  {apiError}
                </p>
              )}

              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="newPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[13px]">New Password</FormLabel>
                        {/* Wrapper outside FormControl so id lands on <Input>, not a div */}
                        <div className="relative">
                          <FormControl>
                            <Input
                              type={showPw ? 'text' : 'password'}
                              autoComplete="new-password"
                              className="pr-10"
                              {...field}
                            />
                          </FormControl>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            tabIndex={-1}
                            className="absolute right-0 top-0 h-full px-3 text-muted-foreground hover:text-foreground"
                            onClick={() => setShowPw(v => !v)}
                          >
                            {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                          </Button>
                        </div>
                        <FormMessage className="text-[12px]" />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[13px]">Confirm Password</FormLabel>
                        <FormControl>
                          <Input
                            type={showPw ? 'text' : 'password'}
                            autoComplete="new-password"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage className="text-[12px]" />
                      </FormItem>
                    )}
                  />

                  <Button type="submit" className="w-full mt-2" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting ? (
                      <><Loader2 size={15} className="mr-2 animate-spin" />Updating…</>
                    ) : 'Set Password'}
                  </Button>
                </form>
              </Form>
            </>
          )}

          {done && (
            <div className="text-center">
              <div className="flex justify-center mb-3">
                <CheckCircle2 size={40} className="text-success" />
              </div>
              <h1 className="text-xl font-semibold text-slate-900 mb-2">Password updated</h1>
              <p className="text-[13px] text-muted-foreground">Redirecting to sign-in…</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

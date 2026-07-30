import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Card, CardContent } from '@/components/ui/card'
import { t } from '@/lib/t'
import { getBackendMessage, getErrorMessage } from '@/utils/errorHandling'

const loginSchema = z.object({
  email:    z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

type LoginFormValues = z.infer<typeof loginSchema>

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const sessionExpired = searchParams.get('expired') === '1'
  const [showPassword, setShowPassword] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = async (values: LoginFormValues) => {
    setApiError(null)
    try {
      await login({ email: values.email, password: values.password })
      navigate('/')
    } catch (err: unknown) {
      // On the login page a 401 means "wrong email/password" — NOT an expired
      // session — so we show the friendly canonical credentials message and
      // ignore the backend's terse "Invalid credentials" label. For any other
      // failure (lockout, rate-limit, server error) we surface a curated
      // backend message when present, else the canonical status wording.
      // Either path is guaranteed never to leak "Request failed with status
      // code 401" (see getErrorMessage).
      const status = (err as { response?: { status?: number } })?.response?.status
      const backend = getBackendMessage(err)
      if (status === 401 && (!backend || /invalid credentials/i.test(backend))) {
        setApiError(t.msg.auth.wrongCredentials)
      } else {
        setApiError(backend ?? getErrorMessage(err, t.msg.auth.wrongCredentials))
      }
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <Card className="w-full max-w-sm shadow-sm">
        <CardContent className="pt-8 pb-8 px-8">

          {/* Logo */}
          <div className="text-center mb-6">
            <span className="text-[20px] font-bold tracking-tight text-slate-900">
              QTIP
              <span className="text-primary">+</span>
              Insights
            </span>
          </div>

          {/* Heading */}
          <div className="text-center mb-6">
            <h1 className="text-xl font-semibold text-slate-900">Welcome back</h1>
            <p className="text-[13px] text-muted-foreground mt-1">Sign in to your account</p>
          </div>

          {/* Session expired banner */}
          {sessionExpired && !apiError && (
            <p className="text-[13px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-4 text-center">
              Your session expired. Please sign in again.
            </p>
          )}

          {/* API error */}
          {apiError && (
            <p className="text-[13px] text-destructive bg-destructive/10 rounded-md px-3 py-2 mb-4 text-center">
              {apiError}
            </p>
          )}

          {/* Form */}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[13px]">Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="you@company.com"
                        autoComplete="email"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className="text-[12px]" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[13px]">Password</FormLabel>
                    {/* Wrapper outside FormControl so id lands on <Input>, not a div */}
                    <div className="relative">
                      <FormControl>
                        <Input
                          type={showPassword ? 'text' : 'password'}
                          placeholder="••••••••"
                          autoComplete="current-password"
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
                        onClick={() => setShowPassword(v => !v)}
                      >
                        {showPassword
                          ? <EyeOff size={15} />
                          : <Eye size={15} />
                        }
                      </Button>
                    </div>
                    <FormMessage className="text-[12px]" />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full mt-2"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting ? (
                  <>
                    <Loader2 size={15} className="mr-2 animate-spin" />
                    Signing in…
                  </>
                ) : (
                  'Sign In'
                )}
              </Button>

              <div className="text-center pt-1">
                <Link
                  to="/forgot-password"
                  className="text-[13px] text-primary hover:underline"
                >
                  Forgot password?
                </Link>
              </div>

            </form>
          </Form>

        </CardContent>
      </Card>
    </div>
  )
}

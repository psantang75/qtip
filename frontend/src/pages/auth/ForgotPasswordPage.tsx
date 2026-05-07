import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, ArrowLeft, CheckCircle2 } from 'lucide-react'
import authService from '@/services/authService'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'
import { Card, CardContent } from '@/components/ui/card'

const schema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
})
type Values = z.infer<typeof schema>

export default function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false)

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  })

  const onSubmit = async (values: Values) => {
    await authService.forgotPassword(values.email)
    setSubmitted(true)
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

          {!submitted ? (
            <>
              <div className="text-center mb-6">
                <h1 className="text-xl font-semibold text-slate-900">Forgot your password?</h1>
                <p className="text-[13px] text-muted-foreground mt-1">
                  Enter your email and we'll send you a reset link.
                </p>
              </div>

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

                  <Button type="submit" className="w-full mt-2" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting ? (
                      <><Loader2 size={15} className="mr-2 animate-spin" />Sending…</>
                    ) : 'Send Reset Link'}
                  </Button>
                </form>
              </Form>
            </>
          ) : (
            <div className="text-center">
              <div className="flex justify-center mb-3">
                <CheckCircle2 size={40} className="text-success" />
              </div>
              <h1 className="text-xl font-semibold text-slate-900 mb-2">Check your inbox</h1>
              <p className="text-[13px] text-muted-foreground mb-4">
                If that email is registered, a reset link has been sent. The link expires in 30 minutes.
              </p>
            </div>
          )}

          <div className="mt-6 text-center">
            <Link
              to="/login"
              className="inline-flex items-center gap-1 text-[13px] text-primary hover:underline"
            >
              <ArrowLeft size={13} /> Back to sign-in
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

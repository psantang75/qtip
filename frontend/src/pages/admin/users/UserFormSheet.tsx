import { useState, useEffect } from 'react'
import { ROLE_IDS } from '@/hooks/useQualityRole'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Eye, EyeOff } from 'lucide-react'
import userService from '@/services/userService'
import type { User, Role, Department } from '@/services/userService'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'
import { useToast } from '@/hooks/use-toast'

type AdminUser = User

const makeSchema = (isCreate: boolean) =>
  z.object({
    username:      z.string().min(3, 'Min 3 characters'),
    email:         z.string().email('Valid email required'),
    password:      isCreate ? z.string().min(6, 'Min 6 characters') : z.string().optional(),
    title:         z.string().optional(),
    role_id:       z.coerce.number().min(1, 'Role required'),
    department_id: z.coerce.number().nullable().optional(),
    is_active:     z.boolean().optional(),
  })

type FormValues = z.infer<ReturnType<typeof makeSchema>>

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  editUser: AdminUser | null
  currentUserId?: number
  roles: Role[]
  departments: Department[]
}

export function UserFormSheet({ open, onOpenChange, editUser, currentUserId, roles, departments }: Props) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [showPass, setShowPass] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)

  const isCreate = !editUser

  const schema = makeSchema(isCreate)
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', email: '', password: '', title: '', role_id: ROLE_IDS.AGENT, department_id: null, is_active: true },
  })

  // Reset form whenever the target user changes
  useEffect(() => {
    if (!open) return
    setApiError(null)
    setShowPass(false)
    if (editUser) {
      form.reset({
        username: editUser.username, email: editUser.email, password: '',
        title: editUser.title ?? '', role_id: editUser.role_id,
        department_id: editUser.department_id,
        is_active: editUser.is_active,
      })
    } else {
      form.reset({ username: '', email: '', password: '', title: '', role_id: ROLE_IDS.AGENT, department_id: null, is_active: true })
    }
  }, [open, editUser, form])

  const createMut = useMutation({
    mutationFn: (v: FormValues) => userService.createUser({
      username: v.username, email: v.email,
      password: v.password!, role_id: v.role_id,
      department_id: v.department_id ?? null, title: v.title || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      toast({ title: 'User created', description: `${form.getValues('username')} has been added.` })
      onOpenChange(false)
    },
    onError: (e: Error) => setApiError(e.message),
  })

  const updateMut = useMutation({
    mutationFn: async (v: FormValues) => {
      await userService.updateUser(editUser!.id, {
        username: v.username, email: v.email,
        ...(v.password ? { password: v.password } : {}),
        role_id: v.role_id, department_id: v.department_id ?? null, title: v.title || undefined,
      })
      const newActive = v.is_active ?? editUser!.is_active
      if (newActive !== editUser!.is_active) await userService.toggleUserStatus(editUser!.id, newActive)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      toast({ title: 'User updated', description: 'Changes saved successfully.' })
      onOpenChange(false)
    },
    onError: (e: Error) => setApiError(e.message),
  })

  const isBusy = createMut.isPending || updateMut.isPending

  const onSubmit = (v: FormValues) => {
    setApiError(null)
    if (isCreate) createMut.mutate(v)
    else          updateMut.mutate(v)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto" aria-describedby={undefined}>
        <SheetHeader className="pb-4">
          <SheetTitle>{isCreate ? 'Add User' : `Edit User: ${editUser?.username}`}</SheetTitle>
        </SheetHeader>

        {apiError && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2.5 mb-4 text-[13px]">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            {apiError}
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="username" render={({ field }) => (
              <FormItem><FormLabel>Display Name</FormLabel>
                <FormControl><Input placeholder="e.g. Jane Smith" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem><FormLabel>Email</FormLabel>
                <FormControl><Input type="email" placeholder="jane@company.com" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="password" render={({ field }) => (
              <FormItem><FormLabel>Password</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Input type={showPass ? 'text' : 'password'}
                      placeholder={isCreate ? 'Min 6 characters' : 'Leave blank to keep current'}
                      className="pr-9" {...field} />
                    <button type="button" tabIndex={-1} onClick={() => setShowPass(v => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="title" render={({ field }) => (
              <FormItem>
                <FormLabel>Job Title <span className="text-muted-foreground">(optional)</span></FormLabel>
                <FormControl><Input placeholder="e.g. Senior QA Analyst" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="role_id" render={({ field }) => (
              <FormItem><FormLabel>Role</FormLabel>
                <Select onValueChange={field.onChange} value={String(field.value)}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {roles.map(r => <SelectItem key={r.id} value={String(r.id)}>{r.role_name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="department_id" render={({ field }) => (
              <FormItem>
                <FormLabel>Department <span className="text-muted-foreground">(optional)</span></FormLabel>
                <Select onValueChange={v => field.onChange(v === 'none' ? null : Number(v))}
                  value={field.value ? String(field.value) : 'none'}>
                  <FormControl><SelectTrigger><SelectValue placeholder="No department" /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="none">No department</SelectItem>
                    {departments.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.department_name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            {!isCreate && editUser && editUser.id !== currentUserId && (
              <FormField control={form.control} name="is_active" render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <FormLabel className="text-[13px] font-medium">Account Active</FormLabel>
                    <p className="text-[12px] text-muted-foreground">Inactive users cannot log in</p>
                  </div>
                  <FormControl>
                    <button type="button" onClick={() => field.onChange(!field.value)}
                      className={`w-10 h-5 rounded-full transition-colors ${field.value ? 'bg-primary' : 'bg-slate-300'} relative`}>
                      <span className={`absolute top-1/2 left-0 h-4 w-4 -translate-y-1/2 rounded-full bg-white shadow ring-0 transition-transform ${field.value ? 'translate-x-[22px]' : 'translate-x-[2px]'}`} />
                    </button>
                  </FormControl>
                </FormItem>
              )} />
            )}

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" className="flex-1" disabled={isBusy}>
                {isBusy ? 'Saving…' : isCreate ? 'Create User' : 'Save Changes'}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  )
}

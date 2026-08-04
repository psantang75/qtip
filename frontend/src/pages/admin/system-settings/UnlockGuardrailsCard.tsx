import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCcw, Unlock, Loader2, AlertCircle } from 'lucide-react'
import { api } from '@/services/authService'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Guardrails for the admin unlock / reopen feature, backed by
 * /api/admin/system-settings/unlock (admin-only). Mirrors
 * KbIndexSchedulerCard's section/card shell so the System Settings hub
 * stays visually uniform.
 */

interface UnlockSettings {
  window_days: number
  relock_days: number
  max_per_record: number
}

const FIELDS = [
  {
    key: 'window_days' as const,
    label: 'Reopen window (days)',
    min: 1,
    max: 365,
    help: 'How long after submit or resolve a record can be reopened. Past this, an admin must confirm a break-glass override, which is flagged in the register.',
  },
  {
    key: 'relock_days' as const,
    label: 'Auto re-lock after (days)',
    min: 1,
    max: 30,
    help: 'A reopened record that nobody re-submits within this many days is automatically restored to its prior state.',
  },
  {
    key: 'max_per_record' as const,
    label: 'Max reopens per record',
    min: 1,
    max: 10,
    help: 'Hard cap. Once a review or dispute hits this many reopens it cannot be reopened again.',
  },
]

type Drafts = Record<keyof UnlockSettings, string>

const EMPTY_DRAFTS: Drafts = { window_days: '', relock_days: '', max_per_record: '' }

export default function UnlockGuardrailsCard() {
  const queryClient = useQueryClient()
  const [drafts, setDrafts] = useState<Drafts>(EMPTY_DRAFTS)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['unlock-settings'],
    queryFn: async () => {
      const res = await api.get('/admin/system-settings/unlock')
      return res.data as UnlockSettings
    },
  })

  useEffect(() => {
    if (!data) return
    setDrafts((prev) =>
      prev.window_days === ''
        ? {
            window_days: String(data.window_days),
            relock_days: String(data.relock_days),
            max_per_record: String(data.max_per_record),
          }
        : prev,
    )
  }, [data])

  const mutation = useMutation({
    mutationFn: async (patch: Partial<UnlockSettings>) => {
      const res = await api.patch('/admin/system-settings/unlock', patch)
      return res.data as UnlockSettings
    },
    onSuccess: (res) => {
      setDrafts({
        window_days: String(res.window_days),
        relock_days: String(res.relock_days),
        max_per_record: String(res.max_per_record),
      })
      queryClient.invalidateQueries({ queryKey: ['unlock-settings'] })
    },
  })

  const allValid = FIELDS.every((f) => {
    const n = Number(drafts[f.key])
    return drafts[f.key] !== '' && Number.isFinite(n) && n >= f.min && n <= f.max
  })
  const isDirty = !!data && FIELDS.some((f) => Number(drafts[f.key]) !== data[f.key])

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200">
        <div className="flex items-center gap-2.5">
          <Unlock size={18} className="text-primary" />
          <div>
            <h2 className="text-base font-semibold text-slate-900">Unlock Guardrails</h2>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Limits on admins reopening finalized reviews and closed disputes. Every reopen is recorded in the Unlock
              Register regardless of these values.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCcw size={13} />
          Refresh
        </Button>
      </header>

      {error ? (
        <div className="px-5 py-6 flex items-center gap-2 text-destructive">
          <AlertCircle size={16} />
          <span className="text-sm">Couldn't load settings. Refresh to try again.</span>
        </div>
      ) : isLoading || !data ? (
        <div className="px-5 py-12 text-center text-muted-foreground text-sm">Loading...</div>
      ) : (
        <div className="divide-y divide-slate-200">
          <div className="px-5 py-4 space-y-4">
            {FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={`unlock-${f.key}`} className="text-[13px] font-medium text-slate-700">
                  {f.label}
                </Label>
                <div className="flex items-start gap-3">
                  <Input
                    id={`unlock-${f.key}`}
                    type="number"
                    min={f.min}
                    max={f.max}
                    className="w-[140px] shrink-0"
                    value={drafts[f.key]}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  />
                  <span className="text-[12px] text-muted-foreground pt-2">
                    Range {f.min}-{f.max}. {f.help}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {mutation.isError && (
            <div className="px-5 py-2.5 bg-red-50 text-[12px] text-red-800">Couldn't save changes. Try again.</div>
          )}

          <div className="px-5 py-3 flex justify-end">
            <Button
              size="sm"
              className="h-9"
              disabled={!isDirty || !allValid || mutation.isPending}
              onClick={() =>
                mutation.mutate({
                  window_days: Number(drafts.window_days),
                  relock_days: Number(drafts.relock_days),
                  max_per_record: Number(drafts.max_per_record),
                })
              }
            >
              {mutation.isPending ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null}
              Save guardrails
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle, CheckCircle2, Lock, Loader2, Send, History,
  Inbox, Activity, List, ChevronRight, ChevronDown, Settings2,
} from 'lucide-react'
import { ListPageShell } from '@/components/common/ListPageShell'
import { ListPageHeader } from '@/components/common/ListPageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import emailTemplatesService, {
  type EmailTemplate, type EmailLogRow, type RoleToken,
} from '@/services/emailTemplatesService'
import { cn } from '@/lib/utils'

const STATUS_BADGE_CLASS: Record<string, string> = {
  SENT: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  FAILED: 'bg-red-100 text-red-800 border-red-200',
  SKIPPED_DISABLED: 'bg-slate-100 text-slate-700 border-slate-200',
  SKIPPED_OFF: 'bg-slate-100 text-slate-700 border-slate-200',
  SKIPPED_RATE_LIMIT: 'bg-amber-100 text-amber-800 border-amber-200',
  SKIPPED_QUIET_HOURS: 'bg-blue-100 text-blue-800 border-blue-200',
  SKIPPED_INACTIVE_USER: 'bg-slate-100 text-slate-700 border-slate-200',
  SKIPPED_CIRCUIT_BREAKER: 'bg-amber-100 text-amber-800 border-amber-200',
  SKIPPED_NOT_CONFIGURED: 'bg-slate-100 text-slate-700 border-slate-200',
}

export default function AdminEmailTemplatesPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [tab, setTab] = useState<'editor' | 'history' | 'recent' | 'health'>('editor')
  const [search, setSearch] = useState('')
  const [openCategory, setOpenCategory] = useState<string | null>(null)

  const { data: templates = [], isLoading: loadingList } = useQuery({
    queryKey: ['emailTemplates'],
    queryFn: emailTemplatesService.list,
  })

  useEffect(() => {
    if (openCategory === null && templates.length > 0) {
      setOpenCategory(templates[0].category)
    }
  }, [openCategory, templates])

  const grouped = useMemo(() => {
    const filtered = search
      ? templates.filter(t =>
          t.name.toLowerCase().includes(search.toLowerCase()) ||
          t.template_key.toLowerCase().includes(search.toLowerCase()))
      : templates
    const g: Record<string, EmailTemplate[]> = {}
    for (const t of filtered) {
      g[t.category] = g[t.category] || []
      g[t.category].push(t)
    }
    return g
  }, [templates, search])

  const isSearching = search.trim().length > 0

  return (
    <ListPageShell>
      <ListPageHeader
        title="Email Templates"
        subtitle="Edit copy, cadence, and recipient cadence per notification."
        actions={
          <Button variant="outline" size="sm" onClick={() => setTab('health')}>
            <Activity size={14} className="mr-1.5" /> System Health
          </Button>
        }
      />

      {tab === 'health' && (
        <SystemHealthCard onClose={() => setTab('editor')} />
      )}

      {tab !== 'health' && (
        <div className="grid grid-cols-12 gap-4">
          <aside className="col-span-12 md:col-span-4 lg:col-span-3 space-y-3">
            <Input
              placeholder="Search templates…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-9"
            />
            <div className="space-y-1 max-h-[calc(100vh-260px)] overflow-y-auto pr-1">
              {loadingList && (
                <div className="flex items-center justify-center p-6 text-slate-400">
                  <Loader2 size={18} className="animate-spin" />
                </div>
              )}
              {Object.entries(grouped).map(([category, list]) => {
                const isOpen = isSearching || openCategory === category
                return (
                  <div key={category}>
                    <button type="button"
                      onClick={() => {
                        if (isSearching) return
                        setOpenCategory(prev => {
                          const next = prev === category ? null : category
                          // Clear the selected template when switching categories
                          // so the right pane shows the category overview, mirroring
                          // List Management's behavior.
                          if (next !== prev) setSelectedId(null)
                          return next
                        })
                      }}
                      className={cn(
                        'w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-colors',
                        isOpen ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <List className="h-4 w-4 shrink-0" />
                        {category}
                        <span className="text-[11px] font-normal opacity-60">({list.length})</span>
                      </div>
                      {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </button>

                    {isOpen && (
                      <div className="ml-3 mt-1 space-y-0.5 pl-3 border-l border-slate-200">
                        {list.map(t => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => { setSelectedId(t.id); setTab('editor'); setOpenCategory(category) }}
                            className={cn(
                              'w-full text-left px-2 py-2 rounded-md text-[13px] transition-colors flex items-start gap-2',
                              selectedId === t.id
                                ? 'bg-primary/10 text-primary font-medium'
                                : 'text-slate-600 hover:bg-slate-50',
                            )}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate">{t.name}</span>
                                {t.is_locked && <Lock size={11} className="text-slate-400 shrink-0" />}
                              </div>
                              <div className="text-[11px] text-slate-400 truncate">{t.template_key}</div>
                            </div>
                            {!t.is_enabled && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5 shrink-0">off</Badge>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
              {!loadingList && Object.keys(grouped).length === 0 && (
                <div className="px-3 py-6 text-center text-[12px] text-slate-400">
                  No templates match “{search}”.
                </div>
              )}
            </div>
          </aside>

          <main className="col-span-12 md:col-span-8 lg:col-span-9">
            {selectedId == null ? (
              <CategoryOverview
                category={openCategory}
                templates={openCategory ? grouped[openCategory] ?? [] : []}
                onPick={(id) => { setSelectedId(id); setTab('editor') }}
              />
            ) : (
              <TemplateEditor
                templateId={selectedId}
                tab={tab}
                onTabChange={setTab}
              />
            )}
          </main>
        </div>
      )}
    </ListPageShell>
  )
}

// ── Editor card ────────────────────────────────────────────────────────────

function CategoryOverview({
  category, templates, onPick,
}: {
  category: string | null
  templates: EmailTemplate[]
  onPick: (id: number) => void
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-base font-semibold text-slate-800 mb-1">
        {category ?? 'Email Templates'}
      </h2>
      <p className="text-[13px] text-slate-500 mb-5">
        Select a template to manage its copy, cadence, and recipients.
      </p>
      {templates.length === 0 ? (
        <div className="text-[13px] text-slate-400 text-center py-8">
          No templates in this category.
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => onPick(t.id)}
              className="w-full text-left flex items-start justify-between gap-4 p-4 rounded-lg border border-slate-200 hover:border-primary/40 hover:bg-slate-50 transition-colors group"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-[13px] font-semibold text-slate-800 truncate">{t.name}</p>
                  {t.is_locked && <Lock size={11} className="text-slate-400 shrink-0" />}
                  {!t.is_enabled && (
                    <Badge variant="outline" className="text-[10px] py-0 px-1.5 shrink-0">off</Badge>
                  )}
                </div>
                <p className="text-[12px] text-slate-500 leading-snug">{t.description}</p>
              </div>
              <Settings2 className="h-4 w-4 text-slate-300 group-hover:text-primary shrink-0 mt-0.5 transition-colors" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TemplateEditor({
  templateId, tab, onTabChange,
}: {
  templateId: number
  tab: 'editor' | 'history' | 'recent' | 'health'
  onTabChange: (t: 'editor' | 'history' | 'recent' | 'health') => void
}) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { data, isLoading } = useQuery({
    queryKey: ['emailTemplate', templateId],
    queryFn: () => emailTemplatesService.get(templateId),
  })

  const [draft, setDraft] = useState<{
    subject: string
    body_html: string
    cadence: EmailTemplate['cadence']
    digest_filter: EmailTemplate['digest_filter']
    is_enabled: boolean
    recipient_roles: RoleToken[]
  }>({
    subject: '',
    body_html: '',
    cadence: 'IMMEDIATE',
    digest_filter: 'ALL',
    is_enabled: true,
    recipient_roles: [],
  })
  // Tracks which templateId the draft was last hydrated from. Used to
  // suppress a render of stale/empty draft state during the gap between
  // `data` arriving and the hydrating useEffect firing.
  const [draftForId, setDraftForId] = useState<number | null>(null)
  useEffect(() => {
    if (data && data.template.id === templateId) {
      setDraft({
        subject: data.template.subject,
        body_html: data.template.body_html,
        cadence: data.template.cadence,
        digest_filter: data.template.digest_filter,
        is_enabled: data.template.is_enabled,
        recipient_roles: data.template.recipient_roles ?? [],
      })
      setDraftForId(templateId)
    }
  }, [data, templateId])

  const [previewHtml, setPreviewHtml] = useState<string>('')
  const [previewSubject, setPreviewSubject] = useState<string>('')
  const [testTo, setTestTo] = useState('')
  const [showTestDialog, setShowTestDialog] = useState(false)

  const saveMut = useMutation({
    mutationFn: () => emailTemplatesService.update(templateId, draft),
    onSuccess: () => {
      toast({ title: 'Saved', description: 'Template updated.' })
      void queryClient.invalidateQueries({ queryKey: ['emailTemplate', templateId] })
      void queryClient.invalidateQueries({ queryKey: ['emailTemplates'] })
    },
    onError: (err: any) =>
      toast({ title: 'Save failed', description: err?.response?.data?.message ?? 'Try again.', variant: 'destructive' }),
  })

  const previewMut = useMutation({
    mutationFn: () => emailTemplatesService.preview(templateId, {
      subject: draft.subject, body_html: draft.body_html,
    }),
    onSuccess: (out) => { setPreviewSubject(out.subject); setPreviewHtml(out.html) },
  })

  const testMut = useMutation({
    mutationFn: (to: string) => emailTemplatesService.testSend(templateId, to),
    onSuccess: (r) => {
      if (r.ok) {
        toast({ title: 'Test sent', description: `Message ID: ${r.messageId ?? '—'}` })
        setShowTestDialog(false); setTestTo('')
      } else {
        toast({ title: 'Test failed', description: r.error ?? 'Send error.', variant: 'destructive' })
      }
    },
  })

  const rollbackMut = useMutation({
    mutationFn: (versionId: number) => emailTemplatesService.rollback(templateId, versionId),
    onSuccess: () => {
      toast({ title: 'Rolled back' })
      void queryClient.invalidateQueries({ queryKey: ['emailTemplate', templateId] })
    },
  })

  if (isLoading || !data || draftForId !== templateId) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-400">
        <Loader2 size={20} className="animate-spin mx-auto" />
      </div>
    )
  }

  const tpl = data.template
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-semibold text-slate-900 truncate">{tpl.name}</h2>
            {tpl.is_locked && (
              <Badge variant="outline" className="text-[10px] py-0 gap-1">
                <Lock size={10} /> Locked
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px] py-0">v{tpl.version}</Badge>
          </div>
          <p className="text-[12px] text-slate-500 mt-0.5">{tpl.description}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="outline" onClick={() => previewMut.mutate()}>
            <Inbox size={13} className="mr-1.5" /> Preview
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowTestDialog(true)}>
            <Send size={13} className="mr-1.5" /> Send Test
          </Button>
          <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
            {saveMut.isPending ? <Loader2 size={13} className="mr-1.5 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={v => onTabChange(v as any)}>
        <div className="px-5 border-b border-slate-100">
          <TabsList className="bg-transparent border-b-0 rounded-none gap-1 h-10 p-0">
            <TabsTrigger value="editor"  className="text-[13px]">Editor</TabsTrigger>
            <TabsTrigger value="history" className="text-[13px]"><History size={12} className="mr-1" /> Version History</TabsTrigger>
            <TabsTrigger value="recent"  className="text-[13px]">Recent Sends</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="editor" className="p-5 space-y-5 m-0">
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 md:col-span-4 space-y-4">
              <EnabledCard
                isEnabled={draft.is_enabled}
                isLocked={tpl.is_locked}
                onEnabledChange={c => setDraft({ ...draft, is_enabled: c })}
              />

              <RecipientsCard
                availableRoles={tpl.available_roles ?? []}
                fixedRoles={tpl.fixed_roles ?? []}
                roleLabels={tpl.role_labels ?? {}}
                selected={draft.recipient_roles}
                onChange={(roles) => setDraft({ ...draft, recipient_roles: roles })}
              />

              <DeliveryCard
                cadence={draft.cadence}
                digestFilter={draft.digest_filter}
                digestEligible={tpl.digest_eligible !== false}
                onCadenceChange={c => setDraft({ ...draft, cadence: c })}
                onDigestFilterChange={f => setDraft({ ...draft, digest_filter: f })}
              />

              <div className="rounded-md border border-slate-200 p-3 text-[11px] text-slate-500 space-y-2">
                <div className="space-y-1">
                  <p className="font-medium text-slate-700">Available variables</p>
                  <div className="flex flex-wrap gap-1">
                    {tpl.allowed_variables.map(v => (
                      <code key={v} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">{`{{${v}}}`}</code>
                    ))}
                  </div>
                </div>
                {tpl.allowed_variables.includes('deepLinkPath') && tpl.deep_link_target && (
                  <div className="pt-2 border-t border-slate-100 space-y-1">
                    <p className="font-medium text-slate-700">Link destination</p>
                    <code className="inline-block px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">{`{{deepLinkPath}}`}</code>
                    <p className="text-[11px] text-slate-500 leading-snug">{tpl.deep_link_target}</p>
                  </div>
                )}
                <div className="pt-2 border-t border-slate-100">
                  <p className="font-medium text-slate-700 mb-1">Template key</p>
                  <code className="text-[11px] text-slate-500">{tpl.template_key}</code>
                </div>
              </div>

            </div>

            <div className="col-span-12 md:col-span-8 space-y-4">
              <div className="space-y-1.5">
                <Label className="text-[12px]">Subject</Label>
                <Input
                  value={draft.subject}
                  onChange={e => setDraft({ ...draft, subject: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12px]">Body (HTML, Handlebars)</Label>
                <Textarea
                  rows={20}
                  className="font-mono text-[12px]"
                  value={draft.body_html}
                  onChange={e => setDraft({ ...draft, body_html: e.target.value })}
                />
              </div>

              {(previewHtml || previewSubject) && (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-1">Live preview</div>
                  <div className="text-[12px] text-slate-700 mb-2 font-medium">{previewSubject}</div>
                  <iframe
                    title="preview"
                    srcDoc={previewHtml}
                    className="w-full h-[440px] bg-white rounded border border-slate-200"
                  />
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="history" className="p-5 m-0">
          <div className="rounded-md border border-slate-200 overflow-hidden">
            <table className="w-full text-[12px]">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-500">Version</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-500">Edited by</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-500">Edited at</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-500">Cadence</th>
                  <th className="px-3 py-2 text-right font-medium text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.versions.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">No previous versions yet.</td></tr>
                )}
                {data.versions.map(v => (
                  <tr key={v.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium">v{v.version}</td>
                    <td className="px-3 py-2">{v.editor?.username ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-500">{new Date(v.edited_at).toLocaleString()}</td>
                    <td className="px-3 py-2">{v.cadence}</td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm" variant="outline" onClick={() => rollbackMut.mutate(v.id)}
                        disabled={rollbackMut.isPending}
                      >
                        Rollback to v{v.version}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="recent" className="p-5 m-0">
          <RecentSendsTable templateKey={tpl.template_key} />
        </TabsContent>
      </Tabs>

      <Dialog open={showTestDialog} onOpenChange={setShowTestDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send test email</DialogTitle>
            <DialogDescription>
              Sends a live test message using sample data. The subject will be prefixed with [TEST] so you can spot it in your inbox.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-[12px]">Recipient</Label>
            <Input
              type="email" placeholder="you@dm-us.com"
              value={testTo} onChange={e => setTestTo(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTestDialog(false)}>Cancel</Button>
            <Button onClick={() => testMut.mutate(testTo)} disabled={!testTo || testMut.isPending}>
              {testMut.isPending && <Loader2 size={13} className="mr-1.5 animate-spin" />}
              Send Test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Recent sends table ──────────────────────────────────────────────────────

function RecentSendsTable({ templateKey }: { templateKey: string }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['emailLog', templateKey],
    queryFn: () => emailTemplatesService.recentSends({ template_key: templateKey, limit: 50 }),
  })
  const resendMut = useMutation({
    mutationFn: (id: number) => emailTemplatesService.resend(id),
    onSuccess: (r) => {
      toast({
        title: r.ok ? 'Resent' : 'Resend failed',
        description: r.ok ? `Message ID: ${r.messageId ?? '—'}` : (r.error ?? 'Try again.'),
        variant: r.ok ? 'default' : 'destructive',
      })
      void queryClient.invalidateQueries({ queryKey: ['emailLog', templateKey] })
    },
  })
  if (isLoading) {
    return <div className="text-center text-slate-400 py-8"><Loader2 size={18} className="animate-spin mx-auto" /></div>
  }
  return (
    <div className="rounded-md border border-slate-200 overflow-hidden">
      <table className="w-full text-[12px]">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-slate-500">Sent</th>
            <th className="px-3 py-2 text-left font-medium text-slate-500">To</th>
            <th className="px-3 py-2 text-left font-medium text-slate-500">Subject</th>
            <th className="px-3 py-2 text-left font-medium text-slate-500">Status</th>
            <th className="px-3 py-2 text-right font-medium text-slate-500">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">No sends recorded yet.</td></tr>
          )}
          {rows.map((r: EmailLogRow) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                {new Date(r.created_at).toLocaleString()}
              </td>
              <td className="px-3 py-2 truncate max-w-[160px]" title={r.to_email}>
                {r.to_user?.username ?? r.to_email}
              </td>
              <td className="px-3 py-2 truncate max-w-[260px]">{r.subject}</td>
              <td className="px-3 py-2">
                <Badge variant="outline" className={cn('text-[10px] py-0 px-1.5', STATUS_BADGE_CLASS[r.status])}>
                  {r.status.replace(/^SKIPPED_/, '').toLowerCase()}
                </Badge>
              </td>
              <td className="px-3 py-2 text-right">
                <Button
                  size="sm" variant="outline" onClick={() => resendMut.mutate(r.id)}
                  disabled={resendMut.isPending}
                >
                  Resend
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Health card ────────────────────────────────────────────────────────────

function SystemHealthCard({ onClose }: { onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['emailHealth'],
    queryFn: emailTemplatesService.health,
  })
  if (isLoading || !data) return <div className="text-center py-8"><Loader2 size={20} className="animate-spin mx-auto" /></div>
  const transportOk = data.transport.ok
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[15px] font-semibold text-slate-900">Email System Health</h2>
        <Button variant="outline" size="sm" onClick={onClose}>Back to templates</Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <HealthStat
          label="Transport"
          ok={transportOk}
          value={data.configured ? (transportOk ? 'connected' : (data.transport.error ?? 'error')) : 'not configured'}
        />
        <HealthStat
          label="Mode"
          ok={!data.dryRun}
          value={data.dryRun ? 'dry-run (no real sends)' : 'live'}
        />
        <HealthStat
          label="Circuit breaker"
          ok={!data.circuit.tripped}
          value={data.circuit.tripped ? `TRIPPED (${data.circuit.count}/window)` : `ok (${data.circuit.count}/window)`}
        />
      </div>
      <h3 className="text-[12px] font-semibold tracking-wider uppercase text-slate-500 mb-2">Last 24 hours</h3>
      <div className="flex flex-wrap gap-2">
        {data.last24h.length === 0 && (
          <span className="text-[12px] text-slate-400">No sends recorded.</span>
        )}
        {data.last24h.map(b => (
          <Badge key={b.status} variant="outline" className={cn('text-[11px]', STATUS_BADGE_CLASS[b.status])}>
            {b.status.replace(/^SKIPPED_/, '').toLowerCase()}: {b._count._all}
          </Badge>
        ))}
      </div>
    </section>
  )
}

function HealthStat({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-1">{label}</div>
      <div className="flex items-center gap-2">
        {ok ? <CheckCircle2 size={16} className="text-emerald-600" /> : <AlertCircle size={16} className="text-amber-600" />}
        <span className="text-[13px] text-slate-800">{value}</span>
      </div>
    </div>
  )
}

// ── Delivery card (cadence radios + conditional digest filter) ──────────────

const optionCls = (active: boolean, disabled: boolean) =>
  cn(
    'flex items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors',
    'text-[13px] cursor-pointer',
    disabled && 'opacity-50 cursor-not-allowed',
    active
      ? 'border-[#00aeef] bg-[#00aeef]/5 text-slate-900'
      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700',
  )

function EnabledCard({
  isEnabled, isLocked, onEnabledChange,
}: {
  isEnabled: boolean
  isLocked: boolean
  onEnabledChange: (e: boolean) => void
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 flex items-center justify-between">
      <div>
        <Label className="text-[12px] font-semibold text-slate-700 block">Enabled</Label>
        <p className="text-[11px] text-slate-400">
          {isLocked ? 'Locked — cannot disable.' : 'Disable to suppress this notification entirely.'}
        </p>
      </div>
      <Switch checked={isEnabled} disabled={isLocked} onCheckedChange={onEnabledChange} />
    </div>
  )
}

function DeliveryCard({
  cadence, digestFilter, digestEligible,
  onCadenceChange, onDigestFilterChange,
}: {
  cadence: EmailTemplate['cadence']
  digestFilter: EmailTemplate['digest_filter']
  digestEligible: boolean
  onCadenceChange: (c: EmailTemplate['cadence']) => void
  onDigestFilterChange: (f: EmailTemplate['digest_filter']) => void
}) {
  const cadenceOptions: Array<{ value: EmailTemplate['cadence']; label: string; hint?: string }> = [
    { value: 'IMMEDIATE', label: 'Immediately when the event happens' },
    { value: 'DAILY', label: 'Daily summary email at 5pm ET',
      hint: digestEligible ? undefined : 'Not available for this template — too time-sensitive to batch.' },
    { value: 'WEEKLY', label: 'Weekly summary email Monday 8am ET',
      hint: digestEligible ? undefined : 'Not available for this template — too time-sensitive to batch.' },
  ]
  const filterOptions: Array<{ value: EmailTemplate['digest_filter']; label: string }> = [
    { value: 'ALL', label: 'Every event' },
    { value: 'BELOW_THRESHOLD', label: 'Only events with a score below the pass threshold' },
    { value: 'ROUTED_TO_QA', label: 'Only AI events that were routed to QA' },
  ]
  const showDigestFilter = cadence !== 'IMMEDIATE'

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
      <div>
        <Label className="text-[12px] font-semibold text-slate-700 block mb-1.5">Delivery</Label>
        <p className="text-[12px] text-slate-500 mb-2">When should this be sent?</p>
        <div className="space-y-1.5">
          {cadenceOptions.map(opt => {
            const disabled = !digestEligible && opt.value !== 'IMMEDIATE'
            const active = cadence === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                disabled={disabled}
                onClick={() => !disabled && onCadenceChange(opt.value)}
                className={optionCls(active, disabled)}
              >
                <span className={cn(
                  'mt-[2px] h-3.5 w-3.5 rounded-full border-2 shrink-0',
                  active ? 'border-[#00aeef] bg-[#00aeef]' : 'border-slate-300',
                )} />
                <span className="flex-1">
                  <div>{opt.label}</div>
                  {opt.hint && <div className="text-[11px] text-slate-400 mt-0.5">{opt.hint}</div>}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {showDigestFilter && (
        <div className="border-t border-slate-100 pt-3">
          <p className="text-[12px] text-slate-500 mb-2">What should the summary include?</p>
          <div className="space-y-1.5">
            {filterOptions.map(opt => {
              const active = digestFilter === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onDigestFilterChange(opt.value)}
                  className={optionCls(active, false)}
                >
                  <span className={cn(
                    'mt-[2px] h-3.5 w-3.5 rounded-full border-2 shrink-0',
                    active ? 'border-[#00aeef] bg-[#00aeef]' : 'border-slate-300',
                  )} />
                  <span className="flex-1">{opt.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Recipients card (per-template role checkboxes) ──────────────────────────

function RecipientsCard({
  availableRoles, fixedRoles, roleLabels, selected, onChange,
}: {
  availableRoles: RoleToken[]
  fixedRoles: RoleToken[]
  roleLabels: Partial<Record<RoleToken, string>>
  selected: RoleToken[]
  onChange: (roles: RoleToken[]) => void
}) {
  // When there's only one available recipient, treat it as locked: there's
  // no meaningful "off" state — disabling it would leave the template with
  // zero recipients.
  const soleOption = availableRoles.length === 1 ? availableRoles[0] : null
  const isLocked = (role: RoleToken) =>
    fixedRoles.includes(role) || soleOption === role

  // Make sure the sole-option role is persisted in the saved recipient_roles
  // array, so the backend actually fans out to it on send.
  useEffect(() => {
    if (soleOption && !selected.includes(soleOption)) {
      onChange([...selected, soleOption])
    }
  }, [soleOption, selected, onChange])

  const toggle = (role: RoleToken) => {
    if (isLocked(role)) return
    if (selected.includes(role)) onChange(selected.filter(r => r !== role))
    else onChange([...selected, role])
  }

  if (availableRoles.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-3 text-[12px] text-slate-400">
        Recipients for this template are fixed and cannot be configured.
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
      <div>
        <Label className="text-[12px] font-semibold text-slate-700 block">Recipients</Label>
        <p className="text-[11px] text-slate-500">Who receives this notification?</p>
      </div>
      <div className="space-y-1">
        {availableRoles.map(role => {
          const locked = isLocked(role)
          const checked = selected.includes(role) || locked
          const id = `role-${role}`
          const lockedReason = fixedRoles.includes(role)
            ? 'Locked — required for this template'
            : 'Locked — only available recipient'
          return (
            <label
              key={role}
              htmlFor={id}
              className={cn(
                'flex items-start gap-2 px-2 py-2 rounded-md border text-[13px] cursor-pointer',
                locked
                  ? 'border-slate-200 bg-slate-50 cursor-not-allowed text-slate-500'
                  : checked
                    ? 'border-[#00aeef] bg-[#00aeef]/5 text-slate-900'
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700',
              )}
            >
              <Checkbox
                id={id}
                checked={checked}
                disabled={locked}
                onCheckedChange={() => toggle(role)}
                className="mt-[2px]"
              />
              <span className="flex-1">
                <span className="block">{roleLabels[role] ?? role}</span>
                {locked && <span className="block text-[10px] text-slate-400">{lockedReason}</span>}
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

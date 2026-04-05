import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Pencil, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { listKpis, createKpi, updateKpi, getThresholds, setThreshold } from '@/services/insightsService'
import type { IeKpi, IeKpiThreshold } from '@/services/insightsService'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'

const kpiSchema = z.object({
  kpi_code:       z.string().min(1, 'Required'),
  kpi_name:       z.string().min(1, 'Required'),
  description:    z.string().optional(),
  category:       z.string().min(1, 'Required'),
  formula_type:   z.string().min(1),
  formula:        z.string().min(1, 'Required'),
  source_table:   z.string().optional(),
  format_type:    z.string().min(1),
  decimal_places: z.coerce.number().min(0).max(6),
  direction:      z.string().min(1),
  unit_label:     z.string().optional(),
  is_active:      z.boolean(),
  sort_order:     z.coerce.number(),
})
type KpiForm = z.infer<typeof kpiSchema>

const thresholdSchema = z.object({
  goal_value:     z.coerce.number().nullable().optional(),
  warning_value:  z.coerce.number().nullable().optional(),
  critical_value: z.coerce.number().nullable().optional(),
  effective_from: z.string().min(1, 'Required'),
  effective_to:   z.string().optional(),
})
type ThresholdForm = z.infer<typeof thresholdSchema>

export default function InsightsKpiManagementPage() {
  const qc = useQueryClient()
  const { toast } = useToast()

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editKpi, setEditKpi]     = useState<IeKpi | null>(null)
  const [apiError, setApiError]   = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const { data: kpis = [], isLoading } = useQuery({ queryKey: ['ie-kpis'], queryFn: listKpis })

  const form = useForm<KpiForm>({
    resolver: zodResolver(kpiSchema),
    defaultValues: { kpi_code: '', kpi_name: '', category: '', formula_type: 'SQL', formula: '',
      format_type: 'NUMBER', decimal_places: 1, direction: 'UP_IS_GOOD', is_active: true, sort_order: 0 },
  })

  const saveMut = useMutation({
    mutationFn: (v: KpiForm) => editKpi ? updateKpi(editKpi.id, v) : createKpi(v),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ie-kpis'] }); toast({ title: editKpi ? 'KPI updated' : 'KPI created' }); closeSheet() },
    onError: (e: Error) => setApiError(e.message),
  })

  function openCreate() {
    setEditKpi(null); setApiError(null)
    form.reset({ kpi_code: '', kpi_name: '', category: '', formula_type: 'SQL', formula: '', source_table: '',
      format_type: 'NUMBER', decimal_places: 1, direction: 'UP_IS_GOOD', unit_label: '', is_active: true, sort_order: 0 })
    setSheetOpen(true)
  }
  function openEdit(k: IeKpi) {
    setEditKpi(k); setApiError(null)
    form.reset({ ...k, description: k.description ?? '', source_table: k.source_table ?? '', unit_label: k.unit_label ?? '' })
    setSheetOpen(true)
  }
  function closeSheet() { setSheetOpen(false); setEditKpi(null) }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Insights KPIs</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage the KPI registry for the Insights Engine</p>
        </div>
        <Button onClick={openCreate} className="gap-1.5"><Plus size={15} /> Add KPI</Button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/60">
              <TableHead className="w-8" />
              <TableHead className="py-4">Code</TableHead>
              <TableHead className="py-4">Name</TableHead>
              <TableHead className="py-4">Category</TableHead>
              <TableHead className="py-4">Formula</TableHead>
              <TableHead className="py-4">Format</TableHead>
              <TableHead className="py-4">Direction</TableHead>
              <TableHead className="py-4">Active</TableHead>
              <TableHead className="py-4 w-[80px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={9} className="text-center py-12 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : kpis.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center py-12 text-muted-foreground">No KPIs registered yet</TableCell></TableRow>
            ) : kpis.map(k => (
              <>
                <TableRow key={k.id} className="hover:bg-slate-50/50">
                  <TableCell>
                    <button onClick={() => setExpandedId(expandedId === k.id ? null : k.id)} className="p-0.5">
                      {expandedId === k.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  </TableCell>
                  <TableCell className="font-mono text-[13px]">{k.kpi_code}</TableCell>
                  <TableCell className="font-medium text-[14px]">{k.kpi_name}</TableCell>
                  <TableCell className="text-[13px] text-slate-600">{k.category}</TableCell>
                  <TableCell className="text-[13px] text-slate-600">{k.formula_type}</TableCell>
                  <TableCell className="text-[13px] text-slate-600">{k.format_type}</TableCell>
                  <TableCell className="text-[13px] text-slate-600">{k.direction.replace(/_/g, ' ')}</TableCell>
                  <TableCell>
                    <span className={`w-1.5 h-1.5 rounded-full inline-block ${k.is_active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]" onClick={() => openEdit(k)}>
                      <Pencil size={12} className="mr-1" /> Edit
                    </Button>
                  </TableCell>
                </TableRow>
                {expandedId === k.id && (
                  <TableRow key={`${k.id}-thresholds`}>
                    <TableCell colSpan={9} className="bg-slate-50 px-6 py-4">
                      <ThresholdSection kpiId={k.id} />
                    </TableCell>
                  </TableRow>
                )}
              </>
            ))}
          </TableBody>
        </Table>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-[520px] sm:max-w-[520px] overflow-y-auto" aria-describedby={undefined}>
          <SheetHeader className="pb-4">
            <SheetTitle>{editKpi ? `Edit: ${editKpi.kpi_name}` : 'Add KPI'}</SheetTitle>
          </SheetHeader>
          {apiError && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2.5 mb-4 text-[13px]">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />{apiError}
            </div>
          )}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(v => { setApiError(null); saveMut.mutate(v) })} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="kpi_code" render={({ field }) => (
                  <FormItem><FormLabel>KPI Code</FormLabel><FormControl><Input placeholder="qa_avg_score" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="kpi_name" render={({ field }) => (
                  <FormItem><FormLabel>Display Name</FormLabel><FormControl><Input placeholder="Average QA Score" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea rows={2} placeholder="Tooltip/help text" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="category" render={({ field }) => (
                  <FormItem><FormLabel>Category</FormLabel><FormControl><Input placeholder="Quality" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="formula_type" render={({ field }) => (
                  <FormItem><FormLabel>Formula Type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="SQL">SQL</SelectItem>
                        <SelectItem value="DERIVED">DERIVED</SelectItem>
                        <SelectItem value="COMPOSITE">COMPOSITE</SelectItem>
                      </SelectContent>
                    </Select><FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="formula" render={({ field }) => (
                <FormItem><FormLabel>Formula</FormLabel><FormControl><Textarea rows={3} className="font-mono text-[13px]" placeholder="AVG(total_score)" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="source_table" render={({ field }) => (
                <FormItem><FormLabel>Source Table</FormLabel><FormControl><Input placeholder="ie_fact_qa_scores" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="grid grid-cols-3 gap-4">
                <FormField control={form.control} name="format_type" render={({ field }) => (
                  <FormItem><FormLabel>Format</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {['PERCENT','NUMBER','CURRENCY','DURATION','RATIO'].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select><FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="decimal_places" render={({ field }) => (
                  <FormItem><FormLabel>Decimals</FormLabel><FormControl><Input type="number" min={0} max={6} {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="direction" render={({ field }) => (
                  <FormItem><FormLabel>Direction</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="UP_IS_GOOD">Up is good</SelectItem>
                        <SelectItem value="DOWN_IS_GOOD">Down is good</SelectItem>
                        <SelectItem value="NEUTRAL">Neutral</SelectItem>
                      </SelectContent>
                    </Select><FormMessage />
                  </FormItem>
                )} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="unit_label" render={({ field }) => (
                  <FormItem><FormLabel>Unit Label</FormLabel><FormControl><Input placeholder="%" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="sort_order" render={({ field }) => (
                  <FormItem><FormLabel>Sort Order</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              {editKpi && (
                <FormField control={form.control} name="is_active" render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <div><FormLabel className="text-[13px] font-medium">Active</FormLabel></div>
                    <FormControl>
                      <button type="button" onClick={() => field.onChange(!field.value)}
                        className={`w-10 h-5 rounded-full transition-colors relative ${field.value ? 'bg-primary' : 'bg-slate-300'}`}>
                        <span className={`absolute top-1/2 left-0 h-4 w-4 -translate-y-1/2 rounded-full bg-white shadow transition-transform ${field.value ? 'translate-x-[22px]' : 'translate-x-[2px]'}`} />
                      </button>
                    </FormControl>
                  </FormItem>
                )} />
              )}
              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" className="flex-1" onClick={closeSheet}>Cancel</Button>
                <Button type="submit" className="flex-1" disabled={saveMut.isPending}>
                  {saveMut.isPending ? 'Saving...' : editKpi ? 'Save Changes' : 'Create'}
                </Button>
              </div>
            </form>
          </Form>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function ThresholdSection({ kpiId }: { kpiId: number }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [adding, setAdding] = useState(false)

  const { data: thresholds = [] } = useQuery({ queryKey: ['ie-thresholds', kpiId], queryFn: () => getThresholds(kpiId) })

  const form = useForm<ThresholdForm>({
    resolver: zodResolver(thresholdSchema),
    defaultValues: { effective_from: new Date().toISOString().split('T')[0] },
  })

  const saveMut = useMutation({
    mutationFn: (v: ThresholdForm) => setThreshold(kpiId, v),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ie-thresholds', kpiId] }); toast({ title: 'Threshold saved' }); setAdding(false); form.reset() },
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-700">Thresholds</h4>
        <Button size="sm" variant="outline" className="h-7 text-[12px]" onClick={() => setAdding(!adding)}>
          <Plus size={12} className="mr-1" /> Add Threshold
        </Button>
      </div>
      {thresholds.length === 0 && !adding && (
        <p className="text-[13px] text-muted-foreground">No thresholds configured for this KPI.</p>
      )}
      {thresholds.length > 0 && (
        <Table>
          <TableHeader><TableRow className="bg-white">
            <TableHead className="py-2 text-[12px]">Department</TableHead>
            <TableHead className="py-2 text-[12px]">Goal</TableHead>
            <TableHead className="py-2 text-[12px]">Warning</TableHead>
            <TableHead className="py-2 text-[12px]">Critical</TableHead>
            <TableHead className="py-2 text-[12px]">From</TableHead>
            <TableHead className="py-2 text-[12px]">To</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {thresholds.map((t: IeKpiThreshold) => (
              <TableRow key={t.id}>
                <TableCell className="text-[13px]">{t.department_name ?? 'Global'}</TableCell>
                <TableCell className="text-[13px]">{t.goal_value ?? '—'}</TableCell>
                <TableCell className="text-[13px]">{t.warning_value ?? '—'}</TableCell>
                <TableCell className="text-[13px]">{t.critical_value ?? '—'}</TableCell>
                <TableCell className="text-[13px]">{t.effective_from}</TableCell>
                <TableCell className="text-[13px]">{t.effective_to ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {adding && (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(v => saveMut.mutate(v))} className="bg-white rounded-lg border p-3 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <FormField control={form.control} name="goal_value" render={({ field }) => (
                <FormItem><FormLabel className="text-[12px]">Goal</FormLabel><FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="warning_value" render={({ field }) => (
                <FormItem><FormLabel className="text-[12px]">Warning</FormLabel><FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="critical_value" render={({ field }) => (
                <FormItem><FormLabel className="text-[12px]">Critical</FormLabel><FormControl><Input type="number" step="any" {...field} value={field.value ?? ''} /></FormControl></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="effective_from" render={({ field }) => (
                <FormItem><FormLabel className="text-[12px]">Effective From</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="effective_to" render={({ field }) => (
                <FormItem><FormLabel className="text-[12px]">Effective To</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
              )} />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={saveMut.isPending}>{saveMut.isPending ? 'Saving...' : 'Save'}</Button>
            </div>
          </form>
        </Form>
      )}
    </div>
  )
}

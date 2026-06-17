import { useMemo, useState } from 'react'
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  flexRender, createColumnHelper, type SortingState,
} from '@tanstack/react-table'
import { ChevronUp, ChevronDown, RotateCcw } from 'lucide-react'
import { KpiTile, InsightsSection } from '@/components/insights'
import { Button } from '@/components/ui/button'
import { StagedMultiSelect } from '@/components/common/StagedMultiSelect'
import ActivityReportShell from '@/components/insights/agentActivity/ActivityReportShell'
import CategoryPieChart from '@/components/insights/agentActivity/CategoryPieChart'
import { fmtNum } from '@/components/insights/agentActivity/format'
import { formatKpiValue } from '@/constants/kpiDefs'
import { useKpiConfig } from '@/hooks/useKpiConfig'
import {
  leadKpis, leadCatSourceRows, leadBusinessDaysElapsed,
  LEAD_CATEGORIES, LEAD_SOURCES, DATA_LAST_UPDATED,
  type LeadCatSourceRow,
} from '@/components/insights/agentActivity/placeholderData'

// The conversion-rate column is rendered through the KPI engine's formatter so
// it honors the live `format`/`decimal_places` configured for aa_conversion_rate
// in ie_kpi — keeping it identical to the KPI tile rather than a one-off.
const CONVERSION_RATE_KPI = 'aa_conversion_rate'

const KPI_CODES = [
  'aa_total_leads', 'aa_total_conversions', 'aa_conversion_rate',
  'aa_lead_pace', 'aa_conversion_pace', 'aa_business_days',
] as const

const col = createColumnHelper<LeadCatSourceRow>()
const num = (v: number) => <span className="text-slate-600">{fmtNum(v)}</span>

// The six numeric columns (Total Leads → Conversion Pace) share one equal width.
const NUM_W = '11%'

const DEFAULT_SORTING: SortingState = [{ id: 'totalLeads', desc: true }]

export default function AALeadsPage() {
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [selectedSources, setSelectedSources]       = useState<string[]>([])
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING)

  const isDirty =
    selectedCategories.length > 0 ||
    selectedSources.length > 0 ||
    !(sorting.length === 1 && sorting[0].id === DEFAULT_SORTING[0].id && sorting[0].desc === DEFAULT_SORTING[0].desc)

  const resetView = () => {
    setSelectedCategories([])
    setSelectedSources([])
    setSorting(DEFAULT_SORTING)
  }

  // Live KPI config (format + decimal_places from ie_kpi) so the conversion-rate
  // column matches the KPI tile and any admin edits to the metric.
  const { data: liveConfig } = useKpiConfig()
  const pctDecimals = liveConfig?.[CONVERSION_RATE_KPI]?.decimal_places ?? 1

  const columns = useMemo(() => [
    col.accessor('category', { header: 'Lead Category', cell: i => <span className="text-slate-600">{i.getValue()}</span>, meta: { width: '18%' } }),
    col.accessor('source',   { header: 'Lead Source',   cell: i => <span className="text-slate-600">{i.getValue()}</span>, meta: { width: '16%' } }),
    col.accessor('totalLeads',     { header: 'Total Leads',           cell: i => num(i.getValue()), meta: { align: 'right', width: NUM_W } }),
    col.accessor('conversions',    { header: 'Conversions',           cell: i => num(i.getValue()), meta: { align: 'right', width: NUM_W } }),
    col.accessor('pctConverted',   { header: '% Converted',           cell: i => <span className="text-slate-600">{formatKpiValue(i.getValue(), 'PERCENT', pctDecimals)}</span>, meta: { align: 'right', width: NUM_W } }),
    col.accessor('bizDaysElapsed', { header: 'Business Days Elapsed', cell: i => num(i.getValue()), enableSorting: false, meta: { align: 'right', width: NUM_W } }),
    col.accessor('leadPace',       { header: 'Lead Pace',             cell: i => num(i.getValue()), meta: { align: 'right', width: NUM_W } }),
    col.accessor('conversionPace', { header: 'Conversion Pace',       cell: i => num(i.getValue()), meta: { align: 'right', width: NUM_W } }),
  ], [pctDecimals])

  const filtered = useMemo(() => leadCatSourceRows.filter(r =>
    (selectedCategories.length === 0 || selectedCategories.includes(r.category)) &&
    (selectedSources.length === 0    || selectedSources.includes(r.source)),
  ), [selectedCategories, selectedSources])

  const leadsBySource = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of filtered) m.set(r.source, (m.get(r.source) ?? 0) + r.totalLeads)
    return [...m.entries()].map(([name, value]) => ({ name, value }))
  }, [filtered])

  const conversionsBySource = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of filtered) m.set(r.source, (m.get(r.source) ?? 0) + r.conversions)
    return [...m.entries()].map(([name, value]) => ({ name, value }))
  }, [filtered])

  const table = useReactTable({
    data: filtered, columns,
    state: { sorting }, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
  })

  return (
    <ActivityReportShell
      title="Leads"
      description="Leads, conversions, and pace by category and source."
      businessDays={leadBusinessDaysElapsed}
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {KPI_CODES.map(code => (
          <KpiTile key={code} kpiCode={code} value={leadKpis[code] ?? null} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <InsightsSection title="Leads by Source" lastUpdated={DATA_LAST_UPDATED} className="mb-0">
          <CategoryPieChart data={leadsBySource} unit="leads" />
        </InsightsSection>
        <InsightsSection title="Conversions by Lead Source" lastUpdated={DATA_LAST_UPDATED} className="mb-0">
          <CategoryPieChart data={conversionsBySource} unit="conversions" />
        </InsightsSection>
      </div>

      <InsightsSection title="Lead Conversions by Category and Lead Source" lastUpdated={DATA_LAST_UPDATED}>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-xs font-medium text-slate-500">Filter:</span>
          <StagedMultiSelect
            options={LEAD_CATEGORIES}
            selected={selectedCategories}
            onApply={setSelectedCategories}
            placeholder="All Lead Categories"
            width="w-[200px]"
          />
          <StagedMultiSelect
            options={LEAD_SOURCES}
            selected={selectedSources}
            onApply={setSelectedSources}
            placeholder="All Lead Sources"
            width="w-[200px]"
          />
          {isDirty && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetView}
              className="ml-auto h-9 text-[13px] text-slate-500 hover:text-slate-800"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Reset
            </Button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px] table-fixed">
            <thead>
              {table.getHeaderGroups().map(hg => (
                <tr key={hg.id} className="border-b-2 border-slate-200">
                  {hg.headers.map(header => {
                    const meta = header.column.columnDef.meta as { align?: string; width?: string } | undefined
                    const align = meta?.align
                    const canSort = header.column.getCanSort()
                    return (
                      <th
                        key={header.id}
                        style={meta?.width ? { width: meta.width } : undefined}
                        className={`pb-2.5 pr-4 text-xs font-semibold text-slate-400 select-none ${canSort ? 'cursor-pointer' : ''} ${align === 'right' ? 'text-right' : 'text-left'}`}
                        onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                      >
                        <span className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getIsSorted() === 'asc'  && <ChevronUp size={12} />}
                          {header.column.getIsSorted() === 'desc' && <ChevronDown size={12} />}
                        </span>
                      </th>
                    )
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map(row => (
                <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  {row.getVisibleCells().map(cell => {
                    const align = (cell.column.columnDef.meta as { align?: string } | undefined)?.align
                    return (
                      <td key={cell.id} className={`py-2.5 pr-4 ${align === 'right' ? 'text-right' : ''}`}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    )
                  })}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={columns.length} className="py-8 text-center text-sm text-slate-400">No rows match the selected filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </InsightsSection>
    </ActivityReportShell>
  )
}

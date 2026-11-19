/**
 * Bucket-oriented panels for Insights → Agent Activity - CSR → Call Length.
 *
 * Split out of the page so it stays layout + data-fetch only (200-300 line
 * rule), mirroring how CampaignTouchPanels backs the Campaign × Touch report.
 *
 * The pair below is the core of the report: `BandTotalsChart` shows where the
 * CALLS are, `BandTimeSplit` shows where the HOURS are, and the gap between
 * them is the finding — a small tail of long calls carries a
 * disproportionate share of total handle time.
 */
import { ResponsiveContainer, BarChart, Bar, Cell, LabelList, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts'
import { bandStyle, visibleWrapSeries, AXIS_TICK, TOOLTIP_STYLE } from './bandStyle'
import { fmtNum } from '@/components/insights/agentActivity/format'
import type { BandTotal, DeptBandRow } from '@/types/callLength'

/** Calls per bucket, with the share of calls vs share of time called out. */
export function BandTotalsChart({ bandTotals }: { bandTotals: BandTotal[] }) {
  return (
    <>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={bandTotals} margin={{ top: 16, right: 8, bottom: 4, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="label" tick={{ ...AXIS_TICK, dy: 6 }} tickLine={false} axisLine={false} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: '#64748b', fontSize: 10 }}
            formatter={(v: number) => [fmtNum(v), 'Calls']}
          />
          <Bar dataKey="calls" radius={[3, 3, 0, 0]}>
            {bandTotals.map(b => {
              const s = bandStyle(b.key)
              return <Cell key={b.key} fill={s.fill} fillOpacity={s.fillOpacity} />
            })}
            <LabelList
              dataKey="calls" position="top"
              formatter={(v: number) => fmtNum(v)}
              style={{ fontSize: 10, fill: '#475569', fontWeight: 600 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Share of calls against share of handle hours, bucket by bucket. The
          divergence between the two numbers is the whole point of the report. */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {bandTotals.map(b => (
          <div key={b.key} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: bandStyle(b.key).fill, opacity: bandStyle(b.key).fillOpacity }}
              />
              <span className="truncate text-[10px] uppercase tracking-wide text-slate-400">{b.label}</span>
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{b.pctCalls}%</div>
            <div className="text-[10px] text-slate-400">of calls</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{b.pctTime}%</div>
            <div className="text-[10px] text-slate-400">of handle time</div>
            <div className="mt-1 text-[10px] text-slate-500">{b.handleHours} hrs · {b.avgMin} min avg</div>
          </div>
        ))}
      </div>
    </>
  )
}

/**
 * Handle hours per bucket, with after-call work broken out as its own bar
 * rather than folded into the total. After-call work responds to a completely
 * different fix than talk time does, so the two are shown side by side per
 * bucket: a bucket where the amber bar is a large slice of the blue one is one
 * where after-call work, not the customer, is the cost. The amber bar stacks
 * wrap, wrap extended and wrap pending; parts with no time in the period are
 * left out, and the label is their total.
 *
 * Bucket identity comes from the Y axis here instead of colour, because the
 * series need their own colours for the legend to mean anything.
 */
const TOTAL_FILL = '#00aeef'

export function BandTimeSplit({ bandTotals }: { bandTotals: BandTotal[] }) {
  const wrapParts = visibleWrapSeries(bandTotals)
  const data = bandTotals.map(b => ({
    ...b,
    wrapTotalHours: Math.round((b.wrapHours + b.wrapExtendedHours + b.wrapPendingHours) * 10) / 10,
  }))
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 24 }} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
        <XAxis
          type="number" tick={AXIS_TICK} tickLine={false} axisLine={false}
          tickFormatter={(v: number) => `${v}h`}
        />
        <YAxis
          type="category" dataKey="label" width={78}
          tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: '#64748b', fontSize: 10 }}
          formatter={(v: number, name: string) => [`${v} hrs`, name]}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="handleHours" name="Total handle" fill={TOTAL_FILL} radius={[0, 3, 3, 0]}>
          <LabelList
            dataKey="handleHours" position="right"
            formatter={(v: number) => `${v}h`}
            style={{ fontSize: 10, fill: '#475569', fontWeight: 600 }}
          />
        </Bar>
        {wrapParts.map((s, i) => {
          const last = i === wrapParts.length - 1
          return (
            <Bar
              key={s.key} dataKey={s.key} name={s.label} stackId="wrap"
              fill={s.fill} fillOpacity={s.fillOpacity} radius={last ? [0, 3, 3, 0] : 0}
            >
              {last && (
                <LabelList
                  dataKey="wrapTotalHours" position="right"
                  formatter={(v: number) => `${v}h`}
                  style={{ fontSize: 10, fill: '#475569', fontWeight: 600 }}
                />
              )}
            </Bar>
          )
        })}
      </BarChart>
    </ResponsiveContainer>
  )
}

/**
 * Bucket mix per department, normalised to 100% so departments of very
 * different size can be compared on SHAPE. Raw counts are in the table below;
 * here the question is "how much of this team's work runs long", which absolute
 * bars can't answer when one team takes 5x the volume.
 */
export function DeptBandMixChart({ byDept, bands }: { byDept: DeptBandRow[]; bands: { key: string; label: string }[] }) {
  const data = byDept.map(d => {
    const row: Record<string, string | number> = { department: d.department }
    for (const b of bands) row[b.key] = d.calls ? (d.bands[b.key] ?? 0) / d.calls * 100 : 0
    return row
  })

  return (
    <ResponsiveContainer width="100%" height={Math.max(140, byDept.length * 46 + 40)}>
      <BarChart data={data} layout="vertical" stackOffset="expand" margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
        <XAxis
          type="number" tick={AXIS_TICK} tickLine={false} axisLine={false}
          tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
        />
        <YAxis
          type="category" dataKey="department" width={112}
          tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(v: number, name: string) => [`${v.toFixed(1)}%`, name]}
        />
        {bands.map(b => {
          const s = bandStyle(b.key)
          return (
            <Bar key={b.key} dataKey={b.key} name={b.label} stackId="mix" fill={s.fill} fillOpacity={s.fillOpacity} />
          )
        })}
      </BarChart>
    </ResponsiveContainer>
  )
}

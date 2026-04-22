import { Building2, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { USER_ROLES } from '@/constants/roles'
import { getKpiDef, getKpiScope } from '@/constants/kpiDefs'
import { useKpiConfig, resolveThresholds } from '@/hooks/useKpiConfig'

interface KpiInfoCardProps {
  kpiCode: string
  /** Optional KPI display name override; defaults to catalog name. */
  displayName?: string
}

/**
 * Detailed KPI reference card. Used inside the (i) popover on KpiTile and
 * anywhere else we want to surface "what is this KPI?".
 *
 * Description / formula / source are read from the live ie_kpi row (via
 * /insights/kpi-config). The kpiDefs.ts overlay is used only as a fallback
 * when the DB row has no value, so a single edit on the admin KPI page
 * propagates everywhere.
 *
 * Agent role:    name + description only.
 * Manager/Admin: name + description + formula + source + live thresholds + Manage link.
 */
export default function KpiInfoCard({ kpiCode, displayName }: KpiInfoCardProps) {
  const { user } = useAuth()
  const def = getKpiDef(kpiCode)
  const scope = getKpiScope(kpiCode)
  const { data: liveConfig } = useKpiConfig()

  const isAdminOrManager =
    user?.role_id === USER_ROLES.ADMIN || user?.role_id === USER_ROLES.MANAGER

  const live        = liveConfig?.[kpiCode]
  const name        = displayName ?? live?.name ?? def?.name ?? kpiCode
  const description = live?.description ?? def?.description
  const formula     = live?.formula     ?? def?.formulaPlain
  const source      = live?.source      ?? def?.source
  const thresholds  = resolveThresholds(kpiCode, liveConfig)

  const showFilterNote = scope === 'non_filtered' || scope === 'mixed'

  return (
    <div className="space-y-3 text-left">
      <div>
        <p className="text-[13px] font-semibold text-slate-900 leading-tight">{name}</p>
        <p className="text-[11px] font-mono text-slate-400 mt-0.5">{kpiCode}</p>
      </div>

      {description && (
        <p className="text-[12.5px] text-slate-600 leading-relaxed">{description}</p>
      )}

      {showFilterNote && (
        <div className="flex gap-1.5 items-start text-[11.5px] text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5">
          <Building2 className="h-3.5 w-3.5 text-slate-400 mt-0.5 shrink-0" />
          <span>
            <span className="font-medium text-slate-700">Non-Filtered KPI.</span>{' '}
            {scope === 'mixed'
              ? 'Part of this metric is calculated across all departments and does not change with your current filter.'
              : 'This metric is calculated across all departments and does not change with your current filter.'}
            {' '}
            When a Department or Form filter is active, this KPI shows a dash to avoid a misleading number.
          </span>
        </div>
      )}

      {isAdminOrManager && (
        <div className="space-y-2.5 pt-2 border-t border-slate-100">
          {formula && (
            <Row label="Formula">
              <span className="font-mono text-[11px] text-slate-600">{formula}</span>
            </Row>
          )}
          {source && (
            <Row label="Source">
              <span className="text-[11.5px] text-slate-600">{source}</span>
            </Row>
          )}
          {(thresholds.goal !== null || thresholds.warn !== null || thresholds.crit !== null) && (
            <Row label="Thresholds">
              <span className="text-[11.5px] text-slate-600">
                {thresholds.goal !== null && <>Goal {thresholds.goal}</>}
                {thresholds.warn !== null && <>{' · '}Warn {thresholds.warn}</>}
                {thresholds.crit !== null && <>{' · '}Crit {thresholds.crit}</>}
              </span>
            </Row>
          )}
          <div className="pt-1">
            <Link
              to="/app/admin/insights/kpis"
              className="inline-flex items-center gap-1 text-[11.5px] text-primary hover:underline"
            >
              Manage in KPI registry <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[10px] uppercase tracking-wide text-slate-400 w-[88px] shrink-0 whitespace-nowrap">
        {label}
      </span>
      <div className="flex-1 min-w-0 break-words">{children}</div>
    </div>
  )
}

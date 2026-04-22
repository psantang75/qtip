import pool from '../config/database'
import { RowDataPacket } from 'mysql2'
import type { PeriodRanges } from '../utils/periodUtils'
import { fmtDatetime as fmt } from '../utils/dateHelpers'
import { deptClause } from './qcQueryHelpers'

// ── Warnings page ─────────────────────────────────────────────────────────────

export async function getWriteUpPipeline(deptFilter: number[], ranges: PeriodRanges) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter)
  const dp = dc.params

  const [[statusRows], [typeRows], [statsRows]] = await Promise.all([
    pool.execute<RowDataPacket[]>(
      `SELECT wu.status, COUNT(*) AS count FROM write_ups wu
       JOIN users csr ON wu.csr_id = csr.id
       WHERE wu.created_at BETWEEN ? AND ? ${dc.sql} GROUP BY wu.status`,
      [s, e, ...dp],
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT wu.document_type AS type, COUNT(*) AS count FROM write_ups wu
       JOIN users csr ON wu.csr_id = csr.id
       WHERE wu.created_at BETWEEN ? AND ? ${dc.sql} GROUP BY wu.document_type`,
      [s, e, ...dp],
    ),
    pool.execute<RowDataPacket[]>(
      `SELECT
         AVG(CASE WHEN wu.status = 'CLOSED' THEN DATEDIFF(wu.closed_at, wu.created_at) END) AS avgDaysToClose,
         SUM(CASE WHEN wu.follow_up_required = 1 AND wu.status NOT IN ('CLOSED') THEN 1 ELSE 0 END) AS pendingFollowUps,
         SUM(CASE WHEN wu.follow_up_required = 1 AND wu.follow_up_date < CURDATE()
               AND wu.status NOT IN ('CLOSED') THEN 1 ELSE 0 END) AS overdueFollowUps
       FROM write_ups wu JOIN users csr ON wu.csr_id = csr.id
       WHERE wu.created_at BETWEEN ? AND ? ${dc.sql}`,
      [s, e, ...dp],
    ),
  ])

  const byStatus: Record<string, number> = {}
  for (const r of statusRows) byStatus[r.status] = parseInt(r.count, 10)
  const byType: Record<string, number> = {}
  for (const r of typeRows) byType[r.type] = parseInt(r.count, 10)
  const st = statsRows[0] ?? {}

  return {
    byStatus,
    byType,
    total:           Object.values(byStatus).reduce((a, b) => a + b, 0),
    avgDaysToClose:  st.avgDaysToClose != null ? parseFloat(st.avgDaysToClose) : null,
    pendingFollowUps:  parseInt(st.pendingFollowUps ?? '0', 10),
    overdueFollowUps:  parseInt(st.overdueFollowUps ?? '0', 10),
  }
}

export async function getActiveWriteUps(deptFilter: number[], ranges: PeriodRanges) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter)
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT wu.id, u.id AS userId, u.username AS agent,
       COALESCE(d.department_name,'Unknown') AS dept,
       wu.document_type AS type, wu.status,
       DATE_FORMAT(wu.created_at,'%Y-%m-%d') AS date,
       DATE_FORMAT(wu.meeting_date,'%Y-%m-%d') AS meetingDate,
       DATE_FORMAT(wu.follow_up_date,'%Y-%m-%d') AS followUpDate,
       COUNT(DISTINCT wupd.id) AS priorCount,
       GROUP_CONCAT(DISTINCT wv.policy_violated ORDER BY wv.policy_violated SEPARATOR '||') AS policies
     FROM write_ups wu
     JOIN users u ON wu.csr_id = u.id
     LEFT JOIN departments d ON u.department_id = d.id
     LEFT JOIN write_up_prior_discipline wupd ON wupd.write_up_id = wu.id
     LEFT JOIN write_up_incidents wi ON wi.write_up_id = wu.id
     LEFT JOIN write_up_violations wv ON wv.incident_id = wi.id
     WHERE wu.created_at BETWEEN ? AND ?
       AND wu.status NOT IN ('CLOSED') ${dc.sql}
     GROUP BY wu.id, u.id, d.department_name, wu.document_type, wu.status, wu.created_at, wu.meeting_date, wu.follow_up_date
     ORDER BY wu.created_at DESC LIMIT 50`,
    [s, e, ...dc.params],
  )
  return rows.map(r => ({
    id:          r.id as number,
    userId:      r.userId as number,
    agent:       r.agent as string,
    dept:        r.dept as string,
    type:        r.type as string,
    status:      r.status as string,
    date:        r.date as string,
    meetingDate: r.meetingDate as string | null,
    followUpDate: r.followUpDate as string | null,
    priorCount:  parseInt(r.priorCount ?? '0', 10),
    policies:    r.policies ? (r.policies as string).split('||') : [],
  }))
}

export async function getEscalationData(deptFilter: number[], ranges: PeriodRanges) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter)
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT wu.document_type AS type, COUNT(*) AS count
     FROM write_ups wu JOIN users csr ON wu.csr_id = csr.id
     WHERE wu.created_at BETWEEN ? AND ? ${dc.sql}
     GROUP BY wu.document_type`,
    [s, e, ...dc.params],
  )
  const map: Record<string, number> = {}
  for (const r of rows) map[r.type] = parseInt(r.count, 10)
  return {
    verbal:  map['VERBAL_WARNING']  ?? 0,
    written: map['WRITTEN_WARNING'] ?? 0,
    final:   map['FINAL_WARNING']   ?? 0,
  }
}

// Step-Up data: how many write-ups in the period represent an escalation from
// a lower tier the agent already held in the trailing 12 months. We count
// distinct write-ups (not agents) so a single agent who escalated twice
// (verbal -> written -> final) is reflected as two step-ups.
async function countStepUps(deptFilter: number[], range: { start: Date; end: Date }) {
  const s = fmt(range.start), e = fmt(range.end)
  const dc = deptClause(deptFilter)
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN curr.document_type = 'WRITTEN_WARNING'
                 AND curr.prev_tier      = 'VERBAL_WARNING' THEN 1 ELSE 0 END) AS verbal_to_written,
       SUM(CASE WHEN curr.document_type = 'FINAL_WARNING'
                 AND curr.prev_tier IN ('VERBAL_WARNING','WRITTEN_WARNING') THEN 1 ELSE 0 END) AS written_to_final,
       COUNT(DISTINCT CASE
                        WHEN (curr.document_type = 'WRITTEN_WARNING' AND curr.prev_tier = 'VERBAL_WARNING')
                          OR (curr.document_type = 'FINAL_WARNING'   AND curr.prev_tier IN ('VERBAL_WARNING','WRITTEN_WARNING'))
                        THEN curr.csr_id END) AS distinct_agents_stepped_up
     FROM (
       SELECT wu.csr_id, wu.document_type,
         (SELECT prev.document_type FROM write_ups prev
            WHERE prev.csr_id = wu.csr_id
              AND prev.created_at < wu.created_at
              AND prev.created_at >= DATE_SUB(wu.created_at, INTERVAL 12 MONTH)
            ORDER BY prev.created_at DESC LIMIT 1) AS prev_tier
       FROM write_ups wu
       JOIN users csr ON wu.csr_id = csr.id
       WHERE wu.created_at BETWEEN ? AND ? ${dc.sql}
     ) curr`,
    [s, e, ...dc.params],
  )
  const r = rows[0] ?? {}
  return {
    verbalToWritten:  parseInt(r.verbal_to_written ?? '0', 10),
    writtenToFinal:   parseInt(r.written_to_final  ?? '0', 10),
    distinctAgents:   parseInt(r.distinct_agents_stepped_up ?? '0', 10),
  }
}

export async function getStepUpData(deptFilter: number[], ranges: PeriodRanges) {
  const [current, prior] = await Promise.all([
    countStepUps(deptFilter, ranges.current),
    countStepUps(deptFilter, ranges.prior),
  ])
  return { current, prior }
}

// Repeat warning agents: agents who received >=2 write-ups within the selected
// period, with their system-derived prior counts (90 days and 12 months
// preceding the start of the selected period) for trend context.
//
// Note: HAVING COUNT(*) >= 2 (rather than the column alias) keeps the query
// portable across MySQL sql_modes. latestType/latestStatus use
// SUBSTRING_INDEX(GROUP_CONCAT(... ORDER BY created_at DESC), ',', 1) so they
// reflect the chronologically-latest in-period write-up rather than the
// alphabetically-largest enum value.
export async function getRepeatWarningAgents(deptFilter: number[], ranges: PeriodRanges) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter, 'u')
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT u.id AS userId, u.username AS agent,
       COALESCE(d.department_name,'Unknown') AS dept,
       COUNT(*) AS inPeriod,
       (SELECT COUNT(*) FROM write_ups w90
          WHERE w90.csr_id = u.id
            AND w90.created_at >= DATE_SUB(?, INTERVAL 90 DAY)
            AND w90.created_at <  ?) AS prior90d,
       (SELECT COUNT(*) FROM write_ups w12
          WHERE w12.csr_id = u.id
            AND w12.created_at >= DATE_SUB(?, INTERVAL 12 MONTH)
            AND w12.created_at <  ?) AS prior12mo,
       SUBSTRING_INDEX(GROUP_CONCAT(wu.document_type ORDER BY wu.created_at DESC), ',', 1) AS latestType,
       SUBSTRING_INDEX(GROUP_CONCAT(wu.status        ORDER BY wu.created_at DESC), ',', 1) AS latestStatus
     FROM write_ups wu
     JOIN users u ON wu.csr_id = u.id
     LEFT JOIN departments d ON u.department_id = d.id
     WHERE wu.created_at BETWEEN ? AND ? ${dc.sql}
     GROUP BY u.id, u.username, d.department_name
     HAVING COUNT(*) >= 2
     ORDER BY inPeriod DESC, prior12mo DESC, agent ASC
     LIMIT 100`,
    [s, s, s, s, s, e, ...dc.params],
  )
  return rows.map(r => ({
    userId:     r.userId as number,
    agent:      r.agent  as string,
    dept:       r.dept   as string,
    inPeriod:   parseInt(r.inPeriod  ?? '0', 10),
    prior90d:   parseInt(r.prior90d  ?? '0', 10),
    prior12mo:  parseInt(r.prior12mo ?? '0', 10),
    latestType:   r.latestType   as string | null,
    latestStatus: r.latestStatus as string | null,
  }))
}

// Distinct-agent count of agents currently sitting on a Final Warning issued
// in the period. Used by the Escalation Path stat row so it reflects PEOPLE
// rather than write-up rows.
export async function getAgentsOnFinalWarning(deptFilter: number[], ranges: PeriodRanges) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter)
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT wu.csr_id) AS value
     FROM write_ups wu JOIN users csr ON wu.csr_id = csr.id
     WHERE wu.document_type = 'FINAL_WARNING'
       AND wu.created_at BETWEEN ? AND ? ${dc.sql}`,
    [s, e, ...dc.params],
  )
  return parseInt(rows[0]?.value ?? '0', 10)
}

// Most violated policies (top 10) for the selected period.
//
// The unit of "count" is **distinct write-ups citing the policy** — i.e.
// `COUNT(DISTINCT wu.id)`. This is the natural HR semantic ("how many
// write-ups cited Tardiness this period") and prevents inflation when a
// single write-up records the same policy across multiple incidents or
// violation rows.
//
// The per-agent breakdown uses the same unit, so the policy-level count
// equals the sum of `violations` across the listed agents. The latest
// document_type / status for each (policy, agent) pair is taken from the
// most-recent in-period write-up.
export async function getPolicyViolations(deptFilter: number[], ranges: PeriodRanges) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter)

  const [policyRows] = await pool.execute<RowDataPacket[]>(
    `SELECT wv.policy_violated AS policy,
       COUNT(DISTINCT wu.id)      AS count,
       COUNT(DISTINCT wu.csr_id)  AS agentCount
     FROM write_up_violations wv
     JOIN write_up_incidents wi ON wv.incident_id = wi.id
     JOIN write_ups wu ON wi.write_up_id = wu.id
     JOIN users u ON wu.csr_id = u.id
     WHERE wu.created_at BETWEEN ? AND ? ${dc.sql}
     GROUP BY wv.policy_violated
     ORDER BY count DESC, agentCount DESC, policy ASC
     LIMIT 10`,
    [s, e, ...dc.params],
  )
  if (policyRows.length === 0) return []

  const policies = policyRows.map(r => r.policy as string)
  const ph       = policies.map(() => '?').join(',')
  const [agentRows] = await pool.execute<RowDataPacket[]>(
    `SELECT wv.policy_violated AS policy, u.id AS userId, u.username AS name,
       COALESCE(d.department_name,'Unknown') AS dept,
       COUNT(DISTINCT wu.id) AS violations,
       SUBSTRING_INDEX(GROUP_CONCAT(wu.document_type ORDER BY wu.created_at DESC), ',', 1) AS type,
       SUBSTRING_INDEX(GROUP_CONCAT(wu.status        ORDER BY wu.created_at DESC), ',', 1) AS status
     FROM write_up_violations wv
     JOIN write_up_incidents wi ON wv.incident_id = wi.id
     JOIN write_ups wu ON wi.write_up_id = wu.id
     JOIN users u ON wu.csr_id = u.id
     LEFT JOIN departments d ON u.department_id = d.id
     WHERE wv.policy_violated IN (${ph}) AND wu.created_at BETWEEN ? AND ?
     GROUP BY wv.policy_violated, u.id, u.username, d.department_name
     ORDER BY wv.policy_violated, violations DESC, u.username`,
    [...policies, s, e],
  )

  type AgentRow = { userId: number; name: string; dept: string; violations: number; type: string; status: string }
  const agentMap = new Map<string, AgentRow[]>()
  for (const ar of agentRows) {
    const list = agentMap.get(ar.policy as string) ?? []
    list.push({
      userId:     ar.userId as number,
      name:       ar.name   as string,
      dept:       ar.dept   as string,
      violations: parseInt(ar.violations ?? '0', 10),
      type:       ar.type   as string,
      status:     ar.status as string,
    })
    agentMap.set(ar.policy as string, list)
  }

  return policyRows.map(r => ({
    policy:       r.policy as string,
    count:        parseInt(r.count, 10),
    agentCount:   parseInt(r.agentCount, 10),
    agentDetails: agentMap.get(r.policy as string) ?? [],
  }))
}

export async function getWarningsDeptComparison(ranges: PeriodRanges) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT d.department_name AS dept,
       COUNT(wu.id) AS writeups,
       SUM(CASE WHEN wu.status = 'CLOSED' THEN 1 ELSE 0 END) AS closed
     FROM departments d
     JOIN users u ON u.department_id = d.id
     LEFT JOIN write_ups wu ON wu.csr_id = u.id AND wu.created_at BETWEEN ? AND ?
     WHERE u.role_id = 3
     GROUP BY d.id, d.department_name ORDER BY writeups DESC`,
    [s, e],
  )
  return rows.map(r => ({
    dept: r.dept,
    writeups: parseInt(r.writeups, 10),
    closed: parseInt(r.closed ?? '0', 10),
    resolutionRate: r.writeups > 0 ? Math.round((r.closed / r.writeups) * 1000) / 10 : 0,
  }))
}

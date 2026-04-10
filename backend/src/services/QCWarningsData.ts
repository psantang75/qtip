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

export async function getPolicyViolations(deptFilter: number[], ranges: PeriodRanges) {
  const s = fmt(ranges.current.start), e = fmt(ranges.current.end)
  const dc = deptClause(deptFilter)

  const [policyRows] = await pool.execute<RowDataPacket[]>(
    `SELECT wv.policy_violated AS policy, COUNT(*) AS count,
       COUNT(DISTINCT wu.csr_id) AS agentCount
     FROM write_up_violations wv
     JOIN write_up_incidents wi ON wv.incident_id = wi.id
     JOIN write_ups wu ON wi.write_up_id = wu.id
     JOIN users u ON wu.csr_id = u.id
     WHERE wu.created_at BETWEEN ? AND ? ${dc.sql}
     GROUP BY wv.policy_violated ORDER BY count DESC LIMIT 10`,
    [s, e, ...dc.params],
  )
  if (policyRows.length === 0) return []

  const policies = policyRows.map(r => r.policy as string)
  const ph       = policies.map(() => '?').join(',')
  const [agentRows] = await pool.execute<RowDataPacket[]>(
    `SELECT DISTINCT wv.policy_violated AS policy, u.id AS userId, u.username AS name,
       COALESCE(d.department_name,'Unknown') AS dept,
       wu.document_type AS type, wu.status
     FROM write_up_violations wv
     JOIN write_up_incidents wi ON wv.incident_id = wi.id
     JOIN write_ups wu ON wi.write_up_id = wu.id
     JOIN users u ON wu.csr_id = u.id
     LEFT JOIN departments d ON u.department_id = d.id
     WHERE wv.policy_violated IN (${ph}) AND wu.created_at BETWEEN ? AND ?
     ORDER BY wv.policy_violated, u.username`,
    [...policies, s, e],
  )

  const agentMap = new Map<string, Array<{ userId: number; name: string; dept: string; type: string; status: string }>>()
  for (const ar of agentRows) {
    const list = agentMap.get(ar.policy as string) ?? []
    if (!list.some(a => a.userId === ar.userId)) {
      list.push({ userId: ar.userId as number, name: ar.name as string, dept: ar.dept as string, type: ar.type as string, status: ar.status as string })
    }
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

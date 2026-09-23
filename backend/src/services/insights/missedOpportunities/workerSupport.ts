import pool from '../../../config/database';
import type { RowDataPacket } from 'mysql2';
import prisma from '../../../config/prisma';
import type { AnalyzedFinding, CallCandidate } from './types';

export interface PendingFinding extends AnalyzedFinding {
  candidate: CallCandidate;
  employeeKey: number | null;
}

/**
 * Replace the day's findings in one transaction. Delete-then-insert rather
 * than an upsert because the natural key is the finding itself (which rule
 * fired on which call) and the model may legitimately return a different
 * count on a re-run after a rule edit.
 */
export async function replaceFindings(runDate: string, findings: PendingFinding[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.ieMissedOpportunityFinding.deleteMany({ where: { run_date: new Date(runDate) } });
    if (findings.length === 0) return;
    await tx.ieMissedOpportunityFinding.createMany({
      data: findings.map((f) => ({
        date_key: f.candidate.dateKey,
        run_date: new Date(runDate),
        employee_key: f.employeeKey,
        agent_email: f.candidate.agentEmail,
        agent_name: f.candidate.agentName,
        conversation_id: f.candidate.conversationId,
        call_started_at: f.candidate.startedAt,
        talk_secs: f.candidate.talkSecs,
        direction: f.candidate.direction,
        customer_name: f.customerName ?? f.candidate.remoteParty,
        crm_task_kind: f.crmRefKind,
        crm_task_id: f.crmRefId,
        rule_key: f.ruleKey,
        severity: f.severity,
        title: f.title,
        what_happened: f.whatHappened,
        evidence_quote: f.evidenceQuote,
        evidence_speaker: f.evidenceSpeaker,
        recommended_approach: f.recommendedApproach,
        recovery_action: f.recoveryAction,
        est_value_note: f.estValueNote,
      })),
    });
  });
}

/** Upsert the run row. Called repeatedly through a run to keep it current. */
export async function recordRun(
  runDate: string,
  patch: {
    status: 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED';
    callsConsidered?: number;
    callsAnalyzed?: number;
    callsFailed?: number;
    callsSkipped?: number;
    findingsCount?: number;
    tokensIn?: number;
    tokensOut?: number;
    usdCost?: number;
    modelUsed?: string | null;
    errorText?: string | null;
    finishedAt?: Date | null;
  },
): Promise<void> {
  const data = {
    status: patch.status,
    calls_considered: patch.callsConsidered ?? 0,
    calls_analyzed: patch.callsAnalyzed ?? 0,
    calls_failed: patch.callsFailed ?? 0,
    calls_skipped: patch.callsSkipped ?? 0,
    findings_count: patch.findingsCount ?? 0,
    tokens_in: patch.tokensIn ?? 0,
    tokens_out: patch.tokensOut ?? 0,
    usd_cost: Math.round((patch.usdCost ?? 0) * 10000) / 10000,
    model_used: patch.modelUsed ?? null,
    error_text: patch.errorText?.slice(0, 500) ?? null,
    finished_at: patch.finishedAt ?? null,
  };
  await prisma.ieMissedOpportunityRun.upsert({
    where: { run_date: new Date(runDate) },
    create: { run_date: new Date(runDate), started_at: new Date(), ...data },
    update: data,
  });
}

/**
 * The most recent business day before today, per `ie_dim_date.is_business_day`
 * (which already carries the company holiday calendar). Falls back to
 * yesterday when the dimension has no row for the window, so a gap in the
 * date seed degrades to "yesterday" rather than skipping the run.
 *
 * The DATE is formatted in SQL rather than returned as a value. The primary
 * pool is configured `timezone: 'Z'`, so mysql2 hydrates a DATE column as UTC
 * midnight; reading that back with local getters under the process timezone
 * (America/New_York, pinned in config/timezone.ts) lands on the previous
 * calendar day. That shifted every scheduled run one business day early —
 * grading Thursday on Monday, and resolving Sunday on Tuesday, where the
 * absence of calls silently produced an empty run. Keeping the value a string
 * end-to-end means no timezone is ever applied to it.
 */
export async function resolvePriorBusinessDay(now: Date = new Date()): Promise<string> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(full_date, '%Y-%m-%d') AS business_day FROM ie_dim_date
      WHERE full_date < CURDATE() AND is_business_day = 1
      ORDER BY full_date DESC LIMIT 1`,
  );
  const value = rows[0]?.business_day;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const fallback = new Date(now);
  fallback.setDate(fallback.getDate() - 1);
  return toIsoDate(fallback);
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Map agent email to `employee_key` so findings join `ie_dim_employee` like
 * every other Insights fact. Email is the conformed key between the phone
 * system and the QTIP user table; a missing match leaves the column null and
 * the report falls back to `agent_name`.
 */
export async function resolveEmployeeKeys(candidates: CallCandidate[]): Promise<Map<string, number>> {
  const emails = Array.from(
    new Set(candidates.map((c) => c.agentEmail?.toLowerCase()).filter((e): e is string => !!e)),
  );
  if (emails.length === 0) return new Map();
  const placeholders = emails.map(() => '?').join(',');
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT employee_key, LOWER(email) AS email FROM ie_dim_employee
      WHERE is_current = 1 AND LOWER(email) IN (${placeholders})`,
    emails,
  );
  return new Map(rows.map((r) => [String(r.email), Number(r.employee_key)]));
}

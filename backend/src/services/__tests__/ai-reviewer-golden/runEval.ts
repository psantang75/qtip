/**
 * Golden eval runner for the AI Reviewer.
 *
 * Pure function used by both the vitest regression suite and the CLI tool
 * (backend/scripts/ai-eval.ts). Loads the golden ticket set, runs each
 * ticket through aiReviewerService.analyzeTicket(...) per requested
 * provider, and compares the produced answers against the ground-truth
 * 'expected' object on each record.
 *
 * Records with `expected: null` are treated as "unscored" — the model is
 * still run (so we capture latency / KB choice / narrative) but no
 * agreement is computed. This lets us seed the file before a human grader
 * has filled in answers, without breaking the eval gate.
 *
 * NEVER writes a submission. analyzeTicket() is the side-effect-free API.
 */

import * as fs from 'fs';
import * as path from 'path';
import aiReviewerService, {
  type AiProvider,
  type AIAnalysisResult,
  AIReviewerServiceError,
} from '../../AIReviewerService';
import prisma from '../../../config/prisma';

export interface GoldenAnswer {
  question_id: number;
  value: string;
}

export interface GoldenTicket {
  /**
   * Phase B (B5): kind of source this golden record points at. Defaults
   * to 'TICKET' for backward compatibility with the original
   * golden.json schema; 'CALL' opts in to call-source replay through
   * `analyzeConversation`. Records that omit `kind` are treated as
   * TICKET goldens.
   */
  kind?: 'TICKET' | 'CALL';
  ticket_id: number;
  /**
   * Phase B (B5): Genesys conversation id (calls.call_id string).
   * REQUIRED when `kind === 'CALL'`. Ignored for TICKET goldens.
   */
  conversation_id?: string;
  subclass?: string;
  resolution?: string;
  expected: { answers: GoldenAnswer[] } | null;
}

export interface GoldenSet {
  form_id: number;
  form_name?: string;
  agreement_threshold?: number;
  tickets: GoldenTicket[];
}

export interface PerTicketEval {
  ticket_id: number;
  /** Phase B (B5): mirrors the golden record's `kind`. */
  kind?: 'TICKET' | 'CALL';
  /** Phase B (B5): set for call goldens so the report can deep-link. */
  conversation_id?: string;
  provider: AiProvider;
  status: 'scored' | 'unscored' | 'error';
  matches?: number;
  total?: number;
  agreement?: number;
  disagreements?: { question_id: number; expected: string; actual: string }[];
  elapsed_ms?: number;
  model?: string;
  error?: string;
  /** Echo of the analysis result (omitted in summary view). */
  result?: AIAnalysisResult;
}

export interface EvalReport {
  form_id: number;
  providers: AiProvider[];
  tickets_total: number;
  tickets_scored: number;
  tickets_unscored: number;
  tickets_error: number;
  per_provider: Record<AiProvider, {
    total_questions_scored: number;
    matched_questions: number;
    overall_agreement: number;
    avg_elapsed_ms: number;
    threshold: number;
    passed: boolean;
  }>;
  details: PerTicketEval[];
}

const DEFAULT_GOLDEN_PATH = path.resolve(__dirname, 'golden.json');

export function loadGoldenSet(filePath: string = DEFAULT_GOLDEN_PATH): GoldenSet {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as GoldenSet & Record<string, unknown>;
  if (!parsed.form_id || !Array.isArray(parsed.tickets)) {
    throw new Error(`Invalid golden file at ${filePath}: missing form_id or tickets[]`);
  }
  return parsed;
}

/**
 * Build a GoldenSet on the fly from `ai_calibration_data`. Each unique
 * (form_id × ticket_id) pair becomes a ticket; the most recent row's
 * human_answers is the ground truth. Rows where `in_rolling_set=false`
 * are skipped so dropped data doesn't influence the eval.
 *
 * Used by the calibration tab and the `--from-db` CLI mode to run
 * regression checks against the live calibration corpus rather than
 * the static golden.json bootstrap.
 */
export async function loadGoldenSetFromDb(formId: number, opts: { limit?: number } = {}): Promise<GoldenSet> {
  if (!Number.isInteger(formId) || formId <= 0) {
    throw new Error(`Invalid form id: ${formId}`);
  }
  const limit = opts.limit && opts.limit > 0 ? opts.limit : 200;
  const rows = await prisma.aiCalibrationData.findMany({
    where: { form_id: formId, in_rolling_set: true },
    orderBy: { created_at: 'desc' },
    take: limit,
  });

  // Phase B (B5): collect calls.id → conversation_id (string) lookups in
  // one batched query so call-source goldens carry the Genesys
  // conversation id needed by analyzeConversation.
  const callRowIds = rows
    .filter((r) => (r as { source_kind?: string | null }).source_kind === 'CALL')
    .map((r) => r.ticket_id);
  const callRowSet = new Set(callRowIds);
  const callMap = new Map<number, string>();
  if (callRowSet.size > 0) {
    const calls = await prisma.call.findMany({
      where: { id: { in: Array.from(callRowSet) } },
      select: { id: true, call_id: true },
    });
    for (const c of calls) callMap.set(c.id, c.call_id);
  }

  // De-dupe by (kind, ticket_id) keeping newest. We sorted desc above so
  // the first occurrence wins.
  const seen = new Map<string, GoldenTicket>();
  for (const row of rows) {
    const sourceKind: 'TICKET' | 'CALL' =
      (row as { source_kind?: string | null }).source_kind === 'CALL' ? 'CALL' : 'TICKET';
    const dedupKey = `${sourceKind}:${row.ticket_id}`;
    if (seen.has(dedupKey)) continue;
    const human = (row.human_answers ?? {}) as Record<string, string>;
    const answers: GoldenAnswer[] = Object.entries(human).map(([qid, val]) => ({
      question_id: Number(qid),
      value: String(val ?? ''),
    }));
    if (answers.length === 0) continue;
    if (sourceKind === 'CALL') {
      const conversationId = callMap.get(row.ticket_id);
      // Skip rows whose call row was deleted; we cannot replay them.
      if (!conversationId) continue;
      seen.set(dedupKey, {
        kind: 'CALL',
        ticket_id: row.ticket_id,
        conversation_id: conversationId,
        expected: { answers },
      });
    } else {
      seen.set(dedupKey, {
        kind: 'TICKET',
        ticket_id: row.ticket_id,
        expected: { answers },
      });
    }
  }

  return {
    form_id: formId,
    form_name: `db:form_${formId}`,
    agreement_threshold: 0.85,
    tickets: Array.from(seen.values()),
  };
}

export interface RunEvalOptions {
  goldenPath?: string;
  providers?: AiProvider[];
  /** When true, include the full AIAnalysisResult on each detail row. */
  includeResults?: boolean;
  /**
   * When set, ignore goldenPath and pull the eval set from
   * `ai_calibration_data` for the given form. Use this for per-form
   * rolling regressions; the static golden.json stays as the bootstrap
   * baseline.
   */
  source?: { kind: 'db'; formId: number; limit?: number };
}

/**
 * Run the full eval. Sequential per ticket per provider so BookStack /
 * LLM calls don't dogpile. Errors on individual tickets are recorded in
 * the report (status='error') rather than propagated, so a single bad
 * ticket can't sink the whole run.
 */
export async function runEval(opts: RunEvalOptions = {}): Promise<EvalReport> {
  const golden = opts.source?.kind === 'db'
    ? await loadGoldenSetFromDb(opts.source.formId, { limit: opts.source.limit })
    : loadGoldenSet(opts.goldenPath);
  const providers: AiProvider[] = opts.providers ?? ['anthropic'];
  const threshold = golden.agreement_threshold ?? 0.85;

  const details: PerTicketEval[] = [];
  let scored = 0;
  let unscored = 0;
  let errored = 0;

  for (const t of golden.tickets) {
    const kind: 'TICKET' | 'CALL' = t.kind ?? 'TICKET';
    for (const provider of providers) {
      try {
        // Phase B (B5): dispatch on the record's kind. CALL goldens use
        // analyzeConversation with the Genesys conversation id; TICKET
        // goldens keep the historical analyzeTicket path. Records that
        // claim kind='CALL' but are missing conversation_id are reported
        // as errors so the eval can't silently mis-grade them.
        let result: AIAnalysisResult;
        if (kind === 'CALL') {
          if (!t.conversation_id) {
            errored++;
            details.push({
              ticket_id: t.ticket_id,
              kind: 'CALL',
              provider,
              status: 'error',
              error: 'CALL golden missing conversation_id',
            });
            continue;
          }
          result = await aiReviewerService.analyzeConversation(t.conversation_id, {
            formId: golden.form_id,
            provider,
          });
        } else {
          result = await aiReviewerService.analyzeTicket(t.ticket_id, {
            formId: golden.form_id,
            provider,
          });
        }

        if (!t.expected) {
          unscored++;
          details.push({
            ticket_id: t.ticket_id,
            kind,
            conversation_id: t.conversation_id,
            provider,
            status: 'unscored',
            elapsed_ms: result.elapsedMs,
            model: result.model,
            ...(opts.includeResults ? { result } : {}),
          });
          continue;
        }

        const expectedById = new Map(t.expected.answers.map((a) => [a.question_id, a.value.toLowerCase()]));
        const actualById = new Map(result.answers.map((a) => [a.question_id, a.value.toLowerCase()]));
        let matches = 0;
        const disagreements: PerTicketEval['disagreements'] = [];
        for (const [qid, expVal] of expectedById) {
          const actVal = actualById.get(qid);
          if (actVal !== undefined && actVal === expVal) {
            matches++;
          } else {
            disagreements!.push({
              question_id: qid,
              expected: expVal,
              actual: actVal ?? '(missing)',
            });
          }
        }
        const total = expectedById.size;
        scored++;
        details.push({
          ticket_id: t.ticket_id,
          kind,
          conversation_id: t.conversation_id,
          provider,
          status: 'scored',
          matches,
          total,
          agreement: total === 0 ? 1 : matches / total,
          disagreements,
          elapsed_ms: result.elapsedMs,
          model: result.model,
          ...(opts.includeResults ? { result } : {}),
        });
      } catch (err) {
        errored++;
        const message = err instanceof AIReviewerServiceError
          ? `[${err.code}] ${err.message}`
          : err instanceof Error ? err.message : String(err);
        details.push({
          ticket_id: t.ticket_id,
          kind,
          conversation_id: t.conversation_id,
          provider,
          status: 'error',
          error: message,
        });
      }
    }
  }

  const perProvider = {} as EvalReport['per_provider'];
  for (const provider of providers) {
    const rows = details.filter((d) => d.provider === provider && d.status === 'scored');
    const matched = rows.reduce((s, r) => s + (r.matches ?? 0), 0);
    const totalQ = rows.reduce((s, r) => s + (r.total ?? 0), 0);
    const elapsedRows = details.filter((d) => d.provider === provider && d.elapsed_ms !== undefined);
    const avgElapsed = elapsedRows.length > 0
      ? elapsedRows.reduce((s, r) => s + (r.elapsed_ms ?? 0), 0) / elapsedRows.length
      : 0;
    const overallAgreement = totalQ === 0 ? 1 : matched / totalQ;
    perProvider[provider] = {
      total_questions_scored: totalQ,
      matched_questions: matched,
      overall_agreement: overallAgreement,
      avg_elapsed_ms: Math.round(avgElapsed),
      threshold,
      // Pass when no scored tickets exist (vacuous) OR agreement meets threshold.
      passed: totalQ === 0 ? true : overallAgreement >= threshold,
    };
  }

  return {
    form_id: golden.form_id,
    providers,
    tickets_total: golden.tickets.length * providers.length,
    tickets_scored: scored,
    tickets_unscored: unscored,
    tickets_error: errored,
    per_provider: perProvider,
    details,
  };
}

/** Render a compact ASCII summary of the report — used by the CLI. */
export function formatReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(`AI Reviewer eval — form_id=${report.form_id}`);
  lines.push(`tickets: ${report.tickets_total} runs · scored=${report.tickets_scored} unscored=${report.tickets_unscored} errored=${report.tickets_error}`);
  lines.push('');
  for (const [provider, stats] of Object.entries(report.per_provider)) {
    lines.push(`  ${provider}: ${stats.matched_questions}/${stats.total_questions_scored} = ${(stats.overall_agreement * 100).toFixed(1)}% (threshold ${(stats.threshold * 100).toFixed(0)}%) — ${stats.passed ? 'PASS' : 'FAIL'} · avg ${stats.avg_elapsed_ms}ms`);
  }
  lines.push('');
  lines.push('Per-ticket detail:');
  for (const d of report.details) {
    // Phase B (B5): label call goldens distinctly so the report makes
    // the source kind obvious at a glance.
    const label = d.kind === 'CALL'
      ? `call ${d.conversation_id ?? '(no-conv-id)'}`
      : `ticket ${d.ticket_id}`;
    if (d.status === 'unscored') {
      lines.push(`  [${d.provider}] ${label}: UNSCORED (no human ground truth) · ${d.elapsed_ms}ms`);
    } else if (d.status === 'error') {
      lines.push(`  [${d.provider}] ${label}: ERROR — ${d.error}`);
    } else {
      const flags = (d.disagreements ?? []).map((x) => `q${x.question_id}:${x.expected}->${x.actual}`).join(', ');
      lines.push(`  [${d.provider}] ${label}: ${d.matches}/${d.total} (${((d.agreement ?? 0) * 100).toFixed(0)}%) · ${d.elapsed_ms}ms${flags ? ' · ' + flags : ''}`);
    }
  }
  return lines.join('\n');
}

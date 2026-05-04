/**
 * AIGoldenEvalRunner
 *
 * Replays every active golden submission for a form through the AI
 * Reviewer's analyze() pipeline (DRY-RUN: no DB writes), compares the
 * AI's answers to the golden answers, computes per-question and
 * overall Cohen's kappa, and persists the result as one ai_eval_runs
 * row.
 *
 * Triggers:
 *   - Manual: POST /api/ai-reviewer/forms/:id/eval/run (or `pnpm run
 *     eval:golden -- --form <id>`)
 *   - Automatic: hooked into rule-pack mutation routes and the
 *     ai_review_guidance PATCH so a content change immediately
 *     produces a regression-eval row.
 *
 * Pass/fail rule:
 *   PASS when `overall_kappa - previous_run.overall_kappa >= -0.03`.
 *   That is: at most a 3-point regression is tolerated. Tighten via
 *   AI_GOLDEN_DELTA_THRESHOLD env var.
 *
 * The runner intentionally only handles TICKET-source golden
 * submissions today. TASK and CONVERSATION sources are skipped with
 * a `reason: 'unsupported_source'` entry in the result, so the
 * surrounding kappa math is computed only on what we can actually
 * replay.
 */

import { createHash } from 'crypto';
import prisma from '../config/prisma';
import logger from '../config/logger';
import aiReviewerService from './AIReviewerService';
import rulePackService from './RulePackService';
import { loadPrompt } from './promptLoader';
import { computeCohensKappa, type RaterPair } from './agreementMath';
import { applyCalibration } from './ConfidenceCalibrator';

/** Pass/fail tolerance vs. the previous run's overall_kappa. */
const DEFAULT_DELTA_THRESHOLD = (() => {
  const raw = Number(process.env.AI_GOLDEN_DELTA_THRESHOLD);
  return Number.isFinite(raw) && raw > 0 ? raw : 0.03;
})();

export type EvalTriggeredBy = 'manual' | 'rule_pack_change' | 'system_prompt_change' | 'scheduled' | 'ci';

export interface EvalRunOptions {
  formId: number;
  triggeredBy: EvalTriggeredBy;
  triggeredByUser?: number | null;
  /** Optional cap on how many golden submissions to replay (used by CI smoke runs). */
  maxSamples?: number;
}

export interface PerSubmissionEvalResult {
  submission_id: number;
  ticket_id: number | null;
  status: 'evaluated' | 'skipped';
  reason?: string;
  /** Cohen's kappa across the questions evaluated on this single submission. */
  kappa?: number;
  /** Per-question detail: golden vs ai. Used by the eval-traces UI panel. */
  questions?: Array<{
    question_id: number;
    question_text: string;
    golden_value: string;
    ai_value: string;
    match: boolean;
    ai_confidence: number | null;
  }>;
  /** Number of KB pages cited; surfaced in eval traces (Phase 7c). */
  kb_citation_count?: number;
  timeline_step_count?: number;
  observation_count?: number;
  ai_overall_confidence?: number | null;
  ai_calibrated_confidence?: number | null;
  /**
   * Phase 7c eval traces: full lists for the drawer, capped to keep
   * results_json bounded. Without these the drawer can only show counts.
   */
  kb_citations?: Array<{ id: number; name: string; url: string }>;
  timeline?: Array<{ step: number; description: string }>;
  observations?: Array<{ category?: string | null; text: string }>;
}

export interface EvalRunResult {
  id: number;
  form_id: number;
  ran_at: Date;
  triggered_by: EvalTriggeredBy;
  golden_set_count: number;
  evaluated_count: number;
  overall_kappa: number | null;
  pass: boolean;
  prev_overall_kappa: number | null;
  delta_vs_prev: number | null;
  per_submission: PerSubmissionEvalResult[];
}

/**
 * Build a stable hash of the system prompt currently shipping for a
 * form. Used to pin which exact prompt this eval run was evaluating
 * (so a kappa drop can be diagnosed against the prompt that caused it).
 */
async function computePromptHash(formId: number): Promise<{ promptHash: string; packHashes: Record<string, string> }> {
  const systemBase = loadPrompt('ai-reviewer/system.v2');
  const packs = rulePackService.getPacksForForm(formId);
  const form = await prisma.form.findUnique({
    where: { id: formId },
    select: { ai_review_guidance: true },
  });
  const guidance = (form?.ai_review_guidance ?? '').trim();
  const packHashes: Record<string, string> = {};
  for (const p of packs) {
    packHashes[p.key] = createHash('sha256').update(p.body).digest('hex').slice(0, 16);
  }
  const composite = createHash('sha256');
  composite.update(systemBase);
  for (const k of Object.keys(packHashes).sort()) {
    composite.update(`|${k}=${packHashes[k]}`);
  }
  composite.update(`|guidance=${guidance}`);
  return { promptHash: composite.digest('hex'), packHashes };
}

async function getPreviousRun(formId: number): Promise<{ overall_kappa: number | null; ran_at: Date } | null> {
  const prev = await prisma.aiEvalRun.findFirst({
    where: { form_id: formId },
    orderBy: { ran_at: 'desc' },
    select: { overall_kappa: true, ran_at: true },
  });
  if (!prev) return null;
  return { overall_kappa: prev.overall_kappa != null ? Number(prev.overall_kappa) : null, ran_at: prev.ran_at };
}

/**
 * Run the eval for one form. Returns the resulting ai_eval_runs row's
 * id along with a summary suitable for displaying in the latest-run
 * card on AIReviewerFormDetail.
 */
export async function runGoldenEval(opts: EvalRunOptions): Promise<EvalRunResult> {
  const { formId, triggeredBy } = opts;
  if (!Number.isInteger(formId) || formId <= 0) {
    throw new Error('Invalid form id');
  }

  const goldenRows = await prisma.aiGoldenSet.findMany({
    where: { form_id: formId, archived_at: null },
    orderBy: { marked_at: 'desc' },
    take: opts.maxSamples ?? undefined,
  });
  const goldenCount = goldenRows.length;

  const { promptHash, packHashes } = await computePromptHash(formId);
  const prevRun = await getPreviousRun(formId);

  const perSubmission: PerSubmissionEvalResult[] = [];
  const allPairs: RaterPair[] = [];

  if (goldenCount === 0) {
    // Persist a "no data" run so the UI shows we tried.
    const created = await prisma.aiEvalRun.create({
      data: {
        form_id: formId,
        triggered_by: triggeredBy,
        triggered_by_user: opts.triggeredByUser ?? null,
        golden_set_count: 0,
        prompt_hash: promptHash,
        pack_hashes_json: packHashes as any,
        results_json: { per_submission: [], note: 'no golden submissions' } as any,
        overall_kappa: null,
        pass: true,
      },
    });
    return {
      id: created.id,
      form_id: formId,
      ran_at: created.ran_at,
      triggered_by: triggeredBy,
      golden_set_count: 0,
      evaluated_count: 0,
      overall_kappa: null,
      pass: true,
      prev_overall_kappa: prevRun?.overall_kappa ?? null,
      delta_vs_prev: null,
      per_submission: [],
    };
  }

  // Resolve each golden submission to its TICKET id (today's only supported source).
  const submissionIds = goldenRows.map((g) => g.submission_id);
  const submissions = await prisma.submission.findMany({
    where: { id: { in: submissionIds } },
    include: {
      submission_ticket_tasks: true,
      submission_answers: { include: { question: { select: { id: true, question_text: true, question_type: true } } } },
    },
  });
  const byId = new Map(submissions.map((s) => [s.id, s]));

  for (const g of goldenRows) {
    const sub = byId.get(g.submission_id);
    if (!sub) {
      perSubmission.push({ submission_id: g.submission_id, ticket_id: null, status: 'skipped', reason: 'submission_missing' });
      continue;
    }
    const ticketLink = sub.submission_ticket_tasks.find((t) => t.kind === 'TICKET');
    if (!ticketLink) {
      perSubmission.push({
        submission_id: g.submission_id,
        ticket_id: null,
        status: 'skipped',
        reason: 'unsupported_source (only TICKET is supported)',
      });
      continue;
    }
    const ticketId = Number(ticketLink.external_id);

    let analysis: Awaited<ReturnType<typeof aiReviewerService.analyzeTicket>> | null = null;
    try {
      analysis = await aiReviewerService.analyzeTicket(ticketId, { formId });
    } catch (err) {
      perSubmission.push({
        submission_id: g.submission_id,
        ticket_id: ticketId,
        status: 'skipped',
        reason: `analyze_failed: ${(err as Error).message}`,
      });
      continue;
    }

    // Build (golden, ai) pairs per question.
    const goldenByQid = new Map(sub.submission_answers.map((a) => [a.question_id, a]));
    const aiByQid = new Map(analysis.answers.map((a) => [a.question_id, a]));
    const questions: NonNullable<PerSubmissionEvalResult['questions']> = [];
    const localPairs: RaterPair[] = [];

    for (const ans of sub.submission_answers) {
      // Skip non-gradeable types — they're never in the AI output.
      const qtype = (ans.question?.question_type ?? '').toUpperCase();
      if (qtype === 'TEXT' || qtype === 'INFO_BLOCK' || qtype === 'SUB_CATEGORY') continue;
      const golden = (ans.answer ?? '').trim();
      if (!golden) continue;
      const ai = aiByQid.get(ans.question_id);
      const aiValue = (ai?.value ?? '').trim();
      const pair: RaterPair = [aiValue, golden];
      localPairs.push(pair);
      allPairs.push(pair);
      questions.push({
        question_id: ans.question_id,
        question_text: ans.question?.question_text ?? `(question #${ans.question_id})`,
        golden_value: golden,
        ai_value: aiValue,
        match: aiValue.toLowerCase() === golden.toLowerCase(),
        ai_confidence: ai?.confidence ?? null,
      });
    }

    // Phase 7c: cap the trace lists so a runaway analysis can't bloat
    // results_json beyond the JSON column's practical limits. The drawer
    // shows "and N more" when truncation kicks in.
    const TIMELINE_CAP = 50;
    const OBSERVATION_CAP = 30;
    const KB_CAP = 25;

    const timelineForTrace = (analysis.timeline ?? [])
      .slice(0, TIMELINE_CAP)
      .map((t, i) => ({
        step: i + 1,
        description: `${t.when} \u2014 ${t.who}: ${t.action}${t.kb_step ? ` [${t.kb_step}]` : ''}`,
      }));
    const observationsForTrace = (analysis.observations ?? [])
      .slice(0, OBSERVATION_CAP)
      .map((o) => ({ category: o.kind ?? null, text: o.message }));
    const kbCitationsForTrace = (analysis.kbCitations ?? [])
      .slice(0, KB_CAP)
      .map((c) => ({ id: c.id, name: c.name, url: c.url }));

    // Apply confidence calibration so the eval trace shows what the
    // system would actually persist after Phase 4. Identity when no
    // active map exists for the form.
    const calibrated =
      analysis.overallConfidence != null
        ? await applyCalibration(formId, analysis.overallConfidence).catch(() => null)
        : null;

    perSubmission.push({
      submission_id: g.submission_id,
      ticket_id: ticketId,
      status: 'evaluated',
      kappa: localPairs.length > 0 ? computeCohensKappa(localPairs) : undefined,
      questions,
      kb_citation_count: analysis.kbCitations?.length ?? 0,
      timeline_step_count: analysis.timeline?.length ?? 0,
      observation_count: analysis.observations?.length ?? 0,
      ai_overall_confidence: analysis.overallConfidence ?? null,
      ai_calibrated_confidence:
        calibrated != null && Number.isFinite(calibrated) ? calibrated : null,
      kb_citations: kbCitationsForTrace,
      timeline: timelineForTrace,
      observations: observationsForTrace,
    });
  }

  const evaluatedCount = perSubmission.filter((p) => p.status === 'evaluated').length;
  const overallKappa = allPairs.length > 0 ? computeCohensKappa(allPairs) : null;

  let pass = true;
  let delta: number | null = null;
  if (overallKappa != null && prevRun?.overall_kappa != null) {
    delta = overallKappa - prevRun.overall_kappa;
    pass = delta >= -DEFAULT_DELTA_THRESHOLD;
  }

  const created = await prisma.aiEvalRun.create({
    data: {
      form_id: formId,
      triggered_by: triggeredBy,
      triggered_by_user: opts.triggeredByUser ?? null,
      golden_set_count: goldenCount,
      prompt_hash: promptHash,
      pack_hashes_json: packHashes as any,
      results_json: {
        per_submission: perSubmission,
        delta_threshold: DEFAULT_DELTA_THRESHOLD,
        prev_overall_kappa: prevRun?.overall_kappa ?? null,
      } as any,
      overall_kappa: overallKappa != null ? roundDecimal(overallKappa, 3) : null,
      pass,
    },
  });

  logger.info(
    `[AI EVAL] form_id=${formId} trigger=${triggeredBy} golden=${goldenCount} evaluated=${evaluatedCount} ` +
      `kappa=${overallKappa == null ? 'null' : overallKappa.toFixed(3)} ` +
      `delta=${delta == null ? 'null' : delta.toFixed(3)} pass=${pass}`
  );

  return {
    id: created.id,
    form_id: formId,
    ran_at: created.ran_at,
    triggered_by: triggeredBy,
    golden_set_count: goldenCount,
    evaluated_count: evaluatedCount,
    overall_kappa: overallKappa,
    pass,
    prev_overall_kappa: prevRun?.overall_kappa ?? null,
    delta_vs_prev: delta,
    per_submission: perSubmission,
  };
}

function roundDecimal(value: number, places: number): number {
  const m = Math.pow(10, places);
  return Math.round(value * m) / m;
}

/**
 * Fetch the latest eval run for the form (or null if none yet). Used
 * by the latest-run card on AIReviewerFormDetail.
 */
export async function getLatestEvalRun(formId: number): Promise<{
  id: number;
  ran_at: Date;
  triggered_by: EvalTriggeredBy;
  golden_set_count: number;
  overall_kappa: number | null;
  pass: boolean;
  results_json: any;
  pack_hashes_json: any;
  prompt_hash: string;
} | null> {
  const row = await prisma.aiEvalRun.findFirst({
    where: { form_id: formId },
    orderBy: { ran_at: 'desc' },
  });
  if (!row) return null;
  return {
    id: row.id,
    ran_at: row.ran_at,
    triggered_by: row.triggered_by as EvalTriggeredBy,
    golden_set_count: row.golden_set_count,
    overall_kappa: row.overall_kappa != null ? Number(row.overall_kappa) : null,
    pass: row.pass,
    results_json: row.results_json,
    pack_hashes_json: row.pack_hashes_json,
    prompt_hash: row.prompt_hash,
  };
}

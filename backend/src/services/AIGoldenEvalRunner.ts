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
 * Phase B (B5): the runner now handles BOTH ticket-source and
 * call-source (CONVERSATION) golden submissions. Ticket goldens are
 * dispatched to {@link aiReviewerService.analyzeTicket}; call goldens
 * to {@link aiReviewerService.analyzeConversation}. TASK source is
 * still skipped because we do not yet have a stable analyze() entry
 * point for tasks. Per-submission results carry a `kind` field so the
 * UI can render call vs ticket evals distinctly.
 */

import { createHash } from 'crypto';
import prisma from '../config/prisma';
import logger from '../config/logger';
import aiReviewerService from './AIReviewerService';
import rulePackService from './RulePackService';
import basePromptService from './BasePromptService';
import { computeCohensKappa, computeWeightedKappa, type RaterPair } from './agreementMath';
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
  /**
   * Phase B (B5): 'TICKET' for ticket-source goldens, 'CALL' for
   * conversation-source goldens, null when the submission was skipped
   * because the source could not be resolved. Surfaced so the eval
   * trace UI can group/filter by kind.
   */
  kind: 'TICKET' | 'CALL' | null;
  /**
   * Phase B (B5): Genesys conversation id (calls.call_id string) when
   * `kind === 'CALL'`. Null for TICKET goldens.
   */
  conversation_id?: string | null;
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
  /**
   * Phase D (D4): Quadratic-weighted Cohen's kappa over the SCALE-typed
   * pairs in this run. Penalizes large ordinal disagreements more
   * heavily than off-by-one. NULL when the golden set has no SCALE
   * questions (or no evaluated submissions). Stored in
   * results_json.overall_qwk; the pass gate uses it alongside Cohen's
   * kappa: `pass = min(kappa, qwk) >= prev - delta_threshold` so a
   * model that flips 1↔5 on an ordinal scale can't sneak by because
   * its nominal agreement is unchanged.
   */
  overall_qwk: number | null;
  pass: boolean;
  prev_overall_kappa: number | null;
  prev_overall_qwk: number | null;
  delta_vs_prev: number | null;
  delta_qwk_vs_prev: number | null;
  per_submission: PerSubmissionEvalResult[];
}

/**
 * Build a stable hash of the system prompt currently shipping for a
 * form. Used to pin which exact prompt this eval run was evaluating
 * (so a kappa drop can be diagnosed against the prompt that caused it).
 */
async function computePromptHash(formId: number): Promise<{ promptHash: string; packHashes: Record<string, string> }> {
  // Hash the assembled single-source system prompt — Base body + the
  // single-source addendum — which matches what real runs send to the
  // model. A Base body edit OR an addendum change naturally bumps the
  // hash and the eval-runs ledger captures the before/after kappa diff.
  const systemBase = basePromptService.getAssembledPrompt('single_source').body;
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

async function getPreviousRun(
  formId: number
): Promise<{ overall_kappa: number | null; overall_qwk: number | null; ran_at: Date } | null> {
  const prev = await prisma.aiEvalRun.findFirst({
    where: { form_id: formId },
    orderBy: { ran_at: 'desc' },
    select: { overall_kappa: true, ran_at: true, results_json: true },
  });
  if (!prev) return null;
  // overall_qwk lives in results_json (Phase D added it without a
  // schema change so we don't carry a migration just to track a second
  // metric on the eval run row).
  let overallQwk: number | null = null;
  const results = prev.results_json as { overall_qwk?: unknown } | null;
  const raw = results?.overall_qwk;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    overallQwk = raw;
  }
  return {
    overall_kappa: prev.overall_kappa != null ? Number(prev.overall_kappa) : null,
    overall_qwk: overallQwk,
    ran_at: prev.ran_at,
  };
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
  // Phase D (D4): SCALE-typed pairs collected separately so we can
  // compute quadratic-weighted kappa over an actual ordinal axis.
  // Pairs whose values aren't both integers are silently skipped — a
  // SCALE answer that someone typed as text can't be ordered safely.
  const scalePairs: RaterPair[] = [];

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
      overall_qwk: null,
      pass: true,
      prev_overall_kappa: prevRun?.overall_kappa ?? null,
      prev_overall_qwk: prevRun?.overall_qwk ?? null,
      delta_vs_prev: null,
      delta_qwk_vs_prev: null,
      per_submission: [],
    };
  }

  // Phase B (B5): resolve each golden submission to a TICKET ticket_id
  // OR to a CALL conversation_id. We pull both relations in one query
  // and dispatch on whichever side is populated. Ticket wins when both
  // exist (combined ticket+call goldens are evaluated as ticket-source
  // until Phase C delivers the Case loader; the call side comes back
  // automatically once the two-pass synthesis lands).
  const submissionIds = goldenRows.map((g) => g.submission_id);
  const submissions = await prisma.submission.findMany({
    where: { id: { in: submissionIds } },
    include: {
      submission_ticket_tasks: true,
      submission_calls: { include: { call: { select: { call_id: true } } } },
      submission_answers: { include: { question: { select: { id: true, question_text: true, question_type: true } } } },
    },
  });
  const byId = new Map(submissions.map((s) => [s.id, s]));

  for (const g of goldenRows) {
    const sub = byId.get(g.submission_id);
    if (!sub) {
      perSubmission.push({
        submission_id: g.submission_id,
        ticket_id: null,
        kind: null,
        status: 'skipped',
        reason: 'submission_missing',
      });
      continue;
    }
    const ticketLink = sub.submission_ticket_tasks.find((t) => t.kind === 'TICKET');
    // Filter out the virtual call_id = -1 placeholder used by the
    // Conversation adapter when no real `calls` row exists. We need a
    // genuine `calls.call_id` (Genesys conversation id) to drive
    // analyzeConversation; without it we cannot replay.
    const callLink = sub.submission_calls.find(
      (sc) => sc.call?.call_id && sc.call.call_id.trim().length > 0
    );

    let analysis: Awaited<ReturnType<typeof aiReviewerService.analyzeTicket>> | null = null;
    let evalKind: 'TICKET' | 'CALL';
    let ticketIdForRow: number | null = null;
    let conversationIdForRow: string | null = null;

    if (ticketLink) {
      evalKind = 'TICKET';
      ticketIdForRow = Number(ticketLink.external_id);
      try {
        analysis = await aiReviewerService.analyzeTicket(ticketIdForRow, { formId });
      } catch (err) {
        perSubmission.push({
          submission_id: g.submission_id,
          ticket_id: ticketIdForRow,
          kind: 'TICKET',
          status: 'skipped',
          reason: `analyze_failed: ${(err as Error).message}`,
        });
        continue;
      }
    } else if (callLink && callLink.call?.call_id) {
      evalKind = 'CALL';
      conversationIdForRow = callLink.call.call_id;
      try {
        analysis = await aiReviewerService.analyzeConversation(conversationIdForRow, { formId });
      } catch (err) {
        perSubmission.push({
          submission_id: g.submission_id,
          ticket_id: null,
          kind: 'CALL',
          conversation_id: conversationIdForRow,
          status: 'skipped',
          reason: `analyze_failed: ${(err as Error).message}`,
        });
        continue;
      }
    } else {
      perSubmission.push({
        submission_id: g.submission_id,
        ticket_id: null,
        kind: null,
        status: 'skipped',
        reason: 'unsupported_source (no TICKET ticket_task and no resolvable CALL link)',
      });
      continue;
    }
    const ticketId = ticketIdForRow ?? 0;

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
      if (qtype === 'SCALE') {
        const aiNum = Number(aiValue);
        const goldenNum = Number(golden);
        if (Number.isInteger(aiNum) && Number.isInteger(goldenNum)) {
          scalePairs.push(pair);
        }
      }
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
      ticket_id: evalKind === 'TICKET' ? ticketId : null,
      kind: evalKind,
      conversation_id: evalKind === 'CALL' ? conversationIdForRow : null,
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

  // Phase D (D4): quadratic-weighted kappa over the SCALE-typed pairs.
  // Build the ordinal axis from the union of integer values that
  // actually appeared so the weight matrix matches the data.
  let overallQwk: number | null = null;
  if (scalePairs.length > 0) {
    const distinct = new Set<number>();
    for (const [a, b] of scalePairs) {
      distinct.add(Number(a));
      distinct.add(Number(b));
    }
    const ordered = [...distinct].sort((a, b) => a - b).map((n) => String(n));
    const qwk = computeWeightedKappa(scalePairs, ordered, 'quadratic');
    overallQwk = Number.isFinite(qwk) ? qwk : null;
  }

  let pass = true;
  let delta: number | null = null;
  let qwkDelta: number | null = null;
  if (overallKappa != null && prevRun?.overall_kappa != null) {
    delta = overallKappa - prevRun.overall_kappa;
    pass = delta >= -DEFAULT_DELTA_THRESHOLD;
  }
  // QWK gate: only enforce when we have a comparable QWK on both sides
  // (prev run actually had SCALE pairs too). When either side is null
  // we fall back to kappa alone — useful while the eval set is being
  // populated and not all forms have SCALE questions.
  if (overallQwk != null && prevRun?.overall_qwk != null) {
    qwkDelta = overallQwk - prevRun.overall_qwk;
    pass = pass && qwkDelta >= -DEFAULT_DELTA_THRESHOLD;
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
        prev_overall_qwk: prevRun?.overall_qwk ?? null,
        overall_qwk: overallQwk,
        qwk_pair_count: scalePairs.length,
      } as any,
      overall_kappa: overallKappa != null ? roundDecimal(overallKappa, 3) : null,
      pass,
    },
  });

  logger.info(
    `[AI EVAL] form_id=${formId} trigger=${triggeredBy} golden=${goldenCount} evaluated=${evaluatedCount} ` +
      `kappa=${overallKappa == null ? 'null' : overallKappa.toFixed(3)} ` +
      `qwk=${overallQwk == null ? 'null' : overallQwk.toFixed(3)} ` +
      `delta=${delta == null ? 'null' : delta.toFixed(3)} ` +
      `qwk_delta=${qwkDelta == null ? 'null' : qwkDelta.toFixed(3)} pass=${pass}`
  );

  return {
    id: created.id,
    form_id: formId,
    ran_at: created.ran_at,
    triggered_by: triggeredBy,
    golden_set_count: goldenCount,
    evaluated_count: evaluatedCount,
    overall_kappa: overallKappa,
    overall_qwk: overallQwk,
    pass,
    prev_overall_kappa: prevRun?.overall_kappa ?? null,
    prev_overall_qwk: prevRun?.overall_qwk ?? null,
    delta_vs_prev: delta,
    delta_qwk_vs_prev: qwkDelta,
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

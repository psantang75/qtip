/**
 * AIReviewerService
 *
 * Fills out and submits real qtip audit forms via the existing submission
 * pipeline, attributed to the synthetic "AI Reviewer" user. Tickets ship
 * first; AR-Ops tasks and call transcripts plug in later via the same
 * InteractionAdapter contract.
 *
 * Pipeline (ticket path):
 *   1. Load form + validate ai_enabled, interaction_type, AI feedback question
 *   2. Adapter loads the audited material from the source system (CRM today)
 *   3. BookStack search by classification text → top-N page plaintext
 *   4. Claude Opus 4.7 fills out the form (structured JSON). Provider +
 *      model are env-driven via ANTHROPIC_DEFAULT_MODEL / OPENAI_DEFAULT_MODEL
 *      (see backend/src/config/environment.ts) — the OpenAI fork uses gpt-5.
 *   5. Map LLM JSON → SubmissionAnswer[]; validate every answer
 *   6. Hand off to SubmissionService.submitAudit (same code path humans use)
 *
 * Where to tune behavior (no hardcoded business rules in this file):
 *   - Per-form rules            → Form Builder "AI Reviewer Guidance"
 *                                 textarea (forms.ai_review_guidance), injected
 *                                 into the system prompt as
 *                                 ADDITIONAL FORM-SPECIFIC GRADING RULES.
 *   - Global grading philosophy → backend/src/services/aiReviewerPrompt.ts
 *                                 (the `system` string in buildAiReviewerPrompt).
 *   - KB retrieval depth/scope  → searchKb() below + BookStackService.
 *   - Playbook-driven KB        → tblPlayBookLink.LinkURL on each ticket's
 *                                 classification. searchKb() pulls those
 *                                 pages first (highest authority), then tops
 *                                 up with classification-text search hits,
 *                                 deduped by page id.
 *
 * Errors surface as AIReviewerServiceError with a stable code + statusCode.
 */

import prisma from '../config/prisma';
import { aiConfig } from '../config/ai';
import { aiReviewerConfig } from '../config/environment';
import { getAnthropicClient, isAnthropicConfigured } from './ai/AnthropicClient';
import { getOpenAIClient, isOpenAIConfigured } from './ai/OpenAIClient';
import bookstackService from './BookStackService';
import kbIndexService from './KbIndexService';
import crmService, { type TicketHeader, type TaskHeader, type CRMNote } from './CRMService';
import phoneSystemService from './PhoneSystemService';
import { SubmissionService } from './SubmissionService';
import { MySQLSubmissionRepository } from '../repositories/MySQLSubmissionRepository';
import { AI_REVIEWER_FEEDBACK_QUESTION_TEXT } from '../repositories/MySQLFormRepository';
import logger from '../config/logger';
import type {
  CreateSubmissionAnswerDTO,
  SubmissionMetadataDTO,
  AiTimelineItem,
  AiObservation,
  AiObservationKind,
  AiObservationSeverity,
} from '../models/Submission';
import { buildAiReviewerPrompt, type FormForPrompt } from './aiReviewerPrompt';
import { withCallLog, type CallLogMeta } from './aiCallLogger';
import aiCalibrationService, { type CalibrationCorrection } from './AICalibrationService';
import rulePackService from './RulePackService';
import { estimateUsdCost, type CostEstimate } from './aiCostEstimator';
import { checkBudget } from './AIReviewerCostGuard';
import { applyCalibration } from './ConfidenceCalibrator';

/** Merge two arrays of strings, dropping duplicates, preserving order. */
function mergeUniqueStrings(a: string[] | undefined, b: string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of [...(a ?? []), ...(b ?? [])]) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

export class AIReviewerServiceError extends Error {
  constructor(message: string, public code: string, public statusCode: number = 400) {
    super(message);
    this.name = 'AIReviewerServiceError';
  }
}

interface InteractionMaterial {
  /** Compact key/value summary of the audited record (for the prompt header). */
  header: Record<string, string>;
  /** Full ordered notes / transcript. */
  notesOrTranscript: CRMNote[];
  /** Free-text classification used to construct the KB search query. */
  classificationText: string;
  /** Author IDs whose recent notes seed the cut-and-paste heuristic. */
  noteAuthorIds: number[];
  /** When the interaction closed (validates "is closed" guard). */
  closedOn: Date | null;
  /** Status text from the source system (used to validate "is closed"). */
  statusText: string | null;
  /** Display name of the agent who handled the interaction (used to resolve qtip CSR). */
  agentDisplayName: string | null;
  /** Date the interaction took place / opened (drives the "Interaction Date" metadata field). */
  interactionDate: Date | null;
  /**
   * Mandatory KB URLs sourced from the interaction itself (today: the active
   * playbook links on a ticket's classification). These are the documented
   * process the agent was supposed to follow on this exact kind of work, so
   * they go into the prompt FIRST and outrank text-search hits.
   */
  mandatoryKbUrls: string[];
}

/**
 * Payload merged into the SubmissionService.submitAudit / saveDraft
 * call so the AI's submission is linked back to the source interaction.
 *
 * - Tickets and tasks land in `submission_ticket_tasks` (reference-only,
 *   live-fetched at view time).
 * - Calls land in `submission_calls` via the existing `call_ids` +
 *   `call_data` virtual-call upsert path used by the human audit flow.
 */
type SubmissionLinkPayload =
  | { ticket_tasks: { kind: 'TICKET' | 'TASK'; external_id: number }[] }
  | {
      call_ids: number[];
      call_data: Array<{
        call_id: string;
        call_date?: string | Date;
        duration?: number;
        recording_url?: string | null;
        transcript?: string | null;
      }>;
    };

interface InteractionAdapter<TId = number> {
  kind: 'TICKET' | 'TASK' | 'CALL';
  loadMaterial(id: TId): Promise<InteractionMaterial>;
  toSubmissionLink(id: TId, material: InteractionMaterial): SubmissionLinkPayload;
  isClosed(material: InteractionMaterial): boolean;
  /** How the source id renders in log / response messages. */
  formatId(id: TId): string;
}

const TicketAdapter: InteractionAdapter<number> = {
  kind: 'TICKET',
  async loadMaterial(ticketId: number): Promise<InteractionMaterial> {
    const header = await crmService.getTicketHeader(ticketId);
    if (!header) {
      throw new AIReviewerServiceError(`Ticket ${ticketId} not found in CRM`, 'TICKET_NOT_FOUND', 404);
    }
    const [notes, playbookLinks] = await Promise.all([
      crmService.getTicketNotes(ticketId),
      crmService.getTicketPlaybookLinks(ticketId),
    ]);
    return {
      header: ticketHeaderToFlat(header),
      notesOrTranscript: notes,
      classificationText: [header.class_name, header.subclass_name].filter(Boolean).join(' '),
      noteAuthorIds: Array.from(new Set(notes.map((n) => n.created_by).filter((v): v is number => v != null))),
      closedOn: header.modified_on, // CRM doesn't expose closed_on directly; modified_on is the closest signal
      statusText: header.status,
      agentDisplayName: header.assigned_to_name,
      interactionDate: header.created_on ?? header.modified_on,
      mandatoryKbUrls: playbookLinks.map((l) => l.link_url).filter(Boolean),
    };
  },
  toSubmissionLink(ticketId) {
    return { ticket_tasks: [{ kind: 'TICKET', external_id: ticketId }] };
  },
  isClosed(material) {
    const s = (material.statusText || '').toLowerCase();
    return s === 'closed' || s === 'resolved';
  },
  formatId(ticketId) {
    return String(ticketId);
  },
};

/**
 * AR-Ops / billing tasks. Same notes-shape as tickets (CRMNote rows), so
 * the existing prompt builder renders them the same way. There's no
 * playbook-link concept on tasks today, so mandatoryKbUrls is empty —
 * KB grounding falls through to the search/semantic layers.
 */
const TaskAdapter: InteractionAdapter<number> = {
  kind: 'TASK',
  async loadMaterial(taskId: number): Promise<InteractionMaterial> {
    const header = await crmService.getTaskHeader(taskId);
    if (!header) {
      throw new AIReviewerServiceError(`Task ${taskId} not found in CRM`, 'TASK_NOT_FOUND', 404);
    }
    const notes = await crmService.getTaskNotes(taskId);
    return {
      header: taskHeaderToFlat(header),
      notesOrTranscript: notes,
      classificationText: header.task_type ?? '',
      noteAuthorIds: Array.from(new Set(notes.map((n) => n.created_by).filter((v): v is number => v != null))),
      closedOn: header.completed_on,
      statusText: header.task_status,
      agentDisplayName: header.assigned_to_name,
      interactionDate: header.created_on,
      mandatoryKbUrls: [],
    };
  },
  toSubmissionLink(taskId) {
    return { ticket_tasks: [{ kind: 'TASK', external_id: taskId }] };
  },
  isClosed(material) {
    const s = (material.statusText || '').toLowerCase();
    // Task statuses use phrasing like "Closed", "Completed", "Resolved" depending on tblTaskStatus rows.
    return s.includes('closed') || s.includes('completed') || s.includes('resolved') || s === 'done';
  },
  formatId(taskId) {
    return String(taskId);
  },
};

/**
 * Phone-system call transcripts (Genesys conversation IDs). Persistence
 * uses the existing virtual-call upsert path (`call_ids: [-1]` + a
 * matching `call_data[0]`) so a `Call` row is materialized in the qtip
 * `calls` table on first use, then linked via `submission_calls`. The
 * AI Reviewer user owns the row so foreign-key constraints are satisfied
 * even when the conversation has never been audited by a human.
 */
const ConversationAdapter: InteractionAdapter<string> = {
  kind: 'CALL',
  async loadMaterial(conversationId: string): Promise<InteractionMaterial> {
    const [transcripts, meta] = await Promise.all([
      phoneSystemService.getTranscriptByConversationId(conversationId),
      phoneSystemService.getConversationMetaByConversationId(conversationId),
    ]);

    const transcriptText = (transcripts ?? [])
      .map((t) => {
        try {
          const parsed = JSON.parse(t.transcript);
          return typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
        } catch {
          return t.transcript;
        }
      })
      .filter((s) => s && s.trim().length > 0)
      .join('\n\n---\n\n');

    if (!transcriptText) {
      throw new AIReviewerServiceError(
        `Conversation ${conversationId} has no transcript available in PhoneSystem.`,
        'CONVERSATION_NOT_FOUND',
        404
      );
    }

    const startEt = meta?.start_et ?? null;
    // Synthesize a single CRMNote so the existing prompt builder can render
    // the transcript verbatim through the same template path.
    const transcriptAsNote: CRMNote = {
      id: 1,
      note: transcriptText,
      created_on: startEt ? startEt.toISOString() : null,
      created_by: null,
      created_by_name: 'Call Transcript',
      status_after: null,
      next_contact_date: null,
      is_after_audit: false,
    };

    return {
      header: conversationHeaderToFlat(conversationId, meta),
      notesOrTranscript: [transcriptAsNote],
      // Conversations have no classification field today — leave blank
      // and lean on the form's ai_review_guidance + global KB index.
      classificationText: '',
      noteAuthorIds: [],
      closedOn: meta?.end_et ?? null,
      // PhoneSystem only exposes completed conversations through the
      // transcript table, so presence of a transcript implies "closed".
      statusText: 'Closed',
      agentDisplayName: null,
      interactionDate: startEt,
      mandatoryKbUrls: [],
    };
  },
  toSubmissionLink(conversationId, material) {
    const transcript = material.notesOrTranscript[0]?.note ?? null;
    const callDate = material.interactionDate ?? new Date();
    const duration =
      material.closedOn && material.interactionDate
        ? Math.max(0, Math.round((material.closedOn.getTime() - material.interactionDate.getTime()) / 1000))
        : 0;
    return {
      call_ids: [-1],
      call_data: [
        {
          call_id: conversationId,
          call_date: callDate,
          duration,
          recording_url: null,
          transcript,
        },
      ],
    };
  },
  isClosed(material) {
    return material.notesOrTranscript.length > 0;
  },
  formatId(conversationId) {
    return conversationId;
  },
};

function ticketHeaderToFlat(h: TicketHeader): Record<string, string> {
  return {
    'Ticket ID': String(h.ticket_id),
    Class: h.class_name ?? '',
    Subclass: h.subclass_name ?? '',
    Status: h.status ?? '',
    Resolution: h.resolution ?? '',
    'Assigned To': h.assigned_to_name ?? (h.assigned_to_id != null ? `User #${h.assigned_to_id}` : ''),
    'Customer ID': h.customer_id != null ? String(h.customer_id) : '',
    'Created On': h.created_on?.toISOString() ?? '',
    'Modified On': h.modified_on?.toISOString() ?? '',
    Description: h.description ?? '',
  };
}

function taskHeaderToFlat(h: TaskHeader): Record<string, string> {
  return {
    'Task ID': String(h.task_id),
    'Task Type': h.task_type ?? '',
    Status: h.task_status ?? '',
    'Assigned To': h.assigned_to_name ?? (h.assigned_to_id != null ? `User #${h.assigned_to_id}` : ''),
    'Customer ID': h.customer_id != null ? String(h.customer_id) : '',
    'Created On': h.created_on?.toISOString() ?? '',
    'Due On': h.due_on?.toISOString() ?? '',
    'Completed On': h.completed_on?.toISOString() ?? '',
  };
}

function conversationHeaderToFlat(
  conversationId: string,
  meta: { start_et: Date | null; end_et: Date | null; duration_seconds: number } | null
): Record<string, string> {
  return {
    'Conversation ID': conversationId,
    'Started At': meta?.start_et?.toISOString() ?? '',
    'Ended At': meta?.end_et?.toISOString() ?? '',
    'Duration (seconds)': meta?.duration_seconds != null ? String(meta.duration_seconds) : '',
  };
}

export interface AIReviewResult {
  submission_id: number;
  /** 0 when status === 'DRAFT' (no scoring runs on drafts). */
  total_score: number;
  /** 'SUBMITTED' for the default flow; 'DRAFT' when the form has ai_submit_as_draft=true (Phase 5). */
  status: 'SUBMITTED' | 'DRAFT';
  message: string;
  ai_model: string;
  kb_pages_cited: { id: number; name: string; url: string }[];
  /**
   * TEMP COST ESTIMATOR — non-persistent per-run USD cost. NOT a database
   * column. Surfaced so the manual-run toast can display the cost. Will
   * be removed when we wire up real usage analytics.
   */
  cost_estimate?: { usd: number; formatted: string; approximated: boolean } | null;
}

export type AiProvider = 'anthropic' | 'openai';

/**
 * Result of running the analysis pipeline WITHOUT writing a submission.
 * Used by tooling (e.g. the dual-provider comparison script) that wants
 * to see what the model would have answered without polluting the audit
 * history.
 */
export interface AIAnalysisResult {
  provider: AiProvider;
  model: string;
  elapsedMs: number;
  retried: boolean;
  /** Header rendered exactly as it would appear in the prompt. */
  header: Record<string, string>;
  /** Notes count fed to the model. */
  notesCount: number;
  /** KB pages we placed into the prompt (with playbook flag). */
  kbPagesProvided: { id: number; name: string; url: string; is_playbook: boolean }[];
  /** Per-question answers, enriched with question text/type for reporting. */
  answers: {
    question_id: number;
    category_name: string;
    question_text: string;
    question_type: string;
    value: string;
    confidence: number | null;
  }[];
  /** Top-level narrative that would have populated the AI Reviewer Feedback. */
  narrative: string;
  /** KB citations the model produced. */
  kbCitations: { id: number; name: string; url: string }[];
  /** Top-level confidence the AI emitted for the whole review (null if not provided). */
  overallConfidence: number | null;
  /** AI-reconstructed chronological action timeline. */
  timeline: AiTimelineItem[];
  /** Non-scored advisory observations. */
  observations: AiObservation[];
}

/**
 * Public service surface. Methods for tasks and calls follow the same
 * shape as `reviewClosedTicket` once their adapters land.
 */
export class AIReviewerService {
  private readonly submissionService: SubmissionService;

  constructor() {
    this.submissionService = new SubmissionService(new MySQLSubmissionRepository());
  }

  isConfigured(): boolean {
    return aiReviewerConfig !== null && isAnthropicConfigured() && bookstackService.isConfigured();
  }

  async reviewClosedTicket(ticketId: number, opts: { formId: number }): Promise<AIReviewResult> {
    return this.review(TicketAdapter, ticketId, opts);
  }

  /**
   * AR-Ops / billing closed task. Mirrors the ticket flow but uses
   * `CRMService.getTaskHeader` + `getTaskNotes` for material loading.
   * Persists with `kind = 'TASK'` in `submission_ticket_tasks`.
   */
  async reviewClosedTask(taskId: number, opts: { formId: number }): Promise<AIReviewResult> {
    return this.review(TaskAdapter, taskId, opts);
  }

  /**
   * Phone-system call transcript (Genesys conversation ID). Materializes
   * a `Call` row in qtip on first use and links via `submission_calls`,
   * matching the existing virtual-call upsert path used by humans.
   */
  async reviewClosedConversation(conversationId: string, opts: { formId: number }): Promise<AIReviewResult> {
    return this.review(ConversationAdapter, conversationId, opts);
  }

  /**
   * Run the analysis pipeline (load form, load material, KB grounding,
   * LLM call, parse, validate) WITHOUT writing a submission. Intended for
   * provider-comparison tooling and offline experimentation. Supports
   * `provider: 'anthropic' | 'openai'` so the same prompt can be evaluated
   * across models.
   */
  async analyzeTicket(
    ticketId: number,
    opts: { formId: number; provider?: AiProvider }
  ): Promise<AIAnalysisResult> {
    return this.analyze(TicketAdapter, ticketId, {
      formId: opts.formId,
      provider: opts.provider ?? 'anthropic',
    });
  }

  private async analyze<TId>(
    adapter: InteractionAdapter<TId>,
    sourceId: TId,
    opts: { formId: number; provider: AiProvider }
  ): Promise<AIAnalysisResult> {
    if (opts.provider === 'anthropic' && !isAnthropicConfigured()) {
      throw new AIReviewerServiceError('Anthropic is not configured (set ANTHROPIC_API_KEY).', 'NOT_CONFIGURED', 503);
    }
    if (opts.provider === 'openai' && !isOpenAIConfigured()) {
      throw new AIReviewerServiceError('OpenAI is not configured (set OPENAI_API_KEY).', 'NOT_CONFIGURED', 503);
    }
    if (!bookstackService.isConfigured()) {
      throw new AIReviewerServiceError('BookStack is not configured.', 'NOT_CONFIGURED', 503);
    }

    const form = await loadFormForReview(opts.formId, adapter.kind);
    const material = await adapter.loadMaterial(sourceId);
    if (!adapter.isClosed(material)) {
      throw new AIReviewerServiceError(
        `${adapter.kind} ${adapter.formatId(sourceId)} is not closed (current status: ${material.statusText ?? 'unknown'})`,
        'INTERACTION_NOT_CLOSED',
        422
      );
    }

    const packAnchorUrls = rulePackService.getAlwaysIncludeUrlsForForm(opts.formId);
    const mandatoryUrls = mergeUniqueStrings(material.mandatoryKbUrls, packAnchorUrls);
    const kbHits = await searchKb(material.classificationText, mandatoryUrls);
    const corrections = await loadCorrectionsForPrompt(opts.formId);
    const promptParts = buildAiReviewerPrompt({
      form,
      adapterKind: adapter.kind,
      header: material.header,
      notes: material.notesOrTranscript,
      kbHits,
      corrections,
    });

    const started = Date.now();
    const traceCtx: CallLogMeta = {
      provider: opts.provider,
      purpose: `ai_reviewer.${adapter.kind.toLowerCase()}.analyze`,
      ticketId: adapter.kind === 'TICKET' && typeof sourceId === 'number' ? sourceId : null,
      formId: opts.formId,
    };
    const { answers, narrative, kbCitations, overallConfidence, timeline, observations, model, retried } =
      await callLlm(opts.provider, promptParts, form, traceCtx);
    const elapsedMs = Date.now() - started;

    const questionsById = new Map(form.questions.map((q) => [q.id, q]));
    const enrichedAnswers = answers.map((a) => {
      const q = questionsById.get(a.question_id);
      return {
        question_id: a.question_id,
        category_name: q?.category_name ?? '(unknown)',
        question_text: q?.question_text ?? '(unknown)',
        question_type: q?.question_type ?? '(unknown)',
        value: a.answer,
        confidence: a.ai_confidence ?? null,
      };
    });

    return {
      provider: opts.provider,
      model,
      elapsedMs,
      retried,
      header: material.header,
      notesCount: material.notesOrTranscript.length,
      kbPagesProvided: kbHits.map((h) => ({ id: h.id, name: h.name, url: h.url, is_playbook: h.is_playbook })),
      answers: enrichedAnswers,
      narrative,
      kbCitations,
      overallConfidence,
      timeline,
      observations,
    };
  }

  /**
   * Generic review path shared by every InteractionAdapter. Public methods
   * (reviewClosedTicket / reviewClosedTask / reviewClosedConversation)
   * just pick the adapter and forward through here.
   */
  private async review<TId>(
    adapter: InteractionAdapter<TId>,
    sourceId: TId,
    opts: { formId: number }
  ): Promise<AIReviewResult> {
    if (!aiReviewerConfig) {
      throw new AIReviewerServiceError('AI Reviewer is not configured (set AI_REVIEWER_USER_ID).', 'NOT_CONFIGURED', 503);
    }
    if (!isAnthropicConfigured()) {
      throw new AIReviewerServiceError('Anthropic is not configured (set ANTHROPIC_API_KEY).', 'NOT_CONFIGURED', 503);
    }
    if (!bookstackService.isConfigured()) {
      throw new AIReviewerServiceError('BookStack is not configured.', 'NOT_CONFIGURED', 503);
    }

    const aiUserId = aiReviewerConfig.userId;
    const form = await loadFormForReview(opts.formId, adapter.kind);

    // Phase 7b: per-form monthly cost budget. Budget hit -> short-circuit
    // before we burn another LLM call. We surface this as a 503 with code
    // BUDGET_EXCEEDED so the route handler can route the submission to a
    // human reviewer with an explanation rather than silently failing or
    // producing a degraded AI grade.
    const budget = await checkBudget(opts.formId);
    if (!budget.allowed) {
      logger.warn(
        `[AI REVIEWER] form_id=${opts.formId} BUDGET_EXCEEDED mtd=$${budget.mtdUsd.toFixed(2)} cap=$${(budget.budgetUsd ?? 0).toFixed(2)}`
      );
      throw new AIReviewerServiceError(budget.reason, 'BUDGET_EXCEEDED', 503);
    }
    if (budget.warn) {
      logger.warn(
        `[AI REVIEWER] form_id=${opts.formId} budget warn (>=80%) mtd=$${budget.mtdUsd.toFixed(2)} cap=$${(budget.budgetUsd ?? 0).toFixed(2)}`
      );
    }

    const material = await adapter.loadMaterial(sourceId);
    if (!adapter.isClosed(material)) {
      throw new AIReviewerServiceError(
        `${adapter.kind} ${adapter.formatId(sourceId)} is not closed (current status: ${material.statusText ?? 'unknown'})`,
        'INTERACTION_NOT_CLOSED',
        422
      );
    }

    const packAnchorUrls = rulePackService.getAlwaysIncludeUrlsForForm(opts.formId);
    const mandatoryUrls = mergeUniqueStrings(material.mandatoryKbUrls, packAnchorUrls);
    const kbHits = await searchKb(material.classificationText, mandatoryUrls);
    const corrections = await loadCorrectionsForPrompt(opts.formId);

    const promptParts = buildAiReviewerPrompt({
      form,
      adapterKind: adapter.kind,
      header: material.header,
      notes: material.notesOrTranscript,
      kbHits,
      corrections,
    });

    const traceCtx: CallLogMeta = {
      provider: 'anthropic',
      purpose: `ai_reviewer.${adapter.kind.toLowerCase()}.review`,
      ticketId: adapter.kind === 'TICKET' && typeof sourceId === 'number' ? sourceId : null,
      formId: opts.formId,
    };
    const { answers, narrative, kbCitations, overallConfidence, timeline, observations, cost } = await callClaude(
      promptParts,
      form,
      traceCtx
    );
    const costPayload = cost
      ? { usd: cost.usd, formatted: cost.formatted, approximated: cost.approximated }
      : null;

    // Compose narrative + KB citations into the auto-managed AI Reviewer
    // Feedback question's free-text answer.
    const feedbackQuestion = form.questions.find((q) => q.question_text.trim() === AI_REVIEWER_FEEDBACK_QUESTION_TEXT);
    if (!feedbackQuestion) {
      throw new AIReviewerServiceError(
        `Form ${form.id} is missing the auto-managed "AI Reviewer Feedback" question. Re-save the form in the form builder to repair it.`,
        'FORM_MISSING_AI_FEEDBACK_QUESTION',
        422
      );
    }

    const feedbackText = composeFeedback({ narrative, kbCitations });
    // Feedback question is human-text — no confidence score makes sense for it.
    const finalAnswers: CreateSubmissionAnswerDTO[] = [
      ...answers,
      { question_id: feedbackQuestion.id, answer: feedbackText },
    ];

    const { csrId, metadata } = await buildSubmissionMetadata({
      formId: form.id,
      agentDisplayName: material.agentDisplayName,
      interactionDate: material.interactionDate,
    });

    const link = adapter.toSubmissionLink(sourceId, material);
    // Calls need a CSR on the materialized Call row; default to the AI
    // Reviewer user when the form metadata didn't resolve one.
    const callCsrId = adapter.kind === 'CALL' ? csrId ?? aiUserId : csrId;

    // Apply per-form confidence calibration. Identity (calibrated === nominal)
    // until the form has an active ai_calibration_map row. Inbox routing
    // queries `ai_calibrated_confidence` so once the calibrator is fit the
    // routing decision automatically uses the empirically-corrected value.
    const calibratedConfidence = await applyCalibration(form.id, overallConfidence ?? null);

    const payload = {
      form_id: form.id,
      submitted_by: aiUserId,
      csr_id: callCsrId,
      metadata,
      answers: finalAnswers,
      ai_overall_confidence: overallConfidence,
      ai_calibrated_confidence: calibratedConfidence,
      ai_extras:
        (timeline && timeline.length > 0) || (observations && observations.length > 0)
          ? { timeline: timeline ?? [], observations: observations ?? [] }
          : null,
      ...link,
    };

    logger.info(
      `[AI REVIEWER] form_id=${form.id} ${adapter.kind.toLowerCase()}_id=${adapter.formatId(sourceId)} ` +
        `overall_confidence=${overallConfidence == null ? 'null' : overallConfidence.toFixed(2)} ` +
        `calibrated_confidence=${calibratedConfidence == null ? 'null' : calibratedConfidence.toFixed(2)} ` +
        `timeline_items=${timeline?.length ?? 0} observations=${observations?.length ?? 0}`
    );

    // Phase 5 branch: when the form opts in to ai_submit_as_draft, route
    // through saveDraft so the AI's grade lands as DRAFT (no scoring) and
    // a human reviews + promotes it. Default path stays unchanged.
    if (form.ai_submit_as_draft) {
      const draftResult = await this.submissionService.saveDraft(payload, aiUserId);
      logger.info(
        `[AI REVIEWER] Saved DRAFT submission_id=${draftResult.submission_id} ` +
          `for form_id=${form.id} ${adapter.kind.toLowerCase()}_id=${adapter.formatId(sourceId)} ` +
          `(awaiting human review).`
      );
      return {
        submission_id: draftResult.submission_id,
        total_score: 0,
        status: 'DRAFT',
        message: draftResult.message,
        ai_model: aiConfig.anthropic?.defaultModel ?? 'unknown',
        kb_pages_cited: kbCitations,
        cost_estimate: costPayload,
      };
    }

    const submitResult = await this.submissionService.submitAudit(payload, aiUserId);

    logger.info(
      `[AI REVIEWER] Submitted audit submission_id=${submitResult.submission_id} ` +
        `for form_id=${form.id} ${adapter.kind.toLowerCase()}_id=${adapter.formatId(sourceId)} ` +
        `score=${submitResult.total_score}`
    );

    return {
      submission_id: submitResult.submission_id,
      total_score: submitResult.total_score,
      status: 'SUBMITTED',
      message: submitResult.message,
      ai_model: aiConfig.anthropic?.defaultModel ?? 'unknown',
      kb_pages_cited: kbCitations,
      cost_estimate: costPayload,
    };
  }
}

/**
 * Pulls recent human corrections for this form so the prompt builder
 * can inject them as few-shot lessons (closes the calibration feedback
 * loop). Logged at info level on every run so operators can see the
 * loop firing in stdout. Returns [] on any failure — the AI run must
 * never fail because the calibration loop is unavailable.
 */
async function loadCorrectionsForPrompt(formId: number): Promise<CalibrationCorrection[]> {
  try {
    const corrections = await aiCalibrationService.getRecentCorrections(formId);
    if (corrections.length > 0) {
      const totalChars = corrections.reduce(
        (sum, c) =>
          sum +
          c.question_text.length +
          c.ai_value.length +
          c.human_value.length +
          80, // header / label fixed overhead per row
        0
      );
      logger.info(
        `[AI REVIEWER] injected ${corrections.length} learned corrections (~${totalChars} chars) for form_id=${formId}`
      );
    } else {
      logger.info(`[AI REVIEWER] no learned corrections to inject for form_id=${formId}`);
    }
    return corrections;
  } catch (err) {
    logger.warn(
      `[AI REVIEWER] failed to load calibration corrections for form_id=${formId} (continuing without): ${(err as Error).message}`
    );
    return [];
  }
}

/** Loads form definition + validates AI eligibility. Throws on any failure. */
async function loadFormForReview(formId: number, expectedKind: 'TICKET' | 'TASK' | 'CALL'): Promise<FormForPrompt & { ai_submit_as_draft: boolean }> {
  const form = await prisma.form.findUnique({
    where: { id: formId },
    include: {
      form_categories: {
        include: { form_questions: { include: { radio_options: true } } },
        orderBy: { sort_order: 'asc' },
      },
    },
  });
  if (!form) throw new AIReviewerServiceError(`Form ${formId} not found`, 'FORM_NOT_FOUND', 404);
  if (!(form as any).ai_enabled) {
    throw new AIReviewerServiceError(
      `Form ${formId} does not have ai_enabled = true. Enable it in the form builder.`,
      'FORM_NOT_AI_ELIGIBLE',
      403
    );
  }

  // interaction_type is informational on AI runs — the operator picks which
  // form to grade with by passing its formId, so we just log a mismatch
  // instead of refusing. Set the form's type to TICKET (or UNIVERSAL) in
  // the form-builder if you want it to stop nagging.
  const formInteractionType = form.interaction_type as string;
  if (formInteractionType !== 'UNIVERSAL' && formInteractionType !== expectedKind) {
    logger.warn(
      `[AI REVIEWER] form_id=${formId} interaction_type=${formInteractionType} does not match the requested ${expectedKind}; proceeding anyway. ` +
        `Update the form's type to ${expectedKind} (or UNIVERSAL) to silence this warning.`
    );
  }

  const questions = form.form_categories.flatMap((c) =>
    c.form_questions.map((q) => ({
      id: q.id,
      category_name: c.category_name,
      question_text: q.question_text,
      question_type: q.question_type as string,
      yes_value: q.yes_value,
      no_value: q.no_value,
      na_value: q.na_value,
      is_na_allowed: q.is_na_allowed,
      radio_options: q.radio_options.map((r) => ({ value: r.option_value, text: r.option_text, score: r.score })),
    }))
  );

  return {
    id: form.id,
    form_name: form.form_name,
    interaction_type: formInteractionType,
    ai_review_guidance: ((form as any).ai_review_guidance ?? null) as string | null,
    ai_submit_as_draft: (form as any).ai_submit_as_draft === true,
    categories: form.form_categories.map((c) => ({ id: c.id, category_name: c.category_name })),
    questions,
  };
}

/**
 * Resolves the form's metadata fields for an AI submission:
 *   • Reviewer Name (AUTO)    → "AI Reviewer"
 *   • Review Date  (AUTO)     → today (yyyy-mm-dd)
 *   • CSR          (DROPDOWN) → qtip user.id matched by username == CRM agent display name
 *   • Interaction Date (DATE) → ticket created_on (yyyy-mm-dd)
 * Any other custom metadata fields are left blank — the human can fill them
 * later if needed.
 */
async function buildSubmissionMetadata(args: {
  formId: number;
  agentDisplayName: string | null;
  interactionDate: Date | null;
}): Promise<{ csrId: number | null; metadata: SubmissionMetadataDTO[] }> {
  const fields = await prisma.formMetadataField.findMany({
    where: { form_id: args.formId },
    orderBy: { sort_order: 'asc' },
  });
  if (fields.length === 0) return { csrId: null, metadata: [] };

  const todayIso = new Date().toISOString().slice(0, 10);
  const interactionIso = args.interactionDate ? args.interactionDate.toISOString().slice(0, 10) : '';

  let csrId: number | null = null;
  if (args.agentDisplayName) {
    const matched = await prisma.user.findFirst({
      where: { username: args.agentDisplayName, is_active: true },
      select: { id: true },
    });
    if (matched) {
      csrId = matched.id;
    } else {
      logger.warn(`[AI REVIEWER] Could not match CRM agent "${args.agentDisplayName}" to a qtip user; CSR field will be empty.`);
    }
  }

  const metadata: SubmissionMetadataDTO[] = [];
  for (const f of fields) {
    const name = (f.field_name || '').trim().toLowerCase();
    let value = '';
    if (f.field_type === 'AUTO') {
      if (name.includes('reviewer name') || name.includes('auditor name')) value = 'AI Reviewer';
      else if (name.includes('review date') || name.includes('audit date')) value = todayIso;
    } else if (f.field_type === 'DROPDOWN' && !f.dropdown_source) {
      // user-list dropdown (typically the CSR field)
      if (csrId != null) value = String(csrId);
    } else if (f.field_type === 'DATE') {
      // Substring match so labels like "Agent Interaction Date",
      // "Ticket Date (closed)", or "Task Date" all resolve to the
      // CRM interaction timestamp.
      if (name.includes('interaction date') || name.includes('ticket date') || name.includes('task date')) {
        value = interactionIso;
      }
    }
    if (value) metadata.push({ field_id: f.id, value });
  }
  return { csrId, metadata };
}

/**
 * BookStack KB grounding for the prompt. Three layers, in order:
 *   1. Mandatory pages — the active playbook URLs assigned to the
 *      ticket's classification (tblPlayBookLink.LinkURL). Highest
 *      authority; they're the exact documented process for this ticket.
 *   2. Search hits — top page results from BookStack full-text search
 *      against the ticket's classification text, deduped against layer 1.
 *   3. Semantic hits — top-k pages from the cached KbIndexService
 *      embeddings (Phase 4). Picks up cross-cutting process pages
 *      (e.g. "Ticket Handling Process") that don't share keywords with
 *      the classification text. Runs only if budget remains.
 *
 * Total content is capped (see `charBudget` below) so the prompt stays
 * within the model's comfortable context budget. Each result carries an
 * `is_playbook` flag so the prompt builder can label it appropriately.
 */
/**
 * KB pages that apply to EVERY review, regardless of form / classification.
 * Always pulled into the prompt as `KB PAGE` (not `ASSIGNED PLAYBOOK PAGE`)
 * so the model treats them as standing policy refs, not as the per-ticket
 * playbook. Reviewer ask 2026-05: "Documentation Policy" and
 * "Ticket Handling - Do's and Don'ts" should be visible to the AI on every
 * audit so it can grade documentation quality and ticket-handling best
 * practices consistently across departments.
 *
 * NB: "Ticket Handling Process" is intentionally NOT in this list — it's
 * the per-classification process page and gets injected by the
 * `tech-ticket-process` rule pack via `always_include_urls`, where it
 * correctly lands as a tech-only authority.
 */
const UNIVERSAL_KB_URLS = [
  'http://know.crm.dm-us.com/books/general-support-instructions/page/documentation-policy',
  'http://know.crm.dm-us.com/books/job-billing-customer-service/page/ticket-handling-dos-and-donts',
];

async function searchKb(
  query: string,
  mandatoryUrls: string[] = [],
  universalUrls: string[] = UNIVERSAL_KB_URLS
): Promise<{ id: number; name: string; url: string; content: string; is_playbook: boolean }[]> {
  const result: { id: number; name: string; url: string; content: string; is_playbook: boolean }[] = [];
  const seenIds = new Set<number>();
  let totalChars = 0;
  // Quality-pass: bumped from 15KB → 60KB so the model gets enough KB
  // grounding to actually compare process steps to notes, especially
  // when multiple rule-pack always-include URLs land alongside the
  // playbook page and 5 search hits + 5 semantic hits. With four
  // anchor URLs ~3-5KB each, the old 15KB was clipping mid-sentence.
  const charBudget = 60000;

  for (const url of mandatoryUrls) {
    if (totalChars >= charBudget) break;
    try {
      const page = await bookstackService.getPageByUrl(url);
      if (!page) {
        logger.warn(`[AI REVIEWER] Playbook URL did not resolve to a BookStack page: ${url}`);
        continue;
      }
      if (seenIds.has(page.id)) continue;
      const content = await bookstackService.getPageContent(page.id, 'plaintext');
      const remaining = Math.max(0, charBudget - totalChars);
      const truncated = content.length > remaining ? content.slice(0, remaining) + '…' : content;
      result.push({ id: page.id, name: page.name, url: page.url, content: truncated, is_playbook: true });
      seenIds.add(page.id);
      totalChars += truncated.length;
    } catch (err) {
      logger.warn(`[AI REVIEWER] Playbook page fetch failed for ${url}: ${(err as Error).message}`);
    }
  }

  // Universal authorities: always-on policy pages tagged is_playbook=false
  // so the prompt labels them `KB PAGE`. Pulled AFTER the per-ticket
  // playbook so the playbook stays first in the prompt (and gets first
  // crack at the char budget).
  for (const url of universalUrls) {
    if (totalChars >= charBudget) break;
    try {
      const page = await bookstackService.getPageByUrl(url);
      if (!page) {
        logger.warn(`[AI REVIEWER] Universal KB URL did not resolve to a BookStack page: ${url}`);
        continue;
      }
      if (seenIds.has(page.id)) continue;
      const content = await bookstackService.getPageContent(page.id, 'plaintext');
      const remaining = Math.max(0, charBudget - totalChars);
      const truncated = content.length > remaining ? content.slice(0, remaining) + '…' : content;
      result.push({ id: page.id, name: page.name, url: page.url, content: truncated, is_playbook: false });
      seenIds.add(page.id);
      totalChars += truncated.length;
    } catch (err) {
      logger.warn(`[AI REVIEWER] Universal KB page fetch failed for ${url}: ${(err as Error).message}`);
    }
  }

  const trimmed = query.trim();
  if (trimmed && totalChars < charBudget) {
    let hits: Awaited<ReturnType<typeof bookstackService.searchByText>> = [];
    try {
      hits = await bookstackService.searchByText(trimmed, { count: 10 });
    } catch (err) {
      logger.warn(`[AI REVIEWER] BookStack search failed for "${trimmed}": ${(err as Error).message}`);
    }

    const pageHits = hits.filter((h) => h.type === 'page').slice(0, 5);
    for (const hit of pageHits) {
      if (totalChars >= charBudget) break;
      if (seenIds.has(hit.id)) continue;
      try {
        const content = await bookstackService.getPageContent(hit.id, 'plaintext');
        const remaining = Math.max(0, charBudget - totalChars);
        const truncated = content.length > remaining ? content.slice(0, remaining) + '…' : content;
        result.push({ id: hit.id, name: hit.name, url: hit.url, content: truncated, is_playbook: false });
        seenIds.add(hit.id);
        totalChars += truncated.length;
      } catch (err) {
        logger.warn(`[AI REVIEWER] BookStack page ${hit.id} fetch failed: ${(err as Error).message}`);
      }
    }
  }

  // Layer 3: semantic hits. Only runs when budget remains AND the index
  // is configured. A failing semanticSearch is non-fatal — we just skip
  // the layer and return what we have, preserving pre-Phase-4 behavior.
  if (trimmed && totalChars < charBudget && kbIndexService.isConfigured()) {
    try {
      const semantic = await kbIndexService.semanticSearch(trimmed, 5);
      for (const hit of semantic) {
        if (totalChars >= charBudget) break;
        if (seenIds.has(hit.id)) continue;
        try {
          const content = await bookstackService.getPageContent(hit.id, 'plaintext');
          const remaining = Math.max(0, charBudget - totalChars);
          const truncated = content.length > remaining ? content.slice(0, remaining) + '…' : content;
          result.push({ id: hit.id, name: hit.name, url: hit.url, content: truncated, is_playbook: false });
          seenIds.add(hit.id);
          totalChars += truncated.length;
        } catch (err) {
          logger.warn(`[AI REVIEWER] semantic page ${hit.id} fetch failed: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      logger.warn(`[AI REVIEWER] Semantic KB layer failed (skipping): ${(err as Error).message}`);
    }
  }

  return result;
}

interface ClaudeOutput {
  answers: CreateSubmissionAnswerDTO[];
  narrative: string;
  kbCitations: { id: number; name: string; url: string }[];
  /** Top-level confidence the AI emits for the whole review (0..1, null if not provided). */
  overallConfidence: number | null;
  /** AI-reconstructed chronological action timeline (empty array if none). */
  timeline: AiTimelineItem[];
  /** Non-scored advisory observations (empty array if none). */
  observations: AiObservation[];
  /** TEMP COST ESTIMATOR — non-persistent USD cost estimate; null when tokens unknown. */
  cost: CostEstimate | null;
}

interface LlmOutput extends ClaudeOutput {
  model: string;
  retried: boolean;
}

/**
 * Provider-aware LLM dispatcher used by the analyzeTicket() path.
 * The production reviewClosedTicket() path still goes through callClaude()
 * directly to keep its diff minimal and behavior unchanged.
 */
async function callLlm(
  provider: AiProvider,
  promptParts: { system: string; user: string },
  form: FormForPrompt,
  traceCtx?: CallLogMeta
): Promise<LlmOutput> {
  if (provider === 'openai') return callOpenAI(promptParts, form, traceCtx);
  return callAnthropic(promptParts, form, traceCtx);
}

/**
 * Anthropic variant. Mirrors callClaude() but returns the model + retried
 * flag for the analysis path. Wrapped in withCallLog so every invocation
 * lands a trace row in ai_call_logs (Phase 3).
 */
async function callAnthropic(
  promptParts: { system: string; user: string },
  form: FormForPrompt,
  traceCtx?: CallLogMeta
): Promise<LlmOutput> {
  return withCallLog<LlmOutput>(
    traceCtx ?? { provider: 'anthropic', purpose: 'ai_reviewer.unknown' },
    promptParts,
    async () => {
      const client = getAnthropicClient();
      const model = aiConfig.anthropic?.defaultModel ?? 'claude-opus-4-7';
      let retried = false;
      let tokensIn: number | null = null;
      let tokensOut: number | null = null;

      const sendOnce = async (extraSystem?: string) => {
        const res = await client.messages.create({
          model,
          max_tokens: 4000,
          system: promptParts.system + (extraSystem ?? ''),
          messages: [{ role: 'user', content: promptParts.user }],
        });
        const usage = (res as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
        if (usage) {
          tokensIn = usage.input_tokens ?? null;
          tokensOut = usage.output_tokens ?? null;
        }
        const textBlock = res.content.find((b) => b.type === 'text') as { text: string } | undefined;
        if (!textBlock) throw new Error('Claude returned no text content');
        return textBlock.text;
      };

      let raw = await sendOnce();
      let parsed = tryParseJson(raw);
      if (!parsed) {
        retried = true;
        logger.warn('[AI REVIEWER] First Anthropic response was not valid JSON; retrying once with stricter system prompt.');
        raw = await sendOnce('\n\nIMPORTANT: Your previous response could not be parsed as JSON. Respond with ONLY the JSON object, nothing else, no prose, no code fences.');
        parsed = tryParseJson(raw);
      }
      if (!parsed) {
        throw new AIReviewerServiceError('Anthropic failed to return valid JSON after one retry.', 'AI_OUTPUT_INVALID', 502);
      }
      const out = mapClaudeOutputToAnswers(parsed, form);
      const cost = estimateUsdCost(model, tokensIn, tokensOut);
      if (cost) {
        logger.info(
          `[AI REVIEWER] TEMP COST ESTIMATOR: model=${model} in=${cost.inputTokens} out=${cost.outputTokens} ` +
            `usd=${cost.formatted}${cost.approximated ? ' (approximated)' : ''}`
        );
      }
      return {
        result: { ...out, cost, model, retried },
        model,
        rawResponse: raw,
        retried,
        tokensIn,
        tokensOut,
      };
    }
  );
}

/**
 * OpenAI variant. Uses chat.completions with response_format json_object
 * which guarantees the model returns a parseable JSON object on the first
 * try (the JSON-retry fallback is still present for safety). Wrapped in
 * withCallLog so every invocation lands a trace row in ai_call_logs
 * (Phase 3).
 */
async function callOpenAI(
  promptParts: { system: string; user: string },
  form: FormForPrompt,
  traceCtx?: CallLogMeta
): Promise<LlmOutput> {
  return withCallLog<LlmOutput>(
    traceCtx ?? { provider: 'openai', purpose: 'ai_reviewer.unknown' },
    promptParts,
    async () => {
      const client = getOpenAIClient();
      const model = aiConfig.openai?.defaultModel ?? 'gpt-5';
      let retried = false;
      let tokensIn: number | null = null;
      let tokensOut: number | null = null;

      const sendOnce = async (extraSystem?: string): Promise<string> => {
        const res = await client.chat.completions.create({
          model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: promptParts.system + (extraSystem ?? '') },
            { role: 'user', content: promptParts.user },
          ],
        });
        const usage = res.usage;
        if (usage) {
          tokensIn = usage.prompt_tokens ?? null;
          tokensOut = usage.completion_tokens ?? null;
        }
        return res.choices[0]?.message?.content ?? '';
      };

      let raw = await sendOnce();
      let parsed = tryParseJson(raw);
      if (!parsed) {
        retried = true;
        logger.warn('[AI REVIEWER] First OpenAI response was not valid JSON; retrying once with stricter system prompt.');
        raw = await sendOnce('\n\nIMPORTANT: Your previous response could not be parsed as JSON. Respond with ONLY the JSON object, nothing else, no prose, no code fences.');
        parsed = tryParseJson(raw);
      }
      if (!parsed) {
        throw new AIReviewerServiceError('OpenAI failed to return valid JSON after one retry.', 'AI_OUTPUT_INVALID', 502);
      }
      const out = mapClaudeOutputToAnswers(parsed, form);
      const cost = estimateUsdCost(model, tokensIn, tokensOut);
      if (cost) {
        logger.info(
          `[AI REVIEWER] TEMP COST ESTIMATOR: model=${model} in=${cost.inputTokens} out=${cost.outputTokens} ` +
            `usd=${cost.formatted}${cost.approximated ? ' (approximated)' : ''}`
        );
      }
      return {
        result: { ...out, cost, model, retried },
        model,
        rawResponse: raw,
        retried,
        tokensIn,
        tokensOut,
      };
    }
  );
}

/**
 * Production-path Claude call (used by review() to actually persist a
 * submission). Wrapped in withCallLog so every prod review writes a trace
 * row to ai_call_logs (Phase 3).
 */
async function callClaude(
  promptParts: { system: string; user: string },
  form: FormForPrompt,
  traceCtx?: CallLogMeta
): Promise<ClaudeOutput> {
  return withCallLog<ClaudeOutput>(
    traceCtx ?? { provider: 'anthropic', purpose: 'ai_reviewer.unknown' },
    promptParts,
    async () => {
      const client = getAnthropicClient();
      const model = aiConfig.anthropic?.defaultModel ?? 'claude-opus-4-7';
      let retried = false;
      let tokensIn: number | null = null;
      let tokensOut: number | null = null;

      const sendOnce = async (extraSystem?: string) => {
        const res = await client.messages.create({
          model,
          max_tokens: 4000,
          system: promptParts.system + (extraSystem ?? ''),
          messages: [{ role: 'user', content: promptParts.user }],
        });
        const usage = (res as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
        if (usage) {
          tokensIn = usage.input_tokens ?? null;
          tokensOut = usage.output_tokens ?? null;
        }
        const textBlock = res.content.find((b) => b.type === 'text') as { text: string } | undefined;
        if (!textBlock) throw new Error('Claude returned no text content');
        return textBlock.text;
      };

      let raw = await sendOnce();
      let parsed = tryParseJson(raw);
      if (!parsed) {
        retried = true;
        logger.warn('[AI REVIEWER] First Claude response was not valid JSON; retrying once with stricter system prompt.');
        raw = await sendOnce('\n\nIMPORTANT: Your previous response could not be parsed as JSON. Respond with ONLY the JSON object, nothing else, no prose, no code fences.');
        parsed = tryParseJson(raw);
      }
      if (!parsed) {
        throw new AIReviewerServiceError(
          'Claude failed to return valid JSON after one retry.',
          'AI_OUTPUT_INVALID',
          502
        );
      }

      const out = mapClaudeOutputToAnswers(parsed, form);
      const cost = estimateUsdCost(model, tokensIn, tokensOut);
      if (cost) {
        logger.info(
          `[AI REVIEWER] TEMP COST ESTIMATOR: model=${model} in=${cost.inputTokens} out=${cost.outputTokens} ` +
            `usd=${cost.formatted}${cost.approximated ? ' (approximated)' : ''}`
        );
      }
      return {
        result: { ...out, cost },
        model,
        rawResponse: raw,
        retried,
        tokensIn,
        tokensOut,
      };
    }
  );
}

function tryParseJson(text: string): any | null {
  // Strip optional markdown fences in case the model adds them despite instructions.
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  try {
    return JSON.parse(stripped);
  } catch {
    // Sometimes the model puts JSON inside a paragraph — try the first {...} span.
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function mapClaudeOutputToAnswers(parsed: any, form: FormForPrompt): ClaudeOutput {
  if (!parsed || !Array.isArray(parsed.answers)) {
    throw new AIReviewerServiceError('Claude response missing required field: answers[].', 'AI_OUTPUT_INVALID', 502);
  }

  // Map by question_id → expected answer space, validate every answered question.
  const questionsById = new Map(form.questions.map((q) => [q.id, q]));
  const answeredIds = new Set<number>();
  const out: CreateSubmissionAnswerDTO[] = [];

  for (const a of parsed.answers as any[]) {
    const question = questionsById.get(Number(a.question_id));
    if (!question) continue; // ignore stray answers; AI Feedback question is added by caller
    if (question.question_text.trim() === AI_REVIEWER_FEEDBACK_QUESTION_TEXT) continue; // caller fills this
    if (question.question_type === 'TEXT') continue; // human-written commentary fields stay empty for AI runs
    const validated = validateAnswerForQuestion(a.value, question);
    if (validated == null) {
      throw new AIReviewerServiceError(
        `Claude returned an unrecognized value for question_id=${question.id} (${question.question_text}): ${JSON.stringify(a.value)}`,
        'AI_OUTPUT_INVALID',
        502
      );
    }
    out.push({
      question_id: question.id,
      answer: validated,
      ai_confidence: clampConfidence(a.confidence),
    });
    answeredIds.add(question.id);
  }

  // Every gradeable question must have an answer. TEXT questions are
  // always human-only (except the auto-managed AI Reviewer Feedback,
  // filled by the caller); INFO_BLOCK is non-gradeable display content.
  for (const q of form.questions) {
    if (q.question_text.trim() === AI_REVIEWER_FEEDBACK_QUESTION_TEXT) continue;
    if (q.question_type === 'INFO_BLOCK' || q.question_type === 'TEXT' || q.question_type === 'SUB_CATEGORY') continue;
    if (!answeredIds.has(q.id)) {
      throw new AIReviewerServiceError(
        `Claude did not answer question_id=${q.id} (${q.question_text}).`,
        'AI_OUTPUT_INVALID',
        502
      );
    }
  }

  return {
    answers: out,
    narrative: typeof parsed.narrative === 'string' ? parsed.narrative : '',
    kbCitations: Array.isArray(parsed.kb_citations)
      ? parsed.kb_citations
          .filter((c: any) => c && Number.isInteger(c.id))
          .map((c: any) => ({ id: Number(c.id), name: String(c.name ?? ''), url: String(c.url ?? '') }))
      : [],
    overallConfidence: clampConfidence(parsed.overall_confidence),
    timeline: parseTimelineArray(parsed.timeline),
    observations: parseObservationsArray(parsed.observations),
    cost: null,
  };
}

/**
 * Coerce an arbitrary AI-emitted value into a confidence score in
 * [0, 1] or null. Tolerant of strings ("0.85"), missing keys, and
 * out-of-range values — the AI run never fails because of a bad
 * confidence number; we just drop it.
 */
function clampConfidence(raw: unknown): number | null {
  if (raw == null) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n > 1) return 1;
  // Two-decimal storage matches the DECIMAL(3,2) column.
  return Math.round(n * 100) / 100;
}

/**
 * Parse the AI's `timeline` array into a sanitized AiTimelineItem[].
 * Bad shapes log a warn and return [] — the timeline is advisory and
 * must never break the AI run.
 */
function parseTimelineArray(raw: unknown): AiTimelineItem[] {
  if (!Array.isArray(raw)) return [];
  const out: AiTimelineItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const when = String((item as any).when ?? '').trim();
    const who = String((item as any).who ?? '').trim();
    const action = String((item as any).action ?? '').trim();
    if (!action) continue; // an empty action is meaningless
    const kbStepRaw = (item as any).kb_step;
    const kb_step = kbStepRaw == null || kbStepRaw === '' ? null : String(kbStepRaw).trim();
    out.push({ when, who, action, kb_step });
  }
  return out;
}

const OBSERVATION_KINDS: ReadonlySet<AiObservationKind> = new Set([
  'documentation',
  'best_practice',
  'cadence',
  'process_drift',
  'pii',
  'other',
]);

const OBSERVATION_SEVERITIES: ReadonlySet<AiObservationSeverity> = new Set(['info', 'warn']);

/**
 * Parse the AI's `observations` array into sanitized AiObservation[].
 * Unknown kinds bucket to 'other'; unknown severities default to 'info'.
 * Empty messages are dropped.
 */
function parseObservationsArray(raw: unknown): AiObservation[] {
  if (!Array.isArray(raw)) return [];
  const out: AiObservation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const message = String((item as any).message ?? '').trim();
    if (!message) continue;
    const kindRaw = String((item as any).kind ?? 'other').trim().toLowerCase() as AiObservationKind;
    const kind = OBSERVATION_KINDS.has(kindRaw) ? kindRaw : 'other';
    const sevRaw = String((item as any).severity ?? 'info').trim().toLowerCase() as AiObservationSeverity;
    const severity = OBSERVATION_SEVERITIES.has(sevRaw) ? sevRaw : 'info';
    const evidence = String((item as any).evidence ?? '').trim() || undefined;
    out.push({ kind, severity, message, evidence });
  }
  return out;
}

function validateAnswerForQuestion(value: unknown, question: FormForPrompt['questions'][number]): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  switch (question.question_type) {
    case 'YES_NO': {
      const lower = s.toLowerCase();
      if (lower === 'yes' || lower === '1' || lower === 'true') return 'yes';
      if (lower === 'no' || lower === '0' || lower === 'false') return 'no';
      if (lower === 'na' || lower === 'n/a') {
        if (question.is_na_allowed) return 'NA';
        // Graceful fallback: model picked NA on a question that doesn't allow it.
        // Treat as "no" rather than crashing the whole review — documented evidence
        // of the step is what we asked for, and the model couldn't find it.
        logger.warn(
          `[AI REVIEWER] question_id=${question.id} returned "NA" but is_na_allowed=false; coercing to "no".`
        );
        return 'no';
      }
      return null;
    }
    case 'TEXT':
      return s;
    case 'SCALE': {
      const n = Number(s);
      return Number.isFinite(n) ? String(n) : null;
    }
    case 'RADIO': {
      const opt = question.radio_options.find((o) => o.value === s || o.text === s);
      return opt ? opt.value : null;
    }
    case 'MULTI_SELECT': {
      const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
      const matched = parts
        .map((p) => question.radio_options.find((o) => o.value === p || o.text === p)?.value)
        .filter((v): v is string => !!v);
      return matched.length > 0 ? matched.join(',') : null;
    }
    default:
      return s;
  }
}

/**
 * Compose the AI Reviewer Feedback free-text. Output is HTML so the
 * RichTextDisplay component renders KB references as clickable links
 * straight to the BookStack page (per reviewer ask 2026-05: "make the
 * links in the notes a hyperlink so we can click to the KB page").
 *
 * Strategy:
 *   1. Parse the narrative into bullet lines. The prompt instructs the
 *      model to emit one `Label: verdict` line per audit-chain step
 *      (Description, Subclass, Steps followed, Notes, Resolution,
 *      Closure) plus optional cross-cutting findings. We render each
 *      line as `<li><strong>Label:</strong> …verdict…</li>` so the
 *      reviewer sees a proper bulleted checklist instead of a wall of
 *      `<br>`-joined text. Lines without a recognisable `Label:` prefix
 *      become plain `<li>` items so we never lose content.
 *   2. Linkify in-narrative mentions of any cited KB page name. We
 *      match the page name in quotes (the prompt instructs the model to
 *      cite "by name" — e.g. *(per "Ticket Handling Process")*) and
 *      replace just the quoted name with an <a> tag. Longest names
 *      first so "Ticket Handling Process" wins over a substring like
 *      "Process".
 *   3. Footer "Knowledge Base Citations:" list also rendered as
 *      <a>-tag bullets so reviewers always have a clickable index even
 *      if the model forgets to mention a page in the narrative.
 *
 * Escaping: every model-supplied string (narrative + page name + url)
 * goes through escapeHtml() before assembly. The downstream renderer
 * (RichTextDisplay) also runs DOMPurify, so this is belt-and-suspenders.
 */
function composeFeedback(parts: {
  narrative: string;
  kbCitations: { id: number; name: string; url: string }[];
}): string {
  const cites = parts.kbCitations.filter((c) => c.name && c.url);
  const narrativeText = (parts.narrative ?? '').trim();

  // Pre-build the citation linkifier so we can apply it to each parsed
  // bullet's verdict text.
  const sortedByLen = [...cites].sort((a, b) => b.name.length - a.name.length);
  const linkifyKb = (htmlEscaped: string): string => {
    let out = htmlEscaped;
    for (const c of sortedByLen) {
      const safeName = escapeHtml(c.name);
      const safeUrl = escapeHtml(c.url);
      const anchor = `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeName}</a>`;
      const escapedForRegex = safeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Match quoted name (straight or curly quotes) — the dominant form
      // is `(per "Name")` but be lenient.
      const re = new RegExp(`([\"'\u2018\u2019\u201C\u201D])${escapedForRegex}\\1`, 'g');
      out = out.replace(re, (_m, q: string) => `${q}${anchor}${q}`);
    }
    return out;
  };

  // Recognise lines like `Steps followed: incomplete — switch-to-internet…`.
  // Label = letters/spaces/hyphens followed by a colon + space. We accept
  // any label the model emits (not just the canonical six) so future
  // additions to the audit chain don't fall through to plain-bullet.
  const labelRe = /^([A-Za-z][A-Za-z \-/&]{1,40}):\s+(.+)$/;

  const segments: string[] = [];

  if (narrativeText) {
    const rawLines = narrativeText
      .split(/\r?\n+/)
      .map((l) => l.replace(/^\s*[-*•]\s+/, '').trim()) // strip stray markdown bullets
      .filter((l) => l.length > 0);

    const items: string[] = [];
    for (const line of rawLines) {
      const m = labelRe.exec(line);
      if (m) {
        const label = escapeHtml(m[1].trim());
        const verdict = linkifyKb(escapeHtml(m[2].trim()));
        items.push(`<li><strong>${label}:</strong> ${verdict}</li>`);
      } else {
        items.push(`<li>${linkifyKb(escapeHtml(line))}</li>`);
      }
    }

    if (items.length > 0) {
      segments.push(`<ul>${items.join('')}</ul>`);
    }
  }

  if (segments.length === 0) {
    // Safety net — see Phase 2026-05 reviewer ask: "If it doesn't return
    // anything, instead of showing blank, we should have a note about the
    // AI not returning a narrative referred to Advisory Observations."
    // This fires when the model emits an empty/missing `narrative` field
    // despite the prompt requiring one. Without this, reviewers see only
    // the citations list (or nothing) and assume the AI ran broken.
    segments.push(
      '<p><em>The AI Reviewer did not return a narrative for this submission. ' +
        'See the Advisory Observations panel and the cited Knowledge Base pages below ' +
        'for context, or re-run the AI Reviewer against this ticket to try again.</em></p>'
    );
  }

  if (cites.length > 0) {
    const citationItems = cites
      .map((c) => {
        const safeName = escapeHtml(c.name);
        const safeUrl = escapeHtml(c.url);
        return `<li><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeName}</a></li>`;
      })
      .join('');
    segments.push(`<p><strong>Knowledge Base Citations:</strong></p><ul>${citationItems}</ul>`);
  }
  return segments.join('');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const aiReviewerService = new AIReviewerService();
export default aiReviewerService;

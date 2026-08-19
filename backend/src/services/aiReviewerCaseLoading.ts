/**
 * AI Reviewer — interaction adapters + Case loading.
 *
 * Extracted from `AIReviewerService.ts`. This is the source-system
 * boundary: each `InteractionAdapter` knows how to load one kind of
 * audited material (CRM ticket, CRM task, Genesys call) into the common
 * `InteractionMaterial` shape and how to link it back to a submission.
 * `loadCase` builds a multi-source `Case` from a primary ref (today the
 * only auto-attachment is CALL→ticket discovery), and the small helpers
 * here handle adapter selection, id coercion, the call-window note
 * cutoff, and submission-link merging.
 *
 * Depends only on the source-system services (`CRMService`,
 * `PhoneSystemService`, `CallTicketLinkerService`) and the neutral
 * `aiReviewerTypes` module — NOT on the engine — so there is no import
 * cycle back into `AIReviewerService`.
 */

import crmService, { type TicketHeader, type TaskHeader, type CRMNote } from './CRMService';
import phoneSystemService from './PhoneSystemService';
import { linkCallToTicket } from './CallTicketLinkerService';
import logger from '../config/logger';
import {
  AIReviewerServiceError,
  formatCaseId,
  type InteractionMaterial,
  type SubmissionLinkPayload,
  type CaseSourceRef,
  type Case,
} from './aiReviewerTypes';

export interface InteractionAdapter<TId = number> {
  kind: 'TICKET' | 'TASK' | 'CALL';
  /**
   * `auditCutoffAt` (added for call-window scoping): when this source is
   * an ATTACHED ticket/task on a CALL-primary review, the orchestrator
   * passes the call's end time plus a documentation-period grace window.
   * The adapter MUST drop any notes whose `created_on > auditCutoffAt`
   * before returning, so the AI grader never sees post-call commentary
   * (re-opens, supervisor edits, follow-up agent notes) and cannot use
   * it as hindsight fault evidence. CALL adapter ignores the parameter —
   * its single synthetic "note" is the transcript itself.
   */
  loadMaterial(id: TId, auditCutoffAt?: Date | null): Promise<InteractionMaterial>;
  toSubmissionLink(id: TId, material: InteractionMaterial): SubmissionLinkPayload;
  isClosed(material: InteractionMaterial): boolean;
  /** How the source id renders in log / response messages. */
  formatId(id: TId): string;
}

export const TicketAdapter: InteractionAdapter<number> = {
  kind: 'TICKET',
  async loadMaterial(
    ticketId: number,
    auditCutoffAt?: Date | null
  ): Promise<InteractionMaterial> {
    const header = await crmService.getTicketHeader(ticketId);
    if (!header) {
      throw new AIReviewerServiceError(`Ticket ${ticketId} not found in CRM`, 'TICKET_NOT_FOUND', 404);
    }
    const [allNotes, playbookLinks] = await Promise.all([
      // Threads the cutoff into CRMService so each row gets stamped with
      // `is_after_audit` based on the same wall-clock anchor we use for
      // human-audit replays. The filtering happens below — keep loaders
      // and filtering separate so the log line below can compare counts.
      crmService.getTicketNotes(ticketId, auditCutoffAt ?? null),
      crmService.getTicketPlaybookLinks(ticketId),
    ]);
    const notes = filterPostAuditNotes(allNotes, auditCutoffAt, {
      sourceKind: 'TICKET',
      sourceId: ticketId,
    });
    const headerFlat = ticketHeaderToFlat(header);
    if (auditCutoffAt) {
      headerFlat['Audit scope'] = renderAuditScopeLine(auditCutoffAt);
    }
    return {
      header: headerFlat,
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
export const TaskAdapter: InteractionAdapter<number> = {
  kind: 'TASK',
  async loadMaterial(
    taskId: number,
    auditCutoffAt?: Date | null
  ): Promise<InteractionMaterial> {
    const header = await crmService.getTaskHeader(taskId);
    if (!header) {
      throw new AIReviewerServiceError(`Task ${taskId} not found in CRM`, 'TASK_NOT_FOUND', 404);
    }
    const allNotes = await crmService.getTaskNotes(taskId, auditCutoffAt ?? null);
    const notes = filterPostAuditNotes(allNotes, auditCutoffAt, {
      sourceKind: 'TASK',
      sourceId: taskId,
    });
    const headerFlat = taskHeaderToFlat(header);
    if (auditCutoffAt) {
      headerFlat['Audit scope'] = renderAuditScopeLine(auditCutoffAt);
    }
    return {
      header: headerFlat,
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
export const ConversationAdapter: InteractionAdapter<string> = {
  kind: 'CALL',
  async loadMaterial(
    conversationId: string,
    // Intentionally ignored: the CALL adapter's only "note" is the
    // synthetic transcript wrapper. The audit cutoff is derived FROM
    // the call, not applied to it.
    _auditCutoffAt?: Date | null
  ): Promise<InteractionMaterial> {
    const [transcripts, meta] = await Promise.all([
      phoneSystemService.getTranscriptByConversationId(conversationId),
      phoneSystemService.getConversationMetaByConversationId(conversationId),
    ]);

    // Phase B: preserve the raw transcript content (string or JSON-of-turns)
    // and let renderTranscriptBlock in aiReviewerPrompt.ts format it. The
    // old code pretty-printed any JSON it parsed, which forced the model
    // to read indented JSON instead of speaker-turn-flow text.
    const transcriptText = (transcripts ?? [])
      .map((t) => t.transcript ?? '')
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
  // Built incrementally so empty optional fields are simply absent rather
  // than rendering as `Key: ` lines in the prompt. The renderer treats
  // empty-string values as missing-but-known; either approach works, but
  // omitting keys keeps the header block compact for tickets that have
  // (e.g.) no site, no order, no job assigned.
  const siteParts: string[] = [];
  if (h.site_name) siteParts.push(h.site_name);
  if (h.site_address) siteParts.push(h.site_address);
  if (h.site_city || h.site_state) {
    siteParts.push(`(${[h.site_city, h.site_state].filter(Boolean).join(', ')})`);
  }
  const siteValue =
    h.site_id != null
      ? `${siteParts.join(' ').trim() || `Site #${h.site_id}`} [id ${h.site_id}]`
      : '';

  const contactName = [h.contact_first_name, h.contact_last_name].filter(Boolean).join(' ').trim();
  const contactValue =
    h.contact_id != null
      ? `${contactName || `Contact #${h.contact_id}`}${h.contact_email ? ` <${h.contact_email}>` : ''} [id ${h.contact_id}]`
      : '';

  const jobValue =
    h.job_id != null
      ? `${h.job_partner_number ? `${h.job_partner_number} ` : ''}[id ${h.job_id}]`
      : '';

  const orderValue =
    h.order_id != null
      ? `${h.order_number ?? ''}${h.po_number ? ` / PO ${h.po_number}` : ''}${h.order_number || h.po_number ? ' ' : ''}[id ${h.order_id}]`.trim()
      : '';

  // Device Type = the dropdown selection (e.g. "PlayerOne", "SXBR3").
  // Distinct from Device ID, which is the serial number (hardware) or
  // username (internet device) stored on tblTicket.RadioIDNum.
  const deviceTypeValue =
    h.device_type_id != null
      ? h.device_type_name ?? `(unknown device type, id ${h.device_type_id})`
      : '';

  // `sites_all` carries every Active site linked to the ticket; surface
  // it whenever the ticket spans more than one site so the AI grader
  // doesn't penalize the agent for naming a location that's "not THE
  // site" when in fact it's one of several linked sites. The single-
  // site `Site` line above stays for back-compat / quick scan; the
  // multi-line `Sites (all linked)` block is the authoritative list.
  const sitesAllValue = (() => {
    if (!h.sites_all) return '';
    const parts = h.sites_all.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
    return parts.length > 1 ? h.sites_all : '';
  })();

  // Per-site device rollup. Surface only when there's more than one
  // device on the ticket — single-device tickets are fine with the
  // bare `Device ID` line above.
  const devicesAllValue = (() => {
    if (!h.devices_all_with_site) return '';
    const parts = h.devices_all_with_site.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    return parts.length > 1 ? h.devices_all_with_site : '';
  })();

  return {
    'Ticket ID': String(h.ticket_id),
    Class: h.class_name ?? '',
    Subclass: h.subclass_name ?? '',
    Status: h.status ?? '',
    Resolution: h.resolution ?? '',
    'Assigned To': h.assigned_to_name ?? (h.assigned_to_id != null ? `User #${h.assigned_to_id}` : ''),
    'Customer ID': h.customer_id != null ? String(h.customer_id) : '',
    Site: siteValue,
    'Sites (all linked)': sitesAllValue,
    Contact: contactValue,
    Job: jobValue,
    Order: orderValue,
    'Device Type': deviceTypeValue,
    'Device ID': h.device_id ?? '',
    'Devices (per site)': devicesAllValue,
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

/**
 * Phase C (C2): build a multi-source Case from a primary source.
 *
 * Today the only auto-attachment we perform is "given a CALL primary,
 * try to discover the linked CRM ticket" via CallTicketLinkerService
 * (Phase C C1 spike output). Ticket-primary cases stay single-source
 * here; the inverse direction (auto-attach a call to a ticket primary)
 * is intentionally manual until ticket→call linkage has a chosen path
 * — adding it later only requires a parallel branch below.
 *
 * `maxAttachedSources` caps the number of attached refs we surface so
 * the prompt builder cannot blow the cost guard with a runaway case.
 * Defaults to 3 (matches the new forms.ai_max_attached_sources column).
 */
export async function loadCase(
  primary: CaseSourceRef,
  opts: { maxAttachedSources?: number; explicitAttached?: CaseSourceRef[] } = {}
): Promise<Case> {
  const cap = Math.max(0, Math.min(10, opts.maxAttachedSources ?? 3));
  const attached: CaseSourceRef[] = [];
  const seen = new Set<string>([formatCaseId(primary)]);

  // Caller-supplied attachments (e.g. the human reviewer manually
  // attached a call to a ticket review). These are honored first so
  // the auto-discovered links can't crowd them out under the cap.
  if (opts.explicitAttached) {
    for (const ref of opts.explicitAttached) {
      const key = formatCaseId(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      attached.push(ref);
      if (attached.length >= cap) break;
    }
  }

  // Auto-discovery: CALL primary → CRM ticket.
  if (primary.kind === 'CALL' && attached.length < cap) {
    try {
      const link = await linkCallToTicket(String(primary.external_id));
      if (link?.ticket_id) {
        const ticketRef: CaseSourceRef = { kind: 'TICKET', external_id: link.ticket_id };
        const key = formatCaseId(ticketRef);
        if (!seen.has(key)) {
          attached.push(ticketRef);
          seen.add(key);
        }
      }
    } catch (err) {
      logger.warn(`[AI REVIEWER CASE] CALL→TICKET linker failed for ${primary.external_id}: ${(err as Error).message}`);
    }
  }

  return {
    id: formatCaseId(primary),
    primary,
    attached: attached.slice(0, cap),
  };
}

/**
 * Pick the right `InteractionAdapter` for a `CaseSourceRef`. The case
 * model is provider-agnostic — the orchestrator picks the adapter at
 * the boundary so each source's material loads through its existing
 * loader without `reviewCase` having to know about CRM vs Genesys.
 */
export function pickAdapter(ref: CaseSourceRef): InteractionAdapter<number> | InteractionAdapter<string> {
  if (ref.kind === 'TICKET') return TicketAdapter;
  if (ref.kind === 'TASK') return TaskAdapter;
  return ConversationAdapter;
}

/**
 * Coerce the union-typed `external_id` into the runtime type each
 * adapter expects (numeric for TICKET/TASK, string for CALL) and call
 * `loadMaterial`. Throws a typed error when the id shape doesn't match
 * the adapter's contract — that's a route-layer validation bug, not a
 * runtime CRM problem.
 */
export async function loadAdapterMaterial(
  adapter: InteractionAdapter<number> | InteractionAdapter<string>,
  ref: CaseSourceRef,
  auditCutoffAt?: Date | null
): Promise<InteractionMaterial> {
  if (adapter.kind === 'CALL') {
    const id = String(ref.external_id);
    return (adapter as InteractionAdapter<string>).loadMaterial(id, auditCutoffAt);
  }
  const id = typeof ref.external_id === 'number' ? ref.external_id : Number(ref.external_id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AIReviewerServiceError(
      `${ref.kind} external_id must be a positive integer (got ${JSON.stringify(ref.external_id)})`,
      'INVALID_SOURCE_REF',
      400
    );
  }
  return (adapter as InteractionAdapter<number>).loadMaterial(id, auditCutoffAt);
}

/**
 * Default grace window applied AFTER a call's end_et when deriving the
 * "you can still document this call" cutoff for attached ticket notes.
 * 60 minutes (user-confirmed) is generous enough to cover most agents'
 * documentation periods without bleeding into the next shift's work.
 * Override via `AI_REVIEWER_POST_CALL_DOC_WINDOW_MIN` for special cases.
 */
export const DEFAULT_POST_CALL_DOC_WINDOW_MIN = 60;

export function resolvePostCallDocWindowMs(): number {
  const raw = Number(process.env.AI_REVIEWER_POST_CALL_DOC_WINDOW_MIN);
  const minutes = Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_POST_CALL_DOC_WINDOW_MIN;
  return Math.round(minutes * 60 * 1000);
}

/**
 * Filter ticket/task notes by the call-window cutoff.
 *
 * Notes whose CRM `is_after_audit === true` were created AFTER the audit
 * cutoff (call_end + doc_window). For CALL-primary reviews these are
 * post-call commentary by other agents (re-opens, supervisor edits,
 * follow-up notes) — they describe what was eventually learned, NOT what
 * the original agent could have known in-flight. Letting them flow into
 * the synthesis prompt produces hindsight-bias grading (the AI faulting
 * the agent for not diagnosing something the customer never surfaced).
 *
 * When `cutoff` is null/undefined we skip the filter entirely (e.g.
 * ticket-primary or task-primary reviews — those audits legitimately
 * cover the full ticket history).
 */
/**
 * Render the human-readable scope line surfaced in attached
 * ticket/task headers so the AI grader knows post-call commentary was
 * deliberately filtered out (vs the ticket genuinely having no later
 * notes). The line itself is informational — the actual filtering
 * happens in `filterPostAuditNotes`.
 */
export function renderAuditScopeLine(cutoff: Date): string {
  const minutes =
    Number(process.env.AI_REVIEWER_POST_CALL_DOC_WINDOW_MIN) ||
    DEFAULT_POST_CALL_DOC_WINDOW_MIN;
  return (
    `this call + ticket/task notes created on/before ${cutoff.toISOString()} ` +
    `(call end + ${minutes}min documentation window). ` +
    `Notes added later by other agents (re-opens, supervisor edits, follow-up activity) ` +
    `are OUT OF SCOPE and have been filtered out — do not request them, do not infer their content, ` +
    `and do not fault the agent for what those later notes might reveal.`
  );
}

export function filterPostAuditNotes(
  notes: CRMNote[],
  cutoff: Date | null | undefined,
  ctx: { sourceKind: 'TICKET' | 'TASK'; sourceId: number }
): CRMNote[] {
  if (!cutoff) return notes;
  const kept: CRMNote[] = [];
  let dropped = 0;
  for (const n of notes) {
    if (n.is_after_audit) {
      dropped += 1;
    } else {
      kept.push(n);
    }
  }
  if (dropped > 0) {
    logger.info(
      `[AI REVIEWER CASE] dropped ${dropped} post-call note(s) from ${ctx.sourceKind} ${ctx.sourceId} ` +
        `(cutoff=${cutoff.toISOString()}, kept=${kept.length}, total=${notes.length})`
    );
  }
  return kept;
}

/** Render a `CaseSourceRef.external_id` as a string for prompts / logs. */
export function formatRefId(ref: CaseSourceRef): string {
  return String(ref.external_id);
}

/**
 * Same source-id coercion used by `loadAdapterMaterial`, but applied at
 * the link-payload boundary so each adapter's `toSubmissionLink` gets
 * its expected runtime type.
 */
export function adapterLinkFor(ref: CaseSourceRef, material: InteractionMaterial): SubmissionLinkPayload {
  if (ref.kind === 'CALL') {
    return ConversationAdapter.toSubmissionLink(String(ref.external_id), material);
  }
  const id = typeof ref.external_id === 'number' ? ref.external_id : Number(ref.external_id);
  if (ref.kind === 'TICKET') return TicketAdapter.toSubmissionLink(id, material);
  return TaskAdapter.toSubmissionLink(id, material);
}

/**
 * Merge per-source link payloads into one submission-shaped payload.
 *
 * Tickets and tasks land in `submission_ticket_tasks` (a list of
 * `{ kind, external_id }` refs). Calls land in `submission_calls` via
 * the virtual-call upsert path: `call_ids: [-1]` is a sentinel telling
 * the repository to create a Call row from the matching `call_data[i]`
 * instead of binding to an existing call. Both halves are kept as
 * arrays so a single submission can carry several sources of either
 * kind without losing any.
 */
export function mergeSubmissionLinks(parts: SubmissionLinkPayload[]): SubmissionLinkPayload {
  const ticket_tasks: { kind: 'TICKET' | 'TASK'; external_id: number }[] = [];
  const call_ids: number[] = [];
  const call_data: NonNullable<SubmissionLinkPayload['call_data']> = [];
  const seenTickets = new Set<string>();
  const seenCallIds = new Set<string>();
  for (const p of parts) {
    for (const t of p.ticket_tasks ?? []) {
      const key = `${t.kind}:${t.external_id}`;
      if (seenTickets.has(key)) continue;
      seenTickets.add(key);
      ticket_tasks.push(t);
    }
    if (Array.isArray(p.call_ids) && Array.isArray(p.call_data)) {
      for (let i = 0; i < p.call_data.length; i++) {
        const entry = p.call_data[i];
        if (!entry?.call_id) continue;
        if (seenCallIds.has(entry.call_id)) continue;
        seenCallIds.add(entry.call_id);
        call_data.push(entry);
        // Preserve the virtual-call sentinel pairing — repository
        // expects `call_ids[i]` to align with `call_data[i]`.
        call_ids.push(p.call_ids[i] ?? -1);
      }
    }
  }
  const out: SubmissionLinkPayload = {};
  if (ticket_tasks.length > 0) out.ticket_tasks = ticket_tasks;
  if (call_data.length > 0) {
    out.call_ids = call_ids;
    out.call_data = call_data;
  }
  return out;
}

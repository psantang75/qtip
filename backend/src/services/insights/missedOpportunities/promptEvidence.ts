/**
 * The per-call evidence packet — what the model is allowed to read, labelled with
 * whose it is and how far we can trust it.
 *
 * ONE STRUCTURED CONTRACT, FOUR BLOCKS. The review unit is (conversation,
 * reviewed salesperson), and every block says explicitly whose actions it can
 * establish:
 *
 *   ATTRIBUTION   whether an "Agent" turn is this salesperson at all.
 *   SALES RECORD  the validated lead/CM set — the ONLY place a prior-completion
 *                 exception may come from, with resolution outcome and coverage.
 *   TICKETS       operational truth and recovery material, never sales credit.
 *   NEW LEADS     what the salesperson created, so an expansion claim is checkable.
 *
 * Split out of prompt.ts so the system prompt (the fixed output contract) and the
 * user message (the evidence) each stay inside the file-size limit; prompt.ts
 * re-exports `buildUserPrompt` so callers keep one import surface.
 *
 * WHY THE LABELS ARE LOAD-BEARING. Before this, the CRM block was one
 * undifferentiated pile of notes whose header claimed it was "the record this
 * call is about", and a support ticket's warranty discussion sat in it looking
 * exactly like the salesperson's own lead note. That is how Customer Service
 * explaining a five-year option cleared a salesperson's warranty omission.
 */
import { CallMaterial, CrmCoverage, CrmResolutionSummary } from './types';

/** How the resolution outcome is explained to the model, in its own words. */
const OUTCOME_TEXT: Record<CrmResolutionSummary['outcome'], string> = {
  verified: 'VERIFIED — the phone match is independently corroborated by this call. '
    + 'These records belong to this account.',
  provisional: 'PROVISIONAL — these records are compatible with the call but nothing outside the '
    + 'phone number confirms them. Do not state their history as established fact about this '
    + 'account, and prefer null for crm_ref if the notes do not plainly match this conversation.',
  ambiguous: 'AMBIGUOUS — more than one account or opportunity matched and we could not tell them '
    + 'apart. Treat prior completion and missing documentation as UNKNOWN.',
  unmatched: 'UNMATCHED — no sales record was found for this call. Absence of documentation here is '
    + 'NOT evidence a step was missed.',
  unavailable: 'UNAVAILABLE — the lookup failed. Nothing about this account\'s history is known, in '
    + 'either direction.',
};

/**
 * Whether an internal turn is the reviewed salesperson's.
 *
 * On a transferred or IVR-routed conversation it is not, and the model has to be
 * told so in the same breath as the transcript — the transcript itself cannot
 * show it, because every internal party renders as "Agent".
 */
function renderAttribution(material: CallMaterial): string {
  const count = material.attribution.internalPartyCount;
  if (material.attribution.soleInternalParty) {
    return `ATTRIBUTION: ${material.agentName} was the only internal party on this conversation, so `
      + 'a turn labelled AGENT is theirs.';
  }
  const who = count == null
    ? 'We could not establish how many internal parties were on this conversation'
    : `${count} internal parties were on this conversation`;
  return `ATTRIBUTION: ${who}. A turn labelled AGENT may therefore be ANOTHER EMPLOYEE `
    + `(a transferred Customer Service or support rep) or an IVR prompt, NOT ${material.agentName}. `
    + `You may NOT credit ${material.agentName} with an offer, question, or close spoken on an `
    + 'AGENT turn you cannot attribute to them. If a rule turns on whether THIS salesperson made a '
    + 'move and the transcript cannot show whose words those are, say so in what_happened and treat '
    + 'the attempt as unestablished rather than as completed.';
}

/** What was read and what was not, so a gap is stated instead of implied. */
function renderCoverage(coverage: CrmCoverage | undefined): string {
  if (!coverage) return 'COVERAGE: not recorded for this block.';
  const parts = [
    `records read: ${coverage.recordsRead.join(', ') || 'none'}`,
    `note rows in range: ${coverage.rowsRetrieved}`,
    `rendered below: ${coverage.rowsRendered}`,
    coverage.rowsOmitted > 0 ? `NOT SHOWN: ${coverage.rowsOmitted}` : 'none omitted',
    `history cutoff: ${coverage.cutoff}`,
    coverage.truncated ? 'TRUNCATED — older notes exist that you have not seen' : 'complete within the cap',
    coverage.errors.length ? `READ FAILURES: ${coverage.errors.join('; ')}` : null,
  ].filter(Boolean);
  const warning = coverage.truncated || coverage.rowsOmitted > 0 || coverage.errors.length
    ? ' Because history is incomplete, you may NOT conclude that a topic was never documented; '
      + 'say it is not established either way.'
    : '';
  return `COVERAGE: ${parts.join('; ')}.${warning}`;
}

/** Why these records, what was rejected, and where a duplicate led. */
function renderResolution(resolution: CrmResolutionSummary | undefined): string[] {
  if (!resolution) return [];
  const lines = [
    `RECORD MATCH: ${OUTCOME_TEXT[resolution.outcome]}`,
    `WHY: ${resolution.reason}`,
  ];
  if (resolution.primaryRef) {
    lines.push(
      `PRIMARY SALES RECORD: ${resolution.primaryRef} — this is the record a finding should cite in `
      + 'crm_ref, and the only kind of record whose notes may establish a prior-completion exception.',
    );
  } else {
    lines.push('PRIMARY SALES RECORD: none established. Use null for crm_ref.');
  }
  if (resolution.salesRefs.length > 1) {
    lines.push(`ASSOCIATED SALES RECORDS: ${resolution.salesRefs.join(', ')}.`);
  }
  if (resolution.duplicatePath.length > 0) {
    lines.push(`DUPLICATE TRAIL: ${resolution.duplicatePath.join(' | ')}.`);
  }
  if (resolution.crossAccount) {
    lines.push(
      'CROSS-ACCOUNT: at least one record below sits on a DIFFERENT customer account reached by '
      + 'following a reference. It is historical context; it does not prove anything about the '
      + 'account on this call.',
    );
  }
  if (resolution.rejected.length > 0) {
    const shown = resolution.rejected.slice(0, 5)
      .map((r) => `${r.ref} (${r.reason})`).join('; ');
    lines.push(`REJECTED CANDIDATES: ${shown}. Do not cite these.`);
  }
  return lines;
}

/**
 * The validated lead/CM history, or an explicit statement of why there is none.
 *
 * The header names the exception rule inline because that is the decision this
 * block exists to support: a documented prior offer or decline ON ONE OF THESE
 * RECORDS, for THIS transaction, is what can excuse a step the salesperson did
 * not take on the call. Nothing else can.
 */
function renderSalesHistory(material: CallMaterial): string[] {
  const isRecord = material.crm.scope === 'record';
  const header = isRecord
    ? `SALES RECORD HISTORY — ${material.crm.recordLabel ?? 'validated lead / Contact Manager'} `
      + '(the validated Lead Manager / Contact Manager set for this opportunity). A prior-completion '
      + 'exception MUST cite an action id from this block, must be about the SAME requirement and the '
      + 'SAME transaction, and must actually record the offer, decision, or decline — a topic merely '
      + 'being mentioned is not a documented disposition.'
    : `CRM NOTES ${material.agentName.toUpperCase()} WROTE THIS SAME DAY (all accounts, day-wide `
      + 'fallback — this is NOT a resolved account history, so it cannot establish what this '
      + "account's lead or Contact Manager documents):";

  const notes = material.crm.notes.trim()
    ? material.crm.notes
    : material.crm.unavailable || material.crm.truncated
      ? '(CRM history unavailable or omitted — missing documentation and prior completion are UNKNOWN)'
      : isRecord
        ? '(no substantive notes on these records within the cutoff)'
        : '(this salesperson logged no CRM notes on this date)';

  return [header, ...renderResolution(material.crm.resolution), renderCoverage(material.crm.coverage), notes];
}

/**
 * Support, billing and return tickets — separately, and clearly demoted.
 *
 * An AE writing on a ticket is still a ticket note. It is the right source for
 * what physically happened to an order and for planning recovery, and the wrong
 * source for whether a required sales step was satisfied.
 */
function renderTicketContext(material: CallMaterial): string[] {
  const block = material.crm.ticketNotes?.trim();
  if (!block) return [];
  return [
    '',
    'SUPPORT / BILLING / RETURN TICKET CONTEXT (operational truth and recovery planning ONLY). '
    + 'These notes establish what happened to an order, a return, or a service issue. They can NOT '
    + 'satisfy a sales requirement and can NOT excuse a step this salesperson did not take — not '
    + 'even when an Account Executive wrote the note, and not even when the note discusses the same '
    + 'topic. Another employee resolving something is that employee\'s action, not this '
    + "salesperson's:",
    block,
  ];
}

/**
 * The "did the salesperson actually record it?" section. The history blocks above
 * show WORK LOGGED, never a record CREATED, so an expansion opportunity opened as
 * a fresh lead was invisible — which is what let the review report "never
 * captured the other locations" as fact. See crmCreated.ts for what qualifies.
 *
 * Rendered even when empty: "created nothing" is the answer the expansion rule
 * needs, and it must be distinguishable from "we could not look", which is what
 * `leadsCreated === null` means.
 */
function renderLeadsCreated(material: CallMaterial): string[] {
  const header = `NEW LEADS ${material.agentName.toUpperCase()} CREATED IN THE CRM THIS SAME DAY `
    + '(use this to check whether an opportunity raised on this call — another location, a sibling '
    + 'site, a referral — was actually recorded somewhere. These are NOT citable in crm_ref):';

  if (material.leadsCreated === null) {
    return [
      header,
      '(THIS LOOKUP FAILED — we do not know what this salesperson created. Treat it as unknown, not '
      + 'as zero: you may not state that an opportunity was never recorded on the basis of this '
      + 'section.)',
    ];
  }
  const block = material.leadsCreated.trim();
  return [header, block || '(this salesperson created no new leads on this date)'];
}

/** The per-call user message: who is reviewed, what they said, and what is documented. */
export function buildUserPrompt(material: CallMaterial): string {
  const mins = Math.round((material.talkSecs / 60) * 10) / 10;
  const header = [
    `REVIEWED SALESPERSON: ${material.agentName}`,
    `CONVERSATION ID: ${material.conversationId}`,
    `CALL DATE/TIME: ${material.startedAt.toISOString()}`,
    `DIRECTION: ${material.direction ?? 'unknown'}`,
    `TALK TIME: ${mins} minutes`,
    material.remoteParty
      ? `PHONE LABEL FOR FAR END: ${material.remoteParty} (often a city/state, not the business name)`
      : '',
    material.wrapUpCode ? `WRAP-UP CODE: ${material.wrapUpCode}` : '',
    renderAttribution(material),
  ].filter(Boolean).join('\n');

  const transcript = material.transcript.trim()
    ? material.transcript
    : '(no transcript captured for this call)';

  return [
    header,
    '',
    'CALL TRANSCRIPT:',
    transcript,
    '',
    ...renderSalesHistory(material),
    ...renderTicketContext(material),
    '',
    ...renderLeadsCreated(material),
  ].join('\n');
}

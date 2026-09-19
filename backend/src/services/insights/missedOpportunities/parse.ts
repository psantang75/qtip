/**
 * Finding parser — the trust boundary between a language model and a table the
 * report reads as fact.
 *
 * Split out of analyzer.ts so that file stays inside the size limit once quote
 * resolution landed; analyzer.ts re-exports `parseFindings`, so it remains the
 * single import surface for callers.
 *
 * TOLERANT OF SHAPE, STRICT ABOUT CONTENT. A fenced code block, a wrapper
 * object, or a bare array all parse, and one malformed finding is skipped rather
 * than failing the call. But an unknown `rule_key`, a missing recommendation, or
 * a quote that does not appear in the material is dropped — each of those is
 * worse than no finding at all, because the report presents whatever survives
 * here as established.
 *
 * A PAYLOAD THAT IS NOT JSON IS A FAILED REVIEW. It used to return the same
 * empty finding list as a well-handled call, so a model that answered "Sorry, I
 * cannot help with that" counted toward the clean-call rate. `parseFailed` is
 * how the caller tells the two apart.
 */
import {
  isSamePerson, quoteAuthors, quoteResolves, quoteResolvesAsInternalSpeaker,
} from './evidence';
import { MAX_CANDIDATE_FINDINGS } from './prompt';
import {
  AnalyzedFinding,
  crmRefToken,
  isSeverity,
  parseCrmRef,
  parseEvidenceSpeaker,
} from './types';

/** Field-length caps mirroring the finding table's column widths. */
const CAP = {
  title: 240,
  whatHappened: 2000,
  evidenceQuote: 1200,
  recommendedApproach: 2000,
  recoveryAction: 1200,
  estValueNote: 240,
  customerName: 200,
} as const;

function cap(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t || t.toLowerCase() === 'null') return null;
  return t.length > max ? t.slice(0, max) : t;
}

/** Unwrap a ```json fence, which both providers occasionally emit despite JSON mode. */
export function stripFence(raw: string): string {
  const t = (raw ?? '').trim();
  if (!t.startsWith('```')) return t;
  return t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
}

export interface ParseFindingsArgs {
  raw: string;
  validRuleKeys: Set<string>;
  defaultSeverityByRule: Map<string, string>;
  /**
   * Citation tokens actually rendered into this call's prompt. A `crm_ref` the
   * model did not see is discarded rather than stored, because a wrong id here
   * deep-links a manager into someone else's CRM record — worse than no link.
   */
  validCrmRefs?: ReadonlySet<string>;
  /**
   * The material an `evidence_quote` must resolve to, kept in labelled parts
   * rather than one concatenated blob. Omitting it disables the check (see
   * evidence.quoteResolves, which fails open by design).
   *
   * The parts matter because a quote's SOURCE decides what it can prove: the
   * same warranty sentence is the salesperson's offer in their own transcript
   * turn, documented history on their lead, and merely operational context on a
   * support ticket. Flattening them is what let a Customer Service line be
   * reported as the reviewed salesperson's words.
   */
  evidence?: EvidenceMaterial;
  /** Ceiling on findings returned. Defaults to the pre-verification candidate cap. */
  max?: number;
}

/** The labelled material a finding's quote may come from. */
export interface EvidenceMaterial {
  transcript: string;
  /** The validated lead/CM history — the only notes that can document an exception. */
  salesNotes: string;
  /** Support/billing/return tickets. Quotable as context, never as sales credit. */
  ticketNotes: string;
  /** The created-leads block. Judgment context; not citable. */
  leadsCreated: string | null;
  /** The reviewed salesperson, for checking who authored a quoted note. */
  salespersonName: string;
  /** True only when they were the sole internal party — see types.CallAttribution. */
  soleInternalParty: boolean;
}

export interface ParseFindingsResult {
  findings: AnalyzedFinding[];
  customerName: string | null;
  /** The payload was not JSON. The call was NOT reviewed; do not read as clean. */
  parseFailed: boolean;
  /**
   * Findings dropped because their quote appears nowhere in the material, with
   * the offending text. Carried out rather than counted because nothing else
   * retains a rejected quote — `ai_call_logs` keeps only a prompt hash — and
   * without the text there is no way to tell a caught fabrication from a quote
   * the matcher was too strict about.
   */
  rejectedQuotes: Array<{ ruleKey: string; quote: string }>;
  /** Findings rejected for lacking the evidence quote required by the contract. */
  missingQuotes: number;
  /**
   * Findings kept but whose AGENT attribution was withdrawn — the quote is real,
   * yet nothing shows the REVIEWED salesperson said or wrote it. The finding
   * survives with a null speaker (the miss can still be valid); the count is here
   * so a run that is systematically mis-attributing is visible.
   */
  unattributedSpeakers: number;
}

/**
 * Whether the reviewed salesperson can be shown to have produced this quote.
 *
 * Two ways in, both requiring positive evidence:
 *   - their own transcript turn, but ONLY on a call where they were the sole
 *     internal party, because otherwise an "Agent" turn may be a transferred rep
 *     or an IVR (see types.CallAttribution);
 *   - a note on the validated sales records that names them as its author.
 *
 * A quote found only in a ticket block, only in a colleague's note, or only in a
 * customer turn is not theirs, whatever the model labelled it.
 */
function agentCanBeCredited(quote: string, ev: EvidenceMaterial): boolean {
  if (ev.soleInternalParty && quoteResolvesAsInternalSpeaker(quote, ev.transcript)) return true;
  return isSamePerson(quoteAuthors(quote, ev.salesNotes), ev.salespersonName);
}

/** Coerce the model's JSON into findings, dropping anything unusable. */
export function parseFindings(args: ParseFindingsArgs): ParseFindingsResult {
  const max = args.max ?? MAX_CANDIDATE_FINDINGS;
  const validCrmRefs = args.validCrmRefs ?? new Set<string>();
  const ev = args.evidence;
  const sources = ev
    ? [ev.transcript, ev.salesNotes, ev.ticketNotes, ev.leadsCreated]
    : [];
  const base: ParseFindingsResult = {
    findings: [],
    customerName: null,
    parseFailed: false,
    rejectedQuotes: [],
    missingQuotes: 0,
    unattributedSpeakers: 0,
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(args.raw));
  } catch {
    return { ...base, parseFailed: true };
  }

  let arr: unknown[] = [];
  let topCustomer: string | null = null;
  if (Array.isArray(parsed)) {
    arr = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const candidate = obj.findings ?? obj.missed_opportunities ?? obj.items;
    if (!Array.isArray(candidate)) return { ...base, parseFailed: true };
    arr = candidate;
    topCustomer = cap(obj.customer_name, CAP.customerName);
  } else {
    return { ...base, parseFailed: true };
  }

  const findings: AnalyzedFinding[] = [];
  const seenRules = new Set<string>();
  const rejectedQuotes: ParseFindingsResult['rejectedQuotes'] = [];
  let missingQuotes = 0;
  let unattributedSpeakers = 0;

  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const ruleKey = typeof o.rule_key === 'string' ? o.rule_key.trim() : '';
    if (!args.validRuleKeys.has(ruleKey) || seenRules.has(ruleKey)) continue;

    const title = cap(o.title, CAP.title);
    const whatHappened = cap(o.what_happened, CAP.whatHappened);
    const recommended = cap(o.recommended_approach, CAP.recommendedApproach);
    const recovery = cap(o.recovery_action, CAP.recoveryAction);
    // These three are NOT NULL on the finding row and are the whole point of
    // the report — a finding missing any of them is not worth storing.
    // recovery_action is optional: null means coaching-only, nothing to recover.
    if (!title || !whatHappened || !recommended) continue;

    // A quote the material does not contain is a fabricated citation, and the
    // finding built on it cannot be trusted either. Dropped rather than shown
    // without its evidence, because the quote is what a manager checks first.
    const evidenceQuote = cap(o.evidence_quote, CAP.evidenceQuote);
    if (evidenceQuote && !quoteResolves(evidenceQuote, ...sources)) {
      rejectedQuotes.push({ ruleKey, quote: evidenceQuote });
      continue;
    }
    if (!evidenceQuote) { missingQuotes += 1; continue; }

    const rawSeverity = typeof o.severity === 'string' ? o.severity.trim().toLowerCase() : '';
    const severity = isSeverity(rawSeverity)
      ? rawSeverity
      : (args.defaultSeverityByRule.get(ruleKey) as AnalyzedFinding['severity']) ?? 'medium';

    const ref = parseCrmRef(o.crm_ref);
    const citable = ref && validCrmRefs.has(crmRefToken(ref.kind, ref.id)) ? ref : null;

    // Speaker only means something when there is a quote to attribute, and AGENT
    // only when this salesperson can be shown to have produced it. Withdrawing
    // the label rather than the finding is deliberate: "someone said it and we
    // cannot prove it was them" leaves the miss standing but stops the report
    // presenting a colleague's sentence as the reviewed person's.
    let speaker = evidenceQuote ? parseEvidenceSpeaker(o.evidence_speaker) : null;
    if (speaker === 'AGENT' && ev && !agentCanBeCredited(evidenceQuote, ev)) {
      speaker = null;
      unattributedSpeakers += 1;
    }

    seenRules.add(ruleKey);
    findings.push({
      ruleKey,
      severity,
      title,
      whatHappened,
      evidenceQuote,
      evidenceSpeaker: speaker,
      recommendedApproach: recommended,
      recoveryAction: recovery,
      estValueNote: cap(o.est_value_note, CAP.estValueNote),
      customerName: cap(o.customer_name, CAP.customerName) ?? topCustomer,
      crmRefKind: citable?.kind ?? null,
      crmRefId: citable?.id ?? null,
    });
    if (findings.length >= max) break;
  }

  return {
    findings,
    customerName: topCustomer,
    parseFailed: false,
    rejectedQuotes,
    missingQuotes,
    unattributedSpeakers,
  };
}

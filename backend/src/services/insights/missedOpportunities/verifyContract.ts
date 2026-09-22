/**
 * The verification pass's contract: what the auditor is asked, and which of its
 * answers may delete a finding.
 *
 * Split from verify.ts so each file stays inside the size limit — that file owns
 * the model call and the fail-open behaviour, this one owns the prompt and the
 * checks on what comes back.
 *
 * TWO QUESTIONS, NOT ONE. The pass began by asking only "did the salesperson
 * attempt this?", which enforces the INCLUSION half of a rule. Every rule body
 * also carries EXCLUSIONS an admin wrote — "Do NOT flag when the customer chose
 * another path", "confirm the customer did not request the slower path" — and
 * nothing enforced those at all. That is how a call where the customer said
 * "revise the quote and we'll come back to you" was reported as a missed close:
 * the rep genuinely never asked for the order, so the attempt question answers
 * "no" and the finding survives, while the rule's own text disqualified it.
 *
 * WHY THE RULE TEXT IS PASSED IN WHOLE. The exclusions are editable business
 * content (`ie_missed_opportunity_rule.body_md`). Extracting them here with a
 * pattern would put policy parsing in code and would silently miss any clause an
 * admin worded differently, so the auditor is handed the rule verbatim and asked
 * whether one of ITS exclusions is met. A clause added next month is enforced
 * without a deploy, which is the only version of this fix that does not need
 * redoing per rule.
 *
 * AN EXCLUSION IS USUALLY THE CUSTOMER'S LINE. The attempt question demands a
 * quote attributable to the reviewed salesperson, because it asserts they acted.
 * An exclusion asserts something about the SITUATION, and the words that prove it
 * are normally the customer's — "email me the link", "we'll come back to you" —
 * which `quoteResolvesAsInternalSpeaker` can never see.
 *
 * WHICH IS NOT THE SAME AS ANY LINE. The exclusion quote is accepted from the
 * CUSTOMER, from the validated sales record, or from an internal turn only when
 * the reviewed salesperson was provably the only employee on the call. Accepting
 * any speaker would reopen the Jason warranty failure through the new question:
 * Customer Service's "there is a five year option available" would satisfy a
 * prior-offer exclusion on a transferred call, deleting a real omission. Support
 * and billing notes cannot satisfy an exclusion either, because this pass is never
 * given the ticket block.
 */
import logger from '../../../config/logger';
import {
  isSamePerson,
  quoteAuthors,
  quoteResolvesAsCustomer,
  quoteResolvesAsInternalSpeaker,
} from './evidence';
import { stripFence } from './parse';
import { AnalyzedFinding } from './types';

/**
 * The auditor's instructions. A byte-identical constant on every call so the
 * provider can cache it; everything per-call, including the rule text, goes in
 * the user message.
 */
export const SYSTEM_PROMPT = [
  'You audit draft coaching notes about a sales call. You answer two questions per finding and nothing else.',
  '',
  'QUESTION 1 — DID THE SALESPERSON ATTEMPT IT? Read the transcript and answer whether it shows THE REVIEWED SALESPERSON, named at the top of the material, attempting the action the finding says they did not take.',
  '',
  'Count it as attempted when that salesperson made the move and the customer declined, deferred, or chose another path — they asked for the order or the card, offered to place or activate it while on the line, offered the warranty, the upsell, the site survey, the group quote, or the transfer, or asked the qualifying question the finding says they never asked. The customer choosing a slower path does not make it unattempted.',
  '',
  'Count it as NOT attempted when that salesperson never made the move, or only mentioned it in passing without offering it.',
  '',
  // The transcript cannot distinguish employees: every internal turn is "Agent".
  // Without this the auditor reads a transferred colleague's sentence as the
  // reviewed person's attempt and deletes a valid finding.
  'ANOTHER PERSON DOING IT IS NOT AN ATTEMPT. A transcript labels every one of our people "Agent", so the material tells you whether more than one employee was on this conversation. If it says so, a line may belong to a transferred Customer Service or support rep rather than the reviewed salesperson, and you must answer false unless the surrounding dialogue makes it unmistakable that the reviewed salesperson said it. Customer Service explaining warranty periods, handling a return, or resolving a billing issue is NEVER the salesperson attempting a sale. The customer asking about something is not the salesperson offering it.',
  '',
  'THE ACCOUNT HISTORY CAN DOCUMENT AN ATTEMPT TOO. You may also be given the reviewed salesperson\'s own notes on this customer\'s CRM record. Count the miss as attempted when one of THEIR notes — a line whose author is the reviewed salesperson — documents they made the move (offered the warranty, sent the quote, set the dated follow-up). A note written by a colleague, or an operational/ticket note, is NOT their attempt. When your evidence is a note, quote that note line verbatim in agent_quote.',
  '',
  'Some findings are not about an omission at all — they are about HOW WELL the rep did something they plainly did: the content of a voicemail they left, or a professionalism or compliance lapse in what they said on the recorded line. Those are outside what you audit, so answer rep_attempted: false for them and leave them alone. Answering true would delete a finding on the grounds that the rep did the very thing it criticises.',
  '',
  'When you answer rep_attempted: true you MUST quote, verbatim in agent_quote, the REVIEWED SALESPERSON\'S line that shows the attempt — either their transcript turn or their own account-history note. A true verdict is discarded and the finding kept unless that quote appears verbatim on an internal turn of this transcript or on one of the reviewed salesperson\'s own account-history notes — a customer line, a colleague\'s note, a ticket note, a paraphrase, or a line you inferred will not do. If you cannot point to the line, answer false.',
  '',
  'QUESTION 2 — DOES THE RULE\'S OWN EXCLUSION APPLY? Each finding is shown with the verbatim text of the rule it was reported under. Rules commonly state when a situation must NOT be reported — "Do NOT flag when...", "that is NOT a miss", "Before reporting it, confirm that...". Answer whether one of THAT rule\'s stated exclusions is satisfied on this call.',
  '',
  'Answer carve_out_applies: true only when the rule\'s own words exclude this situation, and put in carve_out_quote the verbatim line that satisfies it. That line may be the CUSTOMER\'S — an exclusion is usually proved by what the customer said ("send the revised quote and we\'ll review it and come back to you", "email me the link", "I need to run it past my partner", "we already decided against it") — or the salesperson\'s turn, or one of the salesperson\'s own account-history notes.',
  '',
  'Question 2 is bounded by the rule text you are given. Do NOT invent an exclusion the rule does not state. Do NOT answer true because the finding seems harsh, minor, poorly written, or because some other miss occurred instead. If the rule states no exclusion that fits, answer false. A true verdict with no verbatim quote, or a quote that does not appear in the material, is discarded and the finding is kept.',
  '',
  'Judge each finding independently. You are not grading the call, ranking the misses, or rewriting the coaching.',
  '',
  'Respond with ONLY a JSON object in this exact shape:',
  '{"verdicts":[{"index":1,"rep_attempted":false,"agent_quote":null,"carve_out_applies":false,"carve_out_quote":null}]}',
].join('\n');

/**
 * The claim under audit plus the rule that produced it, without the coaching
 * text the auditor must not weigh. The rule body is what makes question 2
 * answerable, so it is rendered verbatim rather than summarised.
 *
 * A content-graded finding is labelled as such. Both questions are put to the
 * auditor for every finding, but only one of them means anything for these, and
 * saying so inline is what stops the auditor answering "yes they attempted it"
 * about a rule that already concedes the rep did the thing.
 */
export function renderFindings(
  findings: AnalyzedFinding[],
  ruleBodies: ReadonlyMap<string, string>,
  omissionRuleKeys: ReadonlySet<string>,
): string {
  return findings
    .map((f, i) => {
      const body = ruleBodies.get(f.ruleKey)?.trim();
      const lines = [
        `FINDING ${i + 1}`,
        `ALLEGED MISS: ${f.title}`,
        `DETAIL: ${f.whatHappened}`,
        `RULE (${f.ruleKey}) AS WRITTEN: ${body || '(rule text unavailable — answer carve_out_applies: false)'}`,
      ];
      if (!omissionRuleKeys.has(f.ruleKey)) {
        lines.push(
          'THIS RULE IS GRADED ON CONTENT, NOT ON AN OMISSION. The rep plainly did the thing; the '
          + 'finding is about how they did it. Answer rep_attempted: false and judge question 2 only.',
        );
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

/** Why a finding is being removed, for the log line and the caller's counters. */
export type DropReason = 'attempted' | 'carve_out';

export interface ParsedVerdicts {
  /** Indexes (zero-based, into the audited list) the rep demonstrably attempted. */
  attempted: Set<number>;
  /** Indexes the rule's own exclusions disqualify. */
  carvedOut: Set<number>;
}

export interface VerdictSources {
  transcript: string;
  salesNotes: string;
  salespersonName: string;
  /**
   * Whether the reviewed salesperson was the only employee on the conversation.
   * When false, an internal turn may be a transferred colleague, so it can
   * establish neither an attempt nor an exclusion.
   */
  attributable: boolean;
}

/**
 * The verdicts that survive their own evidence check.
 *
 * Only an explicit `true` counts, an out-of-range index is ignored, and a verdict
 * with no quote is discarded — anything ambiguous keeps the finding, matching the
 * fail-open stance of the pass. The two questions resolve their quotes
 * differently on purpose: an attempt must be attributable to the reviewed
 * salesperson, an exclusion need only be a real line somebody said.
 */
export function parseVerdicts(
  raw: string,
  count: number,
  src: VerdictSources,
): ParsedVerdicts {
  const attempted = new Set<number>();
  const carvedOut = new Set<number>();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch {
    return { attempted, carvedOut };
  }

  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>).verdicts
      : null;
  if (!Array.isArray(list)) return { attempted, carvedOut };

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const oneBased = Number(o.index);
    if (!Number.isInteger(oneBased) || oneBased < 1 || oneBased > count) continue;
    const zeroBased = oneBased - 1;

    if (o.rep_attempted === true && src.attributable) {
      const quote = quoteOf(o.agent_quote);
      if (!quote) {
        logger.info(
          `[MISSED OPPS] verification verdict ${oneBased} claimed an attempt with no quote — finding kept`,
        );
      } else if (
        // The line has to be THIS person's: their own internal transcript turn,
        // or a note they authored. The auditor's favourite unsound removals —
        // the customer's own question, or a colleague's/CS note — resolve as
        // neither.
        quoteResolvesAsInternalSpeaker(quote, src.transcript)
        || isSamePerson(quoteAuthors(quote, src.salesNotes), src.salespersonName)
      ) {
        attempted.add(zeroBased);
      } else {
        logger.info(
          `[MISSED OPPS] verification verdict ${oneBased} quoted a line that is neither an attributable `
            + `salesperson turn nor a note ${src.salespersonName} authored — finding kept`,
        );
      }
    }

    if (o.carve_out_applies === true) {
      const quote = quoteOf(o.carve_out_quote);
      if (!quote) {
        logger.info(
          `[MISSED OPPS] verification verdict ${oneBased} claimed a rule exclusion with no quote — finding kept`,
        );
      } else if (
        // The customer's own words are the usual proof of an exclusion, and they
        // are attributable no matter who else was on the line.
        quoteResolvesAsCustomer(quote, src.transcript)
        // An internal turn only when it provably belongs to the reviewed person.
        || (src.attributable && quoteResolvesAsInternalSpeaker(quote, src.transcript))
        // A note on the validated sales record. Ticket notes are not in this
        // block at all, which is what stops a support note from clearing a sale.
        || quoteAuthors(quote, src.salesNotes).length > 0
      ) {
        carvedOut.add(zeroBased);
      } else {
        logger.info(
          `[MISSED OPPS] verification verdict ${oneBased} claimed a rule exclusion citing a line that is `
            + 'neither the customer\'s, nor attributable to the reviewed salesperson, nor on the '
            + 'account history — finding kept',
        );
      }
    }
  }

  return { attempted, carvedOut };
}

/** A usable verbatim quote, or null for missing/empty/"null" values. */
function quoteOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null') return null;
  return trimmed;
}

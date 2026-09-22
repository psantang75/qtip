/**
 * Evidence resolution — does a quoted span actually appear in the material?
 *
 * The prompt contract demands `evidence_quote` be a VERBATIM span from the
 * transcript or the CRM notes, but an instruction the model can silently skip is
 * not a control. Nothing checked the quote against its source, so a finding
 * could read as well-supported while citing words nobody said. This is the
 * check, and it is deterministic: no model call, no cost.
 *
 * MATCHING IS NORMALISED, NOT LITERAL. Transcripts come out of ASR through
 * `formatTranscriptContent`, so a true quote routinely differs from the source
 * in case, smart quotes, hyphenation, and line breaks. Comparing raw strings
 * would reject real evidence, so both sides collapse to lowercase alphanumeric
 * words before the substring test.
 *
 * IT MATCHES PER SPEAKER, NOT JUST PER FILE. `formatTranscriptContent` renders
 * one line per turn prefixed with `[timestamp — SPEAKER]`, and a phrase-level
 * provider splits a single sentence across several turns. So a real quote longer
 * than one phrase is interrupted in the source by a speaker label — or by the
 * other party's "mm-hmm" — and can never appear as a contiguous span. Checking
 * only the rendered text rejected exactly the long, multi-clause quotes that
 * carry the most evidence. Each source therefore expands into several
 * haystacks: the text as rendered, all turns with their labels stripped, and one
 * per speaker. The per-speaker form is what lets an interrupted sentence resolve,
 * and it is the stricter test of the two, since the words must be that speaker's.
 *
 * IT FAILS OPEN, DELIBERATELY. A quote too short to be distinctive ("yes",
 * "okay") resolves by definition — a substring test on three characters proves
 * nothing either way, and dropping a finding on that basis would be the same
 * false confidence this module exists to remove.
 */

/**
 * Below this many normalised characters a substring test is not evidence of
 * anything: "yes" appears in almost any transcript, and its absence from a
 * paraphrase says nothing about whether the miss was real.
 */
const MIN_RESOLVABLE_CHARS = 12;

/** Elision marks a model uses when it stitches two spans into one quote. */
const ELISION_RE = /\s*(?:\.\.\.+|…|\[\s*\.\.\.\s*\])\s*/;

/**
 * Collapse text to comparable form: lowercase, smart punctuation folded to
 * ASCII, everything that is not a letter or digit reduced to a single space.
 * Punctuation and line breaks are exactly what ASR rendering disagrees about,
 * so they must not decide whether a quote is real.
 */
export function normalizeForMatch(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * A rendered turn line: `[00:01:24 — CUSTOMER] we have twelve zones`. Anything
 * not matching this (the `---` between joined transcripts, or a provider whose
 * payload fell through to a verbatim dump) is simply not a turn.
 */
const TURN_LINE_RE = /^\s*\[([^\]]*)\]\s*(.*)$/;

/**
 * The older `Agent: text` line form, which `formatTranscriptContent` passes
 * through verbatim when a provider's payload is already plain text. Recognising
 * it matters for attribution: an unparsed line has no speaker, and a transcript
 * with no speakers can attribute nothing, so without this the verification pass
 * would go silent on every plain-text provider and let false positives back in.
 * The label is bounded and word-ish so an ordinary mid-sentence colon does not
 * become a speaker.
 */
const PLAIN_TURN_RE = /^\s*([A-Za-z][A-Za-z0-9 ._-]{0,30}?)\s*:\s+(.*)$/;

interface Turn { speaker: string; text: string }

/** Every speaker-labelled line in a source, in either rendered form. */
function turnsOf(source: string): Turn[] {
  const turns: Turn[] = [];
  for (const line of source.split('\n')) {
    const bracketed = TURN_LINE_RE.exec(line);
    if (bracketed) {
      turns.push({ speaker: speakerOf(bracketed[1]), text: bracketed[2] });
      continue;
    }
    const plain = PLAIN_TURN_RE.exec(line);
    if (plain) turns.push({ speaker: plain[1].trim().toLowerCase(), text: plain[2] });
  }
  return turns;
}

/**
 * Speaker labels `formatTranscriptContent` renders for OUR side of the line.
 * Note that it collapses agent, ACD, IVR and system into one label, so an
 * internal turn identifies the COMPANY, never a particular employee — which is
 * why attribution needs the participant count as well as the label.
 */
const INTERNAL_SPEAKERS = ['agent', 'internal', 'rep', 'salesperson'];

/** The speaker is the last dash-separated part of the label. */
function speakerOf(label: string): string {
  const parts = label.split(/[\u2010-\u2015-]/);
  return (parts[parts.length - 1] ?? '').trim().toLowerCase();
}

/**
 * Expand one source into every form a verbatim quote could legitimately match.
 *
 * Concatenating a speaker's turns does make words adjacent that were minutes
 * apart, so a quote could in principle resolve across a turn boundary it never
 * spanned. That is a far smaller risk than the false rejections it removes: the
 * exact word sequence still has to be present, and the alternative was dropping
 * genuine evidence from every call a phrase-level provider transcribed.
 */
function haystacksFor(source: string): string[] {
  const asRendered = normalizeForMatch(source);
  const turns = turnsOf(source);
  if (turns.length === 0) return [asRendered];

  const bySpeaker = new Map<string, string[]>();
  for (const t of turns) {
    const prior = bySpeaker.get(t.speaker);
    if (prior) prior.push(t.text);
    else bySpeaker.set(t.speaker, [t.text]);
  }

  return [
    asRendered,
    normalizeForMatch(turns.map((t) => t.text).join(' ')),
    ...[...bySpeaker.values()].map((parts) => normalizeForMatch(parts.join(' '))),
  ];
}

/**
 * True when `quote` resolves to at least one of `sources`.
 *
 * A quote containing an elision ("we need it Friday… can you send that") is
 * treated as several spans that must EACH resolve, and all within the same
 * source — that is what the model meant by joining them, and checking the
 * halves separately is what lets a legitimate stitched quote through without
 * accepting two unrelated fragments glued together.
 */
export function quoteResolves(quote: string | null, ...sources: Array<string | null>): boolean {
  const normQuote = normalizeForMatch(quote ?? '');
  if (normQuote.length < MIN_RESOLVABLE_CHARS) return true;

  const haystacks = sources
    .flatMap((s) => haystacksFor(s ?? ''))
    .filter((s) => s.length > 0);
  if (haystacks.length === 0) return true;

  return matchesAny(quote, normQuote, haystacks, true);
}

/**
 * Shared span/elision test against a prepared set of haystacks.
 *
 * `undecidable` is what to answer when the quote carries no testable span — the
 * two callers want opposite answers there, because one is deciding whether to
 * keep a finding and the other whether to delete one.
 */
function matchesAny(
  quote: string | null,
  normQuote: string,
  haystacks: string[],
  undecidable: boolean,
): boolean {
  const spans = (quote ?? '').split(ELISION_RE).map(normalizeForMatch);
  if (spans.length > 1) {
    const testable = spans.filter((s) => s.length >= MIN_RESOLVABLE_CHARS);
    if (testable.length === 0) return undecidable;
    return haystacks.some((hay) => testable.every((span) => hay.includes(span)));
  }
  return haystacks.some((hay) => hay.includes(normQuote));
}

/**
 * True when `quote` resolves to a turn spoken by OUR side of the line.
 *
 * DELIBERATELY STRICT, UNLIKE `quoteResolves`. That function fails open because
 * its job is to avoid discarding a real finding over a punctuation difference.
 * This one is used to decide whether to DELETE a finding on the grounds that the
 * salesperson already did the thing, so every ambiguity has to answer "no":
 *
 *   - a transcript with no speaker labels cannot attribute anything, so false;
 *   - a quote short enough to appear anywhere proves no attribution, so false;
 *   - a line the CUSTOMER spoke is not the salesperson making an offer, so the
 *     customer's turns are never in the haystack.
 *
 * It still cannot tell one employee from another — `formatTranscriptContent`
 * collapses agent, ACD, IVR and system into a single "Agent" label — which is
 * exactly why callers must also check how many internal parties were on the
 * conversation before trusting a positive result.
 */
export function quoteResolvesAsInternalSpeaker(
  quote: string | null,
  transcript: string | null,
): boolean {
  return resolvesAsSpeaker(quote, transcript, (s) => INTERNAL_SPEAKERS.includes(s));
}

/**
 * Labels `formatTranscriptContent` renders for the FAR END of the line. It emits
 * only "Customer"; the aliases cover a hand-built or legacy rendering.
 */
const EXTERNAL_SPEAKERS = ['customer', 'external', 'caller'];

/**
 * True when `quote` resolves to a turn spoken by the CUSTOMER.
 *
 * Used for a rule's own exclusions, which are normally proved by what the
 * customer said — "email me the link", "we'll review it and come back to you", "I
 * need to run it past my partner". Those lines are what the miss turns on and
 * they are unavailable to `quoteResolvesAsInternalSpeaker`.
 *
 * Scoped to the customer rather than to either party ON PURPOSE. A positive
 * result DELETES a finding, and an internal turn identifies the company rather
 * than a person, so accepting any speaker would let a transferred colleague's
 * sentence clear the reviewed salesperson — the Jason warranty failure, re-entered
 * through the exclusion question instead of the attempt question. Callers that can
 * prove the reviewed salesperson was the only employee on the line combine this
 * with the internal test; nobody else may.
 */
export function quoteResolvesAsCustomer(
  quote: string | null,
  transcript: string | null,
): boolean {
  return resolvesAsSpeaker(quote, transcript, (s) => EXTERNAL_SPEAKERS.includes(s));
}

/** Shared strict span test against the turns whose speaker `accept` allows. */
function resolvesAsSpeaker(
  quote: string | null,
  transcript: string | null,
  accept: (speaker: string) => boolean,
): boolean {
  const normQuote = normalizeForMatch(quote ?? '');
  if (normQuote.length < MIN_RESOLVABLE_CHARS) return false;

  const texts = turnsOf(transcript ?? '')
    .filter((t) => accept(t.speaker))
    .map((t) => t.text);
  if (texts.length === 0) return false;

  // Both forms: each turn on its own, and the speaker's turns joined, so a
  // sentence a phrase-level provider split across turns still resolves.
  const haystacks = [
    normalizeForMatch(texts.join(' ')),
    ...texts.map(normalizeForMatch),
  ].filter((s) => s.length > 0);
  return matchesAny(quote, normQuote, haystacks, false);
}

/** `by Jamie Smith` inside a rendered note header. See crmThread.renderAction. */
const NOTE_AUTHOR_RE = /(?:^|·)\s*by\s+([^·\]]+)/i;

/**
 * The authors of the rendered note lines a quote actually appears in.
 *
 * A record's history legitimately contains other employees' notes, so "the quote
 * is somewhere in the CRM block" cannot establish that the reviewed salesperson
 * wrote it — and attributing a colleague's note to them is how one person's work
 * became another's credit. Rendered lines carry `by <author>` in the header
 * (crmThread), so the author of the specific matched line is checkable here
 * without another model call.
 *
 * Returns an empty array when the quote matches no single line, which callers must
 * read as "not attributable", never as "attributable to anyone".
 */
export function quoteAuthors(quote: string | null, notes: string | null): string[] {
  const normQuote = normalizeForMatch(quote ?? '');
  if (normQuote.length < MIN_RESOLVABLE_CHARS) return [];
  const authors: string[] = [];
  for (const line of (notes ?? '').split('\n')) {
    const m = TURN_LINE_RE.exec(line);
    if (!m) continue;
    if (!normalizeForMatch(m[2]).includes(normQuote)) continue;
    const author = NOTE_AUTHOR_RE.exec(m[1])?.[1]?.trim();
    if (author) authors.push(author);
  }
  return authors;
}

/** True when one of `authors` is the named person, compared on normalised form. */
export function isSamePerson(authors: readonly string[], name: string): boolean {
  const target = normalizeForMatch(name);
  if (!target) return false;
  return authors.some((a) => normalizeForMatch(a) === target);
}

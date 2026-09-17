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
  const turns: Array<{ speaker: string; text: string }> = [];
  for (const line of source.split('\n')) {
    const m = TURN_LINE_RE.exec(line);
    if (m) turns.push({ speaker: speakerOf(m[1]), text: m[2] });
  }
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

  const spans = (quote ?? '').split(ELISION_RE).map(normalizeForMatch);
  if (spans.length > 1) {
    // Only the distinctive halves are testable; if the model stitched together
    // nothing but short interjections there is no claim here to disconfirm.
    const testable = spans.filter((s) => s.length >= MIN_RESOLVABLE_CHARS);
    if (testable.length === 0) return true;
    return haystacks.some((hay) => testable.every((span) => hay.includes(span)));
  }

  return haystacks.some((hay) => hay.includes(normQuote));
}

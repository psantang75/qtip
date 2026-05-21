/**
 * KB procedure parser (Phase F, F1).
 *
 * Tech Support BookStack pages express their troubleshooting flow as a
 * sequence of numbered `Approach N` blocks, optionally chained with
 * fallback sentences like:
 *
 *   Approach 1
 *   Qualify what the radio displays. If the radio displays artist...
 *
 *   Approach 2
 *   Verify that the player has 70% or higher signal strength.
 *     If <70%, the antenna will need to be reaimed.
 *     If >=70%, go to approach 3.
 *
 *   If Approach 1 did not solve the issue, move to Approach 3.
 *
 *   Approach 3
 *   Send a refresh signal to the player.
 *   ...
 *   If Approach 2 did not solve the issue, move to Approach 4.
 *
 * Before this parser existed, the trace-pass LLM had to read the raw
 * page body and infer (a) what each Approach is and (b) which Approach
 * is mandatory vs which is a conditional fallback. That inference was
 * unreliable — multiple versions of the trace prompt (v3, v4, v5)
 * tried to bind the model with MANDATORY rules and each version
 * regressed something the prior version had stabilised. The fix is to
 * stop asking: parse the structure once, deterministically, in code,
 * and inject the result into the prompt as data rather than asking
 * the model to derive it.
 *
 * Output shape is intentionally minimal:
 *   - `approaches[]` — one entry per `Approach N` heading.
 *   - `chain[]`      — explicit fallback transitions of the form
 *                      "If Approach M did not solve, move to Approach N".
 *
 * Returns `null` when zero `Approach N` headings are found, so pages
 * that don't fit the Tech-Support skeleton pass through to today's
 * body-only rendering with no regression.
 */

const APPROACH_HEADING_RE = /^Approach\s+(\d+)\b/;
const CHAIN_SENTENCE_RE =
  /If\s+Approach\s+(\d+)\s+did\s+not\s+(?:solve|resolve)[^.\n]*?,\s*move\s+to\s+Approach\s+(\d+)/gi;

const TITLE_MAX_CHARS = 120;
const BODY_MAX_CHARS = 600;

export interface ParsedApproach {
  /** Number from the `Approach N` heading. Stable identifier across the file. */
  n: number;
  /** First non-blank line under the heading, truncated to {@link TITLE_MAX_CHARS}. */
  title: string;
  /**
   * Verbatim body between this Approach heading and the next, with the
   * title line excluded and trimmed of leading / trailing whitespace.
   * Capped at {@link BODY_MAX_CHARS} so a runaway page can't blow up
   * the per-source trace prompt.
   */
  body: string;
}

export interface ParsedChainEdge {
  /** Source Approach number — the one whose failure triggers the transition. */
  from: number;
  /** Destination Approach number — the next step to attempt. */
  to: number;
}

export interface ParsedProcedure {
  approaches: ParsedApproach[];
  chain: ParsedChainEdge[];
}

/**
 * Parse the indented plaintext output of {@link stripHtmlToPlaintext}
 * for a Tech-Support style procedure. Returns `null` when no
 * `Approach N` heading is present so the caller can fall back to the
 * raw page body untouched.
 */
export function parseKbApproaches(text: string): ParsedProcedure | null {
  if (!text) return null;
  const lines = text.split(/\r?\n/);

  // Collect the line index of every Approach heading. We then walk
  // pairs of indices to slice the body. A single pass with a state
  // machine works too, but two passes is easier to reason about and
  // the cost is irrelevant at the page-body scale we deal with.
  const headings: Array<{ n: number; lineIdx: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = APPROACH_HEADING_RE.exec(lines[i].trim());
    if (m) headings.push({ n: Number(m[1]), lineIdx: i });
  }
  if (headings.length === 0) return null;

  const approaches: ParsedApproach[] = [];
  for (let h = 0; h < headings.length; h++) {
    const start = headings[h].lineIdx;
    const end = h + 1 < headings.length ? headings[h + 1].lineIdx : lines.length;
    // Skip the heading line itself, then find the first non-blank
    // line as the title. Body is everything between title and end.
    let titleLineIdx = -1;
    for (let i = start + 1; i < end; i++) {
      if (lines[i].trim().length > 0) {
        titleLineIdx = i;
        break;
      }
    }
    if (titleLineIdx === -1) {
      // Heading with no body at all — skip; an empty Approach contributes
      // nothing to the prompt.
      continue;
    }
    const rawTitle = lines[titleLineIdx].trim();
    const title =
      rawTitle.length > TITLE_MAX_CHARS ? rawTitle.slice(0, TITLE_MAX_CHARS - 1) + '\u2026' : rawTitle;

    const bodyLines = lines.slice(titleLineIdx + 1, end);
    // Drop the trailing "If Approach M did not solve, move to Approach N"
    // chain sentences from the body — they live in `chain[]` instead,
    // and repeating them in the body bloats the prompt without value.
    const bodyLinesNoChain = bodyLines.filter((ln) => !CHAIN_SENTENCE_RE.test(ln));
    // CHAIN_SENTENCE_RE is /g, which means .test() advances lastIndex —
    // reset it so the subsequent global pass over the whole text starts
    // cleanly. (This is the classic JS regex foot-gun.)
    CHAIN_SENTENCE_RE.lastIndex = 0;
    const rawBody = bodyLinesNoChain.join('\n').trim();
    const body =
      rawBody.length > BODY_MAX_CHARS ? rawBody.slice(0, BODY_MAX_CHARS - 1).trimEnd() + '\u2026' : rawBody;

    approaches.push({ n: headings[h].n, title, body });
  }

  if (approaches.length === 0) return null;

  // Pass 2: pick up chain edges anywhere in the text. Order isn't
  // significant — the consumer renders them attached to the
  // destination approach as a "(only if Approach M did not resolve)"
  // qualifier.
  const chain: ParsedChainEdge[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(CHAIN_SENTENCE_RE)) {
    const from = Number(m[1]);
    const to = Number(m[2]);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    const key = `${from}->${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chain.push({ from, to });
  }

  return { approaches, chain };
}

/**
 * Format a parsed procedure as the KB PROCEDURE block injected into
 * the trace + reasoning prompts. The block is the structural
 * counterpart to the raw KB body and is meant to be the AUTHORITATIVE
 * source for KB-following questions.
 *
 * The "(only if Approach M did not resolve)" qualifier is attached
 * inline to the relevant Approach so the model sees the conditional
 * right next to the step it gates, rather than buried in a separate
 * "chain rules" footer where it competes for attention.
 */
export function renderKbProcedureBlock(
  procedure: ParsedProcedure,
  pageName: string,
  pageUrl: string
): string {
  // Build a (destination -> source) map so we can render the gating
  // qualifier inline. If multiple sources can fall through to the same
  // destination (rare but legal), surface all of them.
  const incomingByDest = new Map<number, number[]>();
  for (const edge of procedure.chain) {
    const arr = incomingByDest.get(edge.to) ?? [];
    arr.push(edge.from);
    incomingByDest.set(edge.to, arr);
  }

  const lines: string[] = [
    `KB PROCEDURE - ${pageName} (${pageUrl})`,
    '(authoritative - derived from KB structure in code; do not infer required steps from approach numbering alone)',
    '',
  ];
  for (const a of procedure.approaches) {
    const incoming = incomingByDest.get(a.n);
    const qualifier =
      incoming && incoming.length > 0
        ? ` (only if Approach ${incoming.join(' or Approach ')} did not resolve)`
        : '';
    lines.push(`  Approach ${a.n}: ${a.title}${qualifier}`);
    if (a.body) {
      const indented = a.body
        .split('\n')
        .map((ln) => '    ' + ln)
        .join('\n');
      lines.push(indented);
    }
  }
  return lines.join('\n');
}

/**
 * Best-effort HTML → plaintext conversion used wherever we surface
 * CRM / KB / customer-supplied content into prompts or human-facing
 * UIs that expect plain text.
 *
 * Why this exists rather than a heavier sanitizer like `dompurify` or
 * `cheerio`: we only need three guarantees here, and we need them
 * cheaply and synchronously inside hot paths (KB crawl, AI prompt
 * assembly, ticket detail render):
 *   1. No raw `<tag>` markup leaks into model prompts where the model
 *      might mistake it for instructions.
 *   2. Entities like `&quot;` `&amp;` `&#39;` are decoded so the AI
 *      reads `Contact is having error "please log in"` rather than
 *      `Contact is having error &quot;please log in&quot;`.
 *   3. Whitespace collapses to something a human reader can scan.
 *
 * If the source is already plaintext (CRM ticket Description fields
 * frequently are), the function is a near-no-op — tag-stripping
 * silently does nothing when there are no tags, and entity decoding
 * runs against a small fixed set of replacements.
 */
export function stripHtmlToPlaintext(html: string): string {
  if (!html) return '';

  // Pre-pass: rewrite `<li>` openers with an indent prefix that reflects
  // the current `<ul>/<ol>` nesting depth. Without this, nested lists
  // collapsed into a flat bullet wall — and KB pages that express
  // conditional / fallback semantics through nesting (e.g.
  // "Approach 2 — Verify signal\n  - If <70%, reaim antenna\n  - If
  // >=70%, go to Approach 3") looked sequentially required to the AI
  // Reviewer's trace pass. See backend/prompts/ai-reviewer/trace.v1.md
  // KB_CONDITIONAL rule for the consumer.
  //
  // Implementation: walk the HTML once token-by-token tracking depth on
  // `<ul`/`<ol` push and `</ul>`/`</ol>` pop. Each `<li` emits
  // `\n` + 2*max(0, depth-1) spaces + `- `. Outermost level keeps the
  // legacy zero-indent rendering so flat lists are byte-identical to
  // before. Unmatched closes are clamped to zero (BookStack exports are
  // usually balanced but we keep this defensive).
  const tagRe = /<\/?(ul|ol|li)\b[^>]*>/gi;
  let depth = 0;
  let withIndent = '';
  let cursor = 0;
  for (const m of html.matchAll(tagRe)) {
    withIndent += html.slice(cursor, m.index);
    const raw = m[0];
    const isClose = raw[1] === '/';
    const tag = m[1].toLowerCase();
    if (tag === 'ul' || tag === 'ol') {
      if (isClose) {
        depth = Math.max(0, depth - 1);
        // Keep the existing block-break behaviour for closing list tags
        // so the downstream `</(p|div|...|ul|ol)>` regex still produces
        // the paragraph break callers expect. Re-emit the original token
        // so that pass still matches it.
        withIndent += raw;
      } else {
        depth += 1;
        // Open tag carries no text payload; drop it (the closer above
        // emits the paragraph break, matching pre-change behaviour).
      }
    } else {
      // `<li ...>` opener — emit our indented bullet. `</li>` is dropped
      // (no text payload; the next `<li>` or list-close handles the
      // separator). Closes of `<li>` are rare in well-formed exports and
      // harmless when they appear inline. We emit the indent using a
      // NUL-byte sentinel so that the downstream `[ \t]+` collapse
      // doesn't eat it; sentinels are converted back to real spaces at
      // the end of the function.
      if (!isClose) {
        const indent = '\x00\x00'.repeat(Math.max(0, depth - 1));
        withIndent += `\n${indent}- `;
      }
    }
    cursor = m.index + raw.length;
  }
  withIndent += html.slice(cursor);

  return (
    withIndent
      // Drop noisy <style>/<script> bodies wholesale.
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      // Convert STRUCTURAL breaks BEFORE tag-stripping so paragraph and
      // line boundaries survive into the plaintext output. Without this
      // a wall of `<p>line1</p><p>line2</p>` collapsed into
      // `line1 line2`, eating the blank lines that human readers — and
      // the AI — rely on to separate notes, signatures, Q&A blocks, etc.
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|h[1-6]|blockquote|pre|article|section|ul|ol)>/gi, '\n\n')
      // Any remaining (inline) tags collapse to a single space so that
      // `<span>foo</span><span>bar</span>` becomes `foo bar` rather than
      // `foobar`. The horizontal-whitespace pass below cleans up the
      // double-spaces this can introduce.
      .replace(/<[^>]+>/g, ' ')
      // Decode the small fixed set of entities we care about (matches
      // what shows up in CRM ticket bodies and BookStack page exports).
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // Whitespace cleanup that PRESERVES newlines: collapse only
      // horizontal whitespace, trim each line's edges, and cap runs of
      // blank lines at one (so `\n\n\n\n` becomes `\n\n`). Leading
      // indentation for nested bullets is stored as NUL-byte sentinels
      // during the <li> pre-pass and is therefore not touched here.
      .replace(/[ \t]+/g, ' ')
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      // Convert NUL-byte sentinels back into real space characters now
      // that all collapse passes have run. Two NULs per nesting level
      // gives the two-space indent the trace prompt expects.
      .replace(/\x00/g, ' ')
      .trim()
  );
}

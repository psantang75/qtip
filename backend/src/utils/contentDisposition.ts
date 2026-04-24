/**
 * Content-Disposition helpers.
 *
 * Single source of truth for the `filename=` / `filename*=` token used in
 * download responses. Used to be inlined as `escapeFilename` in
 * admin / manager / csr / coaching / onDemandReports / trainer controllers
 * (six near-identical copies) — consolidated here during the pre-production
 * review (item #26) so any future tweak to the RFC 5987 logic only has to
 * land in one file.
 *
 * Standards followed:
 *   - Strips control characters (0x00–0x1F, 0x7F) which are illegal in HTTP
 *     header values regardless of quoting.
 *   - For pure ASCII alphanumerics + `._-` filenames, emits the simple
 *     `filename="..."` form for maximum compatibility.
 *   - For anything else (spaces, accents, non-Latin) emits the RFC 5987
 *     `filename*=UTF-8''<percent-encoded>` form so user agents that support
 *     the extended syntax (every modern browser) get the correct filename.
 *   - Falls back to `filename="attachment"` when the input is null / empty
 *     after sanitisation.
 *
 * Usage:
 *   res.setHeader('Content-Disposition', `attachment; ${formatFilename(name)}`);
 */

/**
 * Build the `filename=` / `filename*=` portion of a Content-Disposition
 * header value. Caller is responsible for prefixing it with `attachment; `
 * (or `inline; `) so the helper stays disposition-type-agnostic.
 */
export function formatFilename(filename: string | null | undefined): string {
  if (!filename) return 'filename="attachment"';

  const clean = filename.replace(/[\x00-\x1F\x7F]/g, '').trim();
  if (!clean) return 'filename="attachment"';

  const needsEncoding = /[^a-zA-Z0-9._-]/.test(clean);
  if (needsEncoding) {
    const encoded = encodeURIComponent(clean).replace(/\*/g, '%2A');
    return `filename*=UTF-8''${encoded}`;
  }

  return `filename="${clean.replace(/"/g, '\\"')}"`;
}

/**
 * @deprecated Old name kept temporarily so call sites can migrate without
 * touching every file in one PR. Prefer {@link formatFilename}.
 */
export const escapeFilename = formatFilename;

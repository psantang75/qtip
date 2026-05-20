/**
 * KB front-matter parser (Phase D, D2).
 *
 * BookStack page bodies are markdown. QTIP authors a small YAML block
 * at the top of select pages so the AI Reviewer can filter / score them
 * by review kind, role, and authority without re-deriving that signal
 * from prose every prompt build:
 *
 *     ---
 *     qtip_role: agent
 *     qtip_applies_to: [TICKET, CALL]
 *     qtip_steps: [Greet, Probe, Diagnose, Resolve, Wrap]
 *     qtip_authority: official
 *     ---
 *
 * Why a hand-rolled parser?
 *   - Front-matter we accept is a tiny, fully-controlled subset (scalars
 *     + flow-style string arrays). Pulling in `js-yaml` to handle five
 *     keys is dependency creep we can avoid.
 *   - Anything that doesn't match this exact shape is treated as
 *     "no metadata". Authors get clear feedback (no row in
 *     kb_pages_meta) instead of silently mis-parsed values.
 *
 * Phase D (D3) also uses the same crawl pass to extract an ordered
 * `Steps` section (numbered or bulleted list under a `## Steps`
 * heading) into `playbook_steps[]`. The trace prompt reads that JSON
 * directly so it doesn't have to re-parse the page body.
 */

export type QtipAppliesToKind = 'TICKET' | 'TASK' | 'CALL';

export interface KbFrontMatter {
  qtip_role: string | null;
  qtip_applies_to: QtipAppliesToKind[] | null;
  qtip_steps: string[] | null;
  qtip_authority: string | null;
}

export interface KbFrontMatterParseResult {
  /** Page body with the front-matter block stripped (or untouched when none). */
  body: string;
  /** Parsed front-matter values, or null when no valid block was found. */
  meta: KbFrontMatter | null;
  /**
   * Phase D (D3): ordered list of canonical step names extracted from
   * the body's `## Steps` section (or `qtip_steps` when present —
   * front-matter wins). Empty array when neither source produces
   * anything usable.
   */
  playbook_steps: string[];
}

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Parse a page's markdown body, returning the body sans front-matter,
 * the structured metadata (when present and valid), and the ordered
 * playbook step list. Never throws — malformed front-matter degrades
 * to `meta: null` and leaves the body untouched so the embedding
 * pipeline still gets the page.
 */
export function parseKbFrontMatter(markdown: string): KbFrontMatterParseResult {
  const m = FRONT_MATTER_RE.exec(markdown);
  let body = markdown;
  let meta: KbFrontMatter | null = null;
  if (m) {
    const block = m[1] ?? '';
    body = markdown.slice(m[0].length);
    meta = parseScalarBlock(block);
  }
  const stepsFromMeta = meta?.qtip_steps ?? null;
  const playbook_steps = stepsFromMeta && stepsFromMeta.length > 0
    ? stepsFromMeta
    : extractStepsSection(body);
  return { body, meta, playbook_steps };
}

/**
 * Parse a YAML-ish key/value block. Supported per line:
 *   - `key: value`            — bare scalar string
 *   - `key: [a, b, "c, d"]`   — flow-style list of strings
 * Lines starting with `#` are treated as comments. Any line that
 * doesn't match drops to "no metadata".
 */
function parseScalarBlock(block: string): KbFrontMatter | null {
  const out: Record<string, string | string[]> = {};
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const rawVal = line.slice(idx + 1).trim();
    if (!key) continue;
    if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
      out[key] = parseFlowList(rawVal.slice(1, -1));
    } else {
      out[key] = stripQuotes(rawVal);
    }
  }
  if (Object.keys(out).length === 0) return null;

  const role = typeof out.qtip_role === 'string' ? out.qtip_role : null;
  const authority = typeof out.qtip_authority === 'string' ? out.qtip_authority : null;
  const appliesRaw = Array.isArray(out.qtip_applies_to)
    ? out.qtip_applies_to
    : typeof out.qtip_applies_to === 'string'
      ? [out.qtip_applies_to]
      : [];
  const applies = appliesRaw
    .map((s) => s.toUpperCase())
    .filter((s): s is QtipAppliesToKind => s === 'TICKET' || s === 'TASK' || s === 'CALL');
  const stepsRaw = Array.isArray(out.qtip_steps)
    ? out.qtip_steps
    : typeof out.qtip_steps === 'string'
      ? [out.qtip_steps]
      : [];

  return {
    qtip_role: role || null,
    qtip_applies_to: applies.length > 0 ? applies : null,
    qtip_steps: stepsRaw.length > 0 ? stepsRaw : null,
    qtip_authority: authority || null,
  };
}

function parseFlowList(inner: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inQuote: '"' | "'" | null = null;
  for (const ch of inner) {
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        buf += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (ch === ',') {
      const v = buf.trim();
      if (v) out.push(v);
      buf = '';
      continue;
    }
    buf += ch;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

function stripQuotes(raw: string): string {
  if (raw.length >= 2) {
    const a = raw[0];
    const b = raw[raw.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) return raw.slice(1, -1);
  }
  return raw;
}

/**
 * Phase D (D3): pull an ordered list of step names from the body's
 * `Steps` section. Recognizes both `## Steps` and a plain `Steps:`
 * heading, then collects the next contiguous block of numbered or
 * bulleted lines. Leaves the body untouched.
 */
function extractStepsSection(body: string): string[] {
  const lines = body.split(/\r?\n/);
  let inSteps = false;
  const steps: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inSteps) {
      if (/^#{1,6}\s+steps\b/i.test(trimmed) || /^steps\s*:/i.test(trimmed)) {
        inSteps = true;
      }
      continue;
    }
    if (!trimmed) {
      // blank line ends the section unless we haven't collected anything yet
      if (steps.length > 0) break;
      continue;
    }
    // New heading after the steps heading ends the section.
    if (/^#{1,6}\s+/.test(trimmed) && !/^#{1,6}\s+steps\b/i.test(trimmed)) break;
    const m = /^(?:\d+[.)]|[-*])\s+(.+?)\s*$/.exec(trimmed);
    if (!m) {
      // Non-list line after some steps -> end. Plain text before any list -> ignore.
      if (steps.length > 0) break;
      continue;
    }
    steps.push(m[1].trim());
  }
  return steps;
}

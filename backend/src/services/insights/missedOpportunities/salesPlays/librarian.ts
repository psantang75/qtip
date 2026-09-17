/**
 * salesPlays.librarian — the semantic compressor embeddings can't be.
 *
 * Embedding consolidation rates our mined plays "related but distinct", so it
 * only strips exact-ish dupes and leaves the top-N per category still carrying
 * 2-3 rewordings of the same move. This pass fixes that: for each category it
 * hands the most-supported mined plays to the model and asks for a small,
 * genuinely DISTINCT canonical playbook — duplicates merged, evidence kept,
 * support summed. The result is what actually grounds the reviewer.
 *
 * Canonical rows are marked by `source_conversation_id = NULL` (raw mined plays
 * always carry a conversation id), so a re-run can replace the prior canon of
 * the same tier without touching raw history. Raw `proposed` plays in a category
 * are archived once represented by canon — the long, single-call tail is noise.
 *
 * PROVENANCE SURVIVES THE MERGE. Two things used to break here. The evidence
 * quote was whatever the model wrote in that field, even though the quotes were
 * never sent to it — so a canonical play carried invented words in a column
 * named for verbatim evidence, and that column grounds the reviewer's
 * recommendations. And every canonical row was saved as `source_outcome: 'WON'`
 * regardless of what it was merged from, while the miner learns from LOST calls
 * too. Now the members' real quotes go in with their indexes, the model's choice
 * is accepted only if it matches one of them, and the outcome is derived from
 * the members rather than asserted.
 *
 * Never throws per-category: one bad LLM response skips that category, it does
 * not abort the whole rebuild. When no provider is configured it is a no-op.
 */
import logger from '../../../../config/logger';
import prisma from '../../../../config/prisma';
import { callChatModel } from '../../../ai/ChatModelClient';
import { withCallLog } from '../../../aiCallLogger';
import { resolveProvider, resolveTierModel } from '../analyzer';
import { normalizeForMatch } from '../evidence';
import { stripFence } from '../parse';
import { getMissedOpportunitySettings } from '../settings';
import { PLAY_CATEGORIES } from './plays.service';

/** Distinct canonical plays to keep per category — the reviewer only ever shows the top few. */
const MAX_PER_CATEGORY = 12;
/** How many mined plays (top by support) to feed the model per category — bounds tokens. */
const INPUT_CAP_PER_CATEGORY = 150;
const MAX_OUTPUT_TOKENS = 4096;
const CALL_TIMEOUT_MS = 120_000;

interface MinedRow {
  play_id: bigint;
  title: string;
  body_md: string;
  evidence_quote: string | null;
  evidence_speaker: string | null;
  est_value_note: string | null;
  support_count: number | null;
  source_outcome: string;
}

interface CanonicalPlay {
  title: string;
  bodyMd: string;
  evidenceQuote: string | null;
  evidenceSpeaker: string | null;
  estValueNote: string | null;
  support: number;
  /** Derived from the merged members: 'WON', 'LOST', or 'MIXED'. */
  sourceOutcome: string;
}

export interface CanonicalizeSummary {
  categories: number;
  rawArchived: number;
  canonicalInserted: number;
  activated: boolean;
  skipped: boolean;
}

function buildSystemPrompt(persona: string): string {
  return [
    persona.trim(),
    '',
    'You are a sales-enablement LIBRARIAN. You receive mined "plays" (tactics observed on our own calls) from ONE category, each with an index, title, body, support (how many calls it came from), the outcome of those calls, and the verbatim quote it was mined from.',
    `Merge duplicates and near-duplicates into AT MOST ${MAX_PER_CATEGORY} canonical, genuinely DISTINCT plays.`,
    '',
    'Rules:',
    '- Combine every play that expresses the same move into one canonical play; do not emit two plays that a rep would read as "the same idea".',
    '- Keep the strongest, most concrete wording. `title`: short imperative under 12 words. `body_md`: 1-3 actionable sentences.',
    '- `evidence_quote`: COPY the single best quote from among the merged plays EXACTLY as given, or null. Do not reword, shorten, or compose one — a quote that is not character-for-character one of the inputs is discarded. `evidence_speaker`: "CUSTOMER" or "AGENT" for it, else null.',
    '- `est_value_note`: a short revenue note or null.',
    '- `members`: the list of input indexes you merged into this canonical play (1-based). Every input index must appear in exactly one canonical play.',
    '- NEVER recommend free product, free service, waived fees, or unauthorized discounts. Paid/authorized tactics only.',
    '- Rank the output most-impactful first.',
    '',
    'Respond with ONLY JSON: {"plays":[{"title":"...","body_md":"...","evidence_quote":"verbatim or null","evidence_speaker":"CUSTOMER|AGENT|null","est_value_note":"note or null","members":[1,2]}]}',
  ].join('\n');
}

function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t || t.toLowerCase() === 'null') return null;
  return t.length > max ? t.slice(0, max) : t;
}

function speaker(value: unknown): 'CUSTOMER' | 'AGENT' | null {
  const v = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return v === 'CUSTOMER' || v === 'AGENT' ? v : null;
}

/** The merged members' real outcomes, collapsed to one label. */
function deriveOutcome(members: MinedRow[]): string {
  const outcomes = new Set(members.map((m) => (m.source_outcome ?? '').toUpperCase()).filter(Boolean));
  if (outcomes.size === 1) return [...outcomes][0];
  return outcomes.size === 0 ? 'UNKNOWN' : 'MIXED';
}

/**
 * The quote to keep for a merged play.
 *
 * The model's choice is honoured only when it matches one of the members'
 * actual quotes (normalised, so punctuation drift does not reject a real copy).
 * Anything else falls back to the best-supported member's quote, so the field
 * always holds words somebody really said.
 */
function resolveQuote(
  chosen: string | null,
  members: MinedRow[],
): { quote: string | null; speaker: string | null } {
  const withQuotes = members.filter((m) => (m.evidence_quote ?? '').trim());
  const matched = chosen
    ? withQuotes.find((m) => normalizeForMatch(m.evidence_quote ?? '') === normalizeForMatch(chosen))
    : undefined;
  const source = matched
    ?? [...withQuotes].sort((a, b) => (b.support_count ?? 1) - (a.support_count ?? 1))[0];
  if (!source) return { quote: null, speaker: null };
  return {
    quote: (source.evidence_quote ?? '').trim().slice(0, 1200) || null,
    speaker: speaker(source.evidence_speaker),
  };
}

/** Parse the model's canonical list; support = summed support of merged members. */
export function parseCanonical(raw: string, rows: MinedRow[]): CanonicalPlay[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch {
    return [];
  }
  const arr = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).plays)
      ? ((parsed as Record<string, unknown>).plays as unknown[])
      : [];

  const out: CanonicalPlay[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const title = str(o.title, 240);
    const bodyMd = str(o.body_md, 2000);
    if (!title || !bodyMd) continue;

    const memberRows: MinedRow[] = [];
    let support = 0;
    for (const m of Array.isArray(o.members) ? o.members : []) {
      const idx = Math.trunc(Number(m)) - 1;
      if (idx >= 0 && idx < rows.length) {
        memberRows.push(rows[idx]);
        support += rows[idx].support_count ?? 1;
      }
    }

    const evidence = resolveQuote(str(o.evidence_quote, 1200), memberRows);
    out.push({
      title,
      bodyMd,
      evidenceQuote: evidence.quote,
      evidenceSpeaker: evidence.quote ? evidence.speaker : null,
      estValueNote: str(o.est_value_note, 240),
      support: support > 0 ? support : 1,
      sourceOutcome: deriveOutcome(memberRows),
    });
    if (out.length >= MAX_PER_CATEGORY) break;
  }
  return out;
}

/**
 * Rebuild the canonical playbook from the current `proposed` mined plays.
 * @param opts.activate insert canon as `active` (approved) instead of `proposed`.
 */
export async function canonicalizePlays(
  opts: { activate?: boolean } = {},
): Promise<CanonicalizeSummary> {
  const activate = !!opts.activate;
  const summary: CanonicalizeSummary = {
    categories: 0,
    rawArchived: 0,
    canonicalInserted: 0,
    activated: activate,
    skipped: false,
  };

  const provider = resolveProvider();
  if (!provider) {
    logger.warn('[SALES PLAYS] librarian skipped — no LLM provider configured');
    summary.skipped = true;
    return summary;
  }
  const model = resolveTierModel(provider, 'cheap');
  const persona = (await getMissedOpportunitySettings()).systemPersona;
  const system = buildSystemPrompt(persona);
  const targetStatus = activate ? 'active' : 'proposed';

  for (const category of PLAY_CATEGORIES) {
    const rows = (await prisma.ieSalesPlay.findMany({
      where: { status: 'proposed', category, source_conversation_id: { not: null } },
      orderBy: [{ support_count: { sort: 'desc', nulls: 'last' } }, { play_id: 'asc' }],
      take: INPUT_CAP_PER_CATEGORY,
      select: {
        play_id: true, title: true, body_md: true, evidence_quote: true,
        evidence_speaker: true, est_value_note: true, support_count: true,
        source_outcome: true,
      },
    })) as MinedRow[];
    if (rows.length === 0) continue;

    // The quote and the outcome go IN. Asking the model to preserve evidence it
    // was never shown is what produced canonical plays quoting nobody.
    const user = [
      `CATEGORY: ${category}`,
      '',
      'MINED PLAYS:',
      ...rows.map((r, i) => {
        const quote = (r.evidence_quote ?? '').trim();
        const attributed = quote
          ? `\n   QUOTE (${r.evidence_speaker ?? 'unattributed'}): "${quote}"`
          : '\n   QUOTE: none';
        return `${i + 1}. (support ${r.support_count ?? 1}, from ${r.source_outcome} calls) `
          + `${r.title} — ${r.body_md}${attributed}`;
      }),
    ].join('\n');

    let canonical: CanonicalPlay[] = [];
    try {
      canonical = await withCallLog(
        { provider, purpose: 'insights.sales_plays_librarian', pass: 'single_pass', caseId: category },
        { system, user },
        async () => {
          const res = await callChatModel(provider, {
            system, user, model,
            maxTokens: MAX_OUTPUT_TOKENS,
            responseFormat: 'json_object',
            timeoutMs: CALL_TIMEOUT_MS,
          });
          return {
            result: parseCanonical(res.text, rows),
            model: res.model,
            rawResponse: res.text,
            retried: false,
            tokensIn: res.tokensIn,
            tokensOut: res.tokensOut,
          };
        },
      );
    } catch (err) {
      logger.warn(`[SALES PLAYS] librarian failed for ${category}: ${(err as Error).message}`);
      continue;
    }
    if (canonical.length === 0) continue;

    await prisma.$transaction(async (tx) => {
      // Replace prior canon of this tier (source_conversation_id NULL) so re-runs
      // don't stack duplicate playbooks.
      await tx.ieSalesPlay.updateMany({
        where: { category, source_conversation_id: null, status: targetStatus },
        data: { status: 'archived' },
      });
      // Retire the raw mined plays this canon now represents.
      const archived = await tx.ieSalesPlay.updateMany({
        where: { category, status: 'proposed', source_conversation_id: { not: null } },
        data: { status: 'archived', support_count: null },
      });
      summary.rawArchived += archived.count;

      await tx.ieSalesPlay.createMany({
        data: canonical.map((c, i) => ({
          category,
          title: c.title.slice(0, 240),
          body_md: c.bodyMd,
          evidence_quote: c.evidenceQuote,
          evidence_speaker: c.evidenceSpeaker,
          source_outcome: c.sourceOutcome,
          source_conversation_id: null,
          source_agent_name: null,
          est_value_note: c.estValueNote,
          status: targetStatus,
          sort_order: (i + 1) * 10,
          support_count: c.support,
        })),
      });
      summary.canonicalInserted += canonical.length;
    });
    summary.categories += 1;
    logger.info(`[SALES PLAYS] librarian ${category}: ${rows.length} mined → ${canonical.length} canonical`);
  }

  logger.info(
    `[SALES PLAYS] librarian done: ${summary.canonicalInserted} canonical (${targetStatus}) across ` +
      `${summary.categories} categories, ${summary.rawArchived} raw archived`,
  );
  return summary;
}

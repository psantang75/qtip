/**
 * salesPlays.consolidate — collapse near-duplicate mined plays into canonical
 * exemplars so the reviewer prompt (and the admin's review queue) sees a few
 * dozen distinct, proven moves instead of thousands of rewordings.
 *
 * Why this exists: the miner emits ~2.5 plays per call, and a 90-day mine
 * produced 3,303 rows that are 97% unique by title yet cluster into a handful
 * of real plays ("ask about new locations on every check-in" appeared ~70
 * times). Exact-title dedup is useless; the duplication is SEMANTIC. So we
 * embed each play and greedily group by cosine similarity within its category,
 * keep one exemplar per cluster, and record the cluster size in `support_count`
 * — that count is signal (a play backed by 70 WON calls is proven) and lets the
 * prompt rank + cap.
 *
 * Reuses the existing embedding stack (`kbIndexService.embedQueryVectors`,
 * L2-normalized) and cosine helper rather than adding a second embedder. When
 * embeddings are unavailable (OpenAI/BookStack unconfigured) it is a no-op —
 * plays are simply left un-consolidated, never lost.
 *
 * Status contract:
 *   - `active` plays are admin-approved canon: fixed exemplars, NEVER archived.
 *     A proposed dup that lands on one just bumps that exemplar's support.
 *   - `proposed` plays are clustered; the exemplar stays `proposed` (admin still
 *     approves), absorbed duplicates become `archived`.
 */
import logger from '../../../../config/logger';
import prisma from '../../../../config/prisma';
import kbIndexService, { KbIndexService } from '../../../KbIndexService';
import { PLAY_CATEGORIES } from './plays.service';

/**
 * Cosine cutoff for "same play, reworded". Tuned empirically against the seed
 * corpus (title+body, text-embedding-3-small): 0.80 collapses genuine near-dupes
 * (e.g. "pitch factory-direct audio savings" phrasings) while keeping distinct
 * moves apart. Lower merges more but risks fusing different plays; the reviewer
 * prompt cap (PROMPT_MAX_PER_CATEGORY) is the real bound on reviewer noise.
 */
export const SIMILARITY_THRESHOLD = 0.8;
/** OpenAI embeddings accept large arrays, but chunk to stay well under limits. */
const EMBED_BATCH = 256;
const WRITE_CHUNK = 500;

interface PlayRow {
  play_id: bigint;
  category: string;
  title: string;
  body_md: string;
  evidence_quote: string | null;
  status: string;
  support_count: number | null;
}

export interface ConsolidateSummary {
  proposedIn: number;
  exemplars: number;
  archived: number;
  bumped: number;
  skipped: boolean;
}

function embedInput(r: PlayRow): string {
  return `${r.title}. ${r.body_md}`.trim();
}

/** Embed in chunks; returns null if the embedder is unavailable (caller no-ops). */
async function embedAll(texts: string[]): Promise<(Float32Array | null)[] | null> {
  const out: (Float32Array | null)[] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const vecs = await kbIndexService.embedQueryVectors(texts.slice(i, i + EMBED_BATCH));
    if (vecs === null) return null;
    out.push(...vecs);
  }
  return out;
}

interface Exemplar {
  id: bigint;
  vec: Float32Array | null;
  support: number;
  isActive: boolean;
  baseline: number;
}

export async function consolidatePlays(
  opts: { threshold?: number } = {},
): Promise<ConsolidateSummary> {
  const threshold = opts.threshold ?? SIMILARITY_THRESHOLD;
  const active = (await prisma.ieSalesPlay.findMany({ where: { status: 'active' } })) as PlayRow[];
  // evidence_quote desc → rows WITH a verbatim quote sort first, so the exemplar
  // a cluster keeps is the one carrying real evidence.
  const proposed = (await prisma.ieSalesPlay.findMany({
    where: { status: 'proposed' },
    orderBy: [{ evidence_quote: 'desc' }, { play_id: 'asc' }],
  })) as PlayRow[];

  const summary: ConsolidateSummary = {
    proposedIn: proposed.length,
    exemplars: 0,
    archived: 0,
    bumped: 0,
    skipped: false,
  };
  if (proposed.length === 0) return summary;

  const allRows = [...active, ...proposed];
  const vecs = await embedAll(allRows.map(embedInput));
  if (vecs === null) {
    logger.warn('[SALES PLAYS] consolidation skipped — embeddings not configured');
    summary.skipped = true;
    return summary;
  }
  const vecById = new Map<string, Float32Array>();
  allRows.forEach((r, i) => {
    const v = vecs[i];
    if (v) vecById.set(String(r.play_id), v);
  });

  const activeIds = new Set(active.map((a) => String(a.play_id)));
  const archiveIds: bigint[] = [];
  const supportToSet = new Map<string, { id: bigint; support: number }>();

  for (const category of PLAY_CATEGORIES) {
    const rows = allRows.filter((r) => r.category === category);
    if (rows.length === 0) continue;

    const exemplars: Exemplar[] = [];
    // Seed with approved canon (fixed exemplars).
    for (const a of rows.filter((r) => activeIds.has(String(r.play_id)))) {
      exemplars.push({
        id: a.play_id,
        vec: vecById.get(String(a.play_id)) ?? null,
        support: a.support_count ?? 1,
        isActive: true,
        baseline: a.support_count ?? 1,
      });
    }
    // Cluster proposed against exemplars (canon first, then new proposed exemplars).
    for (const p of rows.filter((r) => !activeIds.has(String(r.play_id)))) {
      const v = vecById.get(String(p.play_id)) ?? null;
      let best: Exemplar | null = null;
      let bestSim = -1;
      if (v) {
        for (const ex of exemplars) {
          if (!ex.vec) continue;
          const sim = KbIndexService.cosineSimilarity(v, ex.vec);
          if (sim > bestSim) {
            bestSim = sim;
            best = ex;
          }
        }
      }
      if (best && bestSim >= threshold) {
        best.support += 1;
        archiveIds.push(p.play_id);
      } else {
        exemplars.push({ id: p.play_id, vec: v, support: 1, isActive: false, baseline: 0 });
      }
    }

    for (const ex of exemplars) {
      if (!ex.isActive) summary.exemplars += 1;
      if (ex.isActive && ex.support > ex.baseline) summary.bumped += 1;
      // Set support for new proposed exemplars, and for active exemplars that grew.
      if (!ex.isActive || ex.support !== ex.baseline) {
        supportToSet.set(String(ex.id), { id: ex.id, support: ex.support });
      }
    }
  }

  summary.archived = archiveIds.length;

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < archiveIds.length; i += WRITE_CHUNK) {
      await tx.ieSalesPlay.updateMany({
        where: { play_id: { in: archiveIds.slice(i, i + WRITE_CHUNK) } },
        data: { status: 'archived', support_count: null },
      });
    }
    // Group exemplars by support value → one updateMany per distinct value.
    const byValue = new Map<number, bigint[]>();
    for (const { id, support } of supportToSet.values()) {
      const list = byValue.get(support) ?? [];
      list.push(id);
      byValue.set(support, list);
    }
    for (const [support, ids] of byValue) {
      for (let i = 0; i < ids.length; i += WRITE_CHUNK) {
        await tx.ieSalesPlay.updateMany({
          where: { play_id: { in: ids.slice(i, i + WRITE_CHUNK) } },
          data: { support_count: support },
        });
      }
    }
  });

  logger.info(
    `[SALES PLAYS] consolidated: ${summary.proposedIn} proposed → ${summary.exemplars} exemplars, ` +
      `${summary.archived} archived, ${summary.bumped} canon bumped`,
  );
  return summary;
}

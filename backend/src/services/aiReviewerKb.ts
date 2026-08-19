/**
 * AI Reviewer — Knowledge-Base (KB) grounding.
 *
 * Extracted from `AIReviewerService.ts` so the (large) engine file no longer
 * carries the BookStack retrieval + call-topic-classification logic inline.
 * Everything here is about turning a case into KB PAGE context for the prompt:
 *
 *   - `classifyCallTopic` — Phase B topic classifier (one cheap LLM call on
 *     the transcript head) that produces the query `searchKb` runs with.
 *   - `searchKb` — the multi-layer BookStack retriever (mandatory + universal
 *     anchors → full-text hits → semantic hits → in-body link expansion),
 *     with kb_pages_meta filtering + on-demand `qtip_steps` parsing.
 *   - `fetchPivotKbPool` / `mergeKbHitsByUrl` — the shared pivot KB pool
 *     consumed by every per-source trace in `reviewCase`.
 *
 * These functions depend only on the KB service layer (BookStackService,
 * KbIndexService, kbProcedureParser), Prisma (`kb_pages_meta`), the Anthropic
 * client + call logger, and plain submission/form types — NOT on the
 * AIReviewerService class or `AIReviewerServiceError` — so the module has no
 * back-dependency on the engine and cannot create an import cycle.
 */

import prisma from '../config/prisma';
import { aiConfig } from '../config/ai';
import { getAnthropicClient, isAnthropicConfigured } from './ai/AnthropicClient';
import bookstackService from './BookStackService';
import kbIndexService from './KbIndexService';
import { parseKbApproaches, type ParsedProcedure } from './kbProcedureParser';
import logger from '../config/logger';
import { withCallLog } from './aiCallLogger';
import { type CostEstimate } from './aiCostEstimator';
import { tryParseJson } from './aiReviewerParsing';
import { type CasePivot } from './aiReviewerPivotDetector';

/** Shape of a single hit returned by `searchKb`. Re-declared here so
 *  reviewCase's per-source `kbHits` array has a name (the function's
 *  return type is inlined). */
export type KbHit = {
  id: number;
  name: string;
  url: string;
  content: string;
  is_playbook: boolean;
  playbook_steps?: string[] | null;
  /**
   * Phase F (F3): parsed Approach + chain structure for Tech-Support
   * style pages, populated from `kb_pages_meta.qtip_steps` when the
   * crawl-time parser ({@link parseKbApproaches}) returned a non-null
   * result. Rendered as a KB PROCEDURE block in the trace prompt and
   * treated as the AUTHORITATIVE procedure source by the reasoning
   * pass — removing the model's need to interpret numbered approaches
   * from raw prose.
   *
   * `string[]` shape on disk indicates a legacy front-matter
   * `qtip_steps:` value; structured object shape indicates the
   * parser's `ParsedProcedure`. We only forward the structured form
   * here.
   */
  procedure?: ParsedProcedure | null;
  linked_from?: { name: string; url: string; hop: number };
};

/**
 * BookStack KB grounding for the prompt. Three layers, in order:
 *   1. Mandatory pages — the active playbook URLs assigned to the
 *      ticket's classification (tblPlayBookLink.LinkURL). Highest
 *      authority; they're the exact documented process for this ticket.
 *   2. Search hits — top page results from BookStack full-text search
 *      against the ticket's classification text, deduped against layer 1.
 *   3. Semantic hits — top-k pages from the cached KbIndexService
 *      embeddings (Phase 4). Picks up cross-cutting process pages
 *      (e.g. "Ticket Handling Process") that don't share keywords with
 *      the classification text. Runs only if budget remains.
 *
 * Total content is capped (see `charBudget` below) so the prompt stays
 * within the model's comfortable context budget. Each result carries an
 * `is_playbook` flag so the prompt builder can label it appropriately.
 */
/**
 * KB pages that apply to EVERY review, regardless of form / classification.
 * Always pulled into the prompt as `KB PAGE` (not `ASSIGNED PLAYBOOK PAGE`)
 * so the model treats them as standing policy refs, not as the per-ticket
 * playbook. Reviewer ask 2026-05: "Documentation Policy" and
 * "Ticket Handling - Do's and Don'ts" should be visible to the AI on every
 * audit so it can grade documentation quality and ticket-handling best
 * practices consistently across departments.
 *
 * NB: "Ticket Handling Process" is intentionally NOT in this list — it's
 * the per-classification process page and gets injected by the
 * `tech-ticket-process` rule pack via `always_include_urls`, where it
 * correctly lands as a tech-only authority.
 *
 * Phase B (B3): "Call Handling - Do's and Don'ts" is added here so every
 * review (ticket-only, call-only, or combined) can grade against the same
 * baseline call etiquette / process bar. It mirrors the AWS Bedrock
 * customer-service-transcript-analysis 12-category rubric and is intended
 * as the call-side counterpart to "Ticket Handling - Do's and Don'ts".
 */
export const UNIVERSAL_KB_URLS = [
  'http://know.crm.dm-us.com/books/general-support-instructions/page/documentation-policy',
  'http://know.crm.dm-us.com/books/job-billing-customer-service/page/ticket-handling-dos-and-donts',
  'http://know.crm.dm-us.com/books/general-support-instructions/page/call-handling-dos-and-donts',
];

/**
 * Phase B topic classifier — runs ONE small Claude call on the first
 * ~60 seconds of a call transcript and returns a short "<class> /
 * <subclass>" string that searchKb() can use as its query. Without
 * this, CALL reviews ship with `classificationText = ''`, which
 * silently disables both the BookStack full-text search AND the
 * semantic-search layers — meaning the AI grades the call with zero KB
 * grounding.
 *
 * Implementation notes:
 *   - Uses the configured "cheap" model (env `ANTHROPIC_CHEAP_MODEL`,
 *     default `claude-sonnet-4-5`). Falls back to the default model when
 *     the cheap one is not set, which preserves correctness if an
 *     operator hasn't configured the env yet.
 *   - Cached per-conversation in-process so repeat reviews of the same
 *     call don't pay for the classifier twice.
 *   - Failures are NEVER fatal — we just return '' and let searchKb
 *     fall back to its existing behaviour. Wrapped in `withCallLog`
 *     with `purpose: 'ai_reviewer.call.classification'` so the cost
 *     and latency show up in `ai_call_logs` for observability.
 */
const TRANSCRIPT_HEAD_CHARS = 4000; // ~ first 60s of dialog at avg pace
const callTopicCache = new Map<string, string>();

export async function classifyCallTopic(
  conversationId: string,
  transcriptText: string,
  opts?: { onCost?: (cost: CostEstimate | null) => void }
): Promise<string> {
  const cacheKey = String(conversationId);
  const cached = callTopicCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const head = (transcriptText ?? '').trim().slice(0, TRANSCRIPT_HEAD_CHARS);
  if (!head) {
    callTopicCache.set(cacheKey, '');
    return '';
  }

  let bookList = '';
  try {
    const books = await bookstackService.listBooks();
    bookList = books
      .map((b) => `- ${b.name}${b.description ? `: ${b.description}` : ''}`)
      .join('\n');
  } catch (err) {
    logger.warn(
      `[AI REVIEWER] classifier could not list KB books (${(err as Error).message}); using transcript-only fallback`
    );
  }

  if (!isAnthropicConfigured()) {
    callTopicCache.set(cacheKey, '');
    return '';
  }

  const sysPrompt =
    'You classify call-center transcripts to one of the documented support topics. ' +
    'Read the opening of the transcript and pick the BEST matching topic from the list. ' +
    'Respond with ONLY a single JSON object: {"class": "<topic name verbatim from the list, or short phrase if none fits>", "subclass": "<short phrase or empty string>"}. ' +
    'Do NOT explain. Do NOT include any other fields.';
  const userPrompt =
    `KB TOPICS:\n${bookList || '(no topic list available)'}\n\n` +
    `TRANSCRIPT (first ${TRANSCRIPT_HEAD_CHARS} chars):\n${head}\n\n` +
    'JSON:';

  const cheapModel =
    process.env.ANTHROPIC_CHEAP_MODEL || aiConfig.anthropic?.defaultModel || 'claude-opus-4-7';

  try {
    const out = await withCallLog<string>(
      {
        provider: 'anthropic',
        purpose: 'ai_reviewer.call.classification',
        pass: 'classification',
        onCost: opts?.onCost,
      },
      { system: sysPrompt, user: userPrompt },
      async () => {
        const client = getAnthropicClient();
        const res = await client.messages.create({
          model: cheapModel,
          max_tokens: 200,
          system: sysPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        });
        const usage = (res as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
        const tokensIn = usage?.input_tokens ?? null;
        const tokensOut = usage?.output_tokens ?? null;
        const block = res.content.find((b) => b.type === 'text') as { text: string } | undefined;
        const raw = (block?.text ?? '').trim();
        const parsed = tryParseJson(raw);
        const cls = String(parsed?.class ?? '').trim();
        const sub = String(parsed?.subclass ?? '').trim();
        const composed = sub ? `${cls} / ${sub}` : cls;
        return {
          result: composed,
          model: cheapModel,
          rawResponse: raw,
          retried: false,
          tokensIn,
          tokensOut,
        };
      }
    );
    callTopicCache.set(cacheKey, out);
    if (out) {
      logger.info(
        `[AI REVIEWER] call classifier conversation_id=${conversationId} → "${out}"`
      );
    }
    return out;
  } catch (err) {
    logger.warn(
      `[AI REVIEWER] call classifier failed for conversation_id=${conversationId}: ${(err as Error).message}`
    );
    callTopicCache.set(cacheKey, '');
    return '';
  }
}

/** @internal Test-only: clear the per-conversation classifier cache. */
export function _clearCallTopicCache(): void {
  callTopicCache.clear();
}

/**
 * Default cap on the size of the merged pivot KB pool. With up to 5 pivots
 * each contributing ~5 hits, an unbounded pool could grow to ~25 pages
 * — enough to bloat every per-source trace prompt with the same content.
 * The cap is overridable at runtime via `AI_REVIEWER_PIVOT_KB_POOL_CAP`
 * so cost-tuning can be done without a code change; lowering it shrinks
 * each trace's input proportionally (each KB page is ~3-8k tokens).
 */
const PIVOT_KB_POOL_CAP_DEFAULT = 12;

/**
 * Build the shared pivot KB pool consumed by every per-source trace
 * in `reviewCase`. Runs `searchKb` once per pivot (in parallel),
 * dedupes by URL across results, and trims to the runtime pool cap. The
 * rule-pack anchor URLs are passed as `mandatoryUrls` to every search
 * so the form's always-include pages can never be evicted by the cap.
 *
 * Per-pivot search failures are logged and swallowed so one bad
 * query (e.g. semantic-index hiccup) doesn't poison the whole pool —
 * the pool degrades gracefully to whatever the surviving searches
 * returned.
 */
/**
 * Tier-2 Item 4 (KB Coverage dashboard): per-pivot KB hit count.
 * Surfaces pivots that consistently return zero KB hits as content
 * gaps — the dashboard flags them so Knowledge can author missing
 * pages.
 */
export interface PivotKbCoverage {
  label: string;
  query: string;
  rationale?: string;
  /** Number of KB pages the pivot's individual search returned. */
  kb_hit_count: number;
}

export async function fetchPivotKbPool(
  pivots: CasePivot[],
  packAnchorUrls: string[]
): Promise<{ pool: KbHit[]; coverage: PivotKbCoverage[] }> {
  if (pivots.length === 0) return { pool: [], coverage: [] };
  const PIVOT_KB_POOL_CAP = Math.max(
    1,
    Number(process.env.AI_REVIEWER_PIVOT_KB_POOL_CAP ?? PIVOT_KB_POOL_CAP_DEFAULT)
  );
  const settled = await Promise.allSettled(
    pivots.map((p) => searchKb(p.query, packAnchorUrls, UNIVERSAL_KB_URLS, null))
  );
  const merged: KbHit[] = [];
  const seen = new Set<string>();
  const coverage: PivotKbCoverage[] = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    const pivot = pivots[i];
    if (r.status !== 'fulfilled') {
      logger.warn(
        `[AI REVIEWER] pivot KB search failed for pivot="${pivot.label}" query="${pivot.query}": ${(r.reason as Error)?.message ?? r.reason}`
      );
      coverage.push({ label: pivot.label, query: pivot.query, rationale: pivot.rationale, kb_hit_count: 0 });
      continue;
    }
    coverage.push({
      label: pivot.label,
      query: pivot.query,
      rationale: pivot.rationale,
      kb_hit_count: r.value.length,
    });
    for (const hit of r.value) {
      if (seen.has(hit.url)) continue;
      seen.add(hit.url);
      merged.push(hit);
      if (merged.length >= PIVOT_KB_POOL_CAP) break;
    }
    if (merged.length >= PIVOT_KB_POOL_CAP) break;
  }
  logger.info(
    `[AI REVIEWER] pivot KB pool: pivots=${pivots.length} pages=${merged.length} (cap=${PIVOT_KB_POOL_CAP}) ` +
      `per-pivot=[${coverage.map((c) => `${c.label}:${c.kb_hit_count}`).join(', ')}]`
  );
  return { pool: merged, coverage };
}

/**
 * Merge two KbHit lists, deduping by URL while preserving the order
 * (first-seen wins). Used by the per-source trace step in `reviewCase`
 * to overlay each source's mandatory hits on top of the shared pivot
 * pool without duplicating pages.
 */
export function mergeKbHitsByUrl(a: KbHit[], b: KbHit[]): KbHit[] {
  const out: KbHit[] = [];
  const seen = new Set<string>();
  for (const hit of [...a, ...b]) {
    if (!hit?.url || seen.has(hit.url)) continue;
    seen.add(hit.url);
    out.push(hit);
  }
  return out;
}

export async function searchKb(
  query: string,
  mandatoryUrls: string[] = [],
  universalUrls: string[] = UNIVERSAL_KB_URLS,
  reviewKind: 'TICKET' | 'TASK' | 'CALL' | null = null
): Promise<{
  id: number;
  name: string;
  url: string;
  content: string;
  is_playbook: boolean;
  /** Phase D (D3): canonical step list extracted from kb_pages_meta. */
  playbook_steps?: string[] | null;
  /** Phase F (F3): parsed Approach + chain structure from kb_pages_meta.qtip_steps. */
  procedure?: ParsedProcedure | null;
  /**
   * KB link expansion: when this page was pulled in by following an
   * in-body hyperlink from another KB page, we record the source page
   * + hop distance so the prompt can label it `LINKED KB PAGE` rather
   * than treating it like a primary search hit. Absent on primary
   * mandatory / universal / search / semantic hits.
   */
  linked_from?: { name: string; url: string; hop: number };
}[]> {
  type KbHit = {
    id: number;
    name: string;
    url: string;
    content: string;
    is_playbook: boolean;
    playbook_steps?: string[] | null;
    procedure?: ParsedProcedure | null;
    linked_from?: { name: string; url: string; hop: number };
  };
  const result: KbHit[] = [];
  const seenIds = new Set<number>();
  // KB link expansion (BFS) state. Tracks every link we know about so
  // we don't re-fetch a page already in the result and don't enqueue
  // duplicates from different source pages.
  const linksByPageId = new Map<number, string[]>();
  const seenLinkUrls = new Set<string>();
  let totalChars = 0;
  // Quality-pass: bumped from 15KB → 60KB so the model gets enough KB
  // grounding to actually compare process steps to notes, especially
  // when multiple rule-pack always-include URLs land alongside the
  // playbook page and 5 search hits + 5 semantic hits. With four
  // anchor URLs ~3-5KB each, the old 15KB was clipping mid-sentence.
  //
  // KB link expansion (Layer 4): we reserve `LINK_EXPANSION_HEADROOM`
  // bytes ON TOP of the primary budget so layers 1-3 can't starve the
  // BFS. Without this split a hot ticket whose playbook + universal
  // anchors + search hits already total ~60KB leaves zero room for
  // back-link traversal — which is the exact scenario where we MOST
  // need the linked parent decision-flow page (e.g. SXBR2/BR3 leaf
  // page → "SXBR2/SXBR3 Troubleshooting Guide" parent).
  const PRIMARY_BUDGET = 60000;
  const LINK_EXPANSION_HEADROOM = 30000;
  const charBudget = PRIMARY_BUDGET + LINK_EXPANSION_HEADROOM;

  /** Helper: fetch a page's plaintext + outgoing in-KB links and record both. */
  async function fetchAndStash(
    pageId: number,
    pageName: string,
    pageUrl: string,
    isPlaybook: boolean,
    linkedFrom?: { name: string; url: string; hop: number }
  ): Promise<KbHit | null> {
    try {
      const { plaintext, links } = await bookstackService.getPageContentWithLinks(pageId);
      const remaining = Math.max(0, charBudget - totalChars);
      if (remaining === 0) return null;
      const truncated = plaintext.length > remaining ? plaintext.slice(0, remaining) + '…' : plaintext;
      const hit: KbHit = {
        id: pageId,
        name: pageName,
        url: pageUrl,
        content: truncated,
        is_playbook: isPlaybook,
        ...(linkedFrom ? { linked_from: linkedFrom } : {}),
      };
      result.push(hit);
      seenIds.add(pageId);
      seenLinkUrls.add(pageUrl);
      linksByPageId.set(pageId, links);
      totalChars += truncated.length;
      return hit;
    } catch (err) {
      logger.warn(`[AI REVIEWER] KB page ${pageId} fetch failed: ${(err as Error).message}`);
      return null;
    }
  }

  for (const url of mandatoryUrls) {
    if (totalChars >= PRIMARY_BUDGET) break;
    try {
      const page = await bookstackService.getPageByUrl(url);
      if (!page) {
        logger.warn(`[AI REVIEWER] Playbook URL did not resolve to a BookStack page: ${url}`);
        continue;
      }
      if (seenIds.has(page.id)) continue;
      await fetchAndStash(page.id, page.name, page.url, true);
    } catch (err) {
      logger.warn(`[AI REVIEWER] Playbook page fetch failed for ${url}: ${(err as Error).message}`);
    }
  }

  // Universal authorities: always-on policy pages tagged is_playbook=false
  // so the prompt labels them `KB PAGE`. Pulled AFTER the per-ticket
  // playbook so the playbook stays first in the prompt (and gets first
  // crack at the char budget).
  for (const url of universalUrls) {
    if (totalChars >= PRIMARY_BUDGET) break;
    try {
      const page = await bookstackService.getPageByUrl(url);
      if (!page) {
        logger.warn(`[AI REVIEWER] Universal KB URL did not resolve to a BookStack page: ${url}`);
        continue;
      }
      if (seenIds.has(page.id)) continue;
      await fetchAndStash(page.id, page.name, page.url, false);
    } catch (err) {
      logger.warn(`[AI REVIEWER] Universal KB page fetch failed for ${url}: ${(err as Error).message}`);
    }
  }

  const trimmed = query.trim();
  if (trimmed && totalChars < PRIMARY_BUDGET) {
    let hits: Awaited<ReturnType<typeof bookstackService.searchByText>> = [];
    try {
      hits = await bookstackService.searchByText(trimmed, { count: 10 });
    } catch (err) {
      logger.warn(`[AI REVIEWER] BookStack search failed for "${trimmed}": ${(err as Error).message}`);
    }

    const pageHits = hits.filter((h) => h.type === 'page').slice(0, 5);
    for (const hit of pageHits) {
      if (totalChars >= PRIMARY_BUDGET) break;
      if (seenIds.has(hit.id)) continue;
      await fetchAndStash(hit.id, hit.name, hit.url, false);
    }
  }

  // Layer 3: semantic hits. Only runs when budget remains AND the index
  // is configured. A failing semanticSearch is non-fatal — we just skip
  // the layer and return what we have, preserving pre-Phase-4 behavior.
  if (trimmed && totalChars < PRIMARY_BUDGET && kbIndexService.isConfigured()) {
    try {
      const semantic = await kbIndexService.semanticSearch(trimmed, 5);
      for (const hit of semantic) {
        if (totalChars >= PRIMARY_BUDGET) break;
        if (seenIds.has(hit.id)) continue;
        await fetchAndStash(hit.id, hit.name, hit.url, false);
      }
    } catch (err) {
      logger.warn(`[AI REVIEWER] Semantic KB layer failed (skipping): ${(err as Error).message}`);
    }
  }

  // Layer 4: KB LINK EXPANSION. Walks in-body links from every page
  // already in the result set, fetching parent / sibling / "see also"
  // pages so the model sees decision-flow gating that leaf pages
  // typically reference but do not document directly. Bounded by hop
  // depth, page count, and the existing char budget so cost stays
  // predictable.
  //
  // Real-world example: a hit on
  //   "SXBR2/SXBR3 Troubleshoot - Not Connected to the Internet"
  // back-links to its parent
  //   "SXBR2/SXBR3 Troubleshoot"
  // which documents the email-vs-phone branching the leaf doesn't
  // cover. Without this layer, the AI grades only against leaf-level
  // troubleshoot steps and misses that the agent's email-path was
  // itself a valid choice from the parent's gate.
  const KB_LINK_MAX_HOPS = 3;
  const KB_LINK_MAX_PAGES = 8;
  type LinkQueueItem = { url: string; sourceName: string; hop: number };
  const queue: LinkQueueItem[] = [];
  let totalSeedLinks = 0;
  for (const seed of result) {
    const seedLinks = linksByPageId.get(seed.id) ?? [];
    totalSeedLinks += seedLinks.length;
    for (const linkUrl of seedLinks) {
      if (!seenLinkUrls.has(linkUrl)) {
        queue.push({ url: linkUrl, sourceName: seed.name, hop: 1 });
      }
    }
  }
  const initialCandidates = queue.length;
  let addedLinkedPages = 0;
  let resolveFailures = 0;
  let alreadySeen = 0;
  while (queue.length > 0 && addedLinkedPages < KB_LINK_MAX_PAGES && totalChars < charBudget) {
    const next = queue.shift()!;
    if (seenLinkUrls.has(next.url)) {
      alreadySeen++;
      continue;
    }
    seenLinkUrls.add(next.url);
    let page: Awaited<ReturnType<typeof bookstackService.getPageByUrl>>;
    try {
      page = await bookstackService.getPageByUrl(next.url);
    } catch (err) {
      logger.warn(`[AI REVIEWER] linked KB resolve failed for ${next.url}: ${(err as Error).message}`);
      resolveFailures++;
      continue;
    }
    if (!page) {
      resolveFailures++;
      continue;
    }
    if (seenIds.has(page.id)) {
      alreadySeen++;
      continue;
    }
    const added = await fetchAndStash(page.id, page.name, page.url, false, {
      name: next.sourceName,
      url: next.url,
      hop: next.hop,
    });
    if (!added) break;
    addedLinkedPages++;
    if (next.hop < KB_LINK_MAX_HOPS) {
      const childLinks = linksByPageId.get(added.id) ?? [];
      for (const childUrl of childLinks) {
        if (!seenLinkUrls.has(childUrl)) {
          queue.push({ url: childUrl, sourceName: added.name, hop: next.hop + 1 });
        }
      }
    }
  }
  logger.info(
    `[AI REVIEWER] KB link expansion: seed_pages=${result.length} seed_links=${totalSeedLinks} initial_candidates=${initialCandidates} added=${addedLinkedPages} skipped_seen=${alreadySeen} resolve_failures=${resolveFailures} (max_hops=${KB_LINK_MAX_HOPS}, max_pages=${KB_LINK_MAX_PAGES})`
  );

  // Phase D (D2 + D3): filter out pages whose front-matter says they
  // don't apply to this review kind, AND attach the prefab playbook
  // step list when one was extracted at crawl time. Pages without a
  // kb_pages_meta row pass through unchanged (back-compat for the bulk
  // of the KB that hasn't been front-matter-tagged yet). Mandatory +
  // universal anchors are always retained so an operator can force a
  // page into the prompt even when its tagging is incomplete.
  if (result.length > 0) {
    try {
      const ids = result.map((p) => p.id);
      const metas = await prisma.kbPageMeta.findMany({
        where: { page_id: { in: ids } },
        select: {
          page_id: true,
          qtip_applies_to: true,
          playbook_steps: true,
          // Phase F (F3): pull the parsed Approach structure persisted
          // at crawl time. Shape is either a legacy front-matter
          // `string[]` OR the parser's `ParsedProcedure` object —
          // discriminated at read time below.
          qtip_steps: true,
        },
      });
      const metaById = new Map<
        number,
        { applies: string[] | null; steps: string[] | null; procedure: ParsedProcedure | null }
      >(
        metas.map((m) => {
          const applies = Array.isArray(m.qtip_applies_to)
            ? (m.qtip_applies_to as unknown as string[])
            : null;
          const steps = Array.isArray(m.playbook_steps)
            ? (m.playbook_steps as unknown as string[])
            : null;
          // qtip_steps may carry either the legacy author-supplied
          // `string[]` form (front-matter) or the parser-derived
          // `ParsedProcedure` object. We only forward the structured
          // form to KbHit.procedure; string[] stays unused here.
          const rawQtipSteps = m.qtip_steps;
          const procedure =
            rawQtipSteps != null &&
            typeof rawQtipSteps === 'object' &&
            !Array.isArray(rawQtipSteps) &&
            Array.isArray((rawQtipSteps as { approaches?: unknown }).approaches)
              ? (rawQtipSteps as unknown as ParsedProcedure)
              : null;
          return [m.page_id, { applies, steps, procedure }] as const;
        })
      );
      const mandatorySet = new Set<number>();
      for (const p of result) if (p.is_playbook) mandatorySet.add(p.id);
      for (let i = result.length - 1; i >= 0; i--) {
        const p = result[i];
        const meta = metaById.get(p.id);
        if (meta?.steps && meta.steps.length > 0) {
          p.playbook_steps = meta.steps;
        }
        if (meta?.procedure) {
          p.procedure = meta.procedure;
        }
        if (mandatorySet.has(p.id)) continue;
        if (!reviewKind) continue;
        const applies = meta?.applies ?? null;
        if (applies && applies.length > 0 && !applies.includes(reviewKind)) {
          result.splice(i, 1);
        }
      }
    } catch (err) {
      logger.warn(`[AI REVIEWER] kb_pages_meta filter failed (returning unfiltered): ${(err as Error).message}`);
    }
  }

  // Phase F (F4): on-demand parse fallback. The scheduler crawl populates
  // `kb_pages_meta.qtip_steps` asynchronously; when an AI run fires
  // before the crawl reaches a relevant page (or runs concurrently with
  // an in-flight crawl), the metaById lookup returns `procedure: null`
  // and the prompt silently degrades to raw-markdown grading — which is
  // exactly the failure mode `parseKbApproaches` was built to eliminate.
  // Parse the in-memory `p.content` inline so the PROCEDURE block is
  // present on EVERY run regardless of crawl timing, and best-effort
  // persist back to `kb_pages_meta` so subsequent runs hit the cache.
  // Pure text-to-JSON, no network calls — sub-millisecond per page.
  for (const p of result) {
    if (p.procedure) continue;
    const parsed = parseKbApproaches(p.content);
    if (!parsed) continue;
    p.procedure = parsed;
    void prisma.kbPageMeta
      .upsert({
        where: { page_id: p.id },
        // Only touch qtip_steps + parsed_at — never overwrite
        // qtip_role / qtip_applies_to / qtip_authority / playbook_steps
        // that the crawler may have set from front-matter.
        create: {
          page_id: p.id,
          qtip_steps: parsed as any,
          parsed_at: new Date(),
        },
        update: {
          qtip_steps: parsed as any,
          parsed_at: new Date(),
        },
      })
      .catch((err) =>
        logger.warn(
          `[AI REVIEWER] on-demand qtip_steps upsert failed for page ${p.id}: ${(err as Error).message}`
        )
      );
  }

  return result;
}

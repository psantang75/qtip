/**
 * salesPlays.service — CRUD + prompt rendering for the `ie_sales_play` table.
 *
 * Lifecycle mirrors the rules service: the miner inserts rows as 'proposed', an
 * admin promotes the good ones to 'active' (or 'archived'), and only 'active'
 * plays are rendered into the run's grounding block. Nothing here decides
 * whether plays are used at all — that gate is the `enabled` setting, checked by
 * the worker.
 */
import prisma from '../../../../config/prisma';

export const PLAY_CATEGORIES = [
  'objection',
  'closing',
  'discovery',
  'upsell',
  'urgency',
  'research',
] as const;
export type PlayCategory = (typeof PLAY_CATEGORIES)[number];

export const PLAY_STATUSES = ['proposed', 'active', 'archived'] as const;
export type PlayStatus = (typeof PLAY_STATUSES)[number];

export type PlaySpeaker = 'CUSTOMER' | 'AGENT';
export type PlayOutcome = 'WON' | 'LOST';

export interface SalesPlay {
  playId: number;
  category: string;
  title: string;
  bodyMd: string;
  evidenceQuote: string | null;
  evidenceSpeaker: string | null;
  sourceOutcome: string;
  sourceConversationId: string | null;
  sourceAgentName: string | null;
  estValueNote: string | null;
  status: string;
  sortOrder: number;
  supportCount: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewSalesPlay {
  category: PlayCategory;
  title: string;
  bodyMd: string;
  evidenceQuote?: string | null;
  evidenceSpeaker?: PlaySpeaker | null;
  sourceOutcome: PlayOutcome;
  sourceConversationId?: string | null;
  sourceAgentName?: string | null;
  estValueNote?: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toSalesPlay(row: any): SalesPlay {
  return {
    playId: Number(row.play_id),
    category: row.category,
    title: row.title,
    bodyMd: row.body_md,
    evidenceQuote: row.evidence_quote ?? null,
    evidenceSpeaker: row.evidence_speaker ?? null,
    sourceOutcome: row.source_outcome,
    sourceConversationId: row.source_conversation_id ?? null,
    sourceAgentName: row.source_agent_name ?? null,
    estValueNote: row.est_value_note ?? null,
    status: row.status,
    sortOrder: row.sort_order,
    supportCount: row.support_count ?? null,
    createdAt: (row.created_at instanceof Date ? row.created_at : new Date(row.created_at)).toISOString(),
    updatedAt: (row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at)).toISOString(),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** List plays, optionally filtered by status; proposed first, then by sort order. */
export async function listPlays(status?: PlayStatus): Promise<SalesPlay[]> {
  const rows = await prisma.ieSalesPlay.findMany({
    where: status ? { status } : undefined,
    orderBy: [
      { status: 'asc' },
      { support_count: { sort: 'desc', nulls: 'last' } },
      { sort_order: 'asc' },
      { play_id: 'desc' },
    ],
  });
  return rows.map(toSalesPlay);
}

export interface UpdatePlayPatch {
  status?: PlayStatus;
  category?: PlayCategory;
  title?: string;
  bodyMd?: string;
  sortOrder?: number;
}

/** Edit or transition one play. Returns the updated row. */
export async function updatePlay(
  playId: number,
  patch: UpdatePlayPatch,
  updatedBy?: number,
): Promise<SalesPlay> {
  const data: Record<string, unknown> = { updated_by: updatedBy ?? null };
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.category !== undefined) data.category = patch.category;
  if (patch.title !== undefined) data.title = patch.title.trim();
  if (patch.bodyMd !== undefined) data.body_md = patch.bodyMd.trim();
  if (patch.sortOrder !== undefined) data.sort_order = Math.trunc(patch.sortOrder);

  const row = await prisma.ieSalesPlay.update({
    where: { play_id: BigInt(playId) },
    data,
  });
  return toSalesPlay(row);
}

/** Bulk-insert miner output as 'proposed'. Returns the number inserted. */
export async function insertProposedPlays(plays: NewSalesPlay[]): Promise<number> {
  if (plays.length === 0) return 0;
  const res = await prisma.ieSalesPlay.createMany({
    data: plays.map((p) => ({
      category: p.category,
      title: p.title.slice(0, 240),
      body_md: p.bodyMd,
      evidence_quote: p.evidenceQuote ? p.evidenceQuote.slice(0, 1200) : null,
      evidence_speaker: p.evidenceSpeaker ?? null,
      source_outcome: p.sourceOutcome,
      source_conversation_id: p.sourceConversationId ?? null,
      source_agent_name: p.sourceAgentName ? p.sourceAgentName.slice(0, 160) : null,
      est_value_note: p.estValueNote ? p.estValueNote.slice(0, 240) : null,
      status: 'proposed',
    })),
  });
  return res.count;
}

/** Conversation ids that already have a mined play, so a re-mine can skip them. */
export async function minedConversationIds(): Promise<Set<string>> {
  const rows = await prisma.ieSalesPlay.findMany({
    where: { source_conversation_id: { not: null } },
    select: { source_conversation_id: true },
    distinct: ['source_conversation_id'],
  });
  return new Set(rows.map((r) => r.source_conversation_id).filter((s): s is string => !!s));
}

/**
 * Cap on plays rendered per category, so the grounding block stays bounded and
 * high-signal no matter how large the approved library grows. Ranked by
 * `support_count` — how many of our own calls the play was observed on, which
 * is a frequency measure and not evidence the tactic caused the sale.
 */
export const PROMPT_MAX_PER_CATEGORY = 8;

/**
 * Render active plays for the run's grounding block. Empty string when there are
 * none, so the caller can append conditionally. Grouped by category for a tidy,
 * skimmable playbook the model can lean on when wording a recommendation; within
 * each category we keep only the top-N most-proven plays.
 */
export async function renderPlaysForPrompt(): Promise<string> {
  const rows = await prisma.ieSalesPlay.findMany({
    where: { status: 'active' },
    orderBy: [
      { category: 'asc' },
      { support_count: { sort: 'desc', nulls: 'last' } },
      { sort_order: 'asc' },
    ],
  });
  if (rows.length === 0) return '';

  const perCategory = new Map<string, number>();
  // Described as observed, not proven. These are tactics a manager approved
  // after seeing them recur on our own calls — repetition is not causation, and
  // calling them "winning" invited the reviewer to recommend them as though the
  // sale were attributable to the move.
  const lines: string[] = [
    '# Approved plays (tactics observed on our own calls and signed off by a manager)',
  ];
  for (const r of rows) {
    const seen = perCategory.get(r.category) ?? 0;
    if (seen >= PROMPT_MAX_PER_CATEGORY) continue;
    perCategory.set(r.category, seen + 1);

    const quote = r.evidence_quote
      ? ` (e.g. ${r.evidence_speaker ? `${r.evidence_speaker}: ` : ''}"${r.evidence_quote}")`
      : '';
    const seenOn = r.support_count && r.support_count > 1
      ? ` [observed on ${r.support_count} ${r.source_outcome.toLowerCase()} calls]`
      : '';
    lines.push(`- [${r.category}] ${r.title}: ${r.body_md}${quote}${seenOn}`);
  }
  return lines.join('\n');
}

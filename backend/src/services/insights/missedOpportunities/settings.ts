/**
 * missedOpportunities.settings — the admin-tunable scalars for the Missed
 * Opportunities report, stored in the existing `ie_config` KV store like
 * adherence.settings.ts and attendance.settings.ts. No new table.
 *
 * Keys owned by this module (seeded by 20260908170000_create_missed_opportunity):
 *   missed_opps_min_talk_secs      floor for a call to be worth analyzing.
 *   missed_opps_excluded_agents    comma-separated agent names to skip (BDRs).
 *   missed_opps_daily_usd_cap      hard spend ceiling for one day's run.
 *   missed_opps_model_tier         'cheap' | 'reasoning'.
 *   missed_opps_max_calls_per_run  safety cap on calls analyzed per run.
 *   missed_opps_system_persona     the editable "who you are / how to judge"
 *                                  narrative prepended to every call's system
 *                                  prompt. Tuning this — not adding rules — is
 *                                  how the review's judgment is steered.
 *   missed_opps_kb_anchor_urls     newline-separated BookStack page URLs whose
 *                                  content grounds the recommended-approach in
 *                                  the company's own sales playbook (Phase 1).
 *
 * Every value is validated on read AND write so a hand-edited row can never
 * feed the worker garbage (a bad cap must not mean "unlimited spend").
 */
import prisma from '../../../config/prisma';

const MIN_TALK_SECS_KEY = 'missed_opps_min_talk_secs';
const EXCLUDED_AGENTS_KEY = 'missed_opps_excluded_agents';
const DAILY_USD_CAP_KEY = 'missed_opps_daily_usd_cap';
const MODEL_TIER_KEY = 'missed_opps_model_tier';
const MAX_CALLS_KEY = 'missed_opps_max_calls_per_run';
const SYSTEM_PERSONA_KEY = 'missed_opps_system_persona';
const KB_ANCHOR_URLS_KEY = 'missed_opps_kb_anchor_urls';

export type ModelTier = 'cheap' | 'reasoning';

/**
 * Default persona — the "who you are and how to judge" narrative, kept OUT of the
 * fixed prompt contract so an admin can tune the review's judgment (act like an
 * expert SMB closer, fish out real opportunities, don't flag process/history
 * that already answers the miss) without ever touching the JSON output rules.
 * The mechanical contract and the rule set are appended after this by
 * analyzer.buildSystemPrompt.
 */
export const DEFAULT_SYSTEM_PERSONA = [
  'You are a professional, expert sales manager reviewing recorded sales calls for a business-music, SiriusXM-for-business, and digital-signage company. Most accounts are small businesses and small-to-mid-market companies, so judge each call the way a seasoned SMB / small-mid-market rep would: pragmatic, revenue-focused, and fluent in how these deals actually get closed. Coach like a trusted advisor: recommendations should move the deal forward consultatively — earning a next step or an introduction to an owner/GM — never with hard-close pressure or by pushing to get a decision-maker on the phone on the spot.',
  '',
  'Your job is to surface MISSED OPPORTUNITIES — things the rep could have done on THIS call to win, grow, or protect revenue but did not. Fish out every genuine opportunity left on the table (a second location, an upsell, a streaming or hardware add, a licensing gap, an order the customer was ready to place), but report only REAL, actionable misses — never a nitpick, and never a "miss" that good process or the deal history already answers.',
  '',
  'MATERIALITY — the bar a finding has to clear. Report a miss only when a sales manager would spend coaching time on it, and only when you can name what it would have been worth: an order, an upsell, an added location, a retained account, or a real opportunity created. Ask yourself whether you would stop this rep in the hallway over it; if the answer is no, do not report it. A call the rep handled competently is a NORMAL outcome, not a gap in your analysis — returning an empty findings array on a well-handled call is exactly as valuable as catching a real miss, and it is what makes this review worth reading.',
  '',
  'PRIORITY — rank by money, not by tidiness. Report the single most valuable miss on the call. Add a second only when it is independently worth coaching on its own, and a third only when the call genuinely left three separate opportunities behind. Order them by revenue impact: (1) an order or upsell the customer was ready to place, (2) expansion — additional locations, sites, or services, (3) a save — an account at risk of leaving, (4) a real opportunity that should have been created or advanced. Process and hygiene observations (no dated next step, voicemail quality, no growth probe on a service call) rank LAST and belong in the report ONLY when the missing step is the actual reason revenue was left behind on this call — never as a standalone housekeeping note on a call that was otherwise handled well.',
  '',
  'Judge like an expert closer, not a checklist. Do NOT flag a "miss" when the close is legitimately gated by a prerequisite the rep must resolve first (e.g., a radio already on an active PERSONAL SiriusXM subscription must be cancelled before a business activation; a radio ID, equipment, or site survey is still needed), NOR when the transcript or CRM history shows the rep already advanced that same opportunity (a quote/proposal sent, a dated next step set, a callback promised to complete the order). Gathering the information needed to sell, or promising a same-day proposal, is progress — not a missed order.',
  '',
  'We do not win by giving product away. NEVER recommend free product, free service, waived fees, or unauthorized discounts. When a small fee or a logistical blocker is stalling a deal, the authorized moves are to justify the cost against the value the customer has already agreed to, restructure the order (different equipment, term, or payment method), or escalate to a manager who owns the exception — never to promise a waiver or a credit the rep cannot authorize. Every recommended approach must be a paid offer or tactic the rep is authorized to make.',
].join('\n');

/** Upper bound on the persona so an admin edit can't blow up the prompt budget. */
const SYSTEM_PERSONA_MAX = 8000;

/**
 * Default KB grounding anchors (Phase 1) — the sales rep book pages whose
 * methodology should shape every recommended approach. All live in the
 * `job-account-executive` book (BDR-book pages are intentionally excluded, since
 * BDRs are out of scope for this report). Admin-editable; the worker fetches
 * these once per run and injects them into the prompt. An empty list disables
 * grounding.
 */
export const DEFAULT_KB_ANCHOR_URLS: readonly string[] = [
  'http://know.crm.dm-us.com/books/job-account-executive/page/objection-handling-seek-first-then-arp',
  'http://know.crm.dm-us.com/books/job-account-executive/page/how-to-arp',
  'http://know.crm.dm-us.com/books/job-account-executive/page/one-call-closing-and-building-urgency',
  'http://know.crm.dm-us.com/books/job-account-executive/page/sales-closing-tips',
  'http://know.crm.dm-us.com/books/job-account-executive/page/sxm-call-flow-inbound-call',
  'http://know.crm.dm-us.com/books/job-account-executive/page/syb-call-flow-inbound-call',
];

/** Guardrails on the anchor list so an admin edit can't flood the prompt. */
const KB_ANCHOR_MAX_COUNT = 20;
const KB_ANCHOR_URL_MAX = 300;
/** A BookStack page URL the fetcher can resolve (see BookStackService.getPageByUrl). */
const KB_ANCHOR_URL_RE = /^https?:\/\/\S+\/page\/\S+$/;

/** Defaults match the migration seeds; used when a row is missing or malformed. */
export const DEFAULT_MIN_TALK_SECS = 100;
export const DEFAULT_EXCLUDED_AGENTS: readonly string[] = ['Drew Feely', 'Joshua Barber'];
export const DEFAULT_DAILY_USD_CAP = 25;
/**
 * The reasoning tier is the default because the hard part of this job is the
 * judgment call — "was this genuinely a miss, or did the rep handle it right?"
 * The cheap tier over-fires on that question, which turns the report into a
 * defect list nobody trusts. Reasoning costs roughly 1.7x per call here
 * (opus-4-7 at $5/$25 per MTok vs sonnet-4-6 at $3/$15), which the daily cap
 * absorbs at this call volume.
 */
export const DEFAULT_MODEL_TIER: ModelTier = 'reasoning';
export const DEFAULT_MAX_CALLS_PER_RUN = 400;

/** Guardrails on what an admin may save. */
const MIN_TALK_SECS_RANGE = { min: 30, max: 3600 } as const;
const DAILY_USD_CAP_RANGE = { min: 1, max: 500 } as const;
const MAX_CALLS_RANGE = { min: 1, max: 2000 } as const;

export interface MissedOpportunitySettings {
  minTalkSecs: number;
  excludedAgents: string[];
  dailyUsdCap: number;
  modelTier: ModelTier;
  maxCallsPerRun: number;
  /** Editable narrative prepended to the fixed prompt contract; default applies when unset. */
  systemPersona: string;
  /** BookStack page URLs whose content grounds the recommended approach; empty disables grounding. */
  kbAnchorUrls: string[];
}

async function readConfig(key: string): Promise<string | null> {
  const row = await prisma.ieConfig.findUnique({ where: { config_key: key } });
  return row?.config_value ?? null;
}

async function writeConfig(key: string, value: string, description: string): Promise<void> {
  await prisma.ieConfig.upsert({
    where: { config_key: key },
    create: { config_key: key, config_value: value, description },
    update: { config_value: value },
  });
}

function clampedInt(raw: string | null, fallback: number, range: { min: number; max: number }): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  return i >= range.min && i <= range.max ? i : fallback;
}

function parseAgentList(raw: string | null): string[] {
  if (raw === null) return [...DEFAULT_EXCLUDED_AGENTS];
  // An intentionally empty string means "exclude nobody" — distinct from unset.
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseAnchorUrls(raw: string | null): string[] {
  // Unset falls back to the curated defaults; an explicitly empty string means
  // "grounding off", distinct from unset (mirrors parseAgentList).
  if (raw === null) return [...DEFAULT_KB_ANCHOR_URLS];
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function getMissedOpportunitySettings(): Promise<MissedOpportunitySettings> {
  const [talk, agents, cap, tier, maxCalls, persona, anchors] = await Promise.all([
    readConfig(MIN_TALK_SECS_KEY),
    readConfig(EXCLUDED_AGENTS_KEY),
    readConfig(DAILY_USD_CAP_KEY),
    readConfig(MODEL_TIER_KEY),
    readConfig(MAX_CALLS_KEY),
    readConfig(SYSTEM_PERSONA_KEY),
    readConfig(KB_ANCHOR_URLS_KEY),
  ]);

  const capNum = Number(cap);
  const capValid = Number.isFinite(capNum)
    && capNum >= DAILY_USD_CAP_RANGE.min
    && capNum <= DAILY_USD_CAP_RANGE.max;

  const personaTrimmed = (persona ?? '').trim();

  return {
    minTalkSecs: clampedInt(talk, DEFAULT_MIN_TALK_SECS, MIN_TALK_SECS_RANGE),
    excludedAgents: parseAgentList(agents),
    dailyUsdCap: capValid ? Math.round(capNum * 100) / 100 : DEFAULT_DAILY_USD_CAP,
    modelTier: tier === 'reasoning' || tier === 'cheap' ? tier : DEFAULT_MODEL_TIER,
    maxCallsPerRun: clampedInt(maxCalls, DEFAULT_MAX_CALLS_PER_RUN, MAX_CALLS_RANGE),
    systemPersona: personaTrimmed || DEFAULT_SYSTEM_PERSONA,
    kbAnchorUrls: parseAnchorUrls(anchors),
  };
}

export interface MissedOpportunitySettingsPatch {
  minTalkSecs?: number;
  excludedAgents?: string[];
  dailyUsdCap?: number;
  modelTier?: ModelTier;
  maxCallsPerRun?: number;
  systemPersona?: string;
  kbAnchorUrls?: string[];
}

/** Persists only the supplied keys; rejects out-of-range values loudly. */
export async function saveMissedOpportunitySettings(
  patch: MissedOpportunitySettingsPatch,
): Promise<MissedOpportunitySettings> {
  if (patch.minTalkSecs !== undefined) {
    const v = Math.trunc(patch.minTalkSecs);
    if (!Number.isFinite(v) || v < MIN_TALK_SECS_RANGE.min || v > MIN_TALK_SECS_RANGE.max) {
      throw new Error(
        `Minimum talk seconds must be between ${MIN_TALK_SECS_RANGE.min} and ${MIN_TALK_SECS_RANGE.max}`,
      );
    }
    await writeConfig(
      MIN_TALK_SECS_KEY, String(v),
      'Missed Opportunities: minimum connected talk seconds for a call to be analyzed.',
    );
  }

  if (patch.excludedAgents !== undefined) {
    const cleaned = patch.excludedAgents.map((s) => s.trim()).filter((s) => s.length > 0);
    await writeConfig(
      EXCLUDED_AGENTS_KEY, cleaned.join(','),
      'Missed Opportunities: comma-separated agent names excluded from analysis (BDRs).',
    );
  }

  if (patch.dailyUsdCap !== undefined) {
    const v = Math.round(patch.dailyUsdCap * 100) / 100;
    if (!Number.isFinite(v) || v < DAILY_USD_CAP_RANGE.min || v > DAILY_USD_CAP_RANGE.max) {
      throw new Error(
        `Daily cost cap must be between $${DAILY_USD_CAP_RANGE.min} and $${DAILY_USD_CAP_RANGE.max}`,
      );
    }
    await writeConfig(
      DAILY_USD_CAP_KEY, v.toFixed(2),
      "Missed Opportunities: hard USD cap for a single day's analysis run.",
    );
  }

  if (patch.modelTier !== undefined) {
    if (patch.modelTier !== 'cheap' && patch.modelTier !== 'reasoning') {
      throw new Error('Model tier must be "cheap" or "reasoning"');
    }
    await writeConfig(
      MODEL_TIER_KEY, patch.modelTier,
      'Missed Opportunities: model tier for analysis — "cheap" or "reasoning".',
    );
  }

  if (patch.maxCallsPerRun !== undefined) {
    const v = Math.trunc(patch.maxCallsPerRun);
    if (!Number.isFinite(v) || v < MAX_CALLS_RANGE.min || v > MAX_CALLS_RANGE.max) {
      throw new Error(
        `Max calls per run must be between ${MAX_CALLS_RANGE.min} and ${MAX_CALLS_RANGE.max}`,
      );
    }
    await writeConfig(
      MAX_CALLS_KEY, String(v),
      'Missed Opportunities: safety cap on calls analyzed in one run.',
    );
  }

  if (patch.systemPersona !== undefined) {
    const v = patch.systemPersona.trim();
    if (!v) throw new Error('The review persona cannot be empty');
    if (v.length > SYSTEM_PERSONA_MAX) {
      throw new Error(`The review persona must be ${SYSTEM_PERSONA_MAX} characters or fewer`);
    }
    await writeConfig(
      SYSTEM_PERSONA_KEY, v,
      'Missed Opportunities: editable persona/judgment narrative prepended to the prompt.',
    );
  }

  if (patch.kbAnchorUrls !== undefined) {
    const cleaned = patch.kbAnchorUrls.map((s) => s.trim()).filter((s) => s.length > 0);
    if (cleaned.length > KB_ANCHOR_MAX_COUNT) {
      throw new Error(`At most ${KB_ANCHOR_MAX_COUNT} KB grounding pages are allowed`);
    }
    for (const url of cleaned) {
      if (url.length > KB_ANCHOR_URL_MAX || !KB_ANCHOR_URL_RE.test(url)) {
        throw new Error(`"${url.slice(0, 60)}" is not a valid BookStack page URL`);
      }
    }
    // Newline-separated so the value round-trips cleanly through a textarea; an
    // empty string is stored deliberately to mean "grounding off".
    await writeConfig(
      KB_ANCHOR_URLS_KEY, cleaned.join('\n'),
      'Missed Opportunities: BookStack page URLs whose content grounds recommendations.',
    );
  }

  return getMissedOpportunitySettings();
}

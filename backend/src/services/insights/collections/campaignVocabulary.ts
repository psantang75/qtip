/**
 * The Collections campaign vocabulary, owned by the database.
 *
 * `ie_dim_collections_campaign` is the operator-editable record of what a campaign is
 * called and how it behaves — label, instrument, cycle, success_kind, colour, sort
 * order. It was seeded when the facts were created and then never read: the reports
 * decoded from a hardcoded map instead, mirrored a third time in the frontend's filter
 * options. Three copies of one mapping, and two of them had already drifted (the
 * dimension said `EXP_CC` was "Expiring Credit Card"; the code said "Expiring CC").
 *
 * That drift is not loud. A label is the wire value the filter sends, resolved back to
 * a key here, so a label nothing recognises does not throw — it resolves to `undefined`
 * and silently widens the report to every campaign. Reading the dimension removes the
 * second and third copies, and makes adding a campaign a row rather than a release,
 * per [.cursor/rules/runtime-configuration.mdc].
 *
 * WHICH CAMPAIGNS ARE "DECLINED" IS DERIVED, NOT LISTED. A campaign belongs to the
 * declined-charge reports when it recovers dollars AND bills on a cycle:
 *
 *     success_kind = 'RECOVERY_DOLLARS' AND cycle <> 'NA'
 *
 * which returns exactly the four recurring runs. The two exclusions fall out of the
 * data rather than being spelled out: Check recovers dollars but has no run to fail
 * (cycle 'NA' — a slow-pay chase on an invoice we never attempted), and Expiring CC
 * bills on no cycle and is not measured in dollars at all (success_kind 'CARD_UPDATE'
 * — it chases a card update BEFORE anything declines). Neither has a
 * billed → processed → declined funnel, which is the same reason the old hardcoded
 * list left them out.
 *
 * CACHED FOR THE PROCESS. Eight rows that change when a campaign is added, read on
 * every Collections request. The cache refreshes on a TTL so an edit lands without a
 * restart, and is never emptied once populated — the synchronous accessors below
 * depend on it being there.
 */
import type { RowDataPacket } from 'mysql2';
import pool from '../../../config/database';

export interface CampaignVocabulary {
  /** campaign_key → display label, for every campaign the dimension knows. */
  label: Record<string, string>;
  /** display label → campaign_key, the reverse the filters resolve through. */
  keyByLabel: Record<string, string>;
  /** The recurring declined runs, in the dimension's own sort order. */
  declined: readonly string[];
}

const TTL_MS = 5 * 60_000;

let cache: CampaignVocabulary | null = null;
let loadedAt = 0;

/**
 * Populate the cache if it is empty or past its TTL. Every Collections entry point
 * awaits this before touching the synchronous accessors.
 *
 * A failed refresh keeps serving the cache it already has. The alternative — failing
 * the request — trades a five-minute-stale label for a dead report, and these rows
 * change perhaps twice a year.
 */
export async function loadCampaignVocabulary(): Promise<CampaignVocabulary> {
  if (cache && Date.now() - loadedAt < TTL_MS) return cache;

  let rows: RowDataPacket[];
  try {
    [rows] = await pool.query<RowDataPacket[]>(
      `SELECT campaign_key, label, success_kind, cycle
         FROM ie_dim_collections_campaign
        ORDER BY sort_order, campaign_key`,
    );
  } catch (err) {
    if (cache) return cache;
    throw err;
  }

  if (rows.length === 0) {
    if (cache) return cache;
    throw new Error(
      'ie_dim_collections_campaign is empty — Collections cannot resolve campaign labels. '
      + 'It is seeded by 20260907170000_create_collections_facts.',
    );
  }

  const label: Record<string, string> = {};
  const keyByLabel: Record<string, string> = {};
  const declined: string[] = [];
  for (const r of rows) {
    const key = String(r.campaign_key);
    const name = String(r.label);
    label[key] = name;
    keyByLabel[name] = key;
    if (r.success_kind === 'RECOVERY_DOLLARS' && r.cycle !== 'NA') declined.push(key);
  }

  cache = { label, keyByLabel, declined };
  loadedAt = Date.now();
  return cache;
}

/**
 * The loaded vocabulary. Throws rather than returning an empty shape, because every
 * caller here builds a WHERE clause out of it: an empty declined list renders
 * `campaign_key IN ()`, and an empty label map turns every filter selection into
 * "all campaigns". Both are wrong answers that look like working reports, so a
 * missing `await loadCampaignVocabulary()` has to fail where it happened.
 */
function vocabulary(): CampaignVocabulary {
  if (!cache) {
    throw new Error(
      'Campaign vocabulary read before it was loaded — await loadCampaignVocabulary() '
      + 'at the entry point before building a Collections query.',
    );
  }
  return cache;
}

/**
 * Display label for a campaign key, falling back to the key itself for an unknown one.
 * For DISPLAY: a fact row whose campaign has no dimension row still renders as
 * something a human can read rather than as a blank cell.
 */
export const campaignLabel = (key: string): string => vocabulary().label[key] ?? key;

/**
 * Display label, or undefined when the dimension does not know the key.
 *
 * For CHOICES rather than display. A filter dropdown must not offer a campaign the
 * dimension cannot resolve, because the label is the wire value sent back — an
 * unresolvable one returns as `undefined` and silently widens the report to every
 * campaign. Offering nothing is the honest failure; offering a dead option is not.
 */
export const knownCampaignLabel = (key: string): string | undefined =>
  vocabulary().label[key];

/** The campaign key a display label names, or undefined when nothing matches it. */
export const campaignKeyForLabel = (label: string): string | undefined =>
  vocabulary().keyByLabel[label];

/**
 * The recurring declined runs — the population every declined-charge report measures.
 *
 * ONE LIST, not one per report. Cycle Performance and Campaign × Touch each used to
 * carry their own copy, and they have to agree: a campaign in one and not the other
 * means two pages measure different populations while claiming the same scope.
 */
export const declinedCampaigns = (): readonly string[] => vocabulary().declined;

/**
 * Campaigns that run the numbered call ladder, so a marginal-recovery-by-touch curve
 * means something for them.
 *
 * SAME SET AS `declinedCampaigns()` BY CONSTRUCTION, and kept as its own name because
 * it answers a different question. A campaign has a numbered ladder because it chases
 * a failed charge on a billing cycle, which is the same property that puts it in the
 * declined population — so the two coincide rather than being independently true.
 * If they ever diverge, the dimension is where to split them (a `has_call_ladder`
 * column), not a list back in the code.
 */
export const callLadderCampaigns = (): readonly string[] => vocabulary().declined;

/** Reset for tests. Not used by application code. */
export function __resetCampaignVocabulary(): void {
  cache = null;
  loadedAt = 0;
}

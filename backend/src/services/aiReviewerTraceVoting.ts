/**
 * Tier-1 Confidence Lift: N-sample trace voting (self-consistency K).
 *
 * The single biggest honest-confidence lever in the AI Reviewer is
 * running the per-source trace pass K times in parallel on cheap
 * Sonnet, majority-voting the structured fields, and feeding the
 * cross-run agreement score into the synthesis prompt as ground
 * truth. The synthesis model uses the agreement composite as a hard
 * ceiling for `overall_confidence` (cannot exceed `min(composite) +
 * 0.10`), so the model can no longer be more confident in its final
 * answer than the trace pass was in its own reasoning.
 *
 * Voting rules (per output array — keep the existing trace JSON shape):
 *   - playbook_steps[]: key by lowercased `step` name; majority-vote
 *     `status`; require step to appear in `>= ceil(k/2)` traces.
 *     Drop otherwise. `evidence_note_date` = first non-null across
 *     surviving traces.
 *   - observations[]: dedupe by `kind + normalize(message)`. Keep
 *     observations seen in `>= ceil(k/2)` traces. Highest severity
 *     across surviving copies.
 *   - extracted_claims[]: dedupe by `normalize(claim)`. Keep claims
 *     seen in `>= ceil(k/2)` traces.
 *   - timeline[]: dedupe by `(when, normalize(action))`. Keep events
 *     seen in `>= ceil(k/2)` traces. (This is what kills the
 *     per-run hallucinated timeline event problem.)
 *
 * Composite weighting:
 *   composite = 0.5 * playbookAgreement
 *             + 0.3 * claimAgreement
 *             + 0.2 * observationAgreement
 * Playbook is the highest-signal field for grading correctness.
 *
 * Fail-open: a single trace input still yields a valid merged JSON
 * (same shape as the trace, agreement = 1.0 — every item trivially
 * "passed" majority on a single sample). Bad JSON inputs are
 * silently dropped from the vote so a single corrupt trace doesn't
 * collapse the whole case.
 */

export interface TraceAgreement {
  /** Source kind, populated by the orchestrator after voting. */
  sourceKind: 'TICKET' | 'TASK' | 'CALL';
  /** Source id, populated by the orchestrator after voting. */
  sourceId: string;
  /** Number of trace samples that contributed (after dropping unparseable). */
  k: number;
  /** Fraction of playbook steps that survived majority voting (0..1). */
  playbookAgreement: number;
  /** Fraction of observations that survived majority voting (0..1). */
  observationAgreement: number;
  /** Fraction of extracted claims that survived majority voting (0..1). */
  claimAgreement: number;
  /** Fraction of timeline events that survived majority voting (0..1). */
  timelineAgreement: number;
  /** Weighted composite — what the synthesis prompt anchors against. */
  composite: number;
  /** Counts of items that did NOT make it past majority voting. */
  droppedItems: { playbook: number; observations: number; claims: number; timeline: number };
}

/** Fields the orchestrator fills in after `voteOnTraces` returns. */
export type TraceAgreementMetrics = Omit<TraceAgreement, 'sourceKind' | 'sourceId'>;

interface PlaybookStep {
  step: string;
  status: string;
  evidence_note_date?: string | null;
}

interface Observation {
  kind?: string;
  message?: string;
  severity?: string | number;
  [k: string]: unknown;
}

interface ExtractedClaim {
  source?: string;
  claim?: string;
  [k: string]: unknown;
}

interface TimelineEvent {
  when?: string;
  action?: string;
  [k: string]: unknown;
}

interface ParsedTrace {
  playbook_steps?: PlaybookStep[];
  observations?: Observation[];
  extracted_claims?: ExtractedClaim[];
  timeline?: TimelineEvent[];
  [k: string]: unknown;
}

/** Lowercase, strip punctuation, collapse whitespace. */
function normalize(s: unknown): string {
  if (s == null) return '';
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tryParse(json: string): ParsedTrace | null {
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as ParsedTrace) : null;
  } catch {
    return null;
  }
}

/**
 * Severity ordering used to pick the strongest copy of an observation
 * that appeared multiple times across traces. Strings ranked left to
 * right; unknown values fall back to a numeric coerce, then 0.
 */
const SEVERITY_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
function severityScore(s: unknown): number {
  if (typeof s === 'number') return s;
  if (typeof s === 'string') {
    const k = s.toLowerCase().trim();
    if (k in SEVERITY_RANK) return SEVERITY_RANK[k];
    const n = Number(k);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * Pick the majority-vote status for a playbook step that appeared in
 * multiple traces. Ties broken by status preference order:
 * missing > out_of_order > done > not_applicable. (We bias toward
 * "missing" on ties because a missed step is the higher-stakes
 * outcome the human needs to see — a false "done" hides a problem,
 * a false "missing" surfaces one.)
 */
function pickMajorityStatus(statuses: string[]): string {
  if (statuses.length === 0) return 'done';
  const counts = new Map<string, number>();
  for (const s of statuses) counts.set(s, (counts.get(s) ?? 0) + 1);
  const tieOrder = ['missing', 'out_of_order', 'done', 'not_applicable'];
  let best = statuses[0];
  let bestCount = -1;
  for (const s of [...counts.keys()].sort((a, b) => tieOrder.indexOf(a) - tieOrder.indexOf(b))) {
    const n = counts.get(s) ?? 0;
    if (n > bestCount) {
      best = s;
      bestCount = n;
    }
  }
  return best;
}

/**
 * Vote across K trace JSON strings. Returns the merged trace JSON
 * (same shape as a single Pass-1 trace, so callers don't need to
 * reshape) plus the agreement metrics the orchestrator threads into
 * the synthesis prompt.
 */
export function voteOnTraces(rawJsons: string[]): {
  mergedTraceJson: string;
  agreement: TraceAgreementMetrics;
} {
  const parsed: ParsedTrace[] = [];
  for (const j of rawJsons) {
    const p = tryParse(j);
    if (p) parsed.push(p);
  }

  // Degenerate cases: zero parseable traces (fail closed at zero
  // agreement) or one parseable trace (every item is trivially
  // unanimous — agreement 1.0).
  if (parsed.length === 0) {
    return {
      mergedTraceJson: JSON.stringify({
        playbook_steps: [],
        observations: [],
        extracted_claims: [],
        timeline: [],
      }),
      agreement: {
        k: 0,
        playbookAgreement: 0,
        observationAgreement: 0,
        claimAgreement: 0,
        timelineAgreement: 0,
        composite: 0,
        droppedItems: { playbook: 0, observations: 0, claims: 0, timeline: 0 },
      },
    };
  }

  const k = parsed.length;
  const threshold = Math.max(1, Math.ceil(k / 2));

  // playbook_steps[] vote ------------------------------------------------
  const playbookBuckets = new Map<string, { rows: PlaybookStep[]; key: string }>();
  for (const t of parsed) {
    const seenInThisTrace = new Set<string>();
    for (const row of Array.isArray(t.playbook_steps) ? t.playbook_steps : []) {
      const stepName = String(row?.step ?? '').trim();
      if (!stepName) continue;
      const key = stepName.toLowerCase();
      if (seenInThisTrace.has(key)) continue;
      seenInThisTrace.add(key);
      const bucket = playbookBuckets.get(key) ?? { rows: [], key };
      bucket.rows.push({
        step: stepName,
        status: String(row?.status ?? 'done'),
        evidence_note_date: row?.evidence_note_date ?? null,
      });
      playbookBuckets.set(key, bucket);
    }
  }
  const mergedPlaybook: PlaybookStep[] = [];
  let droppedPlaybook = 0;
  for (const bucket of playbookBuckets.values()) {
    if (bucket.rows.length < threshold) {
      droppedPlaybook += 1;
      continue;
    }
    const status = pickMajorityStatus(bucket.rows.map((r) => r.status));
    const firstDate = bucket.rows.find((r) => r.evidence_note_date != null)?.evidence_note_date ?? null;
    mergedPlaybook.push({
      step: bucket.rows[0].step,
      status,
      evidence_note_date: firstDate ?? null,
    });
  }
  const playbookTotalUnique = playbookBuckets.size;
  const playbookAgreement = playbookTotalUnique === 0 ? 1 : mergedPlaybook.length / playbookTotalUnique;

  // observations[] vote --------------------------------------------------
  const obsBuckets = new Map<string, Observation[]>();
  for (const t of parsed) {
    const seenInThisTrace = new Set<string>();
    for (const o of Array.isArray(t.observations) ? t.observations : []) {
      const key = `${normalize(o?.kind)}::${normalize(o?.message)}`;
      if (key === '::') continue;
      if (seenInThisTrace.has(key)) continue;
      seenInThisTrace.add(key);
      const list = obsBuckets.get(key) ?? [];
      list.push(o);
      obsBuckets.set(key, list);
    }
  }
  const mergedObs: Observation[] = [];
  let droppedObs = 0;
  for (const list of obsBuckets.values()) {
    if (list.length < threshold) {
      droppedObs += 1;
      continue;
    }
    const strongest = list.reduce((a, b) => (severityScore(b?.severity) > severityScore(a?.severity) ? b : a));
    mergedObs.push(strongest);
  }
  const obsTotalUnique = obsBuckets.size;
  const observationAgreement = obsTotalUnique === 0 ? 1 : mergedObs.length / obsTotalUnique;

  // extracted_claims[] vote ----------------------------------------------
  const claimBuckets = new Map<string, ExtractedClaim[]>();
  for (const t of parsed) {
    const seenInThisTrace = new Set<string>();
    for (const c of Array.isArray(t.extracted_claims) ? t.extracted_claims : []) {
      const key = normalize(c?.claim);
      if (!key) continue;
      if (seenInThisTrace.has(key)) continue;
      seenInThisTrace.add(key);
      const list = claimBuckets.get(key) ?? [];
      list.push(c);
      claimBuckets.set(key, list);
    }
  }
  const mergedClaims: ExtractedClaim[] = [];
  let droppedClaims = 0;
  for (const list of claimBuckets.values()) {
    if (list.length < threshold) {
      droppedClaims += 1;
      continue;
    }
    mergedClaims.push(list[0]);
  }
  const claimTotalUnique = claimBuckets.size;
  const claimAgreement = claimTotalUnique === 0 ? 1 : mergedClaims.length / claimTotalUnique;

  // timeline[] vote ------------------------------------------------------
  const timelineBuckets = new Map<string, TimelineEvent[]>();
  for (const t of parsed) {
    const seenInThisTrace = new Set<string>();
    for (const e of Array.isArray(t.timeline) ? t.timeline : []) {
      const key = `${normalize(e?.when)}::${normalize(e?.action)}`;
      if (key === '::') continue;
      if (seenInThisTrace.has(key)) continue;
      seenInThisTrace.add(key);
      const list = timelineBuckets.get(key) ?? [];
      list.push(e);
      timelineBuckets.set(key, list);
    }
  }
  const mergedTimeline: TimelineEvent[] = [];
  let droppedTimeline = 0;
  for (const list of timelineBuckets.values()) {
    if (list.length < threshold) {
      droppedTimeline += 1;
      continue;
    }
    mergedTimeline.push(list[0]);
  }
  const timelineTotalUnique = timelineBuckets.size;
  const timelineAgreement = timelineTotalUnique === 0 ? 1 : mergedTimeline.length / timelineTotalUnique;

  const composite = 0.5 * playbookAgreement + 0.3 * claimAgreement + 0.2 * observationAgreement;

  return {
    mergedTraceJson: JSON.stringify({
      playbook_steps: mergedPlaybook,
      observations: mergedObs,
      extracted_claims: mergedClaims,
      timeline: mergedTimeline,
    }),
    agreement: {
      k,
      playbookAgreement: round2(playbookAgreement),
      observationAgreement: round2(observationAgreement),
      claimAgreement: round2(claimAgreement),
      timelineAgreement: round2(timelineAgreement),
      composite: round2(composite),
      droppedItems: {
        playbook: droppedPlaybook,
        observations: droppedObs,
        claims: droppedClaims,
        timeline: droppedTimeline,
      },
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

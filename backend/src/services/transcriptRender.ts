/**
 * Shared transcript-rendering helpers used by both prompt builders.
 *
 * Originally lived inline in `aiReviewerPrompt.ts` (single-source path).
 * The trace-pass builder in `aiReviewerTwoPassPrompts.ts` was dumping
 * raw note text for CALL sources, which meant:
 *   - the structured turn JSON was rendered verbatim into the Pass-1
 *     trace prompt instead of being parsed into the speaker-flow the
 *     single-source path uses, and
 *   - the same CRMNote rendered DIFFERENTLY in the two paths, so the
 *     model graded the SAME call inconsistently depending on whether
 *     the case was single-source or multi-source.
 *
 * Extracting these helpers into a small standalone module keeps both
 * call sites byte-identical for CALL transcripts without dragging the
 * rest of `aiReviewerPrompt.ts` (form rendering, KB rendering, base
 * prompt assembly) into the dependency graph.
 */

import type { CRMNote } from './CRMService';

interface TranscriptTurn {
  speaker: string;
  timestamp: string;
  text: string;
}

/**
 * Render one or more CRMNotes as a CALL TRANSCRIPT block.
 *
 * Each note becomes its own `[date — author]` block. JSON-turn payloads
 * inside a single note's body are parsed into `[mm:ss — speaker] text`
 * lines; if parsing fails the raw text is included verbatim so a
 * malformed transcript never breaks the AI review.
 *
 * Notes are concatenated in their input order — callers control
 * ordering (SQL ORDER BY in CRMService.getTicketNotes etc.).
 */
export function renderTranscriptBlock(notes: CRMNote[]): string {
  if (notes.length === 0) return '';
  const parts = notes
    .map((n) => {
      const author =
        n.created_by_name || (n.created_by != null ? `User #${n.created_by}` : 'Call Transcript');
      const when = formatNoteDate(n.created_on);
      const headerLine = when ? `[${when} — ${author}]` : `[${author}]`;
      const formatted = formatTranscriptContent(n.note);
      return `${headerLine}\n${formatted}`;
    })
    .filter(Boolean);
  return parts.join('\n\n---\n\n');
}

/**
 * Detect structured turn JSON inside one note's body and render it as
 * `[mm:ss — speaker] text` lines; otherwise return the trimmed verbatim
 * text. Exported so the equivalence tests and the trace builder share
 * the same single implementation.
 */
export function formatTranscriptContent(raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '';
  const turns = tryParseTranscriptTurns(trimmed);
  if (turns.length > 0) {
    return turns.map((t) => `[${t.timestamp} — ${t.speaker}] ${t.text}`).join('\n');
  }
  return trimmed;
}

/**
 * Best-effort parser for structured transcripts. Accepts a JSON array
 * directly OR a JSON object with `turns`/`segments`/`messages`/
 * `utterances` field. Returns [] on any failure so the caller falls
 * back to verbatim text. Field-name aliases cover the common providers
 * (Genesys, Five9, AWS Connect, Twilio).
 */
function tryParseTranscriptTurns(text: string): TranscriptTurn[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  let rawArr: unknown[] = [];
  if (Array.isArray(parsed)) {
    rawArr = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const candidate = obj.turns ?? obj.segments ?? obj.messages ?? obj.utterances;
    if (Array.isArray(candidate)) rawArr = candidate;
  }
  if (rawArr.length === 0) return [];
  const out: TranscriptTurn[] = [];
  for (const item of rawArr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const speaker =
      pickString(o, ['speaker', 'role', 'participant', 'channel', 'name']) || 'Unknown';
    const tsRaw = o.ts ?? o.timestamp ?? o.start ?? o.offset ?? o.start_time ?? '';
    const text = pickString(o, ['text', 'utterance', 'message', 'content']) || '';
    if (!text) continue;
    out.push({ speaker, timestamp: formatTimestamp(tsRaw), text });
  }
  return out;
}

function pickString(o: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/** Coerce common timestamp shapes (numeric seconds, "h:mm:ss.frac", "mm:ss") to "mm:ss". */
function formatTimestamp(raw: unknown): string {
  if (raw == null || raw === '') return '00:00';
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return secondsToMmss(raw);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (/^\d{1,2}:\d{2}(:\d{2})?(\.\d+)?$/.test(trimmed)) {
      const noFrac = trimmed.split('.')[0];
      const parts = noFrac.split(':');
      if (parts.length === 3 && parts[0] === '0') return `${parts[1]}:${parts[2]}`;
      return noFrac;
    }
    const asNum = Number(trimmed);
    if (Number.isFinite(asNum)) return secondsToMmss(asNum);
    return trimmed;
  }
  return String(raw);
}

function secondsToMmss(secs: number): string {
  const total = Math.max(0, Math.floor(secs));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Render a CRM note date as "Apr 28 2026 9:14 AM" so the model can cite by date. */
function formatNoteDate(raw: unknown): string | null {
  if (!raw) return null;
  const d = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

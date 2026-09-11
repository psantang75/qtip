/**
 * Plain-text rendering for the Call Transcripts on-demand report.
 *
 * The file is written to be pasted or uploaded straight into an AI tool, so:
 *  - every call carries its own metadata header, letting the model attribute a
 *    finding to an agent, a date and a conversation id without a second file;
 *  - calls WITHOUT a transcript are listed once at the end rather than emitted
 *    as empty blocks, which would otherwise be noise the model has to wade
 *    through;
 *  - the header states the selection and the cap up front, so a truncated
 *    export can't be mistaken for the whole period.
 */
import type { TranscriptCall } from './callTranscripts.data';

const RULE = '='.repeat(78);
const THIN = '-'.repeat(78);

const mins = (secs: number): string => (secs / 60).toFixed(1);

/**
 * `started_on` originates from Genesys `ConversationStart_ET`, so it is Eastern
 * wall-clock time, not an instant. Formatted from local components per the
 * project's local-first date rule — `toISOString()` here would relabel it as
 * UTC and shift every timestamp by the host's offset.
 */
function stamp(d: Date | null): string {
  if (!d) return 'unknown';
  const dt = new Date(d);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())} `
    + `${p(dt.getHours())}:${p(dt.getMinutes())} ET`;
}

export interface TranscriptDocMeta {
  startDate: string;
  endDate: string;
  bandLabel: string;
  matched: number;
  capped: boolean;
  cap: number;
}

function renderHeader(
  meta: TranscriptDocMeta,
  included: number,
  missing: number,
): string {
  const selection = meta.capped
    ? `${included + missing} of ${meta.matched} matching calls (longest first, capped at ${meta.cap})`
    : `${included + missing} matching calls (longest first)`;

  return [
    'QTIP CALL TRANSCRIPT EXPORT',
    RULE,
    // An instant, not a business date, so UTC is the unambiguous label here.
    `Generated:        ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    `Period:           ${meta.startDate} to ${meta.endDate}`,
    `Call length:      ${meta.bandLabel}`,
    `Calls selected:   ${selection}`,
    `Transcripts:      ${included} included, ${missing} unavailable`,
    '',
    'Handle time is talk + hold + wrap. Timestamps in each transcript are',
    'offsets from the start of that call.',
    RULE,
    '',
  ].join('\n');
}

function renderCall(call: TranscriptCall, transcript: string, index: number, total: number): string {
  const agent = call.agentEmail ? `${call.agentName} <${call.agentEmail}>` : call.agentName;
  return [
    RULE,
    `CALL ${index} of ${total}`,
    `Conversation ID:  ${call.conversationId}`,
    `Started:          ${stamp(call.startedOn)}`,
    `Agent:            ${agent}`,
    `Department:       ${call.department}`,
    `Direction:        ${call.direction}`,
    `Handle:           ${mins(call.handleSecs)} min `
      + `(talk ${mins(call.talkSecs)}, hold ${mins(call.holdSecs)}, wrap ${mins(call.wrapSecs)})`,
    `Wrap-up code:     ${call.wrapUpCode ?? '(none set)'}`,
    `Transferred:      ${call.transferred ? 'Yes' : 'No'}`,
    THIN,
    transcript,
    '',
  ].join('\n');
}

function renderMissing(calls: TranscriptCall[]): string {
  if (calls.length === 0) return '';
  const lines = calls.map(
    (c) => `  ${c.conversationId}  ${c.callDate}  ${mins(c.handleSecs)} min  ${c.agentName}`,
  );
  return [
    RULE,
    `CALLS WITH NO TRANSCRIPT AVAILABLE (${calls.length})`,
    THIN,
    'These matched the selection but the phone system holds no transcript for',
    'them — transcription may have been off, failed, or aged out of retention.',
    '',
    ...lines,
    '',
  ].join('\n');
}

/**
 * The whole document. `transcripts` is keyed by conversation id; a call absent
 * from it (or with empty text) is reported in the trailing unavailable list.
 */
export function renderTranscriptDoc(
  calls: TranscriptCall[],
  transcripts: Map<string, string>,
  meta: TranscriptDocMeta,
): string {
  const withText: Array<{ call: TranscriptCall; text: string }> = [];
  const without: TranscriptCall[] = [];

  for (const call of calls) {
    const text = transcripts.get(call.conversationId)?.trim();
    if (text) withText.push({ call, text });
    else without.push(call);
  }

  const body = withText.map((entry, i) =>
    renderCall(entry.call, entry.text, i + 1, withText.length));

  return [
    renderHeader(meta, withText.length, without.length),
    ...body,
    renderMissing(without),
    RULE,
    'END OF EXPORT',
    '',
  ].join('\n');
}

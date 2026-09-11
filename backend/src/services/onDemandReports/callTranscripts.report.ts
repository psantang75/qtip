/**
 * "Call Transcripts (Long Calls)" on-demand report.
 *
 * Exists so an analyst can pull the transcripts behind long support calls and
 * run their own AI analysis on them. This report deliberately does NO analysis
 * — it is a clean, attributable text dump and nothing more.
 *
 * It lives here rather than on the Call Length report page for two reasons: a
 * bulk transcript pull is a data extract, not a dashboard control; and the
 * on-demand section is already gated to Admin + Manager, whereas Call Length is
 * also granted to QA, CSR and Trainer, which should not reach raw customer
 * conversation text.
 *
 * The Run → count → Download flow the framework already provides is what makes
 * the cap safe: you always see how many calls matched, and how many of them
 * actually have a transcript, before committing to the download.
 */
import { resolvePeriod } from '../../utils/periodUtils';
import { timestampedFilename } from './helpers';
import {
  DEFAULT_TRANSCRIPT_BAND,
  MAX_TRANSCRIPT_CALLS,
  TRANSCRIPT_BAND_OPTIONS,
  bandLabelFor,
  fetchTranscriptTexts,
  markTranscriptAvailability,
  selectTranscriptCalls,
  type TranscriptCall,
} from './callTranscripts.data';
import { renderTranscriptDoc } from './callTranscripts.render';
import type {
  OnDemandReport,
  OnDemandReportColumn,
  OnDemandReportFilters,
} from './types';

const columns: OnDemandReportColumn[] = [
  { key: 'call_date', label: 'Date', format: 'date' },
  { key: 'agent_name', label: 'Agent' },
  { key: 'department', label: 'Department' },
  { key: 'handle_min', label: 'Handle (min)', align: 'right', format: 'number' },
  { key: 'talk_min', label: 'Talk (min)', align: 'right', format: 'number' },
  { key: 'wrap_min', label: 'Wrap (min)', align: 'right', format: 'number' },
  { key: 'direction', label: 'Direction' },
  { key: 'wrap_up_code', label: 'Wrap-up Code' },
  { key: 'has_transcript', label: 'Transcript' },
  { key: 'conversation_id', label: 'Conversation ID' },
];

/** YYYYMMDD integer matching ie_dim_date.date_key. */
function toDateKey(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/**
 * `start_date`/`end_date` arrive pre-resolved from the controller; re-resolving
 * the custom range here keeps this report's key arithmetic identical to the
 * Call Length page's rather than parsing the ISO strings a second way.
 */
function rangeKeys(filters: OnDemandReportFilters): { fromKey: number; toKey: number } {
  const { current } = resolvePeriod('custom', filters.start_date, filters.end_date);
  return { fromKey: toDateKey(current.start), toKey: toDateKey(current.end) };
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** Exported so `filterOptions` can route this report to the warehouse lists. */
export const CALL_TRANSCRIPTS_REPORT_ID = 'call-transcripts-long';

function toRow(call: TranscriptCall): Record<string, unknown> {
  return {
    call_date: call.callDate,
    agent_name: call.agentName,
    department: call.department,
    handle_min: r1(call.handleSecs / 60),
    talk_min: r1(call.talkSecs / 60),
    wrap_min: r1(call.wrapSecs / 60),
    direction: call.direction,
    wrap_up_code: call.wrapUpCode ?? '',
    has_transcript: call.hasTranscript ? 'Yes' : 'No',
    conversation_id: call.conversationId,
  };
}

/**
 * The line shown next to the result count. `total` alone can't say that a cap
 * trimmed the selection, nor that some of the selected calls have no transcript
 * — and a user who downloads 250 of 1,775 calls without being told would draw
 * conclusions from a slice they thought was the whole period.
 */
export function buildNotice(
  matched: number,
  selected: number,
  withTranscript: number,
): string | undefined {
  if (selected === 0) return undefined;
  const n = (v: number) => v.toLocaleString();
  const missing = selected - withTranscript;

  const scope = matched > selected
    ? `${n(matched)} calls match — downloading the ${n(selected)} longest.`
    : `${n(selected)} ${selected === 1 ? 'call matches' : 'calls match'}.`;
  const have = `${n(withTranscript)} ${withTranscript === 1 ? 'has' : 'have'} a transcript `
    + 'and will appear in the file';
  const gap = missing > 0
    ? `; the other ${n(missing)} ${missing === 1 ? 'is' : 'are'} listed at the end as unavailable`
    : '';

  return `${scope} ${have}${gap}.`;
}

export const callTranscriptsReport: OnDemandReport = {
  id: CALL_TRANSCRIPTS_REPORT_ID,
  name: 'Call Transcripts (Long Calls)',
  description:
    'Transcripts for long support calls, with agent, conversation ID and call date, '
    + 'as a plain-text file for your own AI analysis. Covers the same calls as the '
    + `Call Length report. Longest calls first, up to ${MAX_TRANSCRIPT_CALLS} per download — `
    + 'the download can take up to a minute.',
  roles: [1, 5],
  columns,
  supportedFilters: ['period', 'callLengthBand', 'departments', 'agents'],
  defaultFilters: { callLengthBand: DEFAULT_TRANSCRIPT_BAND },
  callLengthBandOptions: TRANSCRIPT_BAND_OPTIONS,
  downloadFormat: 'txt',
  // A full-cap export measured ~40s in dev, where transcripts are fetched from
  // the same remote pool as prod. The shared 60s deadline left no room for a
  // slower day, and the cost here is bounded by MAX_TRANSCRIPT_CALLS rather
  // than by how wide the user's filters are.
  downloadTimeoutMs: 5 * 60 * 1000,

  async getRows(filters, _user, page) {
    const { fromKey, toKey } = rangeKeys(filters);
    const selection = await selectTranscriptCalls({
      fromKey,
      toKey,
      bandKey: filters.callLengthBand,
      departments: filters.departments,
      users: filters.agents,
    });

    const withTranscript = await markTranscriptAvailability(selection.calls);

    // `total` is what the DOWNLOAD will contain, so pagination can never offer
    // a page of calls the file won't include. The pre-cap match count goes in
    // the notice instead, where it reads as context rather than a promise.
    const start = (page.page - 1) * page.pageSize;
    const rows = selection.calls.slice(start, start + page.pageSize).map(toRow);

    return {
      rows,
      total: selection.calls.length,
      notice: buildNotice(selection.matched, selection.calls.length, withTranscript),
    };
  },

  async getDownload(filters) {
    const { fromKey, toKey } = rangeKeys(filters);
    const selection = await selectTranscriptCalls({
      fromKey,
      toKey,
      bandKey: filters.callLengthBand,
      departments: filters.departments,
      users: filters.agents,
    });

    const transcripts = await fetchTranscriptTexts(
      selection.calls.map((c) => c.conversationId),
    );

    const text = renderTranscriptDoc(selection.calls, transcripts, {
      startDate: filters.start_date,
      endDate: filters.end_date,
      bandLabel: bandLabelFor(filters.callLengthBand),
      matched: selection.matched,
      capped: selection.capped,
      cap: MAX_TRANSCRIPT_CALLS,
    });

    return {
      buffer: Buffer.from(text, 'utf8'),
      filename: timestampedFilename('CallTranscripts', 'txt'),
      contentType: 'text/plain; charset=utf-8',
    };
  },
};

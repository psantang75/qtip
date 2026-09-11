import { describe, it, expect } from 'vitest';
import { bandRangeSql, CALL_LENGTH_BANDS, OVER_10_BANDS } from '../../insights/callLength/bands';
import {
  DEFAULT_TRANSCRIPT_BAND,
  MAX_TRANSCRIPT_CALLS,
  TRANSCRIPT_BAND_OPTIONS,
  bandKeysFor,
  bandLabelFor,
  type TranscriptCall,
} from '../callTranscripts.data';
import { renderTranscriptDoc } from '../callTranscripts.render';
import { buildNotice, callTranscriptsReport } from '../callTranscripts.report';

function call(over: Partial<TranscriptCall> = {}): TranscriptCall {
  return {
    conversationId: 'conv-1',
    agentName: 'Marc Joseph',
    agentEmail: 'mjoseph@dm-us.com',
    department: 'Tech Support',
    callDate: '2026-09-02',
    startedOn: new Date(2026, 8, 2, 10, 8),
    direction: 'Inbound',
    talkSecs: 1200,
    holdSecs: 60,
    wrapSecs: 90,
    handleSecs: 1350,
    wrapUpCode: 'ININ-WRAP-UP-TIMEOUT',
    transferred: false,
    hasTranscript: true,
    ...over,
  };
}

describe('bandRangeSql', () => {
  it('bounds a single band on both sides', () => {
    expect(bandRangeSql(['m10_20'])).toBe('(f.handle_secs >= 600 AND f.handle_secs < 1200)');
  });

  it('leaves the open-ended top band unbounded above', () => {
    expect(bandRangeSql(['o20'])).toBe('f.handle_secs >= 1200');
  });

  it('ORs multiple bands into one predicate', () => {
    expect(bandRangeSql(OVER_10_BANDS)).toBe(
      '((f.handle_secs >= 600 AND f.handle_secs < 1200) OR f.handle_secs >= 1200)',
    );
  });

  it('matches NOTHING rather than everything when no band resolves', () => {
    // A false predicate is the safe failure: silently dropping the filter would
    // turn a 44-call request into every call in the period.
    expect(bandRangeSql([])).toBe('1 = 0');
    expect(bandRangeSql(['not_a_band'])).toBe('1 = 0');
  });

  it('honours a custom column', () => {
    expect(bandRangeSql(['o20'], 'x.secs')).toBe('x.secs >= 1200');
  });

  it('agrees with the band boundaries it is generated from', () => {
    for (const b of CALL_LENGTH_BANDS) {
      const sql = bandRangeSql([b.key]);
      expect(sql).toContain(`>= ${b.minSecs}`);
      if (b.maxSecs !== null) expect(sql).toContain(`< ${b.maxSecs}`);
    }
  });
});

describe('band selection', () => {
  it('maps "all" and anything unrecognised to both long bands', () => {
    expect(bandKeysFor('all')).toEqual(OVER_10_BANDS);
    expect(bandKeysFor(undefined)).toEqual(OVER_10_BANDS);
    // Short bands are deliberately not offered; asking for one must not widen
    // the pull to thousands of short calls.
    expect(bandKeysFor('u1')).toEqual(OVER_10_BANDS);
    expect(bandKeysFor('m2_5')).toEqual(OVER_10_BANDS);
  });

  it('passes through the two long bands', () => {
    expect(bandKeysFor('m10_20')).toEqual(['m10_20']);
    expect(bandKeysFor('o20')).toEqual(['o20']);
  });

  it('offers only long options, defaulting to all of them', () => {
    expect(TRANSCRIPT_BAND_OPTIONS.map(o => o.value)).toEqual(['all', 'm10_20', 'o20']);
    expect(DEFAULT_TRANSCRIPT_BAND).toBe('all');
    expect(bandLabelFor('o20')).toBe('20 min+');
    expect(bandLabelFor(undefined)).toBe(TRANSCRIPT_BAND_OPTIONS[0].label);
  });
});

describe('report definition', () => {
  it('is Admin/Manager only, so raw customer transcripts stay out of CSR reach', () => {
    expect(callTranscriptsReport.roles).toEqual([1, 5]);
  });

  it('declares a txt download and the band filter it needs', () => {
    expect(callTranscriptsReport.downloadFormat).toBe('txt');
    expect(callTranscriptsReport.supportedFilters).toContain('callLengthBand');
    expect(callTranscriptsReport.callLengthBandOptions).toBe(TRANSCRIPT_BAND_OPTIONS);
    expect(callTranscriptsReport.defaultFilters?.callLengthBand).toBe(DEFAULT_TRANSCRIPT_BAND);
  });

  it('allows more than the shared 60s deadline, since a full-cap pull needs it', () => {
    expect(callTranscriptsReport.downloadTimeoutMs).toBeGreaterThan(60_000);
  });

  it('caps the pull so download cost cannot scale with the date range', () => {
    expect(MAX_TRANSCRIPT_CALLS).toBeLessThanOrEqual(250);
  });

  it('surfaces transcript availability as its own column', () => {
    const keys = callTranscriptsReport.columns.map(c => c.key);
    expect(keys).toContain('has_transcript');
    expect(keys).toContain('conversation_id');
    expect(keys).toContain('call_date');
  });
});

describe('buildNotice', () => {
  it('says nothing when nothing matched', () => {
    expect(buildNotice(0, 0, 0)).toBeUndefined();
  });

  it('reports the pre-cap total when the cap trimmed the selection', () => {
    const notice = buildNotice(1775, 250, 168)!;
    expect(notice).toContain('1,775 calls match');
    expect(notice).toContain('downloading the 250 longest');
    expect(notice).toContain('168 have a transcript');
    expect(notice).toContain('the other 82 are listed at the end');
  });

  it('omits the cap language when everything matched fits', () => {
    const notice = buildNotice(31, 31, 31)!;
    expect(notice).toBe('31 calls match. 31 have a transcript and will appear in the file.');
    expect(notice).not.toContain('longest');
    expect(notice).not.toContain('unavailable');
  });

  it('keeps singular/plural readable at 1', () => {
    expect(buildNotice(1, 1, 1)).toBe(
      '1 call matches. 1 has a transcript and will appear in the file.',
    );
    expect(buildNotice(31, 31, 30)).toContain('the other 1 is listed at the end');
  });
});

describe('renderTranscriptDoc', () => {
  const meta = {
    startDate: '2026-09-01',
    endDate: '2026-09-09',
    bandLabel: '20 min+',
    matched: 2,
    capped: false,
    cap: MAX_TRANSCRIPT_CALLS,
  };

  it('carries the attribution an AI needs on every call block', () => {
    const doc = renderTranscriptDoc(
      [call()],
      new Map([['conv-1', '[00:01 — Agent] Hello.']]),
      meta,
    );
    expect(doc).toContain('Conversation ID:  conv-1');
    expect(doc).toContain('Agent:            Marc Joseph <mjoseph@dm-us.com>');
    expect(doc).toContain('Department:       Tech Support');
    expect(doc).toContain('[00:01 — Agent] Hello.');
    expect(doc).toContain('CALL 1 of 1');
  });

  it('stamps the call in ET wall time, never shifted through UTC', () => {
    // started_on comes from ConversationStart_ET, so 10:08 must print as 10:08
    // regardless of the host timezone.
    const doc = renderTranscriptDoc([call()], new Map([['conv-1', 'x']]), meta);
    expect(doc).toContain('Started:          2026-09-02 10:08 ET');
  });

  it('lists calls with no transcript at the end instead of emitting empty blocks', () => {
    const doc = renderTranscriptDoc(
      [call({ conversationId: 'has' }), call({ conversationId: 'none', hasTranscript: false })],
      new Map([['has', '[00:01 — Agent] Hi.']]),
      meta,
    );
    expect(doc).toContain('CALL 1 of 1');
    expect(doc).not.toContain('CALL 2 of');
    expect(doc).toContain('CALLS WITH NO TRANSCRIPT AVAILABLE (1)');
    expect(doc).toContain('none');
    expect(doc).toContain('Transcripts:      1 included, 1 unavailable');
  });

  it('treats whitespace-only transcript text as unavailable', () => {
    const doc = renderTranscriptDoc([call()], new Map([['conv-1', '   \n  ']]), meta);
    expect(doc).toContain('CALLS WITH NO TRANSCRIPT AVAILABLE (1)');
    expect(doc).toContain('Transcripts:      0 included, 1 unavailable');
  });

  it('states the cap in the header so a truncated file cannot pass as the whole period', () => {
    const doc = renderTranscriptDoc(
      [call()],
      new Map([['conv-1', 'x']]),
      { ...meta, matched: 1775, capped: true, cap: 250 },
    );
    expect(doc).toContain('of 1775 matching calls (longest first, capped at 250)');
  });

  it('renders a valid document with no calls at all', () => {
    const doc = renderTranscriptDoc([], new Map(), { ...meta, matched: 0 });
    expect(doc).toContain('Transcripts:      0 included, 0 unavailable');
    expect(doc).not.toContain('CALLS WITH NO TRANSCRIPT AVAILABLE');
    expect(doc).toContain('END OF EXPORT');
  });

  it('breaks out handle time into its components', () => {
    const doc = renderTranscriptDoc([call()], new Map([['conv-1', 'x']]), meta);
    expect(doc).toContain('Handle:           22.5 min (talk 20.0, hold 1.0, wrap 1.5)');
  });
});

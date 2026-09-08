/**
 * Genesys conversation-transcript rendering.
 *
 * Production transcripts arrive as `{ transcripts: [ { phrases: [...] } ] }`
 * from Genesys VOICE_TRANSCRIPTION — NOT the flat `turns`/`segments` arrays the
 * other transcriptRender tests use. Before this shape was handled, the parser
 * fell through and dumped the raw ~70KB JSON verbatim, which the analyzer then
 * truncated to the opening IVR greeting — so the model graded a call it never
 * saw (a "no voicemail left" miss on a call where the rep plainly left one).
 * These tests pin the parse so that regression cannot come back silently.
 */
import { describe, it, expect } from 'vitest';
import { formatTranscriptContent } from '../transcriptRender';

/** A minimal slice of the real Genesys payload shape (epoch-ms startTimeMs). */
function genesysPayload() {
  const base = 1788545379000;
  return JSON.stringify({
    conversationId: '5f338064',
    transcripts: [
      {
        startTime: base,
        phrases: [
          {
            text: 'hi is daniel available',
            decoratedText: 'Hi, is Daniel available, please?',
            startTimeMs: base + 20000,
            participantPurpose: 'internal',
          },
          {
            text: 'would you like his voicemail',
            decoratedText: "He's not in. Would you like his voicemail?",
            startTimeMs: base + 24000,
            participantPurpose: 'external',
          },
          {
            text: 'voicemail would be perfect thank you',
            decoratedText: 'Voicemail would be perfect. Thank you.',
            startTimeMs: base + 27000,
            participantPurpose: 'internal',
          },
        ],
      },
    ],
  });
}

describe('formatTranscriptContent — Genesys phrase shape', () => {
  it('renders one readable line per phrase instead of dumping raw JSON', () => {
    const out = formatTranscriptContent(genesysPayload());
    expect(out).not.toContain('"phrases"');
    expect(out).not.toContain('startTimeMs');
    expect(out.split('\n')).toHaveLength(3);
  });

  it('maps participantPurpose to Agent (our side) and Customer (far end)', () => {
    const out = formatTranscriptContent(genesysPayload());
    expect(out).toContain('[00:20 — Agent] Hi, is Daniel available, please?');
    expect(out).toContain("[00:24 — Customer] He's not in. Would you like his voicemail?");
    expect(out).toContain('[00:27 — Agent] Voicemail would be perfect. Thank you.');
  });

  it('prefers decoratedText over the raw all-lowercase ASR text', () => {
    const out = formatTranscriptContent(genesysPayload());
    expect(out).toContain('Voicemail would be perfect. Thank you.');
    expect(out).not.toContain('voicemail would be perfect thank you');
  });

  it('rebases absolute epoch startTimeMs to an in-call m:ss offset', () => {
    // First phrase is 20s past the segment start, so it must read 00:20, not a
    // 2010-era wall-clock time derived from the raw epoch value.
    expect(formatTranscriptContent(genesysPayload())).toContain('[00:20 — Agent]');
  });

  it('collapses a huge real-world payload from tens of KB to a compact script', () => {
    // The bug was one of size as much as shape: unparsed, this is dumped whole
    // and truncated. Parsed, it is a fraction of the size and complete.
    const bulky = JSON.stringify({
      transcripts: [{
        startTime: 0,
        phrases: Array.from({ length: 40 }, (_, i) => ({
          decoratedText: `Line ${i}.`,
          text: `line ${i}`,
          startTimeMs: i * 1000,
          participantPurpose: i % 2 === 0 ? 'internal' : 'external',
          // Ballast mimicking the per-word timing arrays that bloat the raw JSON.
          words: Array.from({ length: 20 }, (_, w) => ({ word: `w${w}`, confidence: 1, startTimeMs: w })),
        })),
      }],
    });
    const out = formatTranscriptContent(bulky);
    expect(out.length).toBeLessThan(bulky.length / 3);
    expect(out.split('\n')).toHaveLength(40);
  });

  it('handles a bare { phrases: [...] } object without the transcripts wrapper', () => {
    const bare = JSON.stringify({
      phrases: [
        { decoratedText: 'Hello there.', startTimeMs: 0, participantPurpose: 'internal' },
      ],
    });
    expect(formatTranscriptContent(bare)).toBe('[00:00 — Agent] Hello there.');
  });

  it('still renders phrases whose participant role is unknown, without a false label', () => {
    const unknown = JSON.stringify({
      phrases: [{ decoratedText: 'On hold music.', startTimeMs: 0, participantPurpose: 'bot' }],
    });
    expect(formatTranscriptContent(unknown)).toContain('Unknown] On hold music.');
  });

  it('leaves non-Genesys structured shapes to the existing turn handlers', () => {
    const turns = JSON.stringify([{ speaker: 'Agent', ts: 5, text: 'Legacy turn shape.' }]);
    expect(formatTranscriptContent(turns)).toBe('[00:05 — Agent] Legacy turn shape.');
  });

  it('falls back to verbatim text for plain (non-JSON) transcripts', () => {
    expect(formatTranscriptContent('Agent: Hello.')).toBe('Agent: Hello.');
  });
});

/**
 * Utility functions for processing transcript data
 */

// Types for transcript structure based on the sample data
export interface TranscriptPhrase {
  text: string;
  decoratedText: string;
  stability: number;
  confidence: number;
  startTimeMs: number;
  duration: { milliseconds: number };
  words: Array<{
    word: string;
    confidence: number;
    startTimeMs: number;
    duration: { milliseconds: number };
  }>;
  decoratedWords: Array<{
    word: string;
    confidence: number;
    startTimeMs: number;
    duration: { milliseconds: number };
  }>;
  alternatives: any[];
  participantPurpose: 'internal' | 'external';
  phraseIndex: number;
}

export interface TranscriptData {
  transcriptId: string;
  language: string;
  programId: string;
  engineId: string;
  engineProvider: string;
  features: string[];
  startTime: number;
  duration: { milliseconds: number };
  phrases: TranscriptPhrase[];
  analytics: any;
}

export interface ConversationTranscript {
  organizationId: string;
  conversationId: string;
  communicationId: string;
  recordingId: string;
  transcripts: TranscriptData[];
  participants: any[];
  uri: string;
  startTime: number;
  duration: { milliseconds: number };
  mediaType: string;
  conversationStartTime: number;
  handleTime: string;
  conversationDuration: number;
  isNamedEntitiesAnalyzed: boolean;
}

/**
 * Map a Genesys-style `participantPurpose` to a human-readable speaker
 * label. We intentionally collapse the platform's many internal roles
 * (agent / acd / ivr / system) into a single "Agent" tag because, from
 * a QA-reviewer perspective, anything coming from our side of the line
 * — including the IVR greeting — is "what we said to the caller".
 *
 * Returns `null` when we genuinely don't know who spoke; the caller
 * then renders the line without a prefix rather than mislabelling it.
 */
function speakerLabelFromParticipantPurpose(purpose: unknown): 'Agent' | 'Customer' | null {
  if (typeof purpose !== 'string') return null;
  const p = purpose.toLowerCase();
  if (p === 'external' || p === 'customer') return 'Customer';
  if (p === 'internal' || p === 'agent' || p === 'acd' || p === 'ivr' || p === 'system') return 'Agent';
  return null;
}

/**
 * Extracts plain text from transcript phrases
 * @param transcriptData - The transcript data (can be string or structured object)
 * @returns Plain text string with all phrases combined, with each phrase
 *          prefixed by an `Agent: ` / `Customer: ` speaker label whenever
 *          the source data exposes a participant role. Lines from older
 *          plain-string transcripts (no role metadata) are returned
 *          unchanged so we never invent a speaker.
 */
export function extractTranscriptText(transcriptData: string | ConversationTranscript | null | undefined): string {
  if (!transcriptData) {
    return 'No transcript available';
  }

  // If it's a string, try to parse it as JSON first
  if (typeof transcriptData === 'string') {
    try {
      // Try to parse as JSON
      const parsed = JSON.parse(transcriptData);
      // If parsing succeeds and it looks like structured transcript data, process it
      if (parsed && (parsed.transcripts || parsed.phrases)) {
        return extractTranscriptText(parsed);
      }
      // If it's just a plain string, return as-is
      return transcriptData;
    } catch (error) {
      // If parsing fails, it's likely plain text, return as-is
      return transcriptData;
    }
  }

  // If it's structured data, extract text from phrases
  if (typeof transcriptData === 'object' && transcriptData !== null) {
    try {
      // Handle array format (multiple conversation transcripts)
      const transcripts = Array.isArray(transcriptData) ? transcriptData : [transcriptData];

      const allText: string[] = [];

      for (const transcript of transcripts) {
        if (transcript.transcripts && Array.isArray(transcript.transcripts)) {
          for (const transcriptItem of transcript.transcripts) {
            if (transcriptItem.phrases && Array.isArray(transcriptItem.phrases)) {
              const phraseLines: string[] = [];
              for (const phrase of transcriptItem.phrases) {
                // Prefer Genesys' `decoratedText` over raw `text`. The
                // raw field is the verbatim ASR output — all lowercase,
                // no punctuation, no number/currency formatting. The
                // decorated field is the same content after Genesys'
                // text-normalisation pass: sentence casing, proper
                // nouns, "$1,200" instead of "twelve hundred dollars",
                // commas, periods, etc. We fall back to raw `text`
                // only when decoration isn't present (older recordings
                // or non-Genesys transcript sources).
                const decorated = typeof phrase?.decoratedText === 'string' ? phrase.decoratedText.trim() : '';
                const raw = typeof phrase?.text === 'string' ? phrase.text.trim() : '';
                const display = decorated.length > 0 ? decorated : raw;
                if (!display) continue;
                const speaker = speakerLabelFromParticipantPurpose(phrase.participantPurpose);
                phraseLines.push(speaker ? `${speaker}: ${display}` : display);
              }

              if (phraseLines.length > 0) {
                allText.push(phraseLines.join('\n'));
              }
            }
          }
        }
      }

      return allText.length > 0 ? allText.join('\n\n') : 'No transcript content found';
    } catch (error) {
      console.warn('Error processing transcript data:', error);
      return 'Error processing transcript';
    }
  }

  return 'No transcript available';
}

/**
 * Escape a plain-text string so it can be safely injected into HTML
 * via `dangerouslySetInnerHTML`. We're intentionally producing HTML
 * here (to bold the speaker labels), so any caller-controlled content
 * — including transcript text from upstream systems — must be
 * HTML-escaped first to avoid an XSS vector.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formats transcript text for better readability. Returns an HTML
 * fragment intended to be passed through `dangerouslySetInnerHTML` on
 * a `whitespace-pre-wrap` container — speaker labels (`Agent:` /
 * `Customer:`) are wrapped in `<strong>` so reviewers can scan turns
 * at a glance, while the rest of the transcript text is HTML-escaped.
 *
 * Sentinel error / empty strings (e.g. "No transcript available") are
 * returned verbatim with no markup so the caller can render them as-is.
 */
export function formatTranscriptText(transcriptData: string | ConversationTranscript | null | undefined): string {
  const rawText = extractTranscriptText(transcriptData);

  if (rawText === 'No transcript available' || rawText === 'No transcript content found' || rawText === 'Error processing transcript') {
    return rawText;
  }

  // Match the speaker label only at the very start of a line, followed
  // by ": ". We anchor on \s* so a stray leading space doesn't defeat
  // the match. Group 1 is the label, group 2 is the rest of the line.
  const labelRe = /^(Agent|Customer):\s+(.*)$/;

  return rawText
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => line.length > 0)
    .map((line) => {
      const m = labelRe.exec(line);
      if (m) {
        return `<strong>${m[1]}:</strong> ${escapeHtml(m[2])}`;
      }
      return escapeHtml(line);
    })
    .join('\n');
}

/**
 * Gets transcript metadata (duration, participant info, etc.)
 * @param transcriptData - The transcript data
 * @returns Object with transcript metadata
 */
export function getTranscriptMetadata(transcriptData: string | ConversationTranscript | null | undefined): {
  duration?: string;
  participantCount?: number;
  hasTranscript: boolean;
} {
  if (!transcriptData || typeof transcriptData === 'string') {
    return {
      hasTranscript: typeof transcriptData === 'string' && transcriptData.trim().length > 0
    };
  }

  try {
    const transcripts = Array.isArray(transcriptData) ? transcriptData : [transcriptData];
    const firstTranscript = transcripts[0];
    
    if (!firstTranscript) {
      return { hasTranscript: false };
    }

    const durationMs = firstTranscript.duration?.milliseconds || firstTranscript.conversationDuration;
    const participantCount = firstTranscript.participants?.length || 0;
    
    return {
      duration: durationMs ? formatDuration(durationMs) : undefined,
      participantCount,
      hasTranscript: true
    };
  } catch (error) {
    console.warn('Error extracting transcript metadata:', error);
    return { hasTranscript: false };
  }
}

/**
 * Formats duration in milliseconds to a readable format
 * @param milliseconds - Duration in milliseconds
 * @returns Formatted duration string (e.g., "2:30")
 */
function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

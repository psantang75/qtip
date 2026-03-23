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
 * Extracts plain text from transcript phrases
 * @param transcriptData - The transcript data (can be string or structured object)
 * @returns Plain text string with all phrases combined
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
              const phraseTexts = transcriptItem.phrases
                .map(phrase => phrase.text)
                .filter(text => text && text.trim().length > 0);
              
              if (phraseTexts.length > 0) {
                allText.push(phraseTexts.join('\n'));
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
 * Formats transcript text for better readability
 * @param transcriptData - The transcript data
 * @returns Formatted transcript text
 */
export function formatTranscriptText(transcriptData: string | ConversationTranscript | null | undefined): string {
  const rawText = extractTranscriptText(transcriptData);
  
  if (rawText === 'No transcript available' || rawText === 'No transcript content found' || rawText === 'Error processing transcript') {
    return rawText;
  }
  
  // Basic formatting - preserve line breaks and normalize whitespace within each line
  return rawText
    .split('\n')
    .map(line => line.trim().replace(/\s+/g, ' ')) // Normalize whitespace within each line
    .filter(line => line.length > 0) // Remove empty lines
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

/**
 * Shared helper: take a list of submission-call rows (each carrying at
 * least `call_id`) and decorate them with the live PhoneSystem
 * `recordings[]` array so the UI can render an audio player even when
 * our own `calls.recording_url` column is empty.
 *
 * Genesys produces one recording file per recorded participant leg. On a
 * normal call the agent and customer legs cover the same time window (duplicate
 * audio), while a genuine transfer/hold has legs with distinct windows.
 * `getRecordingsForConversation` collapses the duplicate legs and keeps the
 * distinct ones, so the UI renders one audio player per genuinely different
 * segment — no duplicated players on ordinary calls.
 *
 * - Looks up every conversation in parallel against PhoneSystem.
 * - Failures (PhoneSystem unreachable, single ID missing) are swallowed
 *   so a submission detail page never breaks because the secondary DB
 *   is down — the call simply renders without audio.
 * - When a call has no `recording_url` stored locally but PhoneSystem
 *   has recordings, we backfill `recording_url` with the first leg's
 *   stream URL so older UI surfaces that still read the scalar field
 *   continue to work.
 */

import phoneSystemService, { type CallRecordingResponse } from './PhoneSystemService'
import logger from '../config/logger'

type CallLike = {
  call_id?: string | null
  recording_url?: string | null
  recordings?: CallRecordingResponse[]
  [key: string]: unknown
}

export async function attachPhoneSystemRecordings<T extends CallLike>(calls: T[]): Promise<T[]> {
  if (!calls || calls.length === 0) return calls

  await Promise.all(
    calls.map(async (call) => {
      const convId = (call.call_id ?? '').trim()
      if (!convId) return
      try {
        const legs = await phoneSystemService.getRecordingsForConversation(convId)
        call.recordings = legs
        if (!call.recording_url && legs.length > 0) {
          call.recording_url = legs[0].audio_url
        }
      } catch (error) {
        logger.warn(`[CALL ENRICHMENT] PhoneSystem lookup failed for conversation ${convId}:`, error)
      }
    }),
  )

  return calls
}

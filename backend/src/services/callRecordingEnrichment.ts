/**
 * Shared helper: take a list of submission-call rows (each carrying at
 * least `call_id`) and decorate them with the live PhoneSystem
 * `recordings[]` array so the UI can render an audio player even when
 * our own `calls.recording_url` column is empty.
 *
 * Genesys typically produces multiple recording files per conversation
 * (one per communication leg — e.g. an IVR/queue leg and the agent
 * leg). ~87% of conversations have exactly two. For QA review we only
 * care about the agent conversation, which is always the most recent
 * recording (`CreatedOn DESC`, so index 0). We therefore drop the
 * earlier legs at the enrichment boundary so no downstream consumer
 * has to worry about it.
 *
 * - Looks up every conversation in parallel against PhoneSystem.
 * - Failures (PhoneSystem unreachable, single ID missing) are swallowed
 *   so a submission detail page never breaks because the secondary DB
 *   is down — the call simply renders without audio.
 * - When a call has no `recording_url` stored locally but PhoneSystem
 *   has the agent leg, we backfill `recording_url` with that leg's
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
        const allRecordings = await phoneSystemService.getRecordingsForConversation(convId)
        const agentLeg = allRecordings.length > 0 ? [allRecordings[0]] : []
        call.recordings = agentLeg
        if (!call.recording_url && agentLeg.length > 0) {
          call.recording_url = agentLeg[0].audio_url
        }
      } catch (error) {
        logger.warn(`[CALL ENRICHMENT] PhoneSystem lookup failed for conversation ${convId}:`, error)
      }
    }),
  )

  return calls
}

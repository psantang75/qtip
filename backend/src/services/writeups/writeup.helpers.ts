/**
 * Pure helpers shared across the writeups domain.
 *
 * Absorbs the contents of the old `services/writeup.service.ts` (97 lines —
 * `splitSep`, `insertIncidents`, `shapePriorDiscipline`) plus the
 * `toIntArray` and `replaceWriteUpListItems` helpers that used to live
 * inline in `controllers/writeup.controller.ts`. Consolidated here during
 * the pre-production review (item #29) so the create / update / internal-
 * notes paths share one definition.
 */

import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import type { IncidentInput } from './writeup.types'

type PrismaTx = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

/** Splits a `~|~`-joined GROUP_CONCAT column into a string array. */
export const splitSep = (val: string | null): string[] =>
  val ? val.split('~|~').filter(Boolean) : []

/**
 * Coerces a request value (array, comma-joined string, or undefined) into
 * a positive-integer array. Used to normalise incoming list-item id payloads.
 */
export const toIntArray = (v: unknown): number[] => {
  if (Array.isArray(v)) return v.map(Number).filter(n => Number.isFinite(n) && n > 0)
  if (typeof v === 'string') return v.split(',').map(Number).filter(n => Number.isFinite(n) && n > 0)
  return []
}

/**
 * Insert nested incident -> violation -> example rows within a Prisma
 * transaction. Hot path for create + update; pulled out so both callers
 * write one row set with one definition.
 */
export async function insertIncidents(
  tx: PrismaTx,
  writeUpId: number,
  incidents: IncidentInput[],
): Promise<void> {
  for (const inc of incidents) {
    const incident = await tx.writeUpIncident.create({
      data: {
        write_up_id: writeUpId,
        description: inc.description,
        sort_order:  inc.sort_order ?? 0,
      },
    })
    for (const viol of (inc.violations ?? [])) {
      const violation = await tx.writeUpViolation.create({
        data: {
          incident_id:        incident.id,
          policy_violated:    viol.policy_violated,
          reference_material: viol.reference_material ?? null,
          sort_order:         viol.sort_order ?? 0,
        },
      })
      for (const ex of (viol.examples ?? [])) {
        await tx.writeUpExample.create({
          data: {
            violation_id:     violation.id,
            example_date:     ex.example_date ? new Date(ex.example_date) : null,
            description:      ex.description,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            source:           (ex.source as any) ?? 'MANUAL',
            qa_submission_id: ex.qa_submission_id ?? null,
            qa_question_id:   ex.qa_question_id ?? null,
            sort_order:       ex.sort_order ?? 0,
          },
        })
      }
    }
  }
}

/**
 * Replace the list-item rows (behavior_flag / root_cause / support_needed)
 * for a write-up. Caller passes the already-flattened, deduped id list; we
 * delete-then-insert in a single transaction step.
 */
export async function replaceWriteUpListItems(
  tx: Prisma.TransactionClient,
  writeUpId: number,
  listItemIds: number[],
): Promise<void> {
  await tx.$executeRaw(Prisma.sql`DELETE FROM write_up_list_items WHERE write_up_id = ${writeUpId}`)
  if (!listItemIds.length) return
  const values = Prisma.join(listItemIds.map(id => Prisma.sql`(${writeUpId}, ${id})`))
  await tx.$executeRaw(Prisma.sql`INSERT INTO write_up_list_items (write_up_id, list_item_id) VALUES ${values}`)
}

/**
 * Shape raw prior-discipline query rows into the domain response format.
 * Used by both the detail endpoint (single write-up) and the standalone
 * prior-discipline lookup so they emit the same envelope.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function shapePriorDiscipline(rows: any[]) {
  return rows.map(pd => ({
    reference_type: pd.reference_type,
    reference_id:   Number(pd.reference_id),
    ...(pd.reference_type === 'write_up' ? {
      document_type:         pd.document_type,
      status:                pd.wu_status,
      date:                  pd.meeting_date,
      policies_violated:     splitSep(pd.policies_violated),
      incident_descriptions: splitSep(pd.incident_descriptions),
    } : {
      coaching_purpose: pd.coaching_purpose,
      status:           pd.cs_status,
      date:             pd.session_date,
      notes:            pd.cs_notes,
      topic_names:      splitSep(pd.topic_names),
    }),
  }))
}

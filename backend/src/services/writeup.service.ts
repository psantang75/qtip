import prisma from '../config/prisma'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExampleInput {
  example_date?: string
  description: string
  source?: string
  qa_submission_id?: number
  qa_question_id?: number
  sort_order?: number
}

export interface ViolationInput {
  policy_violated: string
  reference_material?: string
  sort_order?: number
  examples?: ExampleInput[]
}

export interface IncidentInput {
  description: string
  sort_order?: number
  violations?: ViolationInput[]
}

type PrismaTx = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

// ── Helpers ───────────────────────────────────────────────────────────────────

export const splitSep = (val: string | null): string[] =>
  val ? val.split('~|~').filter(Boolean) : []

/**
 * Insert nested incident → violation → example rows within a Prisma transaction.
 */
export async function insertIncidents(
  tx: PrismaTx,
  writeUpId: number,
  incidents: IncidentInput[],
) {
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
 * Shape raw prior-discipline query rows into the domain response format.
 */
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

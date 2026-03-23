import prisma from '../config/prisma';

export type DisputeScoreType = 'PREVIOUS' | 'ADJUSTED';

export interface DisputeScoreHistoryRecord {
  id: number;
  dispute_id: number;
  submission_id: number;
  score_type: DisputeScoreType;
  score: number;
  recorded_by: number | null;
  notes: string | null;
  created_at: Date;
}

interface RecordDisputeScoreParams {
  disputeId: number;
  submissionId: number;
  scoreType: DisputeScoreType;
  score: number;
  recordedBy?: number | null;
  notes?: string | null;
}

export async function recordDisputeScore(
  _connection: any,
  params: RecordDisputeScoreParams
): Promise<void> {
  await prisma.disputeScoreHistory.create({
    data: {
      dispute_id: params.disputeId,
      submission_id: params.submissionId,
      score_type: params.scoreType as any,
      score: params.score,
      recorded_by: params.recordedBy ?? null,
      notes: params.notes ?? null,
    },
  });
}

export async function getDisputeScoreHistory(
  _connection: any,
  disputeId: number
): Promise<DisputeScoreHistoryRecord[]> {
  const rows = await prisma.disputeScoreHistory.findMany({
    where: { dispute_id: disputeId },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
  });

  return rows.map((r) => ({
    id: r.id,
    dispute_id: r.dispute_id,
    submission_id: r.submission_id,
    score_type: r.score_type as DisputeScoreType,
    score: Number(r.score),
    recorded_by: r.recorded_by,
    notes: r.notes,
    created_at: r.created_at,
  }));
}

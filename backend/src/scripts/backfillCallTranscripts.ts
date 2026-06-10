import pool from '../config/database';
import phoneSystemService from '../services/PhoneSystemService';
import { RowDataPacket } from 'mysql2';

/**
 * Backfill `calls.transcript` with raw Genesys JSON for rows that were
 * stored via the legacy ingest paths (HTML-wrapped speaker labels or
 * plain `Agent: text`). After commit unifying `formatTranscripts()` in
 * `calls.routes.ts`, all new submissions store raw JSON so the
 * frontend can render per-turn `[m:ss]` timestamps. This one-off fills
 * in the gap for pre-existing rows.
 *
 * Re-pulls the raw JSON from `tblConversationTranscript` in the Phone
 * DB by `call_id` (the Genesys conversation UUID). Rows whose
 * conversation has aged out of PhoneSystem are reported as MISSING and
 * left untouched.
 *
 * Usage:
 *   ts-node backend/src/scripts/backfillCallTranscripts.ts            # dry-run
 *   ts-node backend/src/scripts/backfillCallTranscripts.ts --confirm  # write
 *   ts-node backend/src/scripts/backfillCallTranscripts.ts --confirm --limit 50
 */

interface CallRow extends RowDataPacket {
  id: number;
  call_id: string;
  transcript_head: string;
  transcript_len: number;
}

const BATCH_SIZE = 25;

async function backfill(opts: { dryRun: boolean; limit: number | null }): Promise<void> {
  const { dryRun, limit } = opts;

  console.log('========================================');
  console.log('CALL TRANSCRIPT BACKFILL');
  console.log('========================================');
  console.log(`Mode:  ${dryRun ? 'DRY RUN (no DB writes)' : 'LIVE RUN (will UPDATE calls.transcript)'}`);
  console.log(`Limit: ${limit ?? 'none'}`);
  console.log('');

  if (!dryRun) {
    console.log('⚠️  This will overwrite calls.transcript for matched rows.');
    console.log('Press Ctrl+C now to cancel...');
    await new Promise((r) => setTimeout(r, 5000));
    console.log('');
  }

  const limitClause = limit ? `LIMIT ${limit}` : '';
  const [rows] = await pool.execute<CallRow[]>(
    `SELECT id,
            call_id,
            LEFT(transcript, 60) AS transcript_head,
            CHAR_LENGTH(transcript) AS transcript_len
     FROM calls
     WHERE call_id IS NOT NULL
       AND call_id <> ''
       AND transcript IS NOT NULL
       AND transcript <> ''
       AND transcript NOT LIKE '{%'
     ORDER BY id DESC
     ${limitClause}`
  );

  console.log(`Found ${rows.length} candidate row(s) (non-JSON, with call_id).`);
  if (rows.length === 0) {
    console.log('Nothing to do.');
    await pool.end();
    return;
  }

  let updated = 0;
  let missing = 0;
  let skipped = 0;
  let errored = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    console.log(`\n--- Batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} row(s), starting at index ${i}) ---`);

    for (const row of batch) {
      try {
        const transcripts = await phoneSystemService.getTranscriptByConversationId(row.call_id);

        if (!transcripts || transcripts.length === 0) {
          missing++;
          console.log(`  [MISSING] id=${row.id} call_id=${row.call_id}`);
          continue;
        }

        let newTranscript: string;
        if (transcripts.length === 1) {
          newTranscript = transcripts[0].transcript;
        } else {
          try {
            newTranscript = JSON.stringify(transcripts.map((t) => JSON.parse(t.transcript)));
          } catch {
            console.log(`  [SKIP] id=${row.id} call_id=${row.call_id} multi-leg parse failed`);
            skipped++;
            continue;
          }
        }

        if (!newTranscript || !newTranscript.trim()) {
          missing++;
          console.log(`  [EMPTY] id=${row.id} call_id=${row.call_id}`);
          continue;
        }

        if (dryRun) {
          console.log(`  [WOULD UPDATE] id=${row.id} call_id=${row.call_id} old=${row.transcript_len}ch new=${newTranscript.length}ch`);
          updated++;
        } else {
          await pool.execute(`UPDATE calls SET transcript = ? WHERE id = ?`, [newTranscript, row.id]);
          console.log(`  [UPDATED] id=${row.id} call_id=${row.call_id} old=${row.transcript_len}ch new=${newTranscript.length}ch`);
          updated++;
        }
      } catch (err) {
        errored++;
        console.error(`  [ERROR] id=${row.id} call_id=${row.call_id}:`, (err as Error).message);
      }
    }
  }

  console.log('\n========================================');
  console.log('SUMMARY');
  console.log('========================================');
  console.log(`Candidates: ${rows.length}`);
  console.log(`${dryRun ? 'Would update' : 'Updated'}:   ${updated}`);
  console.log(`Missing in PhoneSystem: ${missing}`);
  console.log(`Skipped:    ${skipped}`);
  console.log(`Errored:    ${errored}`);

  await pool.end();
}

const args = process.argv.slice(2);
const dryRun = !args.includes('--confirm');
const limitArgIdx = args.indexOf('--limit');
const limit = limitArgIdx >= 0 && args[limitArgIdx + 1] ? parseInt(args[limitArgIdx + 1], 10) : null;

backfill({ dryRun, limit: Number.isFinite(limit as number) ? (limit as number) : null })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });

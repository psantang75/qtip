/**
 * Pull a handful of real ConversationIDs from PhoneSystem that have a
 * transcript attached, so we can test the QA add-call flow end-to-end.
 *
 * Usage (from backend/):
 *   npx ts-node scripts/sample-conversations.ts
 */

import { getDatabasePool } from '../src/config/database';

async function main(): Promise<void> {
  const pool = getDatabasePool('phone');
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<any[]>(
      `SELECT t.ConversationID, t.RequestDate, c.ConversationStart_ET,
              CHAR_LENGTH(t.Transcript) AS transcript_chars
         FROM tblConversationTranscript t
         LEFT JOIN tblConversations c ON c.ConversationId = t.ConversationID
        WHERE t.Transcript IS NOT NULL
          AND CHAR_LENGTH(t.Transcript) > 200
        ORDER BY t.RequestDate DESC
        LIMIT 10`
    );

    if (rows.length === 0) {
      console.log('No transcripts found.');
      return;
    }

    console.log('Recent conversations with transcripts:\n');
    console.log('ConversationID'.padEnd(40), 'Call Date (ET)'.padEnd(22), 'Transcript size');
    console.log('-'.repeat(85));
    for (const r of rows) {
      const id = String(r.ConversationID).padEnd(40);
      const date = r.ConversationStart_ET
        ? new Date(r.ConversationStart_ET).toISOString().slice(0, 19).replace('T', ' ').padEnd(22)
        : '(unknown)'.padEnd(22);
      console.log(id, date, `${r.transcript_chars} chars`);
    }
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Sample query failed:', err);
  process.exit(1);
});

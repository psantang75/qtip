/**
 * One-off: export sales calls for Fri 5/22/2026 - Tue 5/26/2026 for the
 * 5 named CSRs into a single markdown file (transcript + AI summary per call).
 * Side project; folder `transcripts/` at workspace root, safe to delete.
 *
 * Run with:  npx tsx backend/src/scripts/exportRecentCallFixtures.ts
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import mysql from 'mysql2/promise';

dotenv.config({ path: path.join(__dirname, '../../.env') });

import { getOpenAIClient, isOpenAIConfigured } from '../services/ai/OpenAIClient';

const AGENTS: Array<{ name: string; phoneUserId: string }> = [
  { name: 'Jamie Waldie',        phoneUserId: '5c8a8ba7-31d3-4a64-924d-3d854e71023d' },
  { name: 'Megan Foti',          phoneUserId: 'f4a369ff-ba0a-4220-8086-bbace57843f9' },
  { name: 'Mitchell Stempowski', phoneUserId: '449815a1-66c4-4b2d-8dc1-d70581bc1bd1' },
  { name: 'Steven Selley',       phoneUserId: '7c12c2b1-c24a-4032-96b5-b0eda5627165' },
  { name: 'Vince Deleon',        phoneUserId: 'aa496cef-7c15-4bed-bfc0-ea194b4062b8' },
];

const RANGE_START = '2026-05-22 00:00:00';
const RANGE_END   = '2026-05-27 00:00:00';
const MIN_SECONDS = 120;
const MAX_SECONDS = 600;

interface CallRow {
  ConversationId: string;
  Start_ET: Date;
  Duration: number;
  Transcript: string | null;
}

function fmtLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function fetchCallsForAgent(
  conn: mysql.Connection,
  phoneUserId: string
): Promise<CallRow[]> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `
    SELECT
      c.ConversationId,
      c.ConversationStart_ET AS Start_ET,
      TIMESTAMPDIFF(SECOND, c.ConversationStart_ET, c.ConversationEnd_ET) AS Duration,
      t.Transcript
    FROM tblConversations c
    JOIN tblParticipants p ON p.ConversationId = c.ConversationId
    JOIN tblConversationTranscript t ON t.ConversationID = c.ConversationId
    WHERE c.ConversationStart_ET >= ?
      AND c.ConversationStart_ET <  ?
      AND p.UserId = ?
      AND t.Transcript IS NOT NULL
      AND t.Transcript <> ''
      AND TIMESTAMPDIFF(SECOND, c.ConversationStart_ET, c.ConversationEnd_ET) BETWEEN ? AND ?
    ORDER BY c.ConversationStart_ET ASC
    `,
    [RANGE_START, RANGE_END, phoneUserId, MIN_SECONDS, MAX_SECONDS]
  );
  return rows as unknown as CallRow[];
}

async function summarizeCall(transcript: string, agentName: string): Promise<string> {
  const client = getOpenAIClient();
  const model = process.env.OPENAI_DEFAULT_MODEL || 'gpt-5';
  const capped = transcript.length > 12000 ? transcript.slice(0, 12000) + '\n...[truncated for summary]' : transcript;
  const resp = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content:
          'You summarize customer service phone-call transcripts for a QA reviewer. ' +
          'Be concrete and neutral. No opinions, no scoring. 3-6 sentences.',
      },
      {
        role: 'user',
        content:
          `Agent: ${agentName}\n` +
          `Summarize this call. Cover: customer's reason for calling, key actions the agent took, outcome, and any unresolved follow-up.\n\n` +
          `Transcript:\n${capped}`,
      },
    ],
  });
  return resp.choices[0]?.message?.content?.trim() ?? '(summary unavailable)';
}

function buildMarkdown(
  perAgent: Map<string, Array<CallRow & { summary: string }>>
): string {
  const lines: string[] = [];
  lines.push('# Sales Calls: Fri 2026-05-22 - Tue 2026-05-26');
  lines.push('');
  lines.push('Source: PhoneSystem DB (`tblConversations` + `tblConversationTranscript`).');
  lines.push('Filter: 2026-05-22 through 2026-05-26 (ET), duration 2-10 minutes, transcript present. All matching calls included.');
  lines.push('');
  lines.push('## Index');
  lines.push('');
  for (const agent of AGENTS) {
    const rows = perAgent.get(agent.name) ?? [];
    lines.push(`- [${agent.name}](#${agent.name.toLowerCase().replace(/\s+/g, '-')}) (${rows.length})`);
  }
  lines.push('');

  for (const agent of AGENTS) {
    const rows = perAgent.get(agent.name) ?? [];
    lines.push(`## ${agent.name}`);
    lines.push('');
    if (rows.length === 0) {
      lines.push('_No calls matched the filter._');
      lines.push('');
      continue;
    }
    rows.forEach((row, idx) => {
      lines.push(`### ${idx + 1}. ${fmtLocal(row.Start_ET)} ET - ${fmtDuration(row.Duration)}`);
      lines.push('');
      lines.push(`- **Conversation ID:** \`${row.ConversationId}\``);
      lines.push(`- **Agent:** ${agent.name}`);
      lines.push(`- **Duration:** ${fmtDuration(row.Duration)} (${row.Duration}s)`);
      lines.push('');
      lines.push('**Summary**');
      lines.push('');
      lines.push(row.summary);
      lines.push('');
      lines.push('**Transcript**');
      lines.push('');
      lines.push('```text');
      lines.push((row.Transcript ?? '').replace(/```/g, '`\u200b``'));
      lines.push('```');
      lines.push('');
    });
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  if (!isOpenAIConfigured()) {
    throw new Error('OPENAI_API_KEY is not set; cannot generate summaries.');
  }

  const phoneConn = await mysql.createConnection({
    host: process.env.PHONE_DB_HOST,
    port: Number(process.env.PHONE_DB_PORT ?? 3306),
    user: process.env.PHONE_DB_USER,
    password: process.env.PHONE_DB_PASSWORD,
    database: process.env.PHONE_DB_NAME,
    dateStrings: false,
  });

  console.log('[fixtures] connected to PhoneSystem DB');

  const perAgent = new Map<string, Array<CallRow & { summary: string }>>();
  let totalPicked = 0;

  for (const agent of AGENTS) {
    process.stdout.write(`[fixtures] ${agent.name}: querying... `);
    const rows = await fetchCallsForAgent(phoneConn, agent.phoneUserId);
    console.log(`${rows.length} calls`);
    perAgent.set(agent.name, rows.map((r) => ({ ...r, summary: '' })));
    totalPicked += rows.length;
  }

  await phoneConn.end();
  console.log(`[fixtures] phone DB closed; generating ${totalPicked} summaries via OpenAI...`);

  let done = 0;
  for (const agent of AGENTS) {
    const rows = perAgent.get(agent.name)!;
    for (const row of rows) {
      try {
        row.summary = await summarizeCall(row.Transcript ?? '', agent.name);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[fixtures] summary failed for ${row.ConversationId}: ${msg}`);
        row.summary = `(summary failed: ${msg})`;
      }
      done += 1;
      if (done % 5 === 0 || done === totalPicked) {
        console.log(`[fixtures] summaries: ${done}/${totalPicked}`);
      }
    }
  }

  const outDir = path.join(__dirname, '../../../transcripts');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'sales-calls-2026-05-22_to_2026-05-26.md');
  fs.writeFileSync(outPath, buildMarkdown(perAgent), 'utf8');
  console.log(`[fixtures] wrote ${outPath}`);
}

main().catch((err) => {
  console.error('[fixtures] fatal:', err);
  process.exit(1);
});

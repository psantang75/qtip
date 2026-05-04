/**
 * AI Reviewer dual-provider comparison CLI.
 *
 * Runs the analysis pipeline (load form, load CRM material, KB grounding,
 * LLM call, parse, validate) against the SAME tickets through BOTH the
 * Anthropic and OpenAI providers, side-by-side, WITHOUT writing any
 * submissions to the qtip database. Emits a markdown report to stdout
 * and to backend/tmp/ai-compare-<timestamp>.md.
 *
 * Usage (from backend/):
 *   npx ts-node scripts/ai-compare.ts <ticket_id> [<ticket_id>...] [--form-id <id>]
 *
 * Tickets are run sequentially per provider so the BookStack KB calls
 * don't dogpile. Both providers see the same prompt — any answer or
 * narrative differences are model-driven, not prompt-driven.
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import prisma from '../src/config/prisma';
import { aiConfig } from '../src/config/environment';
import aiReviewerService, {
  AIReviewerServiceError,
  type AIAnalysisResult,
  type AiProvider,
} from '../src/services/AIReviewerService';

interface Args {
  ticketIds: number[];
  formId?: number;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let formId: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '--form-id') {
      const v = argv[++i];
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) throw new Error(`--form-id must be a positive integer, got "${v}"`);
      formId = n;
    } else if (tok === '--help' || tok === '-h') {
      console.log('Usage: npx ts-node scripts/ai-compare.ts <ticket_id> [<ticket_id>...] [--form-id <id>]');
      process.exit(0);
    } else {
      positional.push(tok);
    }
  }
  if (positional.length === 0) {
    console.log('Usage: npx ts-node scripts/ai-compare.ts <ticket_id> [<ticket_id>...] [--form-id <id>]');
    process.exit(2);
  }
  const ticketIds = positional.map((p) => {
    const n = Number(p);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`ticket_id must be a positive integer, got "${p}"`);
    return n;
  });
  return { ticketIds, formId };
}

async function resolveFormId(args: Args): Promise<number> {
  if (args.formId) {
    const exists = await prisma.form.findUnique({ where: { id: args.formId }, select: { id: true } });
    if (!exists) throw new Error(`form_id ${args.formId} not found`);
    return args.formId;
  }
  const candidates = await prisma.form.findMany({
    where: { is_active: true, ai_enabled: true } as any,
    orderBy: { id: 'desc' },
    select: { id: true, form_name: true },
  });
  if (candidates.length === 0) throw new Error('No active AI-enabled forms exist.');
  if (candidates.length > 1) {
    console.error('Multiple AI-enabled forms exist; pass --form-id <id> to disambiguate:');
    for (const c of candidates) console.error(`  - id=${c.id} name="${c.form_name}"`);
    throw new Error('Ambiguous form selection');
  }
  return candidates[0].id;
}

interface PerTicketResult {
  ticketId: number;
  subclass: string;
  resolution: string;
  anthropic: AIAnalysisResult | { error: string };
  openai: AIAnalysisResult | { error: string };
}

async function runOne(ticketId: number, formId: number, provider: AiProvider): Promise<AIAnalysisResult | { error: string }> {
  try {
    return await aiReviewerService.analyzeTicket(ticketId, { formId, provider });
  } catch (err) {
    if (err instanceof AIReviewerServiceError) return { error: `[${err.code}] ${err.message}` };
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function fmtAnswer(value: string): string {
  return value.length > 80 ? value.slice(0, 77) + '...' : value;
}

function renderTicketSection(r: PerTicketResult): string {
  const lines: string[] = [];
  lines.push(`## Ticket ${r.ticketId} — ${r.subclass}`);
  lines.push(`Resolution: \`${r.resolution}\``);
  lines.push('');

  if ('error' in r.anthropic && 'error' in r.openai) {
    lines.push(`Both providers failed:`);
    lines.push(`- anthropic: ${r.anthropic.error}`);
    lines.push(`- openai: ${r.openai.error}`);
    lines.push('');
    return lines.join('\n');
  }

  // Header — only useful info, just enough to anchor the reader
  const header = !('error' in r.anthropic) ? r.anthropic.header : !('error' in r.openai) ? r.openai.header : {};
  lines.push(`Notes: ${!('error' in r.anthropic) ? r.anthropic.notesCount : '?'} · Customer: ${header['Customer ID'] ?? '?'} · Class: ${header['Class'] ?? '?'}/${header['Subclass'] ?? '?'}`);
  lines.push('');

  // KB pages provided to each model (should be identical — same searchKb)
  const kbAnt = !('error' in r.anthropic) ? r.anthropic.kbPagesProvided : [];
  const kbOpenAi = !('error' in r.openai) ? r.openai.kbPagesProvided : [];
  lines.push(`**KB pages provided to both** (same retrieval for both providers):`);
  for (const p of kbAnt.length >= kbOpenAi.length ? kbAnt : kbOpenAi) {
    const tag = p.is_playbook ? 'PLAYBOOK' : 'search';
    lines.push(`  - [${p.id}] (${tag}) ${p.name}`);
  }
  lines.push('');

  // Per-question side-by-side
  const ans = (x: AIAnalysisResult | { error: string }) => ('error' in x ? null : x);
  const a = ans(r.anthropic);
  const o = ans(r.openai);

  if (a && o) {
    lines.push('**Per-question answers**');
    lines.push('');
    lines.push('| Question | Anthropic | OpenAI | Agree |');
    lines.push('|---|---|---|---|');
    const allQids = Array.from(new Set([...a.answers.map((x) => x.question_id), ...o.answers.map((x) => x.question_id)]));
    for (const qid of allQids) {
      const aAns = a.answers.find((x) => x.question_id === qid);
      const oAns = o.answers.find((x) => x.question_id === qid);
      const text = (aAns ?? oAns)?.question_text ?? `(qid ${qid})`;
      const aVal = aAns ? aAns.value : '—';
      const oVal = oAns ? oAns.value : '—';
      const agree = aVal.toLowerCase() === oVal.toLowerCase() ? 'YES' : 'no';
      lines.push(`| ${text.replace(/\|/g, '\\|')} | ${fmtAnswer(aVal)} | ${fmtAnswer(oVal)} | ${agree} |`);
    }
    lines.push('');

    lines.push(`**Anthropic narrative** (${a.model}, ${(a.elapsedMs / 1000).toFixed(1)}s${a.retried ? ', retried' : ''}):`);
    lines.push('> ' + a.narrative.replace(/\n/g, '\n> '));
    lines.push('');
    lines.push(`**OpenAI narrative** (${o.model}, ${(o.elapsedMs / 1000).toFixed(1)}s${o.retried ? ', retried' : ''}):`);
    lines.push('> ' + o.narrative.replace(/\n/g, '\n> '));
    lines.push('');

    lines.push('**KB citations**');
    lines.push(`- Anthropic: ${a.kbCitations.length === 0 ? '(none)' : a.kbCitations.map((c) => `[${c.id}] ${c.name}`).join('; ')}`);
    lines.push(`- OpenAI: ${o.kbCitations.length === 0 ? '(none)' : o.kbCitations.map((c) => `[${c.id}] ${c.name}`).join('; ')}`);
    lines.push('');
  } else {
    if (a) {
      lines.push('**Anthropic ran successfully:**');
      lines.push(`> ${a.narrative.replace(/\n/g, '\n> ')}`);
    }
    if (o) {
      lines.push('**OpenAI ran successfully:**');
      lines.push(`> ${o.narrative.replace(/\n/g, '\n> ')}`);
    }
    if ('error' in r.anthropic) lines.push(`Anthropic FAILED: ${r.anthropic.error}`);
    if ('error' in r.openai) lines.push(`OpenAI FAILED: ${r.openai.error}`);
    lines.push('');
  }

  return lines.join('\n');
}

function renderSummary(results: PerTicketResult[]): string {
  const lines: string[] = [];
  let bothOk = 0;
  let agreeAll = 0;
  let agreeMost = 0;
  let totalAns = 0;
  let totalAgree = 0;
  let antElapsed = 0;
  let oaElapsed = 0;
  let antRetries = 0;
  let oaRetries = 0;

  lines.push('## Summary');
  lines.push('');
  lines.push('| Ticket | Subclass | Both ran | Answers agree | Ant time | OA time | Ant retried | OA retried |');
  lines.push('|---|---|---|---|---|---|---|---|');

  for (const r of results) {
    const a = 'error' in r.anthropic ? null : r.anthropic;
    const o = 'error' in r.openai ? null : r.openai;
    if (a && o) {
      bothOk++;
      const allQids = Array.from(new Set([...a.answers.map((x) => x.question_id), ...o.answers.map((x) => x.question_id)]));
      const agreeCount = allQids.filter((qid) => {
        const aV = a.answers.find((x) => x.question_id === qid)?.value?.toLowerCase();
        const oV = o.answers.find((x) => x.question_id === qid)?.value?.toLowerCase();
        return aV !== undefined && oV !== undefined && aV === oV;
      }).length;
      totalAns += allQids.length;
      totalAgree += agreeCount;
      antElapsed += a.elapsedMs;
      oaElapsed += o.elapsedMs;
      if (a.retried) antRetries++;
      if (o.retried) oaRetries++;
      if (agreeCount === allQids.length) agreeAll++;
      else if (agreeCount >= allQids.length - 1) agreeMost++;
      lines.push(
        `| ${r.ticketId} | ${r.subclass} | yes | ${agreeCount}/${allQids.length} | ${(a.elapsedMs / 1000).toFixed(1)}s | ${(o.elapsedMs / 1000).toFixed(1)}s | ${a.retried ? 'yes' : 'no'} | ${o.retried ? 'yes' : 'no'} |`
      );
    } else {
      lines.push(
        `| ${r.ticketId} | ${r.subclass} | no | — | ${a ? `${(a.elapsedMs / 1000).toFixed(1)}s` : 'FAIL'} | ${o ? `${(o.elapsedMs / 1000).toFixed(1)}s` : 'FAIL'} | — | — |`
      );
    }
  }
  lines.push('');
  lines.push(`- Tickets where both providers ran: **${bothOk}/${results.length}**`);
  lines.push(`- Tickets with full answer agreement: **${agreeAll}/${bothOk}**`);
  lines.push(`- Tickets agreeing on all-but-one answer: **${agreeMost}/${bothOk}**`);
  if (totalAns > 0) {
    const pct = ((totalAgree / totalAns) * 100).toFixed(1);
    lines.push(`- Per-question agreement rate: **${totalAgree}/${totalAns} (${pct}%)**`);
  }
  if (bothOk > 0) {
    lines.push(`- Avg latency — Anthropic: **${(antElapsed / bothOk / 1000).toFixed(1)}s** · OpenAI: **${(oaElapsed / bothOk / 1000).toFixed(1)}s**`);
    lines.push(`- JSON-retry count — Anthropic: **${antRetries}** · OpenAI: **${oaRetries}**`);
  }
  lines.push('');
  return lines.join('\n');
}

async function getTicketMeta(ticketId: number): Promise<{ subclass: string; resolution: string }> {
  const { executeQuery } = await import('../src/utils/databaseUtils');
  const rows = await executeQuery<{ subclass: string | null; resolution: string | null }>(
    `SELECT tc.ClassificationName AS subclass, tr.ResolutionText AS resolution
     FROM tblTicket t
     LEFT JOIN tblTicketClassification tc ON tc.ClassificationID = t.ClassificationID
     LEFT JOIN tblTicketResolution tr ON tr.ResolutionID = t.ResolutionID
     WHERE t.TicketID = ? LIMIT 1`,
    [ticketId],
    'crm'
  );
  return { subclass: rows[0]?.subclass ?? '(unknown)', resolution: rows[0]?.resolution ?? '(unknown)' };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const formId = await resolveFormId(args);

  console.error(`--- AI Reviewer COMPARISON ---`);
  console.error(`form_id  : ${formId}`);
  console.error(`tickets  : ${args.ticketIds.join(', ')}`);
  console.error(`providers: anthropic, openai`);
  console.error('');

  const results: PerTicketResult[] = [];
  for (const ticketId of args.ticketIds) {
    process.stderr.write(`[${ticketId}] meta...`);
    const meta = await getTicketMeta(ticketId);
    process.stderr.write(` anthropic...`);
    const anthropic = await runOne(ticketId, formId, 'anthropic');
    process.stderr.write(` openai...`);
    const openai = await runOne(ticketId, formId, 'openai');
    process.stderr.write(' done\n');
    results.push({ ticketId, subclass: meta.subclass, resolution: meta.resolution, anthropic, openai });
  }

  const headerBlock = [
    `# AI Reviewer Provider Comparison`,
    ``,
    `Generated: ${new Date().toISOString()}`,
    `Form: ${formId}`,
    `Tickets: ${args.ticketIds.join(', ')}`,
    `Providers: anthropic (${aiConfig.anthropic?.defaultModel ?? 'unconfigured'}) vs openai (${aiConfig.openai?.defaultModel ?? 'unconfigured'})`,
    ``,
    `Both providers receive the IDENTICAL prompt (same form, same notes, same KB pages). Any differences below are purely model-driven.`,
    ``,
  ].join('\n');

  const summary = renderSummary(results);
  const sections = results.map(renderTicketSection).join('\n---\n\n');
  const report = `${headerBlock}${summary}---\n\n${sections}`;

  const outDir = path.join(process.cwd(), 'tmp');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(outDir, `ai-compare-${stamp}.md`);
  fs.writeFileSync(outFile, report, 'utf8');

  console.log(report);
  console.error(`\n[wrote ${outFile}]`);
}

main()
  .catch((err) => {
    console.error('FAIL:', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

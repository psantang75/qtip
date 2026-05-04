/**
 * AI Reviewer CLI — runs an AI audit submission against a single closed
 * ticket using the same pipeline the HTTP endpoint uses, with no auth /
 * cookie / browser plumbing required.
 *
 * Usage (from backend/):
 *   npx ts-node scripts/ai-review.ts <ticket_id>                  # auto-pick the only AI-enabled form
 *   npx ts-node scripts/ai-review.ts <ticket_id> --form-id 99015  # pin a specific form
 *   npx ts-node scripts/ai-review.ts <ticket_id> --form "Tech Ticket Review - ..."  # by name
 *
 * Exits non-zero on any failure (validation, KB, LLM, submission). On
 * success prints the submission_id, total_score, model, and KB citations
 * so you can compare against your manual verdict in the existing
 * Submission Detail page.
 */

import 'dotenv/config';
import prisma from '../src/config/prisma';
import aiReviewerService, { AIReviewerServiceError } from '../src/services/AIReviewerService';

interface Args {
  ticketId: number;
  formId?: number;
  formName?: string;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let formId: number | undefined;
  let formName: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '--form-id') {
      const v = argv[++i];
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) throw new Error(`--form-id must be a positive integer, got "${v}"`);
      formId = n;
    } else if (tok === '--form') {
      const v = argv[++i];
      if (!v) throw new Error('--form requires a value');
      formName = v;
    } else if (tok === '--help' || tok === '-h') {
      printUsageAndExit(0);
    } else {
      positional.push(tok);
    }
  }

  if (positional.length !== 1) {
    printUsageAndExit(positional.length === 0 ? 0 : 2);
  }
  const ticketId = Number(positional[0]);
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    throw new Error(`ticket_id must be a positive integer, got "${positional[0]}"`);
  }
  return { ticketId, formId, formName };
}

function printUsageAndExit(code: number): never {
  console.log('Usage: npx ts-node scripts/ai-review.ts <ticket_id> [--form-id <id> | --form "<name>"]');
  process.exit(code);
}

async function resolveFormId(args: Args): Promise<number> {
  if (args.formId) {
    const exists = await prisma.form.findUnique({ where: { id: args.formId }, select: { id: true, form_name: true } });
    if (!exists) throw new Error(`form_id ${args.formId} not found`);
    return args.formId;
  }
  if (args.formName) {
    const match = await prisma.form.findFirst({
      where: { form_name: args.formName, is_active: true },
      orderBy: { version: 'desc' },
      select: { id: true, form_name: true },
    });
    if (!match) throw new Error(`No active form found with name "${args.formName}"`);
    return match.id;
  }
  // Auto-pick: the single active AI-enabled form. Any ambiguity gets surfaced.
  const candidates = await prisma.form.findMany({
    where: { is_active: true, ai_enabled: true } as any,
    orderBy: { id: 'desc' },
    select: { id: true, form_name: true },
  });
  if (candidates.length === 0) {
    throw new Error('No active AI-enabled forms exist. Enable AI on a form in the form-builder, then re-run.');
  }
  if (candidates.length > 1) {
    console.error('Multiple AI-enabled forms exist; pass --form-id <id> to disambiguate:');
    for (const c of candidates) console.error(`  - id=${c.id} name="${c.form_name}"`);
    throw new Error('Ambiguous form selection');
  }
  return candidates[0].id;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const formId = await resolveFormId(args);
  const formInfo = await prisma.form.findUnique({ where: { id: formId }, select: { form_name: true, version: true } });
  console.log('--- AI Reviewer CLI ---');
  console.log(`ticket_id  : ${args.ticketId}`);
  console.log(`form_id    : ${formId}  (${formInfo?.form_name} v${formInfo?.version})`);
  console.log('');

  const startedAt = Date.now();
  try {
    const result = await aiReviewerService.reviewClosedTicket(args.ticketId, { formId });
    const elapsedMs = Date.now() - startedAt;

    console.log('--- AI verdict ---');
    console.log(`submission_id   : ${result.submission_id}`);
    console.log(`status          : ${result.status}${result.status === 'DRAFT' ? ' (awaiting human approval)' : ''}`);
    console.log(`total_score     : ${result.status === 'DRAFT' ? '(not scored — DRAFT)' : result.total_score}`);
    console.log(`ai_model        : ${result.ai_model}`);
    console.log(`elapsed         : ${(elapsedMs / 1000).toFixed(1)}s`);
    console.log('');

    if (result.kb_pages_cited.length > 0) {
      console.log('KB pages cited:');
      for (const p of result.kb_pages_cited) console.log(`  - [${p.id}] ${p.name} :: ${p.url}`);
      console.log('');
    } else {
      console.log('KB pages cited: (none)');
      console.log('');
    }

    console.log(`View it: open the Submission Detail page for submission_id=${result.submission_id}`);
  } catch (err) {
    if (err instanceof AIReviewerServiceError) {
      console.error(`FAIL [${err.code} / status ${err.statusCode}]: ${err.message}`);
    } else {
      console.error('FAIL:', err instanceof Error ? err.message : err);
    }
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error('FAIL:', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

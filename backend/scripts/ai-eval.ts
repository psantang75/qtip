/**
 * AI Reviewer evaluation CLI.
 *
 * Runs the golden eval against the live LLM providers and prints a
 * summary report to stdout. Used for ad-hoc regression checks when
 * tweaking prompts, swapping models, or adding a new KB grounding layer.
 * Same pipeline the gated vitest suite uses (see
 * backend/src/services/__tests__/ai-reviewer-eval.test.ts).
 *
 * Usage (from backend/):
 *   npx ts-node scripts/ai-eval.ts                           # anthropic only
 *   npx ts-node scripts/ai-eval.ts --providers anthropic,openai
 *   npx ts-node scripts/ai-eval.ts --golden custom-set.json
 *
 * NEVER writes a submission. Uses analyzeTicket() under the hood.
 */

import 'dotenv/config';
import * as path from 'path';
import prisma from '../src/config/prisma';
import { runEval, formatReport } from '../src/services/__tests__/ai-reviewer-golden/runEval';
import type { AiProvider } from '../src/services/AIReviewerService';

interface Args {
  providers: AiProvider[];
  goldenPath?: string;
  fromDb?: boolean;
  formId?: number;
  dbLimit?: number;
}

function parseArgs(argv: string[]): Args {
  let providers: AiProvider[] = ['anthropic'];
  let goldenPath: string | undefined;
  let fromDb = false;
  let formId: number | undefined;
  let dbLimit: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '--providers') {
      const v = argv[++i];
      if (!v) throw new Error('--providers requires a value');
      providers = v.split(',').map((s) => s.trim()) as AiProvider[];
      for (const p of providers) {
        if (p !== 'anthropic' && p !== 'openai') throw new Error(`unknown provider "${p}"`);
      }
    } else if (tok === '--golden') {
      const v = argv[++i];
      if (!v) throw new Error('--golden requires a path');
      goldenPath = path.resolve(v);
    } else if (tok === '--from-db') {
      fromDb = true;
    } else if (tok === '--form-id') {
      const v = argv[++i];
      if (!v) throw new Error('--form-id requires a value');
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) throw new Error(`--form-id must be a positive integer, got "${v}"`);
      formId = n;
    } else if (tok === '--db-limit') {
      const v = argv[++i];
      if (!v) throw new Error('--db-limit requires a value');
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) throw new Error(`--db-limit must be a positive integer, got "${v}"`);
      dbLimit = n;
    } else if (tok === '--help' || tok === '-h') {
      console.log('Usage: npx ts-node scripts/ai-eval.ts [--providers anthropic,openai] [--golden <path>] [--from-db --form-id <id> [--db-limit <n>]]');
      process.exit(0);
    }
  }
  if (fromDb && !formId) throw new Error('--from-db requires --form-id');
  return { providers, goldenPath, fromDb, formId, dbLimit };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.error(`--- AI Reviewer EVAL ---`);
  console.error(`providers: ${args.providers.join(', ')}`);
  if (args.fromDb) {
    console.error(`source:    db (form_id=${args.formId}${args.dbLimit ? `, limit=${args.dbLimit}` : ''})`);
  } else {
    console.error(`golden:    ${args.goldenPath ?? '(default)'}`);
  }
  console.error('');

  const report = await runEval({
    providers: args.providers,
    goldenPath: args.goldenPath,
    source: args.fromDb && args.formId
      ? { kind: 'db', formId: args.formId, limit: args.dbLimit }
      : undefined,
  });
  console.log(formatReport(report));

  // Exit non-zero if any provider failed the gate, so this can be wired
  // into CI gates if desired.
  const anyFail = Object.values(report.per_provider).some((p) => !p.passed);
  process.exit(anyFail ? 1 : 0);
}

main()
  .catch((err) => {
    console.error('FAIL:', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

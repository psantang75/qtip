/**
 * BookStack KB crawl + embedding refresh — Phase 4 of the AI Reviewer
 * Maturity Rollout.
 *
 * Walks every page accessible to the BookStack API token, embeds the
 * plaintext via OpenAI (text-embedding-3-small), and upserts the vectors
 * into kb_page_embeddings. Idempotent — pages whose content hash hasn't
 * changed are skipped.
 *
 * Usage (from backend/):
 *   npx ts-node scripts/kb-crawl.ts            # incremental: only re-embed changed pages
 *   npx ts-node scripts/kb-crawl.ts --force    # re-embed every page (e.g. after model swap)
 *
 * Approx cost on text-embedding-3-small: a few hundred pages = under $0.10.
 */

import 'dotenv/config';
import prisma from '../src/config/prisma';
import kbIndexService from '../src/services/KbIndexService';

interface Args {
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  let force = false;
  for (const tok of argv) {
    if (tok === '--force') force = true;
    else if (tok === '--help' || tok === '-h') {
      console.log('Usage: npx ts-node scripts/kb-crawl.ts [--force]');
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${tok}`);
      process.exit(2);
    }
  }
  return { force };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!kbIndexService.isConfigured()) {
    console.error('FAIL: KbIndexService is not configured (need OPENAI_API_KEY and BookStack creds).');
    process.exit(1);
  }
  console.error('--- KB CRAWL ---');
  console.error(`mode: ${args.force ? 'FORCE (re-embed all)' : 'incremental'}`);
  console.error('starting…');
  const summary = await kbIndexService.crawlAndIndex({ force: args.force });
  const indexedNow = await kbIndexService.count();
  console.log('Crawl complete:');
  console.log(`  pages discovered: ${summary.pages_total}`);
  console.log(`  newly embedded:   ${summary.pages_new}`);
  console.log(`  re-embedded:      ${summary.pages_updated}`);
  console.log(`  unchanged:        ${summary.pages_unchanged}`);
  console.log(`  skipped (draft/empty): ${summary.pages_skipped}`);
  console.log(`  errored:          ${summary.pages_errored}`);
  console.log(`  approx cost:      $${summary.approx_cost_usd.toFixed(4)}`);
  console.log(`  elapsed:          ${(summary.elapsed_ms / 1000).toFixed(1)}s`);
  console.log(`  index size now:   ${indexedNow} pages`);
}

main()
  .catch((err) => {
    console.error('FAIL:', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

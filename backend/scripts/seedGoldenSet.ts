/**
 * pnpm run eval:seed-golden
 *
 * One-shot backfill that runs the golden-set seeder and prints what
 * it inserted. The same logic runs on server boot and daily, but this
 * script is useful for the initial post-migration seeding pass and
 * for ad-hoc triggers after a large batch of human reviews.
 */

import 'dotenv/config';
import { runGoldenSetSeeder } from '../src/services/AIGoldenSetSeeder';

async function main(): Promise<void> {
  const result = await runGoldenSetSeeder();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('eval:seed-golden failed:', err);
  process.exit(1);
});

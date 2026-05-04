/**
 * pnpm run eval:golden -- --form <id> [--max <n>]
 *
 * Runs the golden-set eval for one form. Intended for CI gates and
 * manual smoke testing. Exits with code 1 when the run is marked
 * pass=false (so a CI pipeline can fail loudly on a regression).
 *
 * Examples:
 *   pnpm run eval:golden -- --form 12
 *   pnpm run eval:golden -- --form 12 --max 25  # smoke test against subset
 */

import 'dotenv/config';
import { runGoldenEval } from '../src/services/AIGoldenEvalRunner';

function parseArgs(argv: string[]): { formId: number; max?: number } {
  let formId = NaN;
  let max: number | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--form' || a === '-f') {
      formId = Number(argv[i + 1]);
      i += 1;
    } else if (a === '--max' || a === '-m') {
      max = Number(argv[i + 1]);
      i += 1;
    }
  }
  return { formId, max };
}

async function main(): Promise<void> {
  const { formId, max } = parseArgs(process.argv.slice(2));
  if (!Number.isInteger(formId) || formId <= 0) {
    // eslint-disable-next-line no-console
    console.error('Usage: pnpm run eval:golden -- --form <id> [--max <n>]');
    process.exit(2);
  }
  const result = await runGoldenEval({
    formId,
    triggeredBy: 'ci',
    maxSamples: max,
  });
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        eval_run_id: result.id,
        form_id: result.form_id,
        ran_at: result.ran_at,
        golden_set_count: result.golden_set_count,
        evaluated_count: result.evaluated_count,
        overall_kappa: result.overall_kappa,
        prev_overall_kappa: result.prev_overall_kappa,
        delta_vs_prev: result.delta_vs_prev,
        pass: result.pass,
      },
      null,
      2
    )
  );
  process.exit(result.pass ? 0 : 1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('eval:golden failed:', err);
  process.exit(2);
});

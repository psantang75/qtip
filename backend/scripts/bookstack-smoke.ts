/**
 * One-shot BookStack smoke test.
 *
 * Verifies that the env vars are set, the server is reachable, the token
 * authenticates, and the service-account user can see at least one shelf.
 * Prints a compact summary so we know the integration is healthy before
 * adding HTTP endpoints / diagnostics / docs on top.
 *
 * Usage (from backend/):
 *   npx ts-node scripts/bookstack-smoke.ts
 *
 * Exits 0 on success, 1 on any failure. Safe to re-run.
 */

import { bookstackConfig } from '../src/config/environment';
import { bookstackService } from '../src/services/BookStackService';

async function main(): Promise<void> {
  console.log('--- BookStack smoke test ---');

  if (!bookstackConfig) {
    console.error('FAIL: BookStack is not configured. Check BOOKSTACK_BASE_URL, BOOKSTACK_TOKEN_ID, BOOKSTACK_TOKEN_SECRET in backend/.env.');
    process.exit(1);
  }
  console.log(`baseUrl       : ${bookstackConfig.baseUrl}`);
  console.log(`tokenId       : ${bookstackConfig.tokenId.slice(0, 4)}...${bookstackConfig.tokenId.slice(-4)} (length ${bookstackConfig.tokenId.length})`);
  console.log(`tokenSecret   : <hidden, length ${bookstackConfig.tokenSecret.length}>`);
  console.log(`timeoutMs     : ${bookstackConfig.timeoutMs}`);
  console.log(`maxRetries    : ${bookstackConfig.maxRetries}`);
  console.log('');

  console.log('Step 1: live ping ...');
  const ping = await bookstackService.pingBookStack({ liveCheck: true });
  if (!ping.ok) {
    console.error(`FAIL: live ping failed: ${ping.error}`);
    process.exit(1);
  }
  console.log('  ok');
  console.log('');

  console.log('Step 2: list shelves ...');
  const shelves = await bookstackService.listShelves();
  console.log(`  ${shelves.length} shelves visible to this token:`);
  for (const s of shelves) {
    console.log(`    - id=${s.id} slug=${s.slug} name="${s.name}"`);
  }
  console.log('');

  if (shelves.length === 0) {
    console.warn('WARN: no shelves returned. The token works but the service-account role probably lacks View permission on the shelves we want. Grant it in BookStack and re-run.');
    process.exit(0);
  }

  console.log('Step 3: list books on the first shelf ...');
  const firstShelf = shelves[0];
  const books = await bookstackService.listBooks(firstShelf.id);
  console.log(`  ${books.length} books on shelf "${firstShelf.name}":`);
  for (const b of books.slice(0, 5)) {
    console.log(`    - id=${b.id} slug=${b.slug} name="${b.name}"`);
  }
  if (books.length > 5) console.log(`    ... and ${books.length - 5} more`);
  console.log('');

  if (books.length > 0) {
    console.log('Step 4: fetch first page on the first book (plaintext, first 200 chars) ...');
    const pages = await bookstackService.listPages({ bookId: books[0].id });
    if (pages.length === 0) {
      console.log('  (book has no pages)');
    } else {
      const text = await bookstackService.getPageContent(pages[0].id, 'plaintext');
      const preview = text.slice(0, 200).replace(/\s+/g, ' ');
      console.log(`  page id=${pages[0].id} name="${pages[0].name}"`);
      console.log(`  preview: ${preview}${text.length > 200 ? '...' : ''}`);
    }
  }

  console.log('');
  console.log('--- All checks passed ---');
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});

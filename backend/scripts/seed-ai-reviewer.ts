/**
 * Seeds the AI Reviewer system user.
 *
 * The AI Reviewer is the synthetic account that submits AI-driven audit
 * submissions through the existing SubmissionService.submitAudit pipeline.
 * One user, used for every AI-graded form regardless of interaction type.
 *
 * Idempotent: re-running prints the existing user's id and exits 0 without
 * creating a duplicate.
 *
 * Usage (from backend/):
 *   npx ts-node scripts/seed-ai-reviewer.ts
 *
 * After it succeeds, copy the printed user_id into backend/.env as
 * AI_REVIEWER_USER_ID and restart the backend.
 */

import 'dotenv/config';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import prisma from '../src/config/prisma';

const QA_ROLE_NAME = 'QA';
const USERNAME = 'AI Reviewer';
const EMAIL = 'ai.reviewer@dm-us.local';
const TITLE = 'AI Reviewer';

function generatePassword(): string {
  // 32 random bytes -> 64 hex chars; sprinkle special + upper/lower so the
  // result satisfies the standard qtip password policy in case anything ever
  // re-validates it. The user never logs in, so the value is throwaway.
  const random = crypto.randomBytes(32).toString('hex');
  return `Aa1!${random}`;
}

async function main(): Promise<void> {
  console.log('--- Seed AI Reviewer ---');

  const qaRole = await prisma.role.findUnique({ where: { role_name: QA_ROLE_NAME } });
  if (!qaRole) {
    console.error(`FAIL: role '${QA_ROLE_NAME}' not found in roles table. Aborting.`);
    process.exit(1);
  }
  console.log(`QA role id   : ${qaRole.id}`);

  const existing = await prisma.user.findFirst({
    where: { OR: [{ username: USERNAME }, { email: EMAIL }] },
  });

  if (existing) {
    console.log(`User already exists: id=${existing.id} username='${existing.username}' email='${existing.email}' role_id=${existing.role_id} active=${existing.is_active}`);
    console.log('');
    console.log(`AI_REVIEWER_USER_ID=${existing.id}`);
    process.exit(0);
  }

  const password_hash = await bcrypt.hash(generatePassword(), 10);

  const created = await prisma.user.create({
    data: {
      username: USERNAME,
      email: EMAIL,
      password_hash,
      role_id: qaRole.id,
      is_active: true,
      title: TITLE,
    },
  });

  console.log(`Created user: id=${created.id} username='${created.username}' email='${created.email}' role_id=${created.role_id}`);
  console.log('');
  console.log(`AI_REVIEWER_USER_ID=${created.id}`);
  console.log('');
  console.log('Add the line above to backend/.env and restart the backend.');
}

main()
  .catch((err) => {
    console.error('FAIL:', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

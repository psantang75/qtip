/**
 * One-shot helper to re-run AI Reviewer manually on submission 99076.
 * Used during Workstream F end-to-end verification.
 *
 * - Signs an admin JWT for the configured admin user (id 6)
 * - Fetches a fresh XSRF token via /api/auth/csrf
 * - POSTs /api/ai-reviewer/run with the recorded primary + attached refs
 * - Optionally pass --provider=openai|anthropic to override
 * - Optionally pass --skipPersist to dry-run without writing a draft
 */

import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { promises as fs } from 'fs';
import http from 'http';
import { URL } from 'url';

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function rawRequest(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        protocol: u.protocol,
        host: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: init.method ?? 'GET',
        headers: init.headers ?? {},
        timeout: 15 * 60 * 1000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf-8'),
          })
        );
      }
    );
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

const ADMIN_USER_ID = 6;
const FORM_ID = 99019;
const CONVERSATION_ID = '4daee5a4-548d-4069-939b-1f927cc69730';
const ATTACHED_TICKET_ID = 279264;
const BASE = process.env.QTIP_BASE_URL || 'http://localhost:3000';

function parseArgs(): { provider: string | null; skipPersist: boolean; tag: string } {
  let provider: string | null = null;
  let skipPersist = false;
  let tag = 'run';
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--provider=')) provider = a.split('=')[1];
    if (a === '--skipPersist') skipPersist = true;
    if (a.startsWith('--tag=')) tag = a.split('=')[1];
  }
  return { provider, skipPersist, tag };
}

async function main(): Promise<void> {
  const { provider, skipPersist, tag } = parseArgs();
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET missing from env');

  const token = jwt.sign({ user_id: ADMIN_USER_ID, username: 'verification' }, secret, {
    expiresIn: '5m',
  });

  const csrfRes = await rawRequest(`${BASE}/api/csrf-token`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const csrfBody = JSON.parse(csrfRes.body) as { csrfToken?: string; token?: string };
  const csrf = csrfBody.csrfToken ?? csrfBody.token;
  if (!csrf) throw new Error('Failed to fetch CSRF token: ' + JSON.stringify(csrfBody));

  const setCookieRaw = csrfRes.headers['set-cookie'] ?? [];
  const rawSetCookies = Array.isArray(setCookieRaw) ? setCookieRaw : [setCookieRaw];
  const cookiePairs: string[] = rawSetCookies
    .map((line) => line.split(';')[0])
    .filter(Boolean);
  // Make sure XSRF-TOKEN is paired to the value we got back, in case the
  // server didn't return it as a Set-Cookie on this exact response.
  if (!cookiePairs.some((c) => c.startsWith('XSRF-TOKEN='))) {
    cookiePairs.push(`XSRF-TOKEN=${encodeURIComponent(csrf)}`);
  }
  const cookieHeader = cookiePairs.join('; ');

  const body = {
    form_id: FORM_ID,
    kind: 'CONVERSATION',
    external_id: CONVERSATION_ID,
    attached_sources: [{ kind: 'TICKET', external_id: ATTACHED_TICKET_ID }],
    persist: !skipPersist,
    ...(provider ? { provider } : {}),
  };

  const startedAt = Date.now();
  console.log(`[${tag}] POST /api/ai-reviewer/run provider=${provider ?? 'default'} ...`);
  const res = await rawRequest(`${BASE}/api/ai-reviewer/run`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-XSRF-TOKEN': csrf,
      Cookie: cookieHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const elapsed = Date.now() - startedAt;
  console.log(`[${tag}] HTTP ${res.status} in ${elapsed}ms`);
  const text = res.body;
  const out = `_run_99076_${tag}.json`;
  await fs.writeFile(out, text, { encoding: 'utf-8' });
  console.log(`[${tag}] response written to ${out} (${text.length} chars)`);

  try {
    const parsed = JSON.parse(text);
    if (parsed?.answers) {
      const slim = parsed.answers
        .filter((a: { question_id: number }) =>
          [
            // Roll-ups + the questions called out in the F verification plan
            99277, 99282, 99285, 99290, 99293, 99294,
          ].includes(a.question_id)
        )
        .map((a: { question_id: number; answer?: string; ai_confidence?: number }) => ({
          q: a.question_id,
          v: a.answer,
          c: a.ai_confidence,
        }));
      console.log(`[${tag}] focus answers:`, JSON.stringify(slim, null, 2));
    }
    if (parsed?.provider) console.log(`[${tag}] provider=${parsed.provider}`);
    if (parsed?.elapsed_ms) console.log(`[${tag}] backend elapsed_ms=${parsed.elapsed_ms}`);
  } catch {
    /* response wasn't JSON — already saved verbatim */
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FAILED:', err);
    process.exit(1);
  });

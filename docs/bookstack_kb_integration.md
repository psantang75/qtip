# BookStack KB Integration Guide

Read-only integration with the internal BookStack v26.03.x knowledge base
at `http://know.crm.dm-us.com`. Lets qtip pull KB pages (note templates,
AR calendar, escalation rules, role playbooks) so AI-driven note reviews
can grade against documented process. Q-Tip never writes to BookStack.

## Overview

- Auth: BookStack API Token (Token ID + Token Secret) for a dedicated
  service-account user.
- Transport: live HTTPS / HTTP calls every time — no caching layer.
- Surface in qtip: `services/BookStackService.ts` + `routes/kb.routes.ts`
  exposed under `/api/kb/*` with the standard auth middleware.

## One-time setup in BookStack

The "Webhooks" screen in BookStack is *not* what we need — webhooks push
write events outward and have no read events. We use API Tokens instead.

1. **Create a service-account user** (admin only)
   - **Settings** -> **Users** -> **Add New User**
   - Name: `qtip-service` (or similar). Any valid email; doesn't need
     to receive mail.
   - Assign a role that has **`Access system API`** enabled in
     **Settings -> Roles** AND View permission on the shelves we want
     to surface (Department: Operations, Department: Sales, etc.).
   - Do NOT grant Create/Update/Delete — qtip is strictly read-only.

2. **Generate the API token** (as the service-account user, or as an
   admin acting on their behalf)
   - Click avatar (top right) -> **Edit Profile**
   - Scroll to **API Tokens** -> **Create Token**
   - Name: `qtip-review`
   - Expiry: leave blank or set far out
   - Copy **Token ID** and **Token Secret** immediately — the secret is
     shown only once. Lose it and you delete + recreate the token.

3. **Network reachability**
   - The qtip backend host must be able to reach the BookStack URL.
     From the backend host: `curl -I http://know.crm.dm-us.com` should
     return any HTTP response.

## Configuration

Add to `backend/.env`:

```env
BOOKSTACK_BASE_URL=http://know.crm.dm-us.com
BOOKSTACK_TOKEN_ID=<token id>
BOOKSTACK_TOKEN_SECRET=<token secret>
BOOKSTACK_TIMEOUT_MS=15000
BOOKSTACK_MAX_RETRIES=2
```

Same "leave-blank-to-disable" rule as the optional database pools and
AI providers: if `BOOKSTACK_TOKEN_ID` or `BOOKSTACK_TOKEN_SECRET` is
empty, `bookstackConfig` resolves to `null`, the `/api/kb/*` endpoints
return `503 not_configured`, and the rest of qtip is unaffected.

## Verifying the integration

From `backend/`:

```powershell
npx ts-node scripts/bookstack-smoke.ts
```

The script masks the token in its output and walks four checks: live
ping -> list shelves -> list books on the first shelf -> fetch the
first page's plaintext content. It prints `--- All checks passed ---`
on success and exits non-zero on any failure.

If you get `WARN: no shelves returned`, the token authenticates but the
service-account role lacks View permission on the shelves we want.
Grant it in BookStack and re-run.

## API surface (`/api/kb/*`)

All routes require the standard qtip auth middleware. Read-only.

| Route                                 | Purpose                                            |
| ------------------------------------- | -------------------------------------------------- |
| `GET /api/kb/health`                  | Live ping. 200 ok / 503 not_configured / unhealthy |
| `GET /api/kb/shelves`                 | List shelves visible to the token                  |
| `GET /api/kb/books?shelfId=N`         | All books, or books on a specific shelf            |
| `GET /api/kb/chapters?bookId=N`       | All chapters, or chapters in a specific book       |
| `GET /api/kb/pages?bookId=N&chapterId=N` | List pages, optionally narrowed                |
| `GET /api/kb/pages/:id?format=plaintext` | Fetch one page (`html`, `markdown`, `plaintext`) |
| `GET /api/kb/search?q=...&count=10`   | BookStack-native search syntax (`{tag:foo}` etc.)  |

`format=plaintext` is the cheapest format for passing to an LLM (no
HTML noise) and is the default. `html` and `markdown` come straight from
BookStack; `plaintext` is the HTML with tags + entities stripped.

## Token rotation

1. In BookStack: Edit Profile -> API Tokens -> delete the existing
   `qtip-review` token, create a new one, copy the new ID + Secret.
2. Update `BOOKSTACK_TOKEN_ID` and `BOOKSTACK_TOKEN_SECRET` in
   `backend/.env`.
3. Restart the backend (PM2 restart in prod; the dev server picks the
   new value up on the next process restart).
4. Re-run `scripts/bookstack-smoke.ts` to confirm.

## Files

- [`backend/src/config/environment.ts`](../backend/src/config/environment.ts) — env vars + `bookstackConfig`
- [`backend/src/services/BookStackService.ts`](../backend/src/services/BookStackService.ts) — singleton service
- [`backend/src/routes/kb.routes.ts`](../backend/src/routes/kb.routes.ts) — auth-gated GET endpoints
- [`backend/scripts/bookstack-smoke.ts`](../backend/scripts/bookstack-smoke.ts) — verification script

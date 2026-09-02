# Deployment runbook

Canonical order of operations for deploying a QTIP release. This complements
[`PRODUCTION_GUIDE.md`](./PRODUCTION_GUIDE.md) (feature-level overview) by
turning the steps into a checklist an operator can follow top-to-bottom.

---

## 0. TL;DR — `git push` does NOT deploy (read this first)

Pushing to GitHub only updates the repo. **The stage and production VMs do not
auto-deploy.** Until someone SSHes into each VM, pulls, and *rebuilds*, the
servers keep serving the **old** bundle to every user — any browser, any login,
incognito included — even though `origin/main` already shows the new commit.
This is the #1 cause of "I fixed it but production still shows the bug": the fix
was pushed but never built on the host.

Hosts (each environment has a checkout that tracks its **own branch** — see
§0b for the promotion model). **Both stage and prod are now containerized
Docker Compose** — same SSH user (`dmadmin`), same `…/code` checkout layout,
same `docker compose up -d --build` rebuild. There is no PM2 *host* anymore
(PM2 still runs *inside* the container — see §0a).

| Env   | Host          | SSH user  | Compose project dir                         | `/code` checkout → tracks branch |
| ----- | ------------- | --------- | ------------------------------------------- | -------------------------------- |
| stage | `10.90.15.6`  | `dmadmin` | `/home/dmadmin/docker-staging/qtip-app`     | `…/code` → `stage`               |
| prod  | `10.90.15.5`  | `dmadmin` | `/home/dmadmin/docker-production/qtip-app`  | `…/code` → `production`          |

> **Access — read this, it is the #1 thing people get wrong:**
> You SSH to **both** boxes as **`dmadmin`**. That is the only account that owns
> the Docker socket and the `/home/dmadmin/docker-{staging,production}` trees.
> Everything you deploy lives under `…/qtip-app/` (the compose project) whose
> `code/` subdir is the git checkout you `pull` into.
>
> The old prod account **`qtip-admin` at `/opt/qtip` (PM2) is RETIRED** — its
> processes are stopped and it cannot reach Docker. Do **not** SSH there to
> deploy. If a command in an old note says `qtip-admin`, `/opt/qtip`, or
> `deploy_application.sh`, it is stale.
>
> Quick copy-paste identity check for each box:
>
> ```bash
> ssh dmadmin@10.90.15.6 'whoami; docker ps --format "{{.Names}}"'   # stage
> ssh dmadmin@10.90.15.5 'whoami; docker ps --format "{{.Names}}"'   # prod
> ```

## 0b. Branch & promotion model

`main` is the integration branch and the single source of truth. Each
environment has its **own branch** whose tip records exactly what is deployed
there. **Never edit files directly on a host** except for live debugging —
commit the fix to `main` and promote it forward, or it silently drifts and is
lost on the next rebuild.

| Branch       | Meaning                          | Deployed on             |
| ------------ | -------------------------------- | ----------------------- |
| `main`       | Integration / source of truth    | (not deployed directly) |
| `stage`      | Exactly what is live on staging  | `10.90.15.6`            |
| `production` | Exactly what is live on prod     | `10.90.15.5`            |

Promotion is **fast-forward-only** — history stays linear and each environment
branch is a strict subset of the one before it:

```bash
# 1. Develop: commit to main (directly, or merge a feature branch into main).

# 2. Promote main -> stage, then deploy on the stage box:
git checkout stage; git merge --ff-only main; git push origin stage
ssh dmadmin@10.90.15.6 'git -C /home/dmadmin/docker-staging/qtip-app/code pull --ff-only; cd /home/dmadmin/docker-staging/qtip-app; docker compose up -d --build'

# 3. Verify on https://qtip-stage.dm.local

# 4. Promote stage -> production, then deploy on the prod box (same container loop):
git checkout production; git merge --ff-only stage; git push origin production
ssh dmadmin@10.90.15.5 'git -C /home/dmadmin/docker-production/qtip-app/code pull --ff-only; cd /home/dmadmin/docker-production/qtip-app; docker compose up -d --build'

# 5. Verify on https://qtip-prod.dm-us.com
```

If a `git merge --ff-only` is rejected, the target has commits the source
doesn't — reconcile on `main` first. **Never force-push an environment
branch**, and never commit straight onto `stage`/`production`.

## 0a. Containerized environments (stage + prod) — the deploy loop

**Both stage and prod run Docker Compose.** The repo is still the source of
truth — do NOT hand-edit files on the box as the primary workflow. Each env's
`code/` directory is a checkout of that env's branch (stage→`stage`,
prod→`production`, see §0b); you deploy by pulling and rebuilding the image.

> **PM2 didn't go away — it moved inside the container.** The image's entrypoint
> is `pm2-runtime start ecosystem.config.cjs` (see `deploy/Dockerfile`), so the
> API and the nightly workers run under PM2 *inside* `qtip-app`. That means the
> old **host** PM2 commands (`pm2 reload qtip-backend`, `pm2 stop ie-*`) are no
> longer run on the box — a `docker compose up -d --build` recreates the
> container and PM2 starts everything fresh. To touch PM2 now you `docker exec`
> into the container (see §3).

Per-env reference — pick the correct row; the two are identical except host,
path, branch, container name, and URL:

| What            | stage                                     | prod                                          |
| --------------- | ----------------------------------------- | --------------------------------------------- |
| Host            | `10.90.15.6`                              | `10.90.15.5`                                   |
| SSH user        | `dmadmin`                                 | `dmadmin`                                      |
| Project dir     | `/home/dmadmin/docker-staging/qtip-app`   | `/home/dmadmin/docker-production/qtip-app`     |
| `code/` branch  | `stage`                                   | `production`                                   |
| Rebuild command | `docker compose up -d --build`            | `docker compose up -d --build`                 |
| App container   | `qtip-app-stage`                          | `qtip-app`                                     |
| URL             | `https://qtip-stage.dm.local`             | `https://qtip-prod.dm-us.com`                  |
| DB container    | `qtip-db-stage` MySQL 8.4 (`10.90.15.6:3306`) | `qtip-db` MySQL 8.4.5 (`10.90.15.5:3306`)  |

Deploy loop (identical for both — pick the row above; prod keeps the
verify-stage-first discipline):

```bash
# STAGE
ssh dmadmin@10.90.15.6 'git -C /home/dmadmin/docker-staging/qtip-app/code pull --ff-only; cd /home/dmadmin/docker-staging/qtip-app; docker compose up -d --build'

# PROD (only after stage is verified)
ssh dmadmin@10.90.15.5 'git -C /home/dmadmin/docker-production/qtip-app/code pull --ff-only; cd /home/dmadmin/docker-production/qtip-app; docker compose up -d --build'
```

- **`.env`-only change** (no code): `docker compose up -d` (recreates the
  container without rebuilding the image). The app `.env` lives at
  `…/qtip-app/code/backend/.env`; the DB `.env` at `…/docker-<env>/db/.env`.
- **Proxy change**: edit under `…/docker-<env>/proxy/` then
  `cd …/docker-<env>/proxy && docker compose exec proxy nginx -t && docker compose exec proxy nginx -s reload`
  (stage = `docker-staging`, prod = `docker-production`).
- Direct Remote-SSH editing on the box is for **live debugging only** — commit
  anything that works back to `main` and promote it (§0b) so it survives the
  next rebuild and reaches prod. Never let the box diverge from its branch.
- **Workstation prerequisite**: your machine must resolve `*.dm.local` to
  `10.90.15.6`. If DNS doesn't, add to the hosts file
  (`C:\Windows\System32\drivers\etc\hosts` on Windows, needs admin):

  ```text
  10.90.15.6  qtip-stage.dm.local
  10.90.15.6  dmassist-stage.dm.local
  ```

  Certs are self-signed until prod certs are issued — expect a browser trust
  prompt. Bookmark the FQDN (short names 301-redirect to it).

### Known container-stage caveats (from IT)

- **Equipment uploads are non-persistent on stage** — they are written inside
  the container filesystem and lost on `docker compose up` recreate (bind mount
  pending). **Prod is fine here:** its compose bind-mounts
  `…/docker-production/qtip-app/uploads:/app/uploads`, so prod attachment
  uploads survive rebuilds.
- **CIFS mounts**: the app depends on host mounts `/mnt/qtip-audio` and
  `/mnt/dmcms`. If the host loses those network mounts, audio features fail
  gracefully while the rest of the app stays up.

### Frontend-only change (most common — no API restart, no DB)

There is no special path for frontend-only changes anymore: **both envs rebuild
the same way** via the §0a loop. The image build compiles `frontend/dist` and
the container serves it, so `docker compose up -d --build` is the whole deploy —
no copy/swap step. Run stage first, verify in the browser, then promote (§0b)
and repeat for prod.

### Verify the LIVE container actually contains your change

Don't trust "it built" — confirm the running container is on the new code. The
`code/` checkout must match the env branch, and the app container must have been
**recreated** by the rebuild (uptime in seconds, not days):

```bash
# on the box as dmadmin — prod shown; swap paths/host for stage (§0a table):
git -C /home/dmadmin/docker-production/qtip-app/code rev-parse HEAD    # == origin/production
docker ps --format '{{.Names}} :: {{.Status}}' | grep qtip-app         # "Up <seconds>" right after rebuild
# app answers through the proxy:
curl -sko /dev/null -w '%{http_code}\n' https://qtip-prod.dm-us.com/login   # 200
```

### Backend / full change (deps changed, API logic, or DB migration)

**Both envs** use the same container rebuild (§0a): the image build runs
`npm install` + build for backend and frontend, so a changed `package.json`/lock
is picked up automatically — no extra command, no host `npm ci`. The container
then boots the API and workers under `pm2-runtime`.

If the release includes a **DB migration**, apply it with the §3.3 step against
that env's `qtip-db` container **before** the rebuild.

---

## 1. Process model — PM2 inside the container

**Both stage and prod run the same Docker image**, whose entrypoint is
`pm2-runtime start ecosystem.config.cjs` (`deploy/Dockerfile`). PM2 is therefore
an **implementation detail inside `qtip-app`**, not something you install or
drive on the host.

- `ecosystem.config.cjs` at the repo root defines the API process
  (`qtip-backend`) and the nightly workers (`ie-dept-sync`, `ie-emp-sync`,
  `ie-calendar-sync`, `ie-partition-manager`, `ie-rollup`, `ie-source-dispatch`).
- Workers run as cron one-shots inside the 01:00–02:00 window (container `TZ`
  is `America/New_York`); see the file-header comment for the timing rationale.
- To inspect or drive PM2, exec into the container, e.g.
  `docker exec qtip-app pm2 ls` (prod) or `docker exec qtip-app-stage pm2 ls`
  (stage). A `docker compose up -d --build` recreates the container and PM2
  starts everything fresh — you do **not** run host-level `pm2 …` commands.
- Log file rotation is Winston's DailyRotateFile transport (see
  [`LOGGING_CONFIGURATION.md`](./LOGGING_CONFIGURATION.md)); container stdout is
  captured by Docker.

> **Retired:** the host-PM2 (`qtip-admin` @ `/opt/qtip`) and IIS
> (`deploy/web.config.example`) patterns are no longer used for stage or prod.
> They remain in the repo only for reference/DR; do not deploy with them.

---

## 2. Pre-deploy checks (5 min)

| #   | Step                                                    | Command / Location                            |
| --- | ------------------------------------------------------- | --------------------------------------------- |
| 1   | Confirm target env in the correct git state             | `git status`, `git log -1`                    |
| 2   | Confirm `.env` on target host matches current template  | diff against `deploy/production_environment_template.env` |
| 3   | Confirm free disk for DB backup                         | ≥ 2× current `qtip_production` size           |
| 4   | Confirm maintenance window is posted (if prod)          | ops channel                                   |
| 5   | `npm run typecheck` and `npm test` green on the commit  | CI build for the commit                       |

---

## 3. Deploy order — step by step

> **The canonical deploy is the §0a container loop** (`git pull` +
> `docker compose up -d --build`), which does install → build → (re)start under
> `pm2-runtime` in one image build. The steps below are the *order of concerns*
> around that rebuild — backup, migrate, verify — with the container-native
> commands. All box commands run as **`dmadmin`**; examples show **prod**
> (`10.90.15.5`, `qtip-app`) — swap the host/paths/container for stage (§0a).

### 3.1 Database backup (always)

Dump the `qtip-db` container to the box's backups dir. The DB name and root
password already live in the container's env, so reference them in-place rather
than hardcoding secrets:

```powershell
ssh dmadmin@10.90.15.5 'docker exec qtip-db sh -c ''mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'' | gzip > /home/dmadmin/docker-production/qtip-app/backups/pre-deploy-$(date +%Y%m%d_%H%M%S).sql.gz'
```

> **PowerShell-safe quoting (this is what silently produces a broken backup):**
> the inner `sh -c` argument is wrapped in **doubled single quotes** (`''…''`),
> NOT bash's `'\''`. On a Windows/PowerShell workstation `'\''` is mangled before
> ssh ever sees it, `$MYSQL_DATABASE` arrives empty, and `mysqldump` writes only
> its usage text into the `.gz` — a ~130-byte "backup" that looks like it
> succeeded. Always confirm the size (`ls -lh …/pre-deploy-*.sql.gz | tail -1`)
> is tens of MB before trusting it.

On **stage** the DB container is `qtip-db-stage` and the path is under
`/home/dmadmin/docker-staging/qtip-app/backups/` — swap both. Keep the printed
path — it's the rollback target (§4).

### 3.2 Pull code + rebuild (install + build happen in the image)

No host `npm ci`/build — the image build does it. Just fast-forward `code/` to
the release and rebuild:

```bash
ssh dmadmin@10.90.15.5 'git -C /home/dmadmin/docker-production/qtip-app/code pull --ff-only; cd /home/dmadmin/docker-production/qtip-app; docker compose up -d --build'
```

> If a **DB migration** is in the release, run §3.3 **before** this rebuild.

### 3.2a Why "stage passed but prod failed the identical commit" — the hermetic-build rule

stage and prod are the **same environment at *runtime*** (same image, same
`pm2-runtime` entrypoint), but the **image build was historically NOT hermetic**,
so an *identical commit with an identical `package-lock.json` could build clean on
stage and fail on prod*. This burned a whole deploy cycle (2026‑08‑22) — here is
the mechanism so it is never mistaken for a "flaky build" again.

**Root cause — the build context leaked host `node_modules` into the image.**
The build context is the box's `code/` checkout (`context: ..` in
`deploy/docker-compose.yml`). `deploy/Dockerfile` does the right thing —
`COPY <ws>/package*.json` → clean `npm ci` (installs the exact lockfile tree) —
but the very next line, `COPY <ws>/ ./`, copied **everything** in the checkout on
top of that, *including any `node_modules` sitting in the working tree*. So the
freshly-pinned dependencies were silently overwritten by whatever tree that
particular box happened to have on disk:

- **prod** had a stale `code/backend/node_modules` from a manual `npm install`
  run months earlier. It carried `@types/express-serve-static-core@5.1.3`, which
  retypes `req.query`/`req.params` as `string | string[]` → ~160 `tsc` errors,
  plus a stricter `mysql2` and an older Prisma.
- **stage's** working tree had no stale `node_modules`, so its build used the
  clean `npm ci` result and compiled. Same lockfile, opposite outcome.

The stale Prisma also **masked a second latent bug**: `backend/prisma.config.ts`
eagerly resolves a datasource URL and *throws* when no DB env is present, but the
old Prisma ignored `prisma.config.ts`, so the build-time `npx prisma generate`
(which never connects) appeared to work. The moment the build stopped leaking
`node_modules`, `prisma generate` correctly loaded the config and failed.

**The durable fixes (already in the repo — do not remove):**

1. **`.dockerignore` at the repo root** excludes `**/node_modules`, `**/dist`,
   `backend/src/generated`, `.git`, and `.env*`. This makes the build **hermetic**:
   the image depends only on committed source + the lockfile, never on whatever a
   box has lying around. This is the real guardrail — every workstation/box now
   builds bit-for-bit the same image.
2. **`deploy/Dockerfile` gives `prisma generate` a throwaway `DATABASE_URL`**
   (`mysql://build:build@127.0.0.1:3306/build`). Generate never connects, so this
   satisfies `prisma.config.ts` at build time while the **strict env check stays
   intact for real (runtime) migrations**.

**Invariant to preserve:** the image must build from *committed source + lockfile
only*. If you ever add a `COPY <dir>/ ./` that could include installed deps or
generated output, extend `.dockerignore` to exclude it. Never "fix" a build by
editing files directly on a box (§0b) — that is exactly the host-state drift this
rule exists to kill.

**One-line diagnosis if a build ever diverges box-to-box again:** compare the
installed type that broke `tsc` against the lockfile pin, e.g.
`grep -m1 version <box>/code/backend/node_modules/@types/express-serve-static-core/package.json`
vs. the `5.1.0` pinned in `backend/package-lock.json`. A mismatch means something
is leaking into the context — check `.dockerignore` first.

### 3.3 Apply Prisma migrations (only when the release includes one)

Do the backup (§3.1) first, then apply. **The Prisma CLI IS shipped in the
runtime image** — `prisma` is a production dependency (`backend/package.json`)
and the image copies the full `backend/node_modules`, so
`/app/backend/node_modules/.bin/prisma` is present and works (verified:
`prisma 7.9.1`). The runtime image does NOT copy `backend/prisma/` or
`prisma.config.ts`, which is why the commands below mount them.

> **Root cause of the old "the CLI hangs / is absent" myth — it was a quoting
> bug, not a missing CLI.** The previous commands ran
> `sh -c "npx --no-install prisma …"` with **double quotes**. On a
> Windows/PowerShell workstation those double quotes are stripped before ssh
> forwards the string, so the container actually ran `sh -c npx` — bare `npx`
> with no package name — which sits forever waiting on stdin. It looked like the
> CLI was missing or prompting to install; it was neither. The fix is
> mechanical: wrap the `sh -c` argument in **doubled single quotes** (`''…''`)
> and call the **direct binary** `./node_modules/.bin/prisma` instead of `npx`.
> With that, `migrate deploy` (Step 2A) is the reliable primary path; the SQL
> fallback (Step 2B) remains for hand-authored warehouse SQL Prisma can't model
> (partitioned / PK-less tables — see
> [`database_schema_updates.md`](./database_schema_updates.md)).

All commands below are written **PowerShell-safe** for a Windows workstation:
the whole remote command is single-quoted and any literal inner single quote is
doubled (`''`). Examples show **stage**; swap host/paths/DB-container for prod
(`10.90.15.5`, `…/docker-production/…`, `qtip-db`) and only after stage verifies.

#### Step 1 — Probe (read-only; shows exactly what is pending)

`-T` disables the TTY. Call the direct binary `./node_modules/.bin/prisma` (not
`npx`) and wrap the whole `sh -c` argument in **doubled single quotes** so
PowerShell doesn't strip it (see the root-cause note above). Mount only
`prisma/` + `prisma.config.ts` — never the whole `code/backend`, which would
shadow the image's `node_modules`:

```powershell
ssh dmadmin@10.90.15.6 'cd /home/dmadmin/docker-staging/qtip-app; docker compose run --rm -T --no-deps -w /app/backend -v "$PWD/code/backend/prisma:/app/backend/prisma" -v "$PWD/code/backend/prisma.config.ts:/app/backend/prisma.config.ts" qtip-app sh -c ''./node_modules/.bin/prisma migrate status --schema prisma/schema.prisma'''
```

It loads `prisma.config.ts`, connects to the env's DB, and lists any
**not-yet-applied** migrations. Your release's migration listed as pending →
apply it with **Step 2A** (`migrate deploy`), the reliable primary path. Use the
SQL fallback (**Step 2B**) only for hand-authored warehouse SQL Prisma can't
model.

#### Step 2A — primary path: `migrate deploy`

Same overlay and quoting as the probe (direct binary + doubled single quotes).
Migrations connect with the app's own `DB_*` vars via `prisma.config.ts` (no
separate `DATABASE_URL` to drift, which kills the recurring
`P1000: Authentication failed`). `migrate deploy` applies every pending
migration in order AND records the `_prisma_migrations` bookkeeping row itself,
so — unlike the SQL fallback — there is no separate checksum/insert step:

```powershell
ssh dmadmin@10.90.15.6 'cd /home/dmadmin/docker-staging/qtip-app; docker compose run --rm -T --no-deps -w /app/backend -v "$PWD/code/backend/prisma:/app/backend/prisma" -v "$PWD/code/backend/prisma.config.ts:/app/backend/prisma.config.ts" qtip-app sh -c ''./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma'''
```

#### Step 2B — CLI absent (primary path): apply the SQL, then record it

Pipe the migration file into the env's DB container (`qtip-db-stage` on stage,
`qtip-db` on prod), then insert the `_prisma_migrations` bookkeeping row so
`migrate deploy` never re-runs it.

> **PowerShell/SSH quoting rule (this is what keeps biting us):** send SQL over
> **stdin via `docker exec -i`** — do NOT use `mysql -e "…"`; the double quotes
> get stripped through PowerShell → ssh → sh and mysql just prints its usage
> dump. `$MYSQL_ROOT_PASSWORD` / `$MYSQL_DATABASE` stay literal through every
> layer and are expanded by the innermost container shell.

```powershell
# 1) Apply the migration SQL (replace <name> with the migration folder name):
ssh dmadmin@10.90.15.6 'cat /home/dmadmin/docker-staging/qtip-app/code/backend/prisma/migrations/<name>/migration.sql | docker exec -i qtip-db-stage sh -c ''exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'''

# 2) Get the checksum Prisma expects (plain sha256sum hex of the same file):
ssh dmadmin@10.90.15.6 'sha256sum /home/dmadmin/docker-staging/qtip-app/code/backend/prisma/migrations/<name>/migration.sql'

# 3) Insert the bookkeeping row (paste <checksum> from step 2, and <name>):
'INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count) SELECT UUID(), ''<checksum>'', ''<name>'', NOW(3), NOW(3), 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = ''<name>'');' | ssh dmadmin@10.90.15.6 'docker exec -i qtip-db-stage sh -c ''exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'''
```

#### Step 3 — Verify (either path)

Confirm the schema change landed AND the history row exists (swap
`<expected_object>` for something the migration creates, e.g. an index name):

```powershell
'SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME = ''<expected_object>''; SELECT migration_name, finished_at FROM _prisma_migrations WHERE migration_name = ''<name>'';' | ssh dmadmin@10.90.15.6 'docker exec -i qtip-db-stage sh -c ''exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'''
```

Prisma applies migrations in lexicographic order of the folder name. See
[`backend/prisma/migrations/README.md`](../backend/prisma/migrations/README.md)
for the duplicate-timestamp tolerance rule. For not-null/column-drop migrations
follow the staggered plan in §7.

### 3.4a AI Reviewer system user (once per env)

The AI Reviewer subsystem submits AI-graded audits through the same
`SubmissionService.submitAudit` pipeline that humans use, which means every
submission needs a real `users.id` for `submitted_by` (FK + audit trail +
inbox filtering + dispute attribution). That id lives in `.env` as
`AI_REVIEWER_USER_ID` and is read at boot by
`backend/src/config/environment.ts → aiReviewerConfig`. When unset, every
`/api/ai-reviewer/*` endpoint answers `503 NOT_CONFIGURED` — the rest of the
app is unaffected.

This is a **per-environment** setup step. Each env's `users` table assigned
its own auto-increment id when the row was created, so the value differs
between dev / stage / prod and **must be re-resolved** any time you:

- Stand up a brand-new environment (test sandbox, prod first deploy, DR cut-over).
- Restore the DB from a backup taken **before** the row was seeded.
- Re-seed the env from scratch (e.g. wipe + reload data for a regression run).

Run this against the target env (one-time, idempotent) by exec'ing into the app
container (prod `qtip-app`, stage `qtip-app-stage`):

```bash
ssh dmadmin@10.90.15.5 'docker exec qtip-app npx ts-node scripts/seed-ai-reviewer.ts'
# Prints either "Created user: id=<N> ..." or "User already exists: id=<N> ..."
# followed by a copy-pasteable line:
#   AI_REVIEWER_USER_ID=<N>
```

Then append (or update) that line in the env's app `.env` at
`…/docker-production/qtip-app/code/backend/.env` and recreate the container so
the new value is read (env is loaded via `env_file` at container start):

```bash
ssh dmadmin@10.90.15.5 'cd /home/dmadmin/docker-production/qtip-app; docker compose up -d'
```

Verification (through the proxy): `curl -sk -o /dev/null -w '%{http_code}\n'
https://qtip-prod.dm-us.com/api/ai-reviewer/inbox` should return `401`
(authentication required) — **not** `503`. A 503 means `AI_REVIEWER_USER_ID`
is still missing or pointing at a row that doesn't exist.

> **Promotion to prod:** prod's `users` table will assign a different
> auto-increment id than stage's. Do **not** copy stage's `AI_REVIEWER_USER_ID`
> into prod's `.env` — re-run the seed against the prod DB and use the id
> the script prints there.

### 3.4 Workers, API restart, and the frontend bundle — all handled by the rebuild

In the container model these old host-PM2 steps collapse into the single
`docker compose up -d --build` from §3.2:

- **Workers** (`ie-*`) and the **API** (`qtip-backend`) are (re)started together
  by `pm2-runtime` when the container is recreated — there is no separate
  host-side stop/reload/resume. Because the rebuild replaces the whole container
  atomically, workers can't race a half-applied schema: run §3.3 migrations
  first, then rebuild.
- **Frontend bundle** ships *inside* the image (`frontend/dist` baked at build
  time and served by the container), so there is no separate bundle-swap step —
  the new UI and new API go live together on recreate.
- Need to nudge PM2 without a full rebuild (rare)? Exec in:
  `docker exec qtip-app pm2 reload qtip-backend` (prod) /
  `docker exec qtip-app-stage pm2 reload qtip-backend` (stage).

Proceed to the smoke test (§5) before declaring the release live.

---

## 4. Rollback procedure

Trigger conditions: §3.2 rebuild or §5 fails, or observability (§
[`observability.md`](./observability.md)) fires an alert within 15 min
of deploy. All commands as `dmadmin` on the box (prod paths shown).

1. **Roll the code back** to the previous commit and rebuild — recreating the
   container atomically stops the bad workers/API and boots the old ones:

   ```powershell
   ssh dmadmin@10.90.15.5 'cd /home/dmadmin/docker-production/qtip-app; git -C code reset --hard <previous-commit>; docker compose up -d --build'
   ```

   (`<previous-commit>` is the prior `production` tip — e.g. what `code/`
   pointed at before the pull; find it with `git -C code reflog`.)
2. **Restore the DB** only if the release migrated it — otherwise skip:

   ```powershell
   ssh dmadmin@10.90.15.5 'gunzip -c <backup-path-from-§3.1> | docker exec -i qtip-db sh -c ''mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'''
   ```

   - If the migration in §3.3 was schema-only and safe to skip, you can instead
     run `prisma migrate resolve --rolled-back <migration_name>`. The full
     restore is always safe.
3. Also revert the `production` branch on the remote so the box and git agree:
   reconcile on `main` and re-promote — **never force-push an environment
   branch** (§0b).
4. Post an incident note referencing the backup file, the commit deployed,
   and the failing signal.

A partial restore — only the insights / KPI tables — is available via
`scripts\restore-insights-from-backup.ps1` for the case where the data
drift is limited to insights rollups.

---

## 5. Post-deploy smoke test

Run after every deploy, **before** declaring the release live. Target the env's
public URL — stage `https://qtip-stage.dm.local`, prod
`https://qtip-prod.dm-us.com`.

```powershell
.\scripts\run_verification.ps1 -Environment production
```

Or hit the endpoints directly through the proxy (self-signed cert → `-k`):

```bash
for p in /health /ready /live /api/csrf-token '/api/insights/qc-quality?limit=1'; do
  echo -n "$p -> "; curl -sk -o /dev/null -w '%{http_code}\n' "https://qtip-prod.dm-us.com$p"
done
```

> **Run this from your workstation, not the box.** The `*.dm.local` /
> `qtip-prod.dm-us.com` names resolve on your LAN, not from inside the box, so
> curling them over SSH returns `000` (can't resolve host) — that's a DNS miss,
> not an outage. To verify *on the box*, hit the app's published port on
> localhost instead (find it with `docker ps` — e.g. stage maps `5001->5000`):
> `ssh dmadmin@10.90.15.6 "curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5001/health"`.
> (The `qtip-app` container has no `curl`; use the host's, via the published port.)

What to exercise:

- `/health`, `/ready`, `/live` monitoring endpoints
- `/api/auth/login` with a canary account (expects 200 + CSRF cookie)
- `/api/qa/health` (database + cache booleans)
- `/api/csrf-token` (CSRF token mint)
- Smoke GET against `/api/insights/qc-quality?limit=1`

If any step returns non-2xx, treat it as a rollback trigger.

### Manual UI smoke (≤ 2 min)

Load the env URL (prod `https://qtip-prod.dm-us.com`) — self-signed cert prompt
is expected until public certs are issued.

| Surface              | What to verify                                                               |
| -------------------- | ---------------------------------------------------------------------------- |
| `/login`             | Page renders; login with a known admin completes; CSRF token cookie present. |
| `/app/insights/qc-quality` | Page loads, KPI tiles render, no 5xx in the network tab.               |
| `/app/insights/on-demand-reports` | List renders, one report opens without error.                   |
| `/api-docs`          | Swagger UI loads; spec loads without 500s (content coverage is a separate audit — see [`openapi_coverage.md`](./openapi_coverage.md)). |

---

## 6. Secret rotation (JWT_SECRET, REFRESH_TOKEN_SECRET)

Rotation is an **operational task on the production host**. It does **not**
require a code change, a new release, a `git push`, or an `npm install` — you
are only changing environment-variable values and restarting the API.

### 6.1 When to rotate

- Immediately if a signed JWT has leaked (e.g. a token committed to git
  history, pasted into a ticket, or posted to a log aggregator).
- On a regular cadence (recommended: every 90 days) as defence in depth.
- Whenever an employee with access to the production `.env` leaves the team.

### 6.2 Generate new values

Both secrets must be long (≥ 48 bytes) and random. Generate on any machine:

```powershell
# Windows / PowerShell
[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

```bash
# Linux / macOS
openssl rand -base64 48
```

Run twice — one value per secret. Do not reuse `JWT_SECRET` as
`REFRESH_TOKEN_SECRET`.

### 6.3 Apply on the production host

1. Stage the new values in the deploy channel / password manager.
2. SSH as `dmadmin` and edit the prod app `.env` at
   `/home/dmadmin/docker-production/qtip-app/code/backend/.env` and replace:

   ```
   JWT_SECRET=<new value 1>
   REFRESH_TOKEN_SECRET=<new value 2>
   ```

3. Recreate the container so it re-reads `env_file` (no image rebuild needed —
   this is an `.env`-only change, §0a):

   ```bash
   ssh dmadmin@10.90.15.5 'cd /home/dmadmin/docker-production/qtip-app; docker compose up -d'
   ```

   Workers do not mint JWTs, but they share the container, so they restart with
   it — that is harmless.

### 6.4 Expected user impact

All currently logged-in users are bumped back to `/login` on their next
request, because their stored access and refresh tokens no longer verify
against the new secret. This is expected and harmless. Post a brief notice
in the ops channel if the maintenance window does not already cover it.

### 6.5 Verification

After restart:

- `docker exec qtip-app pm2 logs qtip-backend --lines 50` should show no
  "invalid signature" loops other than the expected one-time re-auth of active
  sessions. (`docker logs qtip-app` shows the same stdout.)
- `/api/auth/login` with a known-good canary must return 200 and set a
  new CSRF cookie (§5 smoke test covers this).
- The old token (the one that prompted the rotation, if any) must now return
  401 on any authenticated endpoint.

### 6.6 Rollback

If the new value was mistyped and no user can log in, restore the previous
`.env` value and recreate the container
(`ssh dmadmin@10.90.15.5 'cd /home/dmadmin/docker-production/qtip-app; docker compose up -d'`).
Nothing is persisted server-side against the in-flight secret, so the rollback
is instantaneous.

---

## 7. Staggered migration caveat

For migrations that add **not-null columns** or drop columns still in use:

1. Deploy a code release that handles **both** old and new shapes (write +
   read tolerant of either).
2. Run the migration during the next window.
3. Deploy a follow-up release that assumes the new shape.

Prisma cannot do this automatically. Plan it into the migration PR.

---

## Related documents

- [`environment_variables.md`](./environment_variables.md) — env-var contract
- [`observability.md`](./observability.md) — metrics, alerts, SLOs
- [`backup_restore_runbook.md`](./backup_restore_runbook.md) — detailed DB recovery
- [`role_permission_matrix.md`](./role_permission_matrix.md) — which roles hit which surfaces
- [`LOGGING_CONFIGURATION.md`](./LOGGING_CONFIGURATION.md) — log targets
- [`scripts/README.md`](../scripts/README.md) — script inventory

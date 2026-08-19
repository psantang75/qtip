# Inbound mailbox import

QTIP polls a mailbox and loads any Excel report emailed to it. In practice that
means the Paychex punch export, which Paychex delivers to `qtip@dm-us.com` every
morning at 6am — the file somebody used to download and upload by hand at
Admin > Manual Upload.

Related: [`environment_variables.md`](./environment_variables.md) for the
settings, [`insights_csr_attendance.md`](./insights_csr_attendance.md) for what
the punch data feeds, [`scheduling.md`](./scheduling.md) for the time-off
exceptions derived from it.

---

## Why EWS and not IMAP

IMAP (143/993) and POP3 (110/995) are both closed on `mail.dm-us.com`. Only 443
and 25 are open. Exchange Web Services is reachable on that 443 and accepts
NTLM, so it needs no firewall change and no new service enabled.

The EWS deprecation Microsoft is enforcing through 2026 covers **Exchange Online
only** — on-premises Exchange is explicitly out of scope, so this is not a path
that expires. If the mailbox ever migrates to Microsoft 365, this becomes a
Graph API rewrite and `ExchangeMailClient` is the only file that changes.

---

## What a tick does

Every `MAILBOX_IMPORT_POLL_MINUTES` (default 10), for each unread message in the
Inbox:

1. **Sender check** — the From address must be an active row in the allowlist.
   Nothing is read from a message that fails here.
2. **Authentication check** — if the gateway stamped an `Authentication-Results`
   header, it must show `spf`, `dkim` or `dmarc` as `pass`. See the caveat below.
3. **Attachment filter** — `.xlsx` or `.xls` only, under `MAX_FILE_SIZE`.
4. **Type detection** — `detectDataType()` matches the column headers against
   `REQUIRED_COLUMNS`. No filename or subject convention is involved.
5. **Type allowlist (strict)** — the detected type must be on
   `MAILBOX_IMPORT_ALLOWED_TYPES` (defaults to `punch_data` only). In practice the
   punch feed is the *only* report that arrives by email; every other `*_raw`
   dataset comes from the warehouse queries, so a recognised-but-not-allowed file
   is refused whole to `QTIP Failed`. This stops a stray or spoofed spreadsheet of
   another type injecting rows into the raw tables — which matters because those
   other six tables do not self-heal on re-import the way `punch_raw` does.
6. **Claim** — the message is marked read.
7. **Import** — `runImport()`, the same path the Manual Upload page uses.
8. **File** — the message moves to `QTIP Processed`, or `QTIP Failed` if any
   step refused it. Both folders are created under the Inbox on first use.

Three ordering decisions carry weight:

- **Oldest message first.** The punch report arrives repeatedly with an identical
  subject and filename, and `punch_raw` heals in place on Post ID, so the newest
  copy has to import last or a stale one overwrites good rows.
- **Mark read before importing, not after.** Marking read is the claim. A crash
  mid-import leaves the message read, so the next tick — which asks only for
  unread mail — will not load the same rows again.
- **All attachments are typed before any are imported.** A message carrying one
  good file and one unrecognised file is refused whole rather than half-loaded.

**Nothing here deletes mail.** Every mistake this makes is recoverable from the
mailbox.

### Knowing the poller is alive

A tick that finds no mail logs nothing, which is the right default — at ten
minute intervals a heartbeat on every tick would add ~144 lines a day saying
nothing happened. But it leaves no way to tell a quiet mailbox from a dead
timer, so **once an hour the poller reports in**:

```
[MAILBOX] alive — 6 check(s) in the last 60min, 0 imported, 0 rejected. Last import: 2026-08-04T10:02:11.402Z
```

Read it as a liveness check, not an import record. Two things to know:

- **A tick that never reached the mailbox is not counted**, so the check count
  reflects real polls. If the hourly line stops appearing entirely, the timer
  itself is gone and the process needs a restart.
- The counters cover the last hour only and reset each time the line prints;
  `Last import` is absolute and survives across hours. `import_logs` remains the
  authoritative record of what loaded.

The interval is `HEARTBEAT_MINUTES` in `MailboxImportScheduler.ts`. It is a
constant rather than an env var because there is no reason for it to differ
between environments.

---

## Security

Anything accepted here writes to warehouse tables, so the gates matter.

### The allowlist

Managed at **Admin > List Management > Data Imports > Import Email Senders**. It
is `list_items` rows under `list_type = 'mailbox_import_sender'`, with the
address in `label` — the same generic list mechanism as every other configurable
list, which is why this feature needed no schema change. Deactivating a row
revokes it without losing the record that it was once allowed.

**An empty list allows nobody.** A half-configured install fails closed.

### The sender is external, and that is unavoidable

The punch report comes from `no-reply@centralservers.com`, relayed through
`socketlabs.paychex.com`. It is not an internal address, so the mailbox **cannot**
be locked to internal senders — that would block the only thing it exists to
receive.

A `From` address is trivially forged, and this mail server does not currently
stamp `Authentication-Results` (messages arrive with
`X-MS-Exchange-Organization-AuthAs: Anonymous`). The DKIM signatures Paychex
sends are present but unverified, and a raw `DKIM-Signature` header proves
nothing on its own — anyone can paste one in. So today, sender identity rests on
the allowlist plus the requirement that the attachment actually parse as a known
report shape. The poller logs a warning once per process saying so.

**The durable fix is an IT change, not a code change:** enable DKIM/DMARC
validation on the mail gateway so it stamps `Authentication-Results`. The check
in `authVerdict()` already enforces that header whenever it is present, so this
tightens itself the moment the gateway starts stamping — no deploy needed.

Sizing the residual risk honestly: forging this requires knowing the mailbox
exists, spoofing the exact sender, and producing a valid punch workbook with real
Post IDs. The consequence would be wrong punches and therefore wrong attendance
points — visible on the Attendance report, and self-healing, because re-importing
the genuine file overwrites rows on Post ID.

### Other gates

- Extension check, **not** MIME type. Paychex labels its `.xlsx` as
  `application/ms-excel`, so a content-type check would reject every real file.
- The filename is recorded on `import_logs` but never used for routing or paths.
- Detection refuses ambiguity rather than guessing, because a wrong guess writes
  real rows into the wrong table with no error to notice.

---

## Turning it on

1. Set the `EXCHANGE_*` variables. `EXCHANGE_USER` is `DOMAIN\user`.
2. Set `MAILBOX_IMPORT_USER_ID` to a real `users.id` for the service account.
3. Add the Paychex sender at Admin > List Management > Data Imports.
4. Leave `MAILBOX_IMPORT_DRY_RUN=true` and watch a tick in the log. It reports
   exactly what it would have imported, and touches nothing.
5. Clear or floor any pre-existing mail — either mark it read in Outlook, or set
   `MAILBOX_IMPORT_IGNORE_BEFORE` to today.
6. Set `MAILBOX_IMPORT_DRY_RUN=false`.

`MAILBOX_IMPORT_DRY_RUN` defaults to `true` even in production, which is
deliberately unlike `MAIL_DEV_DRY_RUN`. Outbound mail is embarrassing when it
misfires; this loads data.

---

## Where imports show up

Mailbox imports create ordinary `import_logs` rows, so they appear in the
per-type history on the Manual Upload page. They are tagged
`error_details.source = 'mailbox'` alongside the sending address and subject, so
an emailed import is distinguishable from a hand upload.

**A message rejected before import creates no `import_logs` row**, because
inventing one would need a bogus `data_type` and would pollute import history.
For those, the record is the `QTIP Failed` folder plus a `[MAILBOX]` warning in
the application log naming the message and the reason. If a file you emailed
never appears, that folder is where to look.

---

## Email feeds, schedules and the unified ingestion log

The Admin > Insights section presents mailbox imports next to the SQL
source-report pipeline so operators watch one place:

- **Report Schedules** (`/app/admin/insights/source-reports`) shows the SQL
  source reports (Edit / Run now) and, below them, an **Email Feeds** table.
  Each email feed is one expected mailbox file. Admins add / edit / remove feeds
  right on this card; the per-feed action is **Manual upload** (a drawer over
  the shared `ManualUploadPanel`) rather than Run now, because a feed's data
  arrives by email, not by a scheduled SQL run.
- **Ingestion Log** (`/app/admin/insights/ingestion`) is a single list across
  three channels — `sql` (`ie_ingestion_log`), `email` and `manual` (both
  `import_logs`, split on the `error_details.source` stamp) — filterable by
  channel and status.

### The feed registry (`mailbox_import_feed` table)

Feeds live in the `mailbox_import_feed` table — a first-class sibling of
`ie_source_report`, added by migration `20260813120000_create_mailbox_import_feed`.
Each row is `data_type` (unique; the key that ties the feed to its import
handler and `import_logs` history), `display_name`, an optional free-text
`cadence_label`, `is_active` and `sort_order`. Management is CRUD via
`/api/insights/admin/email-feeds` from the Email Feeds card — no List Management
entry. A row whose data_type is no longer a known import type is skipped on read
rather than shown broken. `last_*` status on the schedule row is derived from the
most recent `import_logs` row for that data_type — there is no per-feed run
cadence, because one poller drains every feed on the same tick (so `cadence_label`
is a display-only expectation note).

### Failure alerts

Any ingestion failure emails the **Alert Recipients** list (List Management >
Notifications; admins are toggleable on the template) via the locked
`system.ingestion_failed` template. `notifyIngestionFailure()` is the single
entry point, called from four sites: a live mailbox rejection, an Excel import
failure (`runImport`, covering both email and manual), a manual "Run now"
report failure, and the source-report dispatcher. Repeated failures of the same
feed on the same day dedupe to one mail (`entityId = channel:code:YYYY-MM-DD`),
with the NotificationService rate-limit and circuit-breaker as the second line.
A dry-run mailbox rejection does **not** alert — it is a rehearsal, not a miss.

---

## Code map

| Concern | File |
|---------|------|
| EWS transport (find, read, mark, move) | `backend/src/services/mailbox/ExchangeMailClient.ts` |
| The tick, the gates, the ordering | `backend/src/services/mailbox/MailboxImportScheduler.ts` |
| Allowlist + import attribution | `backend/src/services/mailbox/senderAllowlist.ts` |
| Column-based type detection | `detectDataType()` in `backend/src/services/importService.ts` |
| Shared import path + punch rescore | `backend/src/services/imports/runImport.ts` |
| Config | `mailboxImportConfig` in `backend/src/config/environment.ts` |
| Startup wiring | `backend/src/index.ts` (boot IIFE, after the email block) |
| Sender allowlist UI | `frontend/src/pages/admin/ListManagementPage.tsx` (Data Imports section) |
| Email feed table | migration `20260813120000_create_mailbox_import_feed` |
| Email feed registry | `backend/src/services/mailbox/feedRegistry.ts` (`mailbox_import_feed`) |
| Email feed API (CRUD) | `backend/src/controllers/insightsAdminEmailFeed.controller.ts` |
| Unified ingestion log | `backend/src/controllers/insightsAdminIngestion.controller.ts` + `services/imports/importLogView.ts` |
| Failure alert | `backend/src/services/notifications/ingestionAlerts.ts` + `email/templates/system.ingestion_failed*.hbs` |
| Report Schedules + feeds UI | `frontend/src/components/insights/EmailFeedsCard.tsx`, `EmailFeedFormDialog.tsx`, `ManualUploadPanel.tsx` |
| Tests | `backend/src/services/mailbox/__tests__/`, `backend/src/services/__tests__/detectDataType.test.ts` |

`runImport.ts` is shared with `controllers/importController.ts` on purpose: an
emailed punch file and an uploaded one must trigger the same 90-day attendance
rescore, and two copies of that would eventually stop agreeing.

---

## Dependencies

`ews-javascript-api` and `@ewsjs/xhr` (both MIT). NTLM lives in the XHR layer,
which is why both are needed.

Two traps worth remembering if these are ever upgraded:

- `@ewsjs/xhr` v3 runs on axios and handles encoding itself. **v2 required
  `new XhrApi({ gzip: true })`** or EWS replies failed to parse with a misleading
  "invalid tagName" error. If you downgrade, that flag comes back.
- `Items` is a real getter on every EWS complex-property collection at runtime,
  but the shipped typings omit it from `AttachmentCollection`. Hence the
  `collectionItems()` helper rather than reading `.Items` directly.

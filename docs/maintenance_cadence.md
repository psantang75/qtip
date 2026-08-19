# Maintenance & code-health cadence

The standing rhythm that keeps QTIP clean after the one-time visibility +
cleanup program. The goal is the campsite rule — leave each file a little better
than you found it — never a big-bang rewrite.

## Per change (every PR)

- Self-review the full diff before merging.
- Green gate is a hard stop: `npm run lint`, the TypeScript build
  (`npm run build` / `tsc`), and `npm test` must pass on `main`.
- Obey the guardrails: Prisma for DB access, the `AppError` envelope for API
  errors, shadcn/ui + `optionCls` for controls, TanStack Table for grids,
  lucide for icons, brand tokens for color. See [`../AGENTS.md`](../AGENTS.md)
  and the scoped rules in [`../.cursor/rules`](../.cursor/rules).
- If you touch an oversized file (>300 lines), extract a cohesive piece rather
  than adding to it.
- Never add tables or change the schema without explicit approval
  (see [`database_schema_updates.md`](./database_schema_updates.md)).

## Weekly (~30–60 min)

- Skim the week's diffs for "a second way to do the same thing" (a new helper
  that duplicates an existing one, a hand-rolled control, a raw `fetch`/axios).
- Fold duplicates back into the shared helper/component in the same pass.

## Monthly (~half day)

- Clean one theme end-to-end (e.g. finish migrating a controller family to
  Prisma, or migrate one page's tables to `SortableTable`).
- Spot-check rule adherence on the busiest subsystems (AI reviewer, insights
  admin, forms/scoring, writeups).

## Quarterly (1–2 days)

- Structural review: file sizes, dead code, dependency bloat, DB index hygiene
  (revisit [`database_review.md`](./database_review.md) and re-`EXPLAIN` the hot
  queries).
- Commit to at most 1–2 scoped reworks — do not open more than you can finish.

## Carry-forward backlog (from the cleanup program)

These were started as verified pilots; continue them under the cadence above:

- Backend data access: the entire `insightsAdmin*` controller family is now on
  Prisma + the `AppError` envelope — `insightsAdminKpi`, `insightsAdminPage`,
  `insightsAdminSourceReport` (the `IeSourceReport` model was added for the
  pre-existing `ie_source_report` table — model only, no migration), and
  `insightsAdminIngestion` (its `ie_ingestion_log` read moved to
  `prisma.ieIngestionLog`). No admin controller touches the `mysql2` pool now.
  Remaining pool users are the Insights **data-warehouse** layer
  (`services/QC*Data`, `QCKpiService`, `workers/`, rollups, `insightsQC` /
  `insights` read controllers) — deliberately hand-written SQL, NOT conversion
  targets. The `SourceReportDispatcher` / `SourceReportSyncWorker` also keep
  their raw SQL; Prisma and those workers share the same `ie_source_report`
  rows.
- Backend mega-files:
  - `ai-reviewer.routes.ts` — thinning it by moving inline handlers into
    `controllers/aiReviewer/*.controller.ts` (routes stay wiring-only). Done so
    far: the **base-prompts** domain (`basePrompts.controller.ts` +
    `shared.ts#parsePositiveInt`), the **rule-packs** domain
    (`rulePacks.controller.ts` — library CRUD + the two per-form
    `/forms/:formId/rule-packs` assignment routes), and the **golden-set**
    domain (`goldenSet.controller.ts` — list/mark-manual/status/archive/
    restore, backed by `AIGoldenSetService`), and the **eval-run** domain
    (`evalRuns.controller.ts` — manual `/eval/run` + `/eval/latest`, backed
    by `AIGoldenEvalRunner`; `runGoldenEval` stays imported in the routes
    file because other handlers fire it), the **calibration-map** domain
    (`calibrationMap.controller.ts` — get/preview/fit/activate, backed by
    `ConfidenceCalibratorFitter` + `ConfidenceCalibrator`), and the
    **rubrics** domain (`rubrics.controller.ts` — list/upsert/delete per-
    question rubrics), the **calibration** domain (`calibration.controller.ts`
    — calibration-tab metrics/recent/settings + the learned-corrections
    lifecycle: corrections-preview/absorbed/absorb/reset; the settings-only
    `normalizeGuidance`, `runGoldenEval`, and `AI_REVIEW_GUIDANCE_MAX_CHARS`
    moved with it), and the **forms read/diagnostics** group
    (`formsDiagnostics.controller.ts` — `/forms` list + readiness, preview-
    prompt, kb-coverage, cost-status, cost-rollup, drift; the diagnostic-only
    `previewSystemPrompt`, `aggregateKbCoverage`, `getDriftStatusForForm`, and
    `getCostStatusForForm` moved with it). The service-error domains
    consolidated their duplicated `*Error → HTTP` mapping into one
    `handle*Error` helper, mirroring `basePrompts.controller.ts`. Every slice
    is verified behavior-preserving: after each move the full
    `router.<verb>('<path>')` inventory is diffed against `git HEAD` and must
    stay identical (53 routes, 15 `authorizeAdmin` guards, same methods/paths)
    on top of lint + `tsc --noEmit` + the backend test suite. This brought the
    route file from ~2,440 → ~1,140 lines. What deliberately STAYS inline: the
    submission-flow handlers (`/run`, `/inbox`, `/ticket/:id`, `/draft`,
    `/promote-draft`, `/calibration-overlay`) and the global `/health` +
    `/_smoke` monitoring endpoints — these are not thin CRUD and share the
    `SubmissionService` wiring, so they're a separate, higher-risk slice for
    later (or leave as-is).
  - `AIReviewerService.ts` — continue extracting cohesive units (adapters,
    feedback composers) into siblings such as `aiReviewerParsing.ts`. Done so
    far: the pure JSON→typed output parsers + post-parse normalization
    (`parsePlaybookSteps`, `parseCoachingBlock`, `detectSelfConsistencyWarnings`,
    `enforceEvidenceFloor`/`isPositiveVerdict`, `parseTimelineArray`,
    `parseObservationsArray` + the `PLAYBOOK_STATUSES`/`OBSERVATION_*` sets) →
    `aiReviewerOutputParsers.ts`. They depend only on submission/form TYPES (no
    prisma, no LLM clients, no module state) and are re-imported so
    `mapClaudeOutputToAnswers` and the `_internal` test exports are unchanged;
    verified by `tsc --noEmit` + the full backend suite (673 passing, incl. the
    `_internal` self-consistency/evidence-floor tests). Then two more
    type-only/pure slices: the reviewer-facing feedback composition
    (`buildKbLinkifier` + `composeCategoryFeedback` + `composeBottomFeedback`) →
    `aiReviewerFeedback.ts`, and answer validation + NA-gate guards
    (`validateAnswerForQuestion`, `applyNaGateGuards`) →
    `aiReviewerAnswerValidation.ts`. Both re-imported so the class + `_internal`
    exports are unchanged; `buildKbLinkifier` stays module-private (only the
    composers use it) and the now-unused `CATEGORY_FEEDBACK_TEXT_PREFIX_RE`
    import was dropped. Then the **KB grounding** group (`searchKb`,
    `classifyCallTopic` + its in-process `callTopicCache`/`_clearCallTopicCache`,
    `fetchPivotKbPool`, `mergeKbHitsByUrl`, `UNIVERSAL_KB_URLS`, the `KbHit`
    type, and the `PivotKbCoverage` interface) → `aiReviewerKb.ts` (676 lines).
    Safe because none of it touches `AIReviewerServiceError` or the class — it
    depends only on the KB service layer (`BookStackService`, `KbIndexService`,
    `kbProcedureParser`), Prisma (`kb_pages_meta`), the Anthropic client + call
    logger, and plain types — so there's no back-dependency / import cycle. The
    class re-imports the functions; `_clearCallTopicCache` and the
    `PivotKbCoverage` type are re-exported from `AIReviewerService` so the
    reviewCase test import and any external `PivotKbCoverage` importer are
    unaffected; the now-unused `kbIndexService` + `parseKbApproaches` imports
    were dropped (only `ParsedProcedure` stays, still used by the class).
    Then the **types/errors hoist + case loading**: a neutral
    `aiReviewerTypes.ts` (100 lines — `AIReviewerServiceError`, `Case`/
    `CaseSourceRef`/`InteractionMaterial`/`SubmissionLinkPayload`, `formatCaseId`)
    that both the engine and the source-system layer can depend on without a
    cycle, and `aiReviewerCaseLoading.ts` (~560 lines — the `TicketAdapter`/
    `TaskAdapter`/`ConversationAdapter` interaction adapters, `loadCase`,
    header-flatteners, `pickAdapter`/`loadAdapterMaterial`, the call-window note
    cutoff `filterPostAuditNotes`/`renderAuditScopeLine`/`resolvePostCallDocWindowMs`,
    and `mergeSubmissionLinks`/`adapterLinkFor`). `aiReviewerCaseLoading` depends
    only on the source services (`CRMService`, `PhoneSystemService`,
    `CallTicketLinkerService`) + `aiReviewerTypes`, so there's no back-dependency
    on the engine; the now-unused `crmService`/`phoneSystemService`/
    `linkCallToTicket` imports were dropped from the engine. `AIReviewerServiceError`,
    `loadCase`, `formatCaseId`, and the Case/material types are re-exported from
    `AIReviewerService` so the routes, golden-eval runner, and reviewCase test
    keep their existing import paths.
    Cumulatively the engine file is down from ~4,990 → ~3,150 lines across six
    sibling modules (`aiReviewerOutputParsers` 270, `aiReviewerFeedback` 188,
    `aiReviewerAnswerValidation` 199, `aiReviewerKb` 676, `aiReviewerTypes` 100,
    `aiReviewerCaseLoading` ~560), verified each time by `tsc --noEmit` + the
    full backend suite (673 passing).
    **DONE to a safe floor — stop here.** The remaining ~3,150 lines are the
    orchestrator class itself (~1,195 lines, `AIReviewerService` at ~line 218–1412,
    which is the core and should not be gutted) plus the cohesive LLM
    reasoning tail below it (`callLlm`/`callAnthropic`/`callOpenAI`, the trace/
    reasoning/answer-chunk/reconciliation passes, `runChunkedSynthesis`,
    `callClaude`, `mapClaudeOutputToAnswers`, `parseDraftAnswers`,
    `extractNarrative` — ~1,300 lines). That tail is deliberately LEFT INLINE: it
    is one large, prompt-critical block where a silent transcription slip would
    quietly degrade grading quality, and the AI Reviewer is not in active
    production use yet, so the passes are not exercised end-to-end. A verbatim
    move that large is disproportionately risky for a purely structural gain. If
    it's ever split, do it while the reviewer is actively running (so the passes
    get real end-to-end coverage), as one `aiReviewerReasoning.ts` module (all
    intra-group calls stay internal; the class imports the ~8 entry points; verify
    the moved lines are byte-identical via `git diff` on top of `tsc` + tests).
- Backend tests: keep adding controller/HTTP-layer tests (mock `config/prisma`).
  Done for the Insights-admin controllers migrated to Prisma — `insightsAdminKpi`
  (pilot), plus `insightsAdminPage`, `insightsAdminSourceReport`, and
  `insightsAdminIngestion` (`__tests__/*.controller.test.ts`, +21 cases). They
  mock `config/prisma` (and, per file, `middleware/qcCache`, the
  `SourceReportSyncWorker`, and `ingestionAlerts`) and assert the exact response
  shape + the `AppError` envelope surfaced via `next()` (400 invalid id /
  validation, 403 unauthenticated, 404 missing row incl. Prisma `P2025` → 404).
  Suite now 694 passing. Next candidates: the other Prisma controllers as they're
  touched.
- Frontend tables: `SortableTable` now takes optional client-side pagination
  (`paginated` + `initialPageSize`/`pageSizeOptions`) via TanStack's
  `getPaginationRowModel` and the shared `ListPagination` footer — sorting spans
  the full dataset, then the visible page is sliced. `QCQualityPage`'s
  "QA Forms Below 90%" grid was migrated onto it (dropped its hand-rolled
  `<table>` + local page/pageSize state + the reset `useEffect`).
  "Department Comparison" on the same page was also migrated (flat table →
  `SortableTable`, gains sortable columns; Status stays `enableSorting:false`
  since it's derived from QA Score). LEFT hand-rolled on purpose:
  "QA Forms Completed" — it renders per-(QA-person, form) groups each with a
  bold subtotal row, which `SortableTable`'s single `totalRow` footer can't
  model without adding grouping support (a bigger change than the payoff).
  Revisit only if `SortableTable` grows real row-grouping.
- Frontend controls: DONE for the native picker sweep — every raw `<select>`,
  `<input type=checkbox>`, and `<input type=radio>` in `frontend/src` is now a
  shadcn primitive (verified: `rg '<select|type="radio"|type="checkbox"'
  frontend/src` returns only a doc comment in `ManualRunCard`). Converted:
  `QaSearchModal` (pilot); `<select>` → shadcn `Select` in `LibraryResourcesPage`,
  `CoachingSessionDetailPage`, and the shared list-management editors
  `GenericListEditor` + `CampaignListEditor`; `<input type=checkbox>` → shadcn
  `Checkbox` in `CoachingSessionDetailPage`, `MetadataStep`, `QuestionEditPanel`
  (3), `MyCoachingDetailPage`, and `LearnedCorrectionsPanel`; `QuizBuilder`'s
  correct-answer `<input type=radio>` → a lucide `CheckCircle2`/`Circle` toggle
  button (no `radio-group` primitive exists and adding a `@radix-ui` dep needs
  sign-off). Radix `Select` forbids an empty-string item value, so the
  list-management category / reference / meta pickers map `''` ↔ a `__none__`/
  `__empty__` sentinel at the Select boundary only (row state + persisted
  payload still use `''`). NEEDS A BROWSER EYEBALL: the list-management editors
  live under Admin → List Management (Scheduling → Call Campaigns, and the
  scheduling/attendance list editors) — confirm the dropdowns still sit inline
  in the edit row and the "No category"/"Not linked"/"reference" options
  round-trip. Remaining (lower value): stray raw `<button>`s used for primary
  actions could still move to shadcn `Button`, case-by-case when touched.
- Frontend layout: `ListPageShell` adoption is effectively DONE — every real
  list page already wraps in it (Submissions, Disputes, WriteUps/MyWriteUps,
  ReviewForms, FormBuilderList, the Library pages, Coaching pages,
  AIReviewer list/inbox, scheduling list pages, etc.). The only remaining
  hand-rolled `p-6` roots (`rg 'className="p-6 space-y-[0-9]' frontend/src/pages`)
  are NOT list pages and shouldn't adopt it: `FormsPage` (form-builder wizard),
  `AuditFormPage` + `SubmissionDetailPage` (detail/form views on `space-y-4`),
  and `QualityAnalyticsPage` — which was DEAD CODE (only self-referenced; not
  imported in `AppRoutes`; the `analytics` route redirects to
  `/app/insights/qc-quality`) and has been DELETED (tsc clean afterward,
  confirming nothing referenced it).
  Still open: unify bespoke filter bars / multi-selects onto the shared
  `ListFilterBar`/`InsightsFilterBar` + `StagedMultiSelect`/`SearchableMultiSelect`.
  This is a visual, prominent-UI change → do it deliberately with a browser
  verification pass, not as a blind sweep.
- DB: the HIGH-value indexes + the `ScheduleShift` redundant-index drop from
  [`database_review.md`](./database_review.md) were approved and APPLIED as
  migration `20260818190000_add_perf_indexes_drop_redundant_shift_index`
  (hand-authored SQL via `prisma migrate deploy`; verified with `EXPLAIN`).
  Still proposal-only (needs approval): the `*Raw` unique-grain + idempotent
  import work, the `AiFormRulePackAssignment` FK/`onDelete`, and the enum/hygiene
  items. NOTE: this repo's `schema.prisma` is a deliberate partial model — NEVER
  run `prisma migrate dev`; use hand-authored `migration.sql` + `prisma migrate
  deploy` (see [`database_schema_updates.md`](./database_schema_updates.md)).
- Lint gate wiring — RESOLVED (Phase 1). `backend/package.json` now has
  `lint`/`lint:fix`/`typecheck`, and `backend/eslint.config.mjs` (flat config,
  typescript-eslint) mirrors the frontend. Root `npm run lint:backend` is green.
  Adoption used the industry-standard ratchet: rules that fire on intentional
  patterns are `off` (see the config header), and pre-existing style debt is
  `warn` (currently **101 warnings, 0 errors**) so the gate stays green without
  churning ~25 unrelated files. **Burn-down:** clear warnings as you touch files
  (biggest buckets: `prefer-const` ~50, `@typescript-eslint/no-unused-vars` ~42);
  when a rule reaches zero, promote it from `warn` to `error`. `no-unused-vars`
  is the first promotion target (the maintainer explicitly cares about
  "declared but never read").
- Build type-gate — PARTIAL (Phase 1); real fix reopened as a follow-up.
  Attempting to remove `|| true` from the `deploy/Dockerfile` `tsc` step failed
  the stage build with type errors across **~50 files** — because that stage runs
  `npm install` (not `npm ci`) with **no lockfile**, so it resolves newer typed
  deps (`@types/express`, `mysql2` drifted 3.15→3.23, …) than the committed
  lockfile. Those errors DO NOT exist against our pinned versions (local
  `tsc --noEmit` is clean). Root cause = **non-reproducible Docker install**, not
  our code. Decisions:
  - `|| true` is kept (with an explanatory comment) so dep drift can't block
    deploys. The authoritative type gate is the reproducible **pre-deploy** step
    (`npm run typecheck` / `tsc` against the lockfile) — already a hard stop in
    "Per change" above.
  - `mysql2` pinned to `3.15.3` (the tested version) as a first reproducibility
    step; runtime API is unchanged.
  - **Follow-up (needs a real Docker build to verify):** make the backend image
    install reproducible — commit a backend-scoped lockfile and switch the stage
    to `npm ci` (mind npm-workspace hoisting vs. the production stage's
    `backend/node_modules` copy) — THEN remove `|| true` so the image build gates
    on tsc too. Do not attempt blind; build on the box or with local Docker.
- Pagination cap drift — RESOLVED (Phase 2, part 2.1). `validation/common.ts` now
  exports `parsePagination(query, { defaultLimit, maxLimit })` → `{ page, limit,
  skip }`, the **canonical** parser for every list endpoint. It reads the
  `limit`/`pageSize`/`perPage` aliases and hard-caps `limit` at `MAX_PAGE_SIZE`
  (1000) by default. Replaced the ~17 hand-rolled `parseInt(req.query.page …)`
  snippets that had drifted to caps of **5000** (coaching, coachingReport,
  resource, manager/disputes, writeups/list), **unbounded** (auditLog,
  auditAssignment, department, user, directorDepartment, manager/audits, admin,
  submission.routes, enhancedPerformanceGoal.routes, submission getAssignedAudits),
  and the already-safe 1000 hand-rolls (admin completed-forms, dispute history,
  trainer/submissions, auditLog.routes, qa/submissions via its `cfg`). Verified
  safe: frontend `CLIENT_FETCH_LIMIT = 1000`, so the cap never truncates a real
  client. Unit-tested in `validation/__tests__/pagination.test.ts`. LEFT on purpose
  (intentional smaller/custom caps): `reportController`/`importController` (100),
  `admin/emailTemplates` (200/500), `quizLibrary` (its own const), the AI-reviewer
  `parsePositiveInt` handlers, and `insightsAdminIngestion` (`clampLimit`). Use
  `parsePagination` for any NEW list endpoint — do not re-introduce inline parsing.
- Error-envelope migration (legacy `res.status(n).json({ message })` / shape C →
  thrown `AppError` + `asyncHandler`, rendered as shape A) — Phase 2, part 2.2, IN
  PROGRESS. Safe because the frontend's shared `utils/errorHandling.ts`
  (`getBackendMessage`/`getErrorMessage`) already normalizes shapes A/B/C and keys
  401/403/5xx off HTTP status — so flipping a controller's ERROR path is transparent
  **iff** the HTTP status and the SUCCESS payload are preserved verbatim.
  - DONE: `dispute.controller.ts` (all 6 handlers → `asyncHandler` + `AppError`;
    status codes + success payloads unchanged; `updateDispute` keeps its
    file-cleanup guarantee by cleaning up then re-throwing in the catch;
    `downloadDisputeAttachment` keeps its mid-stream `on('error')` terminal 500).
    Covered by `controllers/__tests__/dispute.controller.test.ts` (13 tests over the
    401/400/404/403 branches). Also burned 3 lint warnings (unused imports) → 98.
  - DONE: `coaching.controller.ts` (all 12 handlers → `asyncHandler` + `AppError`;
    status codes + `{success:true,…}` success payloads unchanged, incl. the
    `setSessionStatus` early `Status unchanged` 200 and `downloadAttachment`'s
    mid-stream `on('error')` terminal 500). The six legacy `403 { code:'LEGACY_LOCKED' }`
    lock responses become `createAuthorizationError(lock.message ?? LEGACY_LOCKED_MESSAGE)`
    — verified the frontend never reads `data.code === 'LEGACY_LOCKED'` (it only mirrors
    the lock rule client-side to pre-disable buttons), so dropping the `code` field is
    safe; the 403 + message contract is preserved. Removed the now-unused `logger`
    import (global handler logs). Covered by
    `controllers/__tests__/coaching.controller.test.ts` (19 tests). Lint 98 → 97.
  - DONE: `quizLibrary` / `resource` / `onDemandReports` / `phoneSystem` controllers
    (one slice). All handlers → `asyncHandler` + `AppError`; success payloads unchanged.
    Notable preserved semantics: quizLibrary's **409** conflict (built as
    `new AppError(msg, VALIDATION_ERROR, 409)` since there's no 409 factory); resource's
    signed-view-token **401s** (via a local `unauthorized()` helper — the factory default
    is 403) and its two streaming handlers' mid-stream `on('error')` 500s; onDemandReports'
    repeated auth/lookup/role preamble refactored into shared `requireUser` +
    `requireReportForUser` guards (kills 4× duplication) that throw 401/404/403; phoneSystem's
    health **200/503** payload left verbatim (client reads `status`), its streaming
    416/range + `on('error')` paths kept, pre-stream 400/404/**502** guards → throws, and the
    `error:<message>` detail field dropped from 500s (the global handler no longer leaks it).
    Removed now-dead `logger`/`serviceLogger` imports where every catch went away (phoneSystem
    keeps `logger` for its `logger.info` diagnostics). Covered by 35 new tests across
    `controllers/__tests__/{quizLibrary,resource,onDemandReports,phoneSystem}.controller.test.ts`.
    tsc + full backend suite green (769 passed), lint 97/0.
  - DONE: `admin.controller.ts` (all 14 handlers → `asyncHandler` + `AppError`).
    This file mixed **two** legacy success shapes and both were preserved verbatim:
    the dashboard/forms handlers (`getAdminStats`, `getCSRActivity`, `getCompletedForms`,
    `getCompletedFormDetails`, `exportCompletedForm`) return **raw** payloads
    (`res.status(200).json(data)` / CSV `res.send`), while `getAdminCSRs` and every
    coaching handler keep `{success,data[,total,message]}`. Only the error paths moved
    to thrown `AppError` (400 `createValidationError`, 404 `createNotFoundError`, 403
    `createAuthorizationError`, 401/500 `new AppError`). The 8 coaching handlers repeated
    the same `401-if-no-user` + `getRoleId('CSR')`/`500-if-missing` preamble, so it was
    consolidated into two shared guards — `requireUserId(req)` (401) and
    `resolveCsrRoleId()` (500) — killing ~8× duplication; `getAdminCSRs` was retrofitted
    to the same guards for a single source of truth. Preserved semantics:
    `getAdminCoachingSessions`' `limit>100` **400** guard (still enforced on top of the
    shared 1000-cap), `updateAdminCoachingSession`'s `checkLegacyLock` audit call, and
    `downloadAdminCoachingSessionAttachment`'s mid-stream `on('error')` 500. Removed the
    now-dead `serviceLogger` import (`logger` stays for `getRoleId` + attachment I/O).
    Covered by 22 new tests in `controllers/__tests__/admin.controller.test.ts`.
    tsc + full backend suite green (791 passed), lint 97/0.
    Handlers are now clean/wrapped, so the Phase 3 file split (dashboard/forms stay in
    `admin.controller.ts`; the 8 coaching handlers → `controllers/admin/adminCoaching.controller.ts`,
    mirroring the existing `admin/emailTemplates.controller.ts`) is a low-risk mechanical
    move + route rewire, not a re-churn of error logic.
  - Order (risk-first): ✅ `dispute` → ✅ `coaching` →
    ✅ `resource`/`onDemandReports`/`quizLibrary`/`phoneSystem` → ✅ `admin` →
    `auth` LAST (sensitive; keep `{token,user}`/`{valid}`/`{ok}`
    success shapes untouched). Add controller tests per slice, mirroring the
    `insightsAdmin*` / dispute pattern.

## Notes / corrections logged during the program

- `config/timezone.ts` and `config/ai.ts` are **not** dead — the first pins the
  process timezone (imported first in `index.ts`); the second exposes the
  `AiProviderConfig` type and a stable import path. Do not remove them.
- Tremor was removed (unused). The custom KPI/chart components in
  `frontend/src/components/insights` are the dashboard standard.

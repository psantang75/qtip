-- =============================================================================
-- Insights — Quality edge-case fixtures
--
-- These rows exercise the corner cases that the golden slice does not cover:
--   1. Empty period            — query against a window with zero finalized
--                                audits must return [] / no NaN.
--   2. All-N/A submission      — earned=0, possible>0 → category score 0%.
--   3. Threshold boundaries     — submissions whose total_score lands exactly
--                                on the goal / warning / critical thresholds
--                                from `ie_kpi_threshold` for `avg_qa_score`.
--   4. All 3 scoring types      — YES_NO + SCALE + RADIO in one category.
--   5. Single-row aggregation   — one isolated department + agent so
--                                getQualityDeptComparison returns a 1-row
--                                group (no division-by-zero, no NaN).
--
-- ⚠️  This file is **fixtures only**. It is NOT loaded by any migration. Do
-- not source it into a production database. Load into a throwaway schema:
--
--   mysql -u root qtip_test -e "source backend/prisma/test-fixtures/quality-edge-cases.sql"
--
-- All IDs are >= 99000 to avoid colliding with seeded / auto-incremented data.
-- The fixtures are scoped to the period 2024-01-01 → 2024-01-31, which is far
-- outside any real submitted_at window in the dev DB so they cannot
-- contaminate live aggregations even if accidentally loaded.
-- =============================================================================

START TRANSACTION;

-- ── Cleanup (idempotent reload) ──────────────────────────────────────────────

DELETE FROM disputes
 WHERE submission_id BETWEEN 99000 AND 99999;
DELETE FROM submission_answers
 WHERE submission_id BETWEEN 99000 AND 99999;
DELETE FROM submission_metadata
 WHERE submission_id BETWEEN 99000 AND 99999;
DELETE FROM submissions
 WHERE id BETWEEN 99000 AND 99999;
DELETE FROM radio_options
 WHERE question_id BETWEEN 99000 AND 99999;
DELETE FROM form_questions
 WHERE id BETWEEN 99000 AND 99999;
DELETE FROM form_categories
 WHERE id BETWEEN 99000 AND 99999;
DELETE FROM form_metadata_fields
 WHERE id BETWEEN 99000 AND 99999;
DELETE FROM forms
 WHERE id BETWEEN 99000 AND 99999;
DELETE FROM users
 WHERE id BETWEEN 99000 AND 99999;
DELETE FROM departments
 WHERE id BETWEEN 99000 AND 99999;

-- ── 1. Departments / users ───────────────────────────────────────────────────

INSERT INTO departments (id, department_name, is_active, parent_id) VALUES
  (99001, 'EdgeCase Dept A', 1, NULL),
  (99002, 'EdgeCase Dept B (single-row)', 1, NULL);

INSERT INTO users (id, username, email, password_hash, role_id, department_id, is_active) VALUES
  (99001, 'edge.qa',    'edge.qa@test',    'x', 4, 99001, 1),  -- QA Auditor
  (99002, 'edge.csr.a', 'edge.csr.a@test', 'x', 3, 99001, 1),  -- CSR in dept A
  (99003, 'edge.csr.b', 'edge.csr.b@test', 'x', 3, 99002, 1);  -- CSR in dept B (single-row)

-- ── 2. Form A — all three scoring question types in one category ─────────────

INSERT INTO forms (id, form_name, interaction_type, version, created_by, is_active) VALUES
  (99001, 'EdgeCase Mixed Form',  'CALL', 1, 99001, 1),
  (99002, 'EdgeCase Empty Form',  'CALL', 1, 99001, 1);

INSERT INTO form_metadata_fields (id, form_id, interaction_type, field_name, field_type, is_required, sort_order) VALUES
  (99001, 99001, 'CALL', 'CSR',              'DROPDOWN', 1, 0),
  (99002, 99001, 'CALL', 'Interaction Date', 'DATE',     1, 1),
  (99003, 99002, 'CALL', 'CSR',              'DROPDOWN', 1, 0);

INSERT INTO form_categories (id, form_id, category_name, weight, sort_order) VALUES
  (99001, 99001, 'Edge Mixed Cat', 1.00, 0),
  (99002, 99002, 'Edge Empty Cat', 1.00, 0);

-- Q99001 YES_NO — yes=10, no=0, na=0   (max contribution: 10)
-- Q99002 SCALE  — scale 1..10           (max contribution: 10)
-- Q99003 RADIO  — Excellent=10, Good=5, Poor=0 (max contribution: 10)
INSERT INTO form_questions (id, category_id, question_text, question_type, weight, sort_order, scale_min, scale_max, is_na_allowed, yes_value, no_value, na_value, visible_to_csr) VALUES
  (99001, 99001, 'YES_NO probe',  'YES_NO', 0, 0, NULL, NULL, 1, 10, 0, 0, 1),
  (99002, 99001, 'SCALE probe',   'SCALE',  0, 1,    1,   10, 0,  1, 0, 0, 1),
  (99003, 99001, 'RADIO probe',   'RADIO',  0, 2, NULL, NULL, 0,  1, 0, 0, 1);

INSERT INTO radio_options (id, question_id, option_text, option_value, score, sort_order) VALUES
  (99001, 99003, 'Excellent', 'excellent', 10, 0),
  (99002, 99003, 'Good',      'good',       5, 1),
  (99003, 99003, 'Poor',      'poor',       0, 2);

-- ── 3. Submissions ───────────────────────────────────────────────────────────

-- All five submissions land in 2024-01, by edge.csr.a (dept A) unless noted.
-- total_score values are aligned with the ie_kpi_threshold rows so the
-- threshold-boundary tests can pin the colour band:
--   avg_qa_score: goal=90  warn=80  crit=70  (UP_IS_GOOD)

-- 99001 — perfect: all max → earned=30, possible=30 → 100% → green
INSERT INTO submissions (id, form_id, submitted_by, submitted_at, total_score, status) VALUES
  (99001, 99001, 99001, '2024-01-05 10:00:00', 100.00, 'FINALIZED');
INSERT INTO submission_metadata (submission_id, field_id, value, date_value) VALUES
  (99001, 99001, '99002', NULL),
  (99001, 99002, '2024-01-04', '2024-01-04');
INSERT INTO submission_answers (submission_id, question_id, answer) VALUES
  (99001, 99001, 'Yes'),
  (99001, 99002, '10'),
  (99001, 99003, 'excellent');

-- 99002 — exactly at GOAL (90.00). YES_NO=Yes(10), SCALE=8, RADIO=Good(5)
--          earned = 10+8+5 = 23,  but total_score is what the API reads.
--          Stored total mimics what the live form-scoring service would
--          produce; for the threshold band tests we only need total_score
--          to land on 90.00.
INSERT INTO submissions (id, form_id, submitted_by, submitted_at, total_score, status) VALUES
  (99002, 99001, 99001, '2024-01-08 10:00:00', 90.00, 'FINALIZED');
INSERT INTO submission_metadata (submission_id, field_id, value, date_value) VALUES
  (99002, 99001, '99002', NULL),
  (99002, 99002, '2024-01-07', '2024-01-07');
INSERT INTO submission_answers (submission_id, question_id, answer) VALUES
  (99002, 99001, 'Yes'),
  (99002, 99002, '8'),
  (99002, 99003, 'good');

-- 99003 — exactly at WARNING (80.00). Same idea, total pinned.
INSERT INTO submissions (id, form_id, submitted_by, submitted_at, total_score, status) VALUES
  (99003, 99001, 99001, '2024-01-12 10:00:00', 80.00, 'FINALIZED');
INSERT INTO submission_metadata (submission_id, field_id, value, date_value) VALUES
  (99003, 99001, '99002', NULL),
  (99003, 99002, '2024-01-11', '2024-01-11');
INSERT INTO submission_answers (submission_id, question_id, answer) VALUES
  (99003, 99001, 'Yes'),
  (99003, 99002, '6'),
  (99003, 99003, 'good');

-- 99004 — exactly at CRITICAL (70.00).
INSERT INTO submissions (id, form_id, submitted_by, submitted_at, total_score, status) VALUES
  (99004, 99001, 99001, '2024-01-15 10:00:00', 70.00, 'FINALIZED');
INSERT INTO submission_metadata (submission_id, field_id, value, date_value) VALUES
  (99004, 99001, '99002', NULL),
  (99004, 99002, '2024-01-14', '2024-01-14');
INSERT INTO submission_answers (submission_id, question_id, answer) VALUES
  (99004, 99001, 'No'),
  (99004, 99002, '5'),
  (99004, 99003, 'good');

-- 99005 — All-N/A. YES_NO answered "n/a" (na_value=0). SCALE / RADIO
--          left empty → ELSE 0 in EARNED_EXPR. Possible for YES_NO is
--          yes_value=10; SCALE = scale_max (10); RADIO = max option score (10).
--          So earned=0, possible=30 → category score 0.0%.
INSERT INTO submissions (id, form_id, submitted_by, submitted_at, total_score, status) VALUES
  (99005, 99001, 99001, '2024-01-20 10:00:00', 0.00, 'FINALIZED');
INSERT INTO submission_metadata (submission_id, field_id, value, date_value) VALUES
  (99005, 99001, '99002', NULL),
  (99005, 99002, '2024-01-19', '2024-01-19');
INSERT INTO submission_answers (submission_id, question_id, answer) VALUES
  (99005, 99001, 'N/A'),
  (99005, 99002, NULL),
  (99005, 99003, NULL);

-- 99006 — single-row dept B. One submission only → dept B aggregate is one row.
INSERT INTO submissions (id, form_id, submitted_by, submitted_at, total_score, status) VALUES
  (99006, 99001, 99001, '2024-01-25 10:00:00', 88.00, 'FINALIZED');
INSERT INTO submission_metadata (submission_id, field_id, value, date_value) VALUES
  (99006, 99001, '99003', NULL),
  (99006, 99002, '2024-01-24', '2024-01-24');
INSERT INTO submission_answers (submission_id, question_id, answer) VALUES
  (99006, 99001, 'Yes'),
  (99006, 99002, '7'),
  (99006, 99003, 'good');

-- 99007 — DRAFT (must be excluded by `WHERE s.status = 'FINALIZED'`).
INSERT INTO submissions (id, form_id, submitted_by, submitted_at, total_score, status) VALUES
  (99007, 99001, 99001, '2024-01-26 10:00:00', 100.00, 'DRAFT');
INSERT INTO submission_metadata (submission_id, field_id, value, date_value) VALUES
  (99007, 99001, '99002', NULL),
  (99007, 99002, '2024-01-25', '2024-01-25');
INSERT INTO submission_answers (submission_id, question_id, answer) VALUES
  (99007, 99001, 'Yes'),
  (99007, 99002, '10'),
  (99007, 99003, 'excellent');

-- ── 4. Disputes ──────────────────────────────────────────────────────────────
-- One UPHELD + one ADJUSTED on the dept-A submissions so the dispute_rate /
-- dispute_upheld_rate / dispute_adjusted_rate edge cases (0/0 protection,
-- ratio rounding) can be asserted.
INSERT INTO disputes (id, submission_id, disputed_by, resolved_by, created_at, resolved_at, status, reason, resolution_notes) VALUES
  (99001, 99002, 99002, 99001, '2024-01-09 09:00:00', '2024-01-12 09:00:00', 'UPHELD',   'edge: upheld',   'edge'),
  (99002, 99003, 99002, 99001, '2024-01-13 09:00:00', '2024-01-14 09:00:00', 'ADJUSTED', 'edge: adjusted', 'edge');

-- ── 5. Pinned expectations (for the integration tests) ─────────────────────
-- Period: 2024-01-01 .. 2024-01-31, dept_filter = [99001]
--   getScoreDistribution → [{70-79:1}, {80-89:1}, {90-100:2}, {Below 60:1}]
--                          (99001=100, 99002=90, 99003=80, 99004=70, 99005=0)
--   getCategoryScores (slice user 99002):
--     audits = 5  (99001..99005)
--     earned per submission:
--       99001 perfect:  Yes(10) + SCALE 10 + RADIO excellent(10) = 30
--       99002 @goal:    Yes(10) + SCALE  8 + RADIO good(5)       = 23
--       99003 @warn:    Yes(10) + SCALE  6 + RADIO good(5)       = 21
--       99004 @crit:    No(0)   + SCALE  5 + RADIO good(5)       = 10
--       99005 all-NA:   N/A(0)  + null(0) + null(0)               =  0
--     earned total = 84,  possible = 5 × 30 = 150
--     score = 84/150 × 100 = 56.0000 → 56.0
--     priorScore = null (no Dec-2023 fixtures)
--   getCategoryScores (user 99003): audits = 1, earned = 22, possible = 30
--                                   score = 73.3333… → 73.3
--   getFormScores (dept 99001): "EdgeCase Mixed Form", submissions = 5,
--                                avg(total_score) = (100+90+80+70+0)/5 = 68.0
--   getFormScores (dept 99002): "EdgeCase Mixed Form", submissions = 1,
--                                avg(total_score) = 88.0
--   getQualityDeptComparison (ALL): 2 fixture rows
--                                   — Dept A: audits=5, avgScore=68.0, disputes=2
--                                   — Dept B: audits=1, avgScore=88.0, disputes=0
--   getQCKpis (dept 99001):
--     avg_qa_score = 68.00     (5 finalized, average of total_score)
--     audits_completed = 5
--     dispute_rate     = 2/5 × 100 = 40.0
--     dispute_upheld_rate = 1/2 × 100 = 50.0  (1 UPHELD of 2 resolved)
--     dispute_adjusted_rate = 1/2 × 100 = 50.0
--     avg_dispute_resolution_time = AVG(3 days, 1 day) = 2.0
--   Empty period (e.g. 2023-06-01..2023-06-30) → every getter returns [] / null.
-- These values are pinned in:
--   backend/src/services/__tests__/QCQualityData.edges.test.ts

COMMIT;

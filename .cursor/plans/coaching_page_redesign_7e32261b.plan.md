---
name: Coaching page redesign
overview: Redesign the QC Coaching page with updated KPI tiles (Assigned, Scheduled, Completed, Closed), a new Sessions by Status section with expandable agent lists, and a reordered section flow modeled after the Quality page pattern.
todos:
  - id: backend-kpis
    content: Add coaching_sessions_scheduled + coaching_sessions_closed KPIs to QCKpiService, update assigned to total count, update completed to exclude CLOSED
    status: completed
  - id: backend-status-endpoint
    content: Add getSessionsByStatus() to QCCoachingData.ts + controller + route
    status: completed
  - id: backend-topic-limit
    content: Change coaching topics LIMIT from 15 to 10 in QCInsightsData.ts
    status: completed
  - id: frontend-kpi-defs
    content: Add 2 new KPI definitions to kpiDefs.ts, update existing coaching KPI names
    status: completed
  - id: frontend-service
    content: Add SessionStatusGroup type + getSessionsByStatus API function to insightsQCService.ts
    status: completed
  - id: frontend-page
    content: "Rewrite QCCoachingPage.tsx with new layout: 4 KPI tiles, trend chart, status pipeline, reordered sections"
    status: completed
isProject: false
---

# Coaching Page Redesign

## Current State

The coaching page ([QCCoachingPage.tsx](frontend/src/pages/insights/QCCoachingPage.tsx)) currently has:
- 5 KPI tiles: Assigned, Completed, Completion %, Cadence, Delivery Rate
- Most Coached Topics (15, expandable)
- Repeat Coaching Agents (expandable)
- Quiz Performance (3 mini-KPI tiles + breakdown table + failed agents)
- Department Comparison table

## Proposed Page Layout (top to bottom)

### 1. Filter Bar (no change)
Sticky filter bar with dept/period filters, same as today.

### 2. Page Header (no change)
"Coaching" title + subtitle.

### 3. KPI Tiles -- 4 tiles in a row
Replace the current 5 tiles with the 4 requested:

- **Sessions Assigned** -- total coaching sessions created in the period (all statuses). Currently this is pace-based; changing to actual count.
- **Sessions Scheduled** -- sessions currently in `SCHEDULED` status (NEW KPI)
- **Sessions Completed** -- sessions in `COMPLETED` status only (currently includes CLOSED; splitting)
- **Sessions Closed** -- sessions in `CLOSED` status (NEW KPI)

Grid: `grid-cols-2 sm:grid-cols-4 gap-3`

### 4. Coaching Completion Trend (NEW)
A 6-month `TrendChart` showing `coaching_completion_rate` over time, matching the Quality page's QA Score Trend pattern. Uses the existing `/api/insights/qc/trends?kpis=coaching_completion_rate` endpoint. Renders inside an `InsightsSection` card.

### 5. Session Status Pipeline (NEW)
Shows all coaching session statuses with counts and progress bars. Each status row is an `ExpandableRow` that opens to reveal which agents are in that status.

Statuses from the enum: `SCHEDULED`, `IN_PROCESS`, `AWAITING_CSR_ACTION`, `QUIZ_PENDING`, `COMPLETED`, `FOLLOW_UP_REQUIRED`, `CLOSED`

Summary row per status: status label, count, bar chart (proportional to max), and percentage of total.
Expanded detail: table with Agent, Dept, Sessions count -- clicking an agent navigates to their profile.

### 6. Top 10 Most Coached Topics (existing, adjusted)
Change from 15 to 10. Keep the expandable agent list pattern. No other changes needed -- backend `LIMIT 15` changes to `LIMIT 10`, or we slice on the frontend.

### 7. Repeat Coaching (existing, no change)
Keep the "Repeat Coaching -- Agents Needing Escalation" section exactly as-is.

### 8. Quiz Performance (existing, no change)
Keep the 3 mini-KPI tiles + quiz breakdown table + failed agents table exactly as-is.

### 9. Department Comparison (existing, no change)
Keep at the bottom, same as today.

---

## Backend Changes

### A. New KPI values in [QCKpiService.ts](backend/src/services/QCKpiService.ts)

Add 2 new scalar queries inside `computeKpisForRange()` (lines ~140-196):

```sql
-- coaching_sessions_scheduled
SELECT COUNT(*) AS value FROM coaching_sessions cs
JOIN users csr ON cs.csr_id = csr.id
WHERE cs.status = 'SCHEDULED'
  AND cs.session_date BETWEEN ? AND ? {deptClause}

-- coaching_sessions_closed
SELECT COUNT(*) AS value FROM coaching_sessions cs
JOIN users csr ON cs.csr_id = csr.id
WHERE cs.status = 'CLOSED'
  AND cs.session_date BETWEEN ? AND ? {deptClause}
```

Update `coaching_sessions_assigned` to be the **total count** of sessions in the period (currently pace-based).

Update `coaching_sessions_completed` to only count `COMPLETED` status (currently includes `CLOSED`).

Add the 2 new keys to the returned `kpis` object.

### B. New KPI definitions in [kpiDefs.ts](frontend/src/constants/kpiDefs.ts)

```ts
coaching_sessions_scheduled: {
  code: 'coaching_sessions_scheduled', name: 'Sessions Scheduled',
  format: 'NUMBER', direction: 'NEUTRAL',
},
coaching_sessions_closed: {
  code: 'coaching_sessions_closed', name: 'Sessions Closed',
  format: 'NUMBER', direction: 'UP_IS_GOOD',
},
```

Update `coaching_sessions_assigned` name to `'Sessions Assigned'` and direction to `NEUTRAL`.
Update `coaching_sessions_completed` name to `'Sessions Completed'`.

### C. New endpoint: Sessions by Status

**Backend** -- add to [QCCoachingData.ts](backend/src/services/QCCoachingData.ts):

`getSessionsByStatus(deptFilter, ranges)` -- two queries:
1. Group by status: `SELECT cs.status, COUNT(*) AS count FROM coaching_sessions cs ...`
2. Agent details per status: `SELECT cs.status, u.id, u.username, d.department_name, COUNT(*) ...`

Returns:
```ts
Array<{
  status: string
  count: number
  agents: Array<{ userId: number; name: string; dept: string; sessions: number }>
}>
```

**Route** -- add to [insightsQC.routes.ts](backend/src/routes/insightsQC.routes.ts):
```
GET /coaching/sessions-by-status
```

**Controller** -- add to [insightsQC.controller.ts](backend/src/controllers/insightsQC.controller.ts):
```ts
export const getSessionsByStatus = qcHandler('qc_coaching', (deptFilter, ranges) =>
  qcCoaching.getSessionsByStatus(deptFilter, ranges),
)
```

**Frontend service** -- add to [insightsQCService.ts](frontend/src/services/insightsQCService.ts):
```ts
export interface SessionStatusGroup {
  status: string; count: number
  agents: Array<{ userId: number; name: string; dept: string; sessions: number }>
}
export const getSessionsByStatus = async (p: QCParams): Promise<SessionStatusGroup[]> =>
  (await api.get('/insights/qc/coaching/sessions-by-status', { params: p })).data
```

### D. Limit topics to 10

In [QCInsightsData.ts](backend/src/services/QCInsightsData.ts) line ~345: change `LIMIT 15` to `LIMIT 10`.

---

## Frontend Changes

### E. Rewrite [QCCoachingPage.tsx](frontend/src/pages/insights/QCCoachingPage.tsx)

Restructure the page in this order:

1. Filter bar (unchanged)
2. Page header (unchanged)
3. **KPI tiles** -- 4 tiles: `coaching_sessions_assigned`, `coaching_sessions_scheduled`, `coaching_sessions_completed`, `coaching_sessions_closed`
4. **Coaching Completion Trend** -- new `InsightsSection` with `TrendChart` (fetch via existing `getQCTrends`)
5. **Session Status Pipeline** -- new `InsightsSection` with `ExpandableRow` per status
6. **Most Coached Topics** -- existing section (already expandable)
7. **Repeat Coaching** -- existing section (no changes)
8. **Quiz Performance** -- existing section (no changes)
9. **Department Comparison** -- existing section (no changes)

The page stays under ~250 lines by keeping helper components inline (they're small) and reusing existing shared components (`InsightsSection`, `KpiTile`, `ExpandableRow`, `TrendChart`, `StatusBadge`).

---

## Files Modified

| File | Change |
|------|--------|
| `backend/src/services/QCKpiService.ts` | Add 2 new KPI queries, update assigned/completed logic |
| `backend/src/services/QCCoachingData.ts` | Add `getSessionsByStatus()` |
| `backend/src/controllers/insightsQC.controller.ts` | Add `getSessionsByStatus` handler |
| `backend/src/routes/insightsQC.routes.ts` | Add route for sessions-by-status |
| `backend/src/services/QCInsightsData.ts` | Change LIMIT 15 to LIMIT 10 for topics |
| `frontend/src/constants/kpiDefs.ts` | Add 2 new KPI defs, update existing names |
| `frontend/src/services/insightsQCService.ts` | Add type + API function for sessions-by-status |
| `frontend/src/pages/insights/QCCoachingPage.tsx` | Rewrite with new layout, tiles, trend chart, status pipeline |

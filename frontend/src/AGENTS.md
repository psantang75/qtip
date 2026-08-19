# Frontend — Agent Guide

React 19 + TypeScript + Vite SPA. Server state via TanStack Query, grids via
TanStack Table, UI via shadcn/ui + Tailwind. Read the UI rule before building
any component: [../../.cursor/rules/ui-design.mdc](../../.cursor/rules/ui-design.mdc) and [../../docs/design.md](../../docs/design.md).

## Folder layout

- `app/` — router, query client, route guards.
- `pages/` — route-level screens, grouped by section (`quality/`, `training/`, `insights/`, `admin/`, `writeups/`, `scheduling/`).
- `components/ui/` — shadcn/ui primitives (auto-generated; do not edit).
- `components/common/` — shared reusable components we own (e.g. `ListPageShell`, filter bars).
- `components/{quality,training,insights,admin}/` — section-specific components.
- `hooks/` — custom React hooks.
- `services/` — Axios API service functions (server state is fetched here, consumed via TanStack Query).
- `types/`, `utils/`, `lib/`, `constants/`, `contexts/` — shared types, helpers, config.

## Hard UI rules (non-negotiable — see ui-design.mdc)

- Use shadcn/ui for buttons, inputs, dialogs, selects. NEVER raw `<button>`, `<input type=radio/checkbox>`, or raw `<select>`.
- "Pick one of N" segmented control → reuse the `optionCls` pill pattern in [utils/forms/formRendererComponents.tsx](utils/forms/formRendererComponents.tsx).
- Server state → TanStack Query only. NEVER `useEffect` + `axios`/`fetch` in components. Query-key conventions: [../../docs/frontend_query_keys.md](../../docs/frontend_query_keys.md).
- Data grids → TanStack Table. NEVER hand-rolled `<table>` markup for data grids. Sortable columns use the shared 3-state `SortHeaderIcon`.
- Icons → `lucide-react` only. No emojis, no other icon libraries.
- Colors → QTIP brand palette / Tailwind tokens (`bg-primary`, `text-primary`, `bg-success`, `bg-warning`, `bg-destructive`, `bg-surface`). No new hex outside existing utility classes.
- No custom CSS files; Tailwind utilities only. Stick to the 8-pt spacing scale.
- Forms with >2 fields → React Hook Form.

## Before writing a new component

Find the closest existing one and mirror it (list page → `components/common/ListPageShell.tsx`;
settings card → `pages/quality/AIReviewerFormDetail.tsx`). Ask before adding new `@radix-ui/*` deps.
Refactor files at 200–300 lines.

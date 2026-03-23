QTIP — QA & Training Integrated Platform

UI/UX Design Specification

1. Purpose

This document establishes a cohesive visual language for the Quality & Training Insight Platform (QTIP) — an integrated QA, Training, and LMS solution.  It defines brand colors, typography, layout, and component‑level guidance to ensure a modern, accessible interface that is simple to develop and scale.

2. Brand Voice & Personality

Trait

Manifestation in UI

Professional

Clean grids, ample whitespace, consistent iconography

Insightful

Data‑forward dashboards, contextual tooltips, micro‑charts

Supportive

Friendly micro‑copy, progress indicators, clear affordances

Efficient

One‑click actions, keyboard shortcuts, minimal cognitive load

3. Color Palette

All design tokens are defined as CSS custom properties for easy theming.

:root {
  /* Primary Brand */
  --color-primary-blue: #00aeef;      /* Main accent */

  /* Neutrals */
  --color-neutral-900: #000000;       /* Headlines / Icons */
  --color-neutral-700: #666666;       /* Body text */
  --color-neutral-600: #777777;       /* Background shell */
  --color-neutral-100: #f5f7f8;       /* Cards / surfaces */

  /* States */
  --color-success: #1abc9c;
  --color-warning: #f39c12;
  --color-danger:  #e74c3c;
}

3.1 Usage Guidelines

Token

Typical Usage

WCAG Contrast*

--color-primary-blue

Links, primary buttons, active icons

4.7 : 1

--color-neutral-700

Paragraph text, secondary labels

7.0 : 1

--color-neutral-600

App shell background, dashboard panels

—

--color-neutral-100

Card & modal backgrounds

3.1 : 1

--color-success

Positive status badges, success toasts

4.5 : 1

--color-warning

Pending status chips, warning banners

4.0 : 1

--color-danger

Error messages, destructive button states

4.5 : 1

*Contrast ratios measured against --color-neutral-100 background.

4. Typography

Style

Size / Weight

Usage

Display / H1

32 px / 700

Welcome & section page titles

H2

24 px / 600

Card headers, modal titles

H3

20 px / 600

Sub‑section titles

Body‑Large

16 px / 400

Core body copy

Body‑Small

14 px / 400

Tables, labels, helper text

Caption

12 px / 400

Footers, timestamps

Font Family: "Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serifOpt for system fallbacks to maximize performance.

5. Layout & Spacing

Grid: 12‑column, 72 px max gutter on ≥1440 px screens; 16 px gutters on mobile.

Spacing scale (8‑pt): 2, 4, 8, 12, 16, 24, 32, 40, 48, 64.

Breakpoints: 360 px (xs), 480 px (sm), 768 px (md), 1024 px (lg), 1440 px (xl).

5.1 Responsive Behavior

Dashboards collapse from a 3‑column data card layout (desktop) to stacked single‑column cards (mobile).

Navigation switches to a bottom tab bar on ≤480 px.

6. Core Components

6.1 Buttons

Variant

Background

Text/Icon Color

Border Radius

Primary

--color-primary-blue

#ffffff

6 px

Secondary

transparent

--color-primary-blue

6 px

Tertiary

transparent

--color-neutral-700

6 px

Destructive

--color-danger

#ffffff

6 px

All buttons animate with scale(0.98) press feedback (Framer Motion 120 ms).

6.2 Cards & Panels

Soft shadow 0 2 px 6 px rgba(0,0,0,0.06).

16 px padding, 12 px radius.

6.3 Forms

Label color --color-neutral-700.

Focus ring 2 px solid var(--color-primary-blue).

6.4 Tables

Zebra stripe with rgba(0,0,0,0.03).

Sticky header, 12 px cell padding.

6.5 Toasts & Alerts

Slide‑in from top right.

Alert background tints: primary 10%, danger 10%, etc.

7. Iconography

Library: Lucide‑react 1.2+ (line icons, 24 px default).

Use filled variants only for critical action emphasis.

8. Accessibility

Maintain 4.5:1 minimum contrast for primary interactions.

Provide keyboard navigation order reflecting visual flow.

ARIA labels for non‑text buttons.

9. Sample Screen Blueprints

9.1 CSR Dashboard

KPIs Strip: Primary cards (# sessions scored, course completion %).

Training Timeline: Horizontal scroll list of assigned modules.

QA Trends: Mini line chart (Recharts) over last 30 days.

9.2 Trainer Control Center

Tabbed panes: Courses, Assignments, Analytics.

Floating action button (FAB) for New Course.

9.3 Manager Overview

Department selector (multi‑tenant).

Heatmap table showing agent scores vs. course completion.

9.4 Course Player

Progress Bar persistent top.

Timed screen lock using JavaScript timer overlay.

Branching navigation on quiz outcome.

9.5 QA Form Builder

Drag‑and‑drop question blocks.

Weighted category sliders.

Real‑time total score preview.

10. Implementation Notes

Build components in React with Tailwind (@apply) + shadcn/ui primitives.

Store theme tokens in /src/styles/tokens.css.

Wrap the app in <ThemeProvider> to allow future dark‑mode overrides.

Follow the 8‑pt spacing scale uniformly for margin/padding utilities.

Appendix A – CSS Utility Cheatsheet

.text-primary   { color: var(--color-primary-blue); }
.bg-shell       { background: var(--color-neutral-600); }
.avatar-ring    { box-shadow: 0 0 0 3px var(--color-primary-blue); }

Version: 1.0Maintainer: UX Lead — Last updated: 2025‑04‑26
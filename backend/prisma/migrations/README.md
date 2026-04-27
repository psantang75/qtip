# Prisma migrations

Authoritative Prisma migration history for the QTIP backend. Prisma tracks
applied migrations in the `_prisma_migrations` table using the **full folder
name** (timestamp + slug) as the primary key, not the timestamp alone.

## Duplicate timestamp tolerance (pre-production review item #97)

Two folders share the `20260422040000_` prefix:

- `20260422040000_add_warnings_section_kpis`
- `20260422040000_deactivate_coaching_cadence`

They are **both valid** — Prisma applies them in lexicographic order of the
full folder name (`add_warnings…` before `deactivate_coaching…`) and records
each as its own row in `_prisma_migrations`. The two migrations touch
independent rows in `ie_kpi`, so application order does not affect the final
state.

Going forward, **never reuse a timestamp prefix** within the same minute.
Use the current UTC clock to the nearest minute when scaffolding a new
migration and bump by a minute if a colleague has already committed at the
same time. This keeps the list strictly chronological when sorted
alphabetically, which is how Prisma, `ls`, and every editor's file tree
display it.

## Do not rename applied migrations

Renaming a folder changes its `migration_name` in `_prisma_migrations`,
which Prisma treats as a brand-new migration and attempts to re-apply. That
breaks against any environment where the original was already applied. If
you need to fix a typo in the slug, write a new corrective migration —
don't rename an existing folder.

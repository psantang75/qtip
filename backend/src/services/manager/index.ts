/**
 * Barrel for manager-domain services.
 *
 * ## SQL safety policy (pre-production review item #42)
 *
 * Several services in this folder use `prisma.$queryRawUnsafe(...)` because
 * they need to splice a dynamic IN-clause whose placeholder count varies
 * with `departmentIds.length`, or compose UPDATE column lists at runtime.
 * **Every dynamic value flows through a `?` placeholder + spread args** —
 * no service in this folder concatenates user-supplied input into the SQL
 * string. The "Unsafe" suffix in Prisma's API name refers to "you assert
 * the query string is safe", not to a parameterization gap.
 *
 * Audit performed 2026-04-24:
 *   - `manager.dashboard.service.ts`         — dept-id IN clauses, parameterized.
 *   - `manager.audits.list.service.ts`       — dept-id IN clauses, parameterized.
 *   - `manager.coaching.{list,detail,export,update,transitions,shared}.ts`
 *                                            — dept-id IN clauses + dynamic
 *                                              UPDATE column list (whitelisted),
 *                                              all values parameterized.
 *   - `manager.disputes.{list,detail,export,resolve}.service.ts`
 *                                            — same pattern, parameterized.
 *   - `manager.team.service.ts`              — dept-id IN clause only.
 *
 * **When adding new dynamic SQL here:** prefer `Prisma.sql` tagged templates
 * with `Prisma.join(...)`; only fall back to `$queryRawUnsafe` when the
 * placeholder count is itself dynamic, and never interpolate request-derived
 * strings into the query body — push them through `?` instead.
 */
export * from './manager.types'
export * from './manager.access'
export * from './manager.dashboard.service'
export * from './manager.disputes.list.service'
export * from './manager.disputes.export.service'
export * from './manager.disputes.detail.service'
export * from './manager.disputes.resolve.service'
export * from './manager.coaching.list.service'
export * from './manager.coaching.export.service'
export * from './manager.coaching.detail.service'
export * from './manager.coaching.attachment.service'
export * from './manager.coaching.create.service'
export * from './manager.coaching.update.service'
export * from './manager.coaching.transitions.service'
export * from './manager.audits.list.service'
export * from './manager.audits.detail.service'
export * from './manager.team.service'

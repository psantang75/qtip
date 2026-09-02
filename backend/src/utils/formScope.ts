/**
 * Internal form mode — single source of truth for visibility scoping.
 *
 * A form may be in a non-public "Internal" mode (`forms.access_mode = 'INTERNAL'`).
 * Submissions captured under such a form snapshot the mode onto
 * `submissions.access_mode` at creation, so their visibility is fixed for life
 * regardless of later form status changes.
 *
 *   - STANDARD scope (every agent/CSR + normal Quality/AI surface): only
 *     rows whose `access_mode IS NULL` are visible — Internal data is excluded
 *     "as if it never existed".
 *   - INTERNAL scope (the "Internal Research" Insights section only): only rows
 *     whose `access_mode = 'INTERNAL'` are visible, further restricted to the
 *     forms the requester is permitted to see.
 *
 * Access is configurable per form via `forms.access_roles` (a single JSON
 * array). Entries are either canonical role keys (e.g. "manager", "qa") OR
 * individual-user tokens of the form `user:<id>` (e.g. "user:42"), so a form
 * can be shared with whole role groups AND/OR named individuals. `admin` is
 * always permitted implicitly. Packing both into the one existing column keeps
 * this additive — no schema change is needed to target individual users.
 */
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';

export const INTERNAL_MODE = 'INTERNAL' as const;

export type AccessScope = 'STANDARD' | 'INTERNAL';

/** Prefix marking an individual-user grant inside `forms.access_roles`. */
export const USER_TOKEN_PREFIX = 'user:' as const;

/** Canonical lowercase role keys stored in `forms.access_roles`. */
export const ROLE_KEYS = ['admin', 'director', 'manager', 'qa', 'trainer', 'csr'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

/** Build the stored token for an individual-user grant. */
export function userToken(userId: number): string {
  return `${USER_TOKEN_PREFIX}${userId}`;
}

/** Normalize a role (name like "QA" or key like "qa") to a canonical key. */
export function normalizeRole(role: string | null | undefined): string {
  return (role ?? '').trim().toLowerCase();
}

export function isValidRoleKey(value: string): value is RoleKey {
  return (ROLE_KEYS as readonly string[]).includes(value);
}

/** Coerce a raw stored value into a token array (array or JSON-string column). */
function toTokenArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* fall through */
    }
  }
  return [];
}

/**
 * Parse the stored audience JSON into canonical role keys only. Individual-user
 * tokens (`user:<id>`) are intentionally excluded — use `parseAccessUsers` for
 * those — so this never returns a pseudo-role to callers or the UI.
 */
export function parseAccessRoles(raw: unknown): string[] {
  return toTokenArray(raw)
    .map((r) => normalizeRole(String(r)))
    .filter(isValidRoleKey);
}

/**
 * Parse individual-user grants out of the audience. Accepts both the stored
 * `user:<id>` string tokens and a bare `number[]` (as the UI/DTO sends), so it
 * doubles as the sanitizer for the create/update payload's `access_users`.
 */
export function parseAccessUsers(raw: unknown): number[] {
  const ids = toTokenArray(raw)
    .map((v): number | null => {
      if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? v : null;
      if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (!s.startsWith(USER_TOKEN_PREFIX)) return null;
        const n = parseInt(s.slice(USER_TOKEN_PREFIX.length), 10);
        return Number.isInteger(n) && n > 0 ? n : null;
      }
      return null;
    })
    .filter((n): n is number => n !== null);
  return Array.from(new Set(ids));
}

interface FormAccessShape {
  access_mode?: string | null;
  access_roles?: unknown;
}

/** Adds the version-family keys needed to resolve current governance. */
interface FormFamilyShape extends FormAccessShape {
  id?: number | null;
  form_group_id?: number | null;
}

/** True when the form is in a non-public Internal mode. */
export function isInternalForm(form: FormAccessShape | null | undefined): boolean {
  return !!form && form.access_mode === INTERNAL_MODE;
}

/**
 * Can a requester see/use a form? Normal forms (access_mode NULL) are always
 * allowed here — the audience gate applies only to Internal forms. An Internal
 * form is visible when the requester's role is in the audience OR their `userId`
 * was granted individually. Admin always passes.
 */
export function canAccessInternalForm(
  role: string | null | undefined,
  form: FormAccessShape | null | undefined,
  userId?: number | null,
): boolean {
  if (!isInternalForm(form)) return true;
  const key = normalizeRole(role);
  if (key === 'admin') return true;
  if (parseAccessRoles(form?.access_roles).includes(key)) return true;
  if (userId != null && parseAccessUsers(form?.access_roles).includes(userId)) return true;
  return false;
}

/**
 * DB-backed audience check that always evaluates the form family's CURRENT
 * governance — the active version, else the highest version — instead of the
 * specific (possibly superseded) version handed in. Use this on read paths that
 * may hold an older version by id (e.g. loading a form definition) so a grant
 * removed on a newer version is honoured everywhere, not just on the active row.
 *
 * Normal (non-internal) forms and admin short-circuit without a query. When the
 * family's current version is no longer internal, or the audience no longer
 * lists the requester, access is denied (only admin passes) — removal sticks.
 */
export async function canAccessInternalFormCurrent(
  role: string | null | undefined,
  form: FormFamilyShape | null | undefined,
  userId?: number | null,
): Promise<boolean> {
  if (!isInternalForm(form)) return true;
  const key = normalizeRole(role);
  if (key === 'admin') return true;

  // Resolve the audience from the family's current version. Fall back to the
  // row we were handed only when it has no family key (pre-backfill rows).
  let roles: unknown = form?.access_roles;
  const groupId = form?.form_group_id ?? form?.id ?? null;
  if (groupId != null) {
    const current = await prisma.form.findFirst({
      where: { form_group_id: groupId },
      orderBy: [{ is_active: 'desc' }, { version: 'desc' }],
      select: { access_roles: true, access_mode: true },
    });
    if (current) {
      // If the current version is no longer internal, there is no audience to
      // grant against → only admin (already handled) may see it.
      roles = current.access_mode === INTERNAL_MODE ? current.access_roles : [];
    }
  }

  if (parseAccessRoles(roles).includes(key)) return true;
  if (userId != null && parseAccessUsers(roles).includes(userId)) return true;
  return false;
}

// ── Raw-SQL (mysql-style `?`) fragments — for the hand-written QC/analytics
// layer. The access filter needs no bound params, so a literal is safe.
export function accessScopeClause(scope: AccessScope, alias = 's'): string {
  return scope === 'INTERNAL'
    ? `AND ${alias}.access_mode = 'INTERNAL'`
    : `AND ${alias}.access_mode IS NULL`;
}

/** STANDARD-scope literal (exclude Internal). Convenience for the common case. */
export function standardScopeClause(alias = 's'): string {
  return accessScopeClause('STANDARD', alias);
}

// ── Prisma.Sql fragments — for services that build queries with Prisma.sql.
export function accessScopeSql(scope: AccessScope, alias = 's'): Prisma.Sql {
  const col = Prisma.raw(`${alias}.access_mode`);
  return scope === 'INTERNAL' ? Prisma.sql`${col} = 'INTERNAL'` : Prisma.sql`${col} IS NULL`;
}

export function standardScopeSql(alias = 's'): Prisma.Sql {
  return accessScopeSql('STANDARD', alias);
}

/**
 * The Internal forms a requester may see in Internal Research. Admin sees all
 * Internal forms; anyone else sees Internal forms whose audience includes their
 * role OR grants their `userId` individually.
 *
 * Versions are grouped by the stable `form_group_id` — NOT by `form_name`, which
 * a form can change between versions. The current audience is read from each
 * family's CURRENT version (the active one, else the highest version): editing a
 * form's audience creates a new version and deactivates the old one, but the
 * superseded row keeps its OLD `access_roles`, so honouring every version would
 * let a removed grant keep leaking (the reported "removed access but they still
 * see the data" bug). All version ids/names of a permitted family are returned —
 * submissions snapshot the form_id (and name) captured at creation, so
 * drill-downs/filters must still match data recorded under older versions.
 */
export async function resolvePermittedInternalForms(
  role: string | null | undefined,
  userId?: number | null,
): Promise<{ ids: number[]; names: string[] }> {
  const rows = await prisma.form.findMany({
    where: { access_mode: INTERNAL_MODE },
    select: {
      id: true,
      form_name: true,
      version: true,
      is_active: true,
      form_group_id: true,
      access_roles: true,
    },
  });

  // Group every internal version into its form family. Rows predating the
  // backfill (form_group_id NULL) fall back to their own id so they still form
  // a singleton family rather than all collapsing together.
  const families = new Map<number, (typeof rows)[number][]>();
  for (const r of rows) {
    const gid = r.form_group_id ?? r.id;
    const list = families.get(gid);
    if (list) list.push(r);
    else families.set(gid, [r]);
  }

  const key = normalizeRole(role);
  const isAdmin = key === 'admin';
  const ids: number[] = [];
  const names = new Set<string>();
  for (const members of families.values()) {
    // Current governance = the active version, else the highest version.
    const current =
      members.find((m) => m.is_active) ??
      members.reduce((a, b) => (b.version > a.version ? b : a));
    const allowed =
      isAdmin ||
      parseAccessRoles(current.access_roles).includes(key) ||
      (userId != null && parseAccessUsers(current.access_roles).includes(userId));
    if (!allowed) continue;
    for (const m of members) {
      ids.push(m.id);
      names.add(m.form_name);
    }
  }

  return { ids, names: Array.from(names) };
}

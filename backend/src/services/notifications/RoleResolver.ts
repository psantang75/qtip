import prisma from '../../config/prisma';
import logger from '../../config/logger';
import { isAiReviewer } from './ReviewerClassifier';
import { getTemplateSpec, ROLE_LABELS, type RoleToken } from '../email/templateSeeds';

/**
 * Recipient lookup, configurable per template.
 *
 * `email_templates.recipient_roles` (JSON array of role tokens) drives
 * who gets each notification. Admins toggle these in the editor; this
 * file resolves each token to live user rows at send time. Falls back
 * to the seed spec's default when the DB column is empty (first-boot
 * race) or when called with a key that isn't a real template.
 *
 * Tokens are intentionally generic ("agent", "direct_manager") so
 * adding a new event type usually means adding to the seed spec, not
 * patching this resolver.
 */

export interface Recipient {
  id: number;
  username: string;
  email: string;
  role_id: number;
  /** Token that surfaced this user. Used for the "why am I getting this?" footer line. */
  matchedRole?: RoleToken;
  matchedRoleLabel?: string;
}

interface UserRow {
  id: number;
  username: string;
  email: string | null;
  role_id: number;
  is_active: boolean;
  manager_id: number | null;
  department_id: number | null;
}

function toRecipient(u: UserRow | null, role?: RoleToken): Recipient | null {
  if (!u || !u.is_active || !u.email) return null;
  if (isAiReviewer(u.id)) return null;
  return {
    id: u.id, username: u.username, email: u.email, role_id: u.role_id,
    matchedRole: role,
    matchedRoleLabel: role ? ROLE_LABELS[role] : undefined,
  };
}

async function fetchUser(id: number | null | undefined): Promise<UserRow | null> {
  if (!id) return null;
  const u = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, username: true, email: true, role_id: true,
      is_active: true, manager_id: true, department_id: true,
    },
  });
  return u as UserRow | null;
}

async function fetchManager(user: UserRow | null): Promise<UserRow | null> {
  if (!user) return null;
  if (user.manager_id) {
    const m = await fetchUser(user.manager_id);
    if (m && m.is_active) return m;
  }
  if (user.department_id) {
    const dm = await prisma.departmentManager.findFirst({
      where: { department_id: user.department_id, is_active: true },
      orderBy: { assigned_at: 'desc' },
      select: { manager_id: true },
    });
    if (dm) return fetchUser(dm.manager_id);
  }
  return null;
}

async function fetchUsersByRoleAndDept(
  roleName: string,
  deptId: number | null,
  includeUnassigned = false,
): Promise<UserRow[]> {
  const where: any = { role: { role_name: roleName }, is_active: true };
  if (deptId !== null) {
    where.OR = includeUnassigned
      ? [{ department_id: deptId }, { department_id: null }]
      : [{ department_id: deptId }];
  }
  const rows = await prisma.user.findMany({
    where,
    select: {
      id: true, username: true, email: true, role_id: true,
      is_active: true, manager_id: true, department_id: true,
    },
  });
  return rows as UserRow[];
}

function dedupe(list: Recipient[]): Recipient[] {
  const seen = new Set<number>();
  const out: Recipient[] = [];
  for (const r of list) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

/**
 * Resolves a single role token to zero or more Recipients given an
 * event payload. Each branch knows which payload keys it expects.
 */
async function resolveToken(token: RoleToken, payload: Record<string, any>): Promise<Recipient[]> {
  switch (token) {
    case 'self': {
      const id = payload.user?.id ?? payload.userId ?? payload.csr?.id ?? payload.disputantId;
      const r = toRecipient(await fetchUser(id), 'self');
      return r ? [r] : [];
    }

    case 'agent': {
      const id = payload.csr?.id ?? payload.csrId;
      const r = toRecipient(await fetchUser(id), 'agent');
      return r ? [r] : [];
    }

    case 'direct_manager': {
      const csrId = payload.csr?.id ?? payload.csrId ?? payload.user?.id;
      const explicitManagerId = payload.manager?.id ?? payload.managerId;
      if (explicitManagerId) {
        const r = toRecipient(await fetchUser(explicitManagerId), 'direct_manager');
        if (r) return [r];
      }
      const csr = await fetchUser(csrId);
      const m = await fetchManager(csr);
      const r = toRecipient(m, 'direct_manager');
      return r ? [r] : [];
    }

    case 'department_director': {
      const csrId = payload.csr?.id ?? payload.csrId;
      const csr = await fetchUser(csrId);
      const rows = await fetchUsersByRoleAndDept('Director', csr?.department_id ?? null);
      return rows.map(r => toRecipient(r, 'department_director')).filter((x): x is Recipient => !!x);
    }

    case 'creator': {
      const id = payload.creator?.id ?? payload.createdBy ?? payload.coach?.id;
      const r = toRecipient(await fetchUser(id), 'creator');
      return r ? [r] : [];
    }

    case 'original_qa': {
      const id = payload.originalQaId ?? payload.original_qa?.id;
      const r = toRecipient(await fetchUser(id), 'original_qa');
      return r ? [r] : [];
    }

    case 'qa_pool': {
      const csrId = payload.csr?.id ?? payload.csrId;
      const csr = await fetchUser(csrId);
      const rows = await fetchUsersByRoleAndDept('QA', csr?.department_id ?? null, true);
      return rows.map(r => toRecipient(r, 'qa_pool')).filter((x): x is Recipient => !!x);
    }

    case 'hr_witness': {
      const id = payload.hr_witness?.id ?? payload.hrWitnessId;
      const r = toRecipient(await fetchUser(id), 'hr_witness');
      return r ? [r] : [];
    }

    case 'assignee': {
      const id = payload.assignee?.id ?? payload.assigneeId;
      const r = toRecipient(await fetchUser(id), 'assignee');
      return r ? [r] : [];
    }

    case 'coach': {
      const id = payload.coach?.id ?? payload.coachId;
      const r = toRecipient(await fetchUser(id), 'coach');
      return r ? [r] : [];
    }

    case 'admins': {
      const rows = await fetchUsersByRoleAndDept('Admin', null);
      return rows.map(r => toRecipient(r, 'admins')).filter((x): x is Recipient => !!x);
    }
  }
}

/**
 * Loads the enabled recipient role tokens for an event. Reads the DB
 * column first; falls back to the spec's defaults when the row hasn't
 * been seeded yet (first-boot ordering safety).
 */
async function loadEnabledRoles(event: string): Promise<RoleToken[]> {
  const tpl = await prisma.emailTemplate.findUnique({
    where: { template_key: event },
    select: { recipient_roles: true },
  });
  const dbRoles = (tpl?.recipient_roles as unknown as RoleToken[]) ?? [];
  if (Array.isArray(dbRoles) && dbRoles.length > 0) return dbRoles;
  const spec = getTemplateSpec(event);
  return spec?.default_recipient_roles ?? [];
}

export async function resolveRecipients(
  event: string,
  payload: Record<string, any>,
): Promise<Recipient[]> {
  const roles = await loadEnabledRoles(event);
  if (roles.length === 0) {
    logger.debug('[RoleResolver] no enabled roles for event', { event });
    return [];
  }

  const lists = await Promise.all(roles.map(role => resolveToken(role, payload)));
  return dedupe(lists.flat());
}

// ── Legacy public helpers kept for tests / direct callers ──────────────────

export async function resolveSelf(userId: number): Promise<Recipient[]> {
  const u = await fetchUser(userId);
  const r = toRecipient(u, 'self');
  return r ? [r] : [];
}

export async function resolveAdmins(): Promise<Recipient[]> {
  const rows = await fetchUsersByRoleAndDept('Admin', null);
  return rows.map(r => toRecipient(r, 'admins')).filter((x): x is Recipient => !!x);
}

export async function resolveManager(user: UserRow | null): Promise<Recipient | null> {
  return toRecipient(await fetchManager(user), 'direct_manager');
}

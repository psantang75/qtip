/**
 * Named people who should receive operational alerts, chosen by address rather
 * than by role.
 *
 * Role tokens describe roles, so the only way to reach "the two admins who
 * actually watch attendance" was to mail every admin, test accounts included.
 * This list closes that gap: templates that offer the `designated` recipient
 * option send here as well.
 *
 * Stored as `list_items` rows under `notification_recipient`, so admins manage it
 * at Admin > List Management alongside every other configurable list and no
 * schema change was needed. The address goes in `label`, matching the import
 * sender allowlist. Deactivating a row stops the mail without losing the record.
 *
 * The list is SHARED across templates by design — in practice the same handful
 * of people watch every operational alert. A template only sends here if an admin
 * ticks the option for it, so nothing leaks in without a deliberate choice.
 *
 * An empty list simply resolves to nobody. Unlike the import allowlist there is
 * no security consequence to that: the CSR-facing copy is driven by its own role
 * token, so an empty list means fewer alerts, never a wider audience.
 */

import prisma from '../../config/prisma';
import logger from '../../config/logger';
import { Prisma } from '../../generated/prisma/client';

export const DESIGNATED_LIST_TYPE = 'notification_recipient';

const normalise = (address: string): string => address.replace(/\s+/g, '').trim().toLowerCase();

/** Active addresses on the list, normalised and de-duplicated. */
export async function loadDesignatedAddresses(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ label: string }[]>(
    Prisma.sql`SELECT label FROM list_items
                WHERE list_type = ${DESIGNATED_LIST_TYPE} AND is_active = 1`,
  );
  return [...new Set(rows.map(r => normalise(r.label ?? '')).filter(Boolean))];
}

export interface DesignatedUser {
  id: number;
  username: string;
  email: string | null;
  role_id: number;
  is_active: boolean;
  manager_id: number | null;
  department_id: number | null;
}

/**
 * The QTIP users behind the listed addresses.
 *
 * A notification is delivered by way of a `notification_queue` row, and that row
 * requires a real `user_id`, so an address that belongs to nobody cannot be
 * mailed. Those are logged rather than dropped in silence — a typo here looks
 * exactly like a working configuration from the outside.
 */
export async function loadDesignatedRecipients(): Promise<DesignatedUser[]> {
  const addresses = await loadDesignatedAddresses();
  if (addresses.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { email: { in: addresses }, is_active: true },
    select: {
      id: true, username: true, email: true, role_id: true,
      is_active: true, manager_id: true, department_id: true,
    },
  });

  const matched = new Set(users.map(u => normalise(u.email ?? '')));
  const unmatched = addresses.filter(a => !matched.has(a));
  if (unmatched.length > 0) {
    logger.warn('[designatedRecipients] listed addresses match no active QTIP user', {
      addresses: unmatched, listType: DESIGNATED_LIST_TYPE,
    });
  }

  return users as DesignatedUser[];
}

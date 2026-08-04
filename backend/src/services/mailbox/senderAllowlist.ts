/**
 * Who is allowed to email an import in.
 *
 * Stored as `list_items` rows under the `mailbox_import_sender` type, so admins
 * manage it at Admin > List Management alongside every other configurable list
 * and no schema change was needed. The address goes in `label`; deactivating a
 * row revokes it without losing the record of it ever having been allowed.
 *
 * An empty list allows nobody. That is deliberate — a misconfigured or
 * half-migrated install must fail closed, because the alternative is a mailbox
 * that loads warehouse rows on behalf of anyone who finds the address.
 */

import prisma from '../../config/prisma';
import { Prisma } from '../../generated/prisma/client';

export const SENDER_LIST_TYPE = 'mailbox_import_sender';

const normalise = (address: string): string => address.replace(/\s+/g, '').trim().toLowerCase();

/** Active allowed sender addresses, normalised for comparison. */
export async function loadAllowedSenders(): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ label: string }[]>(
    Prisma.sql`SELECT label FROM list_items
                WHERE list_type = ${SENDER_LIST_TYPE} AND is_active = 1`,
  );
  return new Set(rows.map(r => normalise(r.label ?? '')).filter(Boolean));
}

export function isSenderAllowed(from: string, allowed: Set<string>): boolean {
  const address = normalise(from);
  return address.length > 0 && allowed.has(address);
}

/**
 * Who to credit on the ImportLog. Prefers the real QTIP user behind the address
 * so a forwarded file is attributed to a person, and falls back to the
 * configured service user — which is the normal case, since the punch report
 * arrives from an automated no-reply address that is nobody's account.
 */
export async function resolveImporter(from: string, fallbackUserId?: number): Promise<number | null> {
  const address = normalise(from);
  if (address) {
    const user = await prisma.user.findFirst({
      where: { email: address, is_active: true },
      select: { id: true },
    });
    if (user) return user.id;
  }
  return fallbackUserId ?? null;
}

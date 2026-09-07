/**
 * punchExempt.settings — per-user "does not punch" flag.
 *
 * Some CSRs appear on the published schedule (coverage / phone) but never clock
 * in. Scoring them manufactures a miss every scheduled day and then mails a
 * threshold crossing. The flag lives on the user form; storage reuses ie_config
 * (one key per user) so we do not alter the users table.
 *
 * Both engines read this BEFORE writing a daily/occurrence row. No points means
 * the notifiers have nothing to queue.
 *
 * Keys: `user.<id>.does_not_punch` = '1'. Missing / any other value = scores.
 */
import prisma from '../../config/prisma';

const KEY_PREFIX = 'user.';
const KEY_SUFFIX = '.does_not_punch';
const KEY_RE = /^user\.(\d+)\.does_not_punch$/;

export function punchExemptKey(userId: number): string {
  return `${KEY_PREFIX}${userId}${KEY_SUFFIX}`;
}

function parseExemptUserId(configKey: string): number | null {
  const m = KEY_RE.exec(configKey);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Every user currently flagged as not punching. */
export async function getPunchExemptUserIds(): Promise<Set<number>> {
  const rows = await prisma.ieConfig.findMany({
    where: { config_key: { startsWith: KEY_PREFIX } },
    select: { config_key: true, config_value: true },
  });
  const ids = new Set<number>();
  for (const row of rows) {
    if (row.config_value !== '1') continue;
    const id = parseExemptUserId(row.config_key);
    if (id) ids.add(id);
  }
  return ids;
}

export async function isPunchExempt(userId: number): Promise<boolean> {
  const row = await prisma.ieConfig.findUnique({ where: { config_key: punchExemptKey(userId) } });
  return row?.config_value === '1';
}

export async function setPunchExempt(userId: number, exempt: boolean): Promise<void> {
  const config_key = punchExemptKey(userId);
  if (!exempt) {
    await prisma.ieConfig.deleteMany({ where: { config_key } });
    return;
  }
  await prisma.ieConfig.upsert({
    where: { config_key },
    create: {
      config_key,
      config_value: '1',
      description: 'User does not punch. Attendance and adherence points are not calculated.',
    },
    update: { config_value: '1' },
  });
}

/** Stamp `does_not_punch` onto a list of users from one ie_config read. */
export async function attachPunchExempt<T extends { id: number }>(
  users: T[],
): Promise<Array<T & { does_not_punch: boolean }>> {
  if (users.length === 0) return [];
  const ids = await getPunchExemptUserIds();
  return users.map((u) => ({ ...u, does_not_punch: ids.has(u.id) }));
}

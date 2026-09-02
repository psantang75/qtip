/**
 * Campaign month PROJECTION — the read path. For a (schedule, year, month) we
 * expand each enabled campaign onto that month's business days via its anchor
 * rule, apply the manager's per-day overrides, and return one entry per calendar
 * day (with day_type for greying) carrying colored chips in library sort order.
 *
 * Occurrences are computed on read — there are NO stored per-month rows — so
 * "moving forward" is just asking for the next month.
 *
 * Anchor resolution is a resolver map keyed by anchor_type, counted over the
 * ordered workday list from businessCalendar.businessDaysOfMonth:
 *   BD_FROM_START        → Nth workday from the 1st (offset is 1-based).
 *   BD_FROM_END          → Nth workday from the last day (offset 1 = last).
 *   RELATIVE_TO_CAMPAIGN → resolve the referenced campaign first, then ± N
 *                          workdays (0 = same day). Resolved with memoisation
 *                          and a cycle guard.
 * After resolving, `not_on_friday` shifts a Friday hit to the next workday.
 */
import prisma from '../../config/prisma';
import { businessDaysOfMonth, getMonthDayTypes } from '../../utils/businessCalendar';
import { AuthReq } from '../scheduling/schedule.types';
import { assertCanViewSchedule } from './campaign.permissions';
import { assertMonthVisible, isMonthPublished, type PublishStatus } from './campaign.publish.service';

type AnchorType = 'BD_FROM_START' | 'BD_FROM_END' | 'RELATIVE_TO_CAMPAIGN';

interface LibItem {
  id: number;
  label: string;
  anchor_type: AnchorType;
  anchor_offset: number;
  anchor_ref_item_id: number | null;
  not_on_friday: boolean;
  sort_order: number;
  category_id: number;
  category_name: string;
  color: string;
  category_sort: number;
}

export interface DayChip {
  campaign_item_id: number;
  label: string;
  category_id: number;
  category_name: string;
  color: string;
  source: 'GENERATED' | 'ADDED';
}
export interface ProjectedDay {
  date: string;         // YYYY-MM-DD
  day_type: string;     // WORKDAY | WEEKEND | HOLIDAY | CLOSURE | ADJUSTMENT
  is_workday: boolean;
  chips: DayChip[];
}
export interface MonthProjection {
  schedule_id: number;
  year: number;
  month: number;
  /** Whether THIS month is released. Agents only ever receive published months. */
  is_published: boolean;
  /** Publish state of the parent schedule — a draft one hides all its months. */
  schedule_status: PublishStatus;
  days: ProjectedDay[];
}

const dowOf = (ds: string): number => {
  const [y, m, d] = ds.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
};

/**
 * Resolve every active library item to its final occurrence date (or null) for
 * the given ordered business-day list. Pure — shared by projection and the
 * override diff so both agree on what "generated" means.
 */
export function resolveOccurrences(items: LibItem[], businessDays: string[]): Map<number, string | null> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const memo = new Map<number, string | null>();
  const visiting = new Set<number>();
  const bdIndex = new Map(businessDays.map((d, i) => [d, i]));

  const resolve = (id: number): string | null => {
    if (memo.has(id)) return memo.get(id)!;
    if (visiting.has(id)) { memo.set(id, null); return null; } // cycle
    const item = byId.get(id);
    if (!item) { memo.set(id, null); return null; }
    visiting.add(id);

    let base: string | null = null;
    if (item.anchor_type === 'BD_FROM_START') {
      base = businessDays[item.anchor_offset - 1] ?? null;
    } else if (item.anchor_type === 'BD_FROM_END') {
      const idx = businessDays.length - item.anchor_offset;
      base = idx >= 0 ? (businessDays[idx] ?? null) : null;
    } else {
      const refFinal = item.anchor_ref_item_id != null ? resolve(item.anchor_ref_item_id) : null;
      if (refFinal != null) {
        const refIdx = bdIndex.get(refFinal);
        if (refIdx !== undefined) base = businessDays[refIdx + item.anchor_offset] ?? null;
      }
    }

    let final = base;
    if (base && item.not_on_friday && dowOf(base) === 5) {
      const idx = bdIndex.get(base)!;
      final = businessDays[idx + 1] ?? null; // next workday → Monday
    }

    visiting.delete(id);
    memo.set(id, final);
    return final;
  };

  for (const it of items) resolve(it.id);
  return memo;
}

/** All ACTIVE library items flattened with their category color/sort. */
async function loadActiveLibrary(): Promise<LibItem[]> {
  const cats = await prisma.campaignCategory.findMany({
    where: { is_active: true },
    include: { items: { where: { is_active: true } } },
  });
  const out: LibItem[] = [];
  for (const c of cats) {
    for (const it of c.items) {
      out.push({
        id: it.id, label: it.label,
        anchor_type: it.anchor_type as AnchorType,
        anchor_offset: it.anchor_offset,
        anchor_ref_item_id: it.anchor_ref_item_id,
        not_on_friday: it.not_on_friday,
        sort_order: it.sort_order,
        category_id: c.id, category_name: c.name, color: c.color, category_sort: c.sort_order,
      });
    }
  }
  return out;
}

async function loadEnabledItemIds(scheduleId: number, library: LibItem[]): Promise<Set<number>> {
  const memberships = await prisma.campaignScheduleItem.findMany({ where: { schedule_id: scheduleId } });
  const disabled = new Set(memberships.filter((m) => !m.is_enabled).map((m) => m.campaign_item_id));
  return new Set(library.filter((i) => !disabled.has(i.id)).map((i) => i.id));
}

function sortChips(items: LibItem[]) {
  return (a: DayChip, b: DayChip) => {
    const ia = items.find((i) => i.id === a.campaign_item_id);
    const ib = items.find((i) => i.id === b.campaign_item_id);
    const cs = (ia?.category_sort ?? 0) - (ib?.category_sort ?? 0);
    if (cs !== 0) return cs;
    return (ia?.sort_order ?? 0) - (ib?.sort_order ?? 0);
  };
}

/**
 * The per-date map of item ids that appear, given the generated set plus
 * overrides. Shared by projectMonth (to render) and the override toggle (to
 * compute a minimal diff). `generatedByDate` is derived from enabled items;
 * ADD/REMOVE overrides tweak it.
 */
export function applyOverrides(
  generatedByDate: Map<string, Set<number>>,
  overrides: Array<{ occurrence_date: string; campaign_item_id: number; action: 'ADD' | 'REMOVE' }>,
): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const [d, s] of generatedByDate) out.set(d, new Set(s));
  for (const o of overrides) {
    if (o.action === 'REMOVE') out.get(o.occurrence_date)?.delete(o.campaign_item_id);
    else {
      if (!out.has(o.occurrence_date)) out.set(o.occurrence_date, new Set());
      out.get(o.occurrence_date)!.add(o.campaign_item_id);
    }
  }
  return out;
}

/**
 * Overrides are stored at UTC midnight (`${date}T00:00:00Z`) in a `@db.Date`
 * column, so read them back in UTC too. Using local getters here shifts the day
 * back one in negative-offset timezones (US), landing the toggle on the wrong
 * date — see .cursor/rules/date-handling.mdc.
 */
export const toDs = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Build the generated-by-date set for a schedule/month. Only enabled items with
 * a resolvable date contribute. Returned alongside the flattened library so the
 * caller can sort chips.
 */
export async function buildGenerated(scheduleId: number, year: number, month: number) {
  const [library, businessDays] = await Promise.all([
    loadActiveLibrary(),
    businessDaysOfMonth(year, month),
  ]);
  const enabled = await loadEnabledItemIds(scheduleId, library);
  const resolved = resolveOccurrences(library, businessDays);
  const generated = new Map<string, Set<number>>();
  for (const it of library) {
    if (!enabled.has(it.id)) continue;
    const date = resolved.get(it.id);
    if (!date) continue;
    if (!generated.has(date)) generated.set(date, new Set());
    generated.get(date)!.add(it.id);
  }
  return { library, businessDays, generated, enabled };
}

export async function projectMonth(req: AuthReq, scheduleId: number, year: number, month: number): Promise<MonthProjection> {
  const { scope, schedule } = await assertCanViewSchedule(req, scheduleId);
  await assertMonthVisible(scope, schedule, year, month);
  const { library, generated } = await buildGenerated(scheduleId, year, month);
  const [dayTypes, overrideRows, isPublished] = await Promise.all([
    getMonthDayTypes(year, month),
    prisma.campaignScheduleOverride.findMany({ where: { schedule_id: scheduleId } }),
    isMonthPublished(scheduleId, year, month),
  ]);

  // Overrides store DATE (may arrive as Date) — normalise to YYYY-MM-DD and keep
  // only this month's, so the projection is self-contained.
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}-`;
  const overrides = overrideRows
    .map((o) => ({
      occurrence_date: o.occurrence_date instanceof Date ? toDs(o.occurrence_date) : String(o.occurrence_date).slice(0, 10),
      campaign_item_id: o.campaign_item_id,
      action: o.action as 'ADD' | 'REMOVE',
    }))
    .filter((o) => o.occurrence_date.startsWith(monthPrefix));

  const generatedIds = new Set<string>();
  for (const [d, s] of generated) for (const id of s) generatedIds.add(`${d}:${id}`);

  const finalByDate = applyOverrides(generated, overrides);
  const libById = new Map(library.map((i) => [i.id, i]));
  const chipSort = sortChips(library);

  const days: ProjectedDay[] = [...dayTypes.keys()].sort().map((date) => {
    const type = dayTypes.get(date)!;
    const isWorkday = type === 'WORKDAY' || type === 'ADJUSTMENT';
    const ids = finalByDate.get(date) ?? new Set<number>();
    const chips: DayChip[] = [...ids].flatMap((id) => {
      const it = libById.get(id);
      if (!it) return [];
      return [{
        campaign_item_id: it.id, label: it.label,
        category_id: it.category_id, category_name: it.category_name, color: it.color,
        source: generatedIds.has(`${date}:${id}`) ? 'GENERATED' : 'ADDED',
      } as DayChip];
    }).sort(chipSort);
    return { date, day_type: type, is_workday: isWorkday, chips };
  });

  return {
    schedule_id: scheduleId, year, month,
    is_published: isPublished, schedule_status: schedule.status,
    days,
  };
}

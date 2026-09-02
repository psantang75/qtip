/**
 * Template CRUD. A template is a named week: up to seven days, each a day off or
 * a shift window with sparse break/lunch segments. Templates are global (not
 * department-scoped) and soft-deactivated, never deleted, because a template
 * that generated real shifts is referenced by provenance on those shifts.
 *
 * Applying a template onto real dates lives in schedule.shift.service.ts, since
 * that is a shift write; this file only manages the template definitions.
 */
import prisma from '../../config/prisma';
import { ScheduleServiceError } from './schedule.types';

export interface TemplateSegmentInput {
  activity_type_id: number;
  start: string; // 'HH:MM'
  end: string;
}
export interface TemplateDayInput {
  day_of_week: number; // 0=Sun … 6=Sat
  is_day_off: boolean;
  start?: string | null; // 'HH:MM'
  end?: string | null;
  segments?: TemplateSegmentInput[];
}
export interface TemplateInput {
  template_name: string;
  description?: string | null;
  days: TemplateDayInput[];
}

/** Prisma Time columns want a Date; anchor 'HH:MM' at the epoch in UTC. */
function timeValue(hm: string): Date {
  const [h, m] = hm.split(':').map(Number);
  return new Date(Date.UTC(1970, 0, 1, h, m, 0));
}

// Templates are read back into an editor that must distinguish break vs lunch,
// so the segment's activity_type label rides along (mirrors the shift read).
const segmentInclude = {
  include: { activity_type: true },
  orderBy: { sort_order: 'asc' },
} as const;

export function listTemplates(includeInactive = false) {
  return prisma.scheduleTemplate.findMany({
    where: includeInactive ? {} : { is_active: true },
    include: {
      days: { include: { segments: segmentInclude }, orderBy: { day_of_week: 'asc' } },
    },
    orderBy: { template_name: 'asc' },
  });
}

export async function getTemplate(id: number) {
  const tpl = await prisma.scheduleTemplate.findUnique({
    where: { id },
    include: {
      days: { include: { segments: segmentInclude }, orderBy: { day_of_week: 'asc' } },
    },
  });
  if (!tpl) throw new ScheduleServiceError('Template not found', 404, 'NOT_FOUND');
  return tpl;
}

function validateDays(days: TemplateDayInput[]): void {
  const seen = new Set<number>();
  for (const d of days) {
    if (d.day_of_week < 0 || d.day_of_week > 6) {
      throw new ScheduleServiceError('day_of_week must be 0–6', 400, 'INVALID_DAY');
    }
    if (seen.has(d.day_of_week)) {
      throw new ScheduleServiceError('Duplicate day_of_week in template', 400, 'DUPLICATE_DAY');
    }
    seen.add(d.day_of_week);
    if (!d.is_day_off && (!d.start || !d.end)) {
      throw new ScheduleServiceError('A working template day needs a start and end', 400, 'MISSING_TIMES');
    }
  }
}

function dayCreateData(days: TemplateDayInput[]) {
  return days.map((d) => ({
    day_of_week: d.day_of_week,
    is_day_off: d.is_day_off,
    start_time: d.is_day_off || !d.start ? null : timeValue(d.start),
    end_time: d.is_day_off || !d.end ? null : timeValue(d.end),
    segments: {
      // Persist in clock order so breaks/lunches always read back sorted by
      // start time, regardless of the order they were added in the builder.
      create: (d.is_day_off ? [] : d.segments ?? [])
        .slice()
        .sort((a, b) => a.start.localeCompare(b.start))
        .map((s, i) => ({
          activity_type_id: s.activity_type_id,
          start_time: timeValue(s.start),
          end_time: timeValue(s.end),
          sort_order: i,
        })),
    },
  }));
}

export async function createTemplate(input: TemplateInput, createdBy: number) {
  validateDays(input.days);
  const dup = await prisma.scheduleTemplate.findUnique({ where: { template_name: input.template_name } });
  if (dup) throw new ScheduleServiceError('A template with that name already exists', 409, 'DUPLICATE');

  return prisma.scheduleTemplate.create({
    data: {
      template_name: input.template_name,
      description: input.description ?? null,
      created_by: createdBy,
      days: { create: dayCreateData(input.days) },
    },
    include: { days: { include: { segments: true } } },
  });
}

export async function updateTemplate(id: number, input: TemplateInput) {
  validateDays(input.days);
  const tpl = await prisma.scheduleTemplate.findUnique({ where: { id } });
  if (!tpl) throw new ScheduleServiceError('Template not found', 404, 'NOT_FOUND');

  const dup = await prisma.scheduleTemplate.findFirst({
    where: { template_name: input.template_name, id: { not: id } },
  });
  if (dup) throw new ScheduleServiceError('A template with that name already exists', 409, 'DUPLICATE');

  // Replace the day/segment tree wholesale — simplest correct semantics for an
  // editor that re-sends the entire week. Existing shifts keep their own copy.
  return prisma.$transaction(async (tx) => {
    await tx.scheduleTemplateDay.deleteMany({ where: { template_id: id } });
    return tx.scheduleTemplate.update({
      where: { id },
      data: {
        template_name: input.template_name,
        description: input.description ?? null,
        days: { create: dayCreateData(input.days) },
      },
      include: { days: { include: { segments: true } } },
    });
  });
}

export async function setTemplateActive(id: number, isActive: boolean) {
  const tpl = await prisma.scheduleTemplate.findUnique({ where: { id } });
  if (!tpl) throw new ScheduleServiceError('Template not found', 404, 'NOT_FOUND');
  return prisma.scheduleTemplate.update({ where: { id }, data: { is_active: isActive } });
}

export async function duplicateTemplate(id: number, createdBy: number) {
  const tpl = await getTemplate(id);
  let name = `${tpl.template_name} (copy)`;
  for (let i = 2; await prisma.scheduleTemplate.findUnique({ where: { template_name: name } }); i++) {
    name = `${tpl.template_name} (copy ${i})`;
  }
  return prisma.scheduleTemplate.create({
    data: {
      template_name: name,
      description: tpl.description,
      created_by: createdBy,
      days: {
        create: tpl.days.map((d) => ({
          day_of_week: d.day_of_week,
          is_day_off: d.is_day_off,
          start_time: d.start_time,
          end_time: d.end_time,
          segments: {
            create: d.segments.map((s) => ({
              activity_type_id: s.activity_type_id,
              start_time: s.start_time,
              end_time: s.end_time,
              sort_order: s.sort_order,
            })),
          },
        })),
      },
    },
    include: { days: { include: { segments: true } } },
  });
}

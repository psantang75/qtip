import prisma from '../config/prisma';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreateMetricData {
  code: string;
  name: string;
  aggregation: 'COUNT' | 'SUM' | 'AVG' | 'MAX' | 'MIN';
  direction: 'HIGH_IS_GOOD' | 'LOW_IS_GOOD';
  is_cumulative?: boolean;
  is_active?: boolean;
}

export interface UpdateMetricData {
  name?: string;
  aggregation?: 'COUNT' | 'SUM' | 'AVG' | 'MAX' | 'MIN';
  direction?: 'HIGH_IS_GOOD' | 'LOW_IS_GOOD';
  is_cumulative?: boolean;
  is_active?: boolean;
}

export interface SetThresholdData {
  red_below: number;
  yellow_below: number;
  department_id?: number | null;
}

// ── Service functions ─────────────────────────────────────────────────────────

/** Return all active MetricDefinitions with their department assignments. */
export async function getAllMetrics() {
  return prisma.metricDefinition.findMany({
    where: { is_active: true },
    include: {
      metric_departments: {
        include: {
          department: { select: { id: true, department_name: true } },
        },
      },
    },
    orderBy: { name: 'asc' },
  });
}

/** Return a single MetricDefinition with its thresholds. */
export async function getMetricById(id: number) {
  return prisma.metricDefinition.findUnique({
    where: { id },
    include: {
      metric_departments: {
        include: {
          department: { select: { id: true, department_name: true } },
        },
      },
      metric_thresholds: {
        include: {
          department: { select: { id: true, department_name: true } },
        },
      },
    },
  });
}

/** Create a new MetricDefinition. */
export async function createMetric(data: CreateMetricData) {
  return prisma.metricDefinition.create({
    data: {
      code: data.code,
      name: data.name,
      aggregation: data.aggregation,
      direction: data.direction,
      is_cumulative: data.is_cumulative ?? false,
      is_active: data.is_active ?? true,
    },
  });
}

/** Update an existing MetricDefinition. */
export async function updateMetric(id: number, data: UpdateMetricData) {
  return prisma.metricDefinition.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.aggregation !== undefined && { aggregation: data.aggregation }),
      ...(data.direction !== undefined && { direction: data.direction }),
      ...(data.is_cumulative !== undefined && { is_cumulative: data.is_cumulative }),
      ...(data.is_active !== undefined && { is_active: data.is_active }),
    },
  });
}

/**
 * Upsert a MetricThreshold for the given metric and optional department.
 * A null department_id means the threshold is global (applies to all departments).
 */
export async function setThreshold(metricId: number, data: SetThresholdData) {
  const { department_id = null, red_below, yellow_below } = data;

  // Find existing threshold with matching metric + department combo
  const existing = await prisma.metricThreshold.findFirst({
    where: {
      metric_id: metricId,
      department_id: department_id ?? null,
    },
  });

  if (existing) {
    return prisma.metricThreshold.update({
      where: { id: existing.id },
      data: { red_below, yellow_below },
    });
  }

  return prisma.metricThreshold.create({
    data: {
      metric_id: metricId,
      department_id: department_id ?? null,
      red_below,
      yellow_below,
    },
  });
}

/**
 * Return thresholds for a metric, optionally filtered by department.
 * If no departmentId is given, returns all thresholds for the metric.
 */
export async function getThresholds(metricId: number, departmentId?: number) {
  return prisma.metricThreshold.findMany({
    where: {
      metric_id: metricId,
      ...(departmentId !== undefined && { department_id: departmentId }),
    },
    include: {
      department: { select: { id: true, department_name: true } },
    },
    orderBy: { created_at: 'asc' },
  });
}

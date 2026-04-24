/**
 * Pure analytics math helpers.
 *
 * Extracted from the legacy `AnalyticsService` god class during
 * pre-production cleanup item #29. All functions in this module are
 * deterministic and free of I/O — they take rows in, return shaped data
 * out — so they're trivial to unit test.
 */

import type {
  GroupedScoreData,
  ScoreDistribution,
  ScoreTrendDataPoint,
} from '../../types/analytics.types'

/**
 * Empty statistics envelope used as a safe default when there are no
 * scores to summarise (e.g. no submissions in the selected window).
 */
export function getEmptyStatistics(): {
  count: number
  mean: number
  median: number
  mode: number
  standardDeviation: number
  min: number
  max: number
  percentiles: { p25: number; p50: number; p75: number; p90: number; p95: number }
} {
  return {
    count: 0,
    mean: 0,
    median: 0,
    mode: 0,
    standardDeviation: 0,
    min: 0,
    max: 0,
    percentiles: { p25: 0, p50: 0, p75: 0, p90: 0, p95: 0 },
  }
}

export function calculateOverallMetrics(
  rawData: any[],
): { averageScore: number; totalAudits: number } {
  if (rawData.length === 0) {
    return { averageScore: 0, totalAudits: 0 }
  }
  const total = rawData.reduce((sum, row) => sum + row.total_score, 0)
  return {
    averageScore: Math.round((total / rawData.length) * 100) / 100,
    totalAudits: rawData.length,
  }
}

const SCORE_BUCKETS: Array<{ range: string; min: number; max: number }> = [
  { range: '90-100', min: 90, max: 100 },
  { range: '80-89',  min: 80, max: 89.99 },
  { range: '70-79',  min: 70, max: 79.99 },
  { range: '60-69',  min: 60, max: 69.99 },
  { range: '0-59',   min: 0,  max: 59.99 },
]

export function calculateScoreDistribution(rawData: any[]): ScoreDistribution[] {
  const total = rawData.length
  return SCORE_BUCKETS.map(bucket => {
    const count = rawData.filter(
      row => row.total_score >= bucket.min && row.total_score <= bucket.max,
    ).length
    const percentage = total > 0
      ? Math.round((count / total) * 100 * 100) / 100
      : 0
    return { range: bucket.range, count, percentage }
  })
}

export function aggregateScoreTrends(
  rawData: any[],
  groupBy: string,
): GroupedScoreData[] {
  const groups = new Map<string, { name: string; scores: { date: string; score: number }[] }>()

  rawData.forEach(record => {
    const groupKey = groupBy === 'department'
      ? (record.group_id || 'unassigned').toString()
      : record.group_id.toString()

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        name: record.group_name || 'Unknown',
        scores: [],
      })
    }
    groups.get(groupKey)!.scores.push({
      date: record.date,
      score: record.total_score,
    })
  })

  const trends: GroupedScoreData[] = []
  groups.forEach((group, groupId) => {
    const dateScores = new Map<string, { total: number; count: number }>()
    group.scores.forEach(({ date, score }) => {
      if (!dateScores.has(date)) dateScores.set(date, { total: 0, count: 0 })
      const entry = dateScores.get(date)!
      entry.total += score
      entry.count += 1
    })

    const data: ScoreTrendDataPoint[] = Array.from(dateScores.entries())
      .map(([date, scores]) => ({
        date,
        score: Math.round((scores.total / scores.count) * 100) / 100,
        count: scores.count,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const totalScore = group.scores.reduce((sum, s) => sum + s.score, 0)
    const averageScore = Math.round((totalScore / group.scores.length) * 100) / 100

    trends.push({
      id: parseInt(groupId, 10),
      name: group.name,
      data,
      averageScore,
    })
  })

  return trends.sort((a, b) => a.name.localeCompare(b.name))
}

export function calculateStandardDeviation(values: number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

export function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

export function calculateMode(values: number[]): number {
  if (values.length === 0) return 0
  const frequency: Record<number, number> = {}
  values.forEach(value => { frequency[value] = (frequency[value] || 0) + 1 })

  let maxFreq = 0
  let mode = values[0]
  Object.keys(frequency).forEach(value => {
    if (frequency[Number(value)] > maxFreq) {
      maxFreq = frequency[Number(value)]
      mode = Number(value)
    }
  })
  return Number.isNaN(mode) ? 0 : mode
}

export function calculatePercentiles(
  values: number[],
): { p25: number; p50: number; p75: number; p90: number; p95: number } {
  if (values.length === 0) return { p25: 0, p50: 0, p75: 0, p90: 0, p95: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const percentile = (p: number): number => {
    const index = (p / 100) * (sorted.length - 1)
    const lower = Math.floor(index)
    const upper = Math.ceil(index)
    const weight = index % 1
    if (upper >= sorted.length) return sorted[sorted.length - 1]
    return sorted[lower] * (1 - weight) + sorted[upper] * weight
  }
  return {
    p25: percentile(25),
    p50: percentile(50),
    p75: percentile(75),
    p90: percentile(90),
    p95: percentile(95),
  }
}

export function calculateRawScoreStatistics(rawData: any[]): {
  count: number
  mean: number
  median: number
  mode: number
  standardDeviation: number
  min: number
  max: number
  percentiles: { p25: number; p50: number; p75: number; p90: number; p95: number }
} {
  const scores = rawData
    .map(r => r.total_score)
    .filter(score => score !== null && score !== undefined && !Number.isNaN(score))

  if (scores.length === 0) return getEmptyStatistics()

  const mean = scores.reduce((a, b) => a + b, 0) / scores.length
  const median = calculateMedian(scores)
  const mode = calculateMode(scores)
  const standardDeviation = calculateStandardDeviation(scores)
  const min = Math.min(...scores)
  const max = Math.max(...scores)
  const percentiles = calculatePercentiles(scores)

  return {
    count: scores.length,
    mean: Number.isNaN(mean) ? 0 : mean,
    median: Number.isNaN(median) ? 0 : median,
    mode: Number.isNaN(mode) ? 0 : mode,
    standardDeviation: Number.isNaN(standardDeviation) ? 0 : standardDeviation,
    min: !Number.isFinite(min) ? 0 : min,
    max: !Number.isFinite(max) ? 0 : max,
    percentiles,
  }
}

export function calculatePercentComplete(
  actualValue: number,
  targetValue: number,
): number {
  if (targetValue === 0) return 0
  return Math.min(100, Math.round((actualValue / targetValue) * 100))
}

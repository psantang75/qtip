/**
 * Answer-text / Answer-value resolution for the analytics raw scores
 * report.
 *
 * Extracted from the original `services/onDemandReportsRegistry.ts`
 * during pre-production cleanup item #29 (god-files refactor).
 *
 * The on-screen viewer needs:
 *  - human-readable Answer text (e.g. "Tool A, Tool B" instead of
 *    "1,2") via {@link resolveAnswerText}
 *  - a per-answer Value column that mirrors how the answer was scored
 *    via {@link resolveAnswerValue} (string when multi-select with
 *    more than one choice, number otherwise)
 *
 * The Excel download additionally needs an always-numeric companion
 * column ({@link resolveAnswerTotalValue}) so spreadsheets can
 * sum/average it. Multi-select returns the SUM of every selected
 * option's score there.
 *
 * All three resolvers share the same pre-computed lookups so we
 * never N+1 the underlying tables — built once via
 * {@link augmentAnalyticsRowsWithAnswerText}.
 */

import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'

export interface AnswerOption {
  text: string
  score: number
}

export interface QuestionMeta {
  question_type: string
  yes_value: number
  no_value: number
  na_value: number
  scale_max: number | null
  scale_min: number | null
}

export async function buildAnswerOptionLookup(
  questionIds: number[],
): Promise<Map<number, Map<string, AnswerOption>>> {
  const lookup = new Map<number, Map<string, AnswerOption>>()
  if (questionIds.length === 0) return lookup

  const opts = await prisma.$queryRaw<{
    question_id: number
    option_value: string
    option_text: string
    score: number
  }[]>(Prisma.sql`
    SELECT question_id, option_value, option_text, score
    FROM radio_options
    WHERE question_id IN (${Prisma.join(questionIds)})
  `)

  for (const opt of opts) {
    const qid = Number(opt.question_id)
    if (!lookup.has(qid)) lookup.set(qid, new Map())
    const map = lookup.get(qid)!
    const entry: AnswerOption = {
      text: opt.option_text,
      score: Number(opt.score) || 0,
    }
    if (opt.option_value != null) map.set(String(opt.option_value), entry)
    if (opt.option_text != null && !map.has(opt.option_text)) {
      map.set(opt.option_text, entry)
    }
  }
  return lookup
}

export async function buildQuestionMetaLookup(
  questionIds: number[],
): Promise<Map<number, QuestionMeta>> {
  const lookup = new Map<number, QuestionMeta>()
  if (questionIds.length === 0) return lookup

  const rows = await prisma.$queryRaw<{
    id: number
    question_type: string
    yes_value: number | null
    no_value: number | null
    na_value: number | null
    scale_max: number | null
    scale_min: number | null
  }[]>(Prisma.sql`
    SELECT id, question_type, yes_value, no_value, na_value, scale_max, scale_min
    FROM form_questions
    WHERE id IN (${Prisma.join(questionIds)})
  `)

  for (const r of rows) {
    lookup.set(Number(r.id), {
      question_type: String(r.question_type || '').toUpperCase(),
      yes_value: Number(r.yes_value ?? 0),
      no_value: Number(r.no_value ?? 0),
      na_value: Number(r.na_value ?? 0),
      scale_max: r.scale_max != null ? Number(r.scale_max) : null,
      scale_min: r.scale_min != null ? Number(r.scale_min) : null,
    })
  }
  return lookup
}

export function resolveAnswerText(
  questionId: number | undefined | null,
  rawAnswer: string,
  lookup: Map<number, Map<string, AnswerOption>>,
): string {
  if (!rawAnswer) return ''
  const qid = questionId != null ? Number(questionId) : NaN
  const optMap = Number.isFinite(qid) ? lookup.get(qid) : undefined
  if (!optMap || optMap.size === 0) return rawAnswer

  const tokens = rawAnswer.split(',').map(t => t.trim()).filter(Boolean)
  if (tokens.length === 0) return rawAnswer
  return tokens.map(t => optMap.get(t)?.text ?? t).join(', ')
}

export function resolveAnswerValue(
  questionId: number | undefined | null,
  rawAnswer: string,
  optionLookup: Map<number, Map<string, AnswerOption>>,
  metaLookup: Map<number, QuestionMeta>,
): number | string {
  if (rawAnswer == null || rawAnswer === '') return ''
  const qid = questionId != null ? Number(questionId) : NaN
  const meta = Number.isFinite(qid) ? metaLookup.get(qid) : undefined
  const optMap = Number.isFinite(qid) ? optionLookup.get(qid) : undefined
  const trimmed = String(rawAnswer).trim()

  if (meta && (meta.question_type === 'TEXT' || meta.question_type === 'INFO_BLOCK')) {
    return ''
  }

  if (meta && meta.question_type === 'YES_NO') {
    const norm = trimmed.toLowerCase()
    if (norm === 'yes') return meta.yes_value
    if (norm === 'no') return meta.no_value
    if (norm === 'n/a' || norm === 'na') return meta.na_value
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : trimmed
  }

  if (meta && meta.question_type === 'SCALE') {
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : trimmed
  }

  if (optMap && optMap.size > 0) {
    const tokens = trimmed.split(',').map(t => t.trim()).filter(Boolean)
    if (tokens.length === 0) return ''
    const scores = tokens.map(t => {
      const opt = optMap.get(t)
      return opt ? opt.score : t
    })
    if (scores.length === 1) return scores[0]
    return scores.join(', ')
  }

  const n = Number(trimmed)
  return Number.isFinite(n) ? n : trimmed
}

/**
 * Always-numeric companion to {@link resolveAnswerValue}. Returns
 * `null` (not 0) for non-scoring question types so the Excel cell
 * stays blank rather than implying a meaningful zero.
 */
export function resolveAnswerTotalValue(
  questionId: number | undefined | null,
  rawAnswer: string,
  optionLookup: Map<number, Map<string, AnswerOption>>,
  metaLookup: Map<number, QuestionMeta>,
): number | null {
  if (rawAnswer == null || rawAnswer === '') return null
  const qid = questionId != null ? Number(questionId) : NaN
  const meta = Number.isFinite(qid) ? metaLookup.get(qid) : undefined
  const optMap = Number.isFinite(qid) ? optionLookup.get(qid) : undefined
  const trimmed = String(rawAnswer).trim()

  if (meta && (meta.question_type === 'TEXT' || meta.question_type === 'INFO_BLOCK')) {
    return null
  }

  if (meta && meta.question_type === 'YES_NO') {
    const norm = trimmed.toLowerCase()
    if (norm === 'yes') return meta.yes_value
    if (norm === 'no') return meta.no_value
    if (norm === 'n/a' || norm === 'na') return meta.na_value
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : null
  }

  if (meta && meta.question_type === 'SCALE') {
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : null
  }

  if (optMap && optMap.size > 0) {
    const tokens = trimmed.split(',').map(t => t.trim()).filter(Boolean)
    if (tokens.length === 0) return null
    return tokens.reduce<number>((sum, t) => {
      const opt = optMap.get(t)
      return sum + (opt ? Number(opt.score) || 0 : 0)
    }, 0)
  }

  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

/**
 * Augments analytics rows with resolved Answer text + Value columns
 * using batched lookups (one round-trip per table for the entire
 * page). When `includeTotalValue` is true, also tacks on
 * `question_total_value` for the Excel download.
 */
export async function augmentAnalyticsRowsWithAnswerText(
  rows: any[],
  options: { includeTotalValue?: boolean } = {},
): Promise<any[]> {
  const ids = new Set<number>()
  for (const r of rows) {
    const qid = Number(r.question_id)
    if (Number.isFinite(qid) && qid > 0) ids.add(qid)
  }
  const idArr = Array.from(ids)
  const [optionLookup, metaLookup] = await Promise.all([
    buildAnswerOptionLookup(idArr),
    buildQuestionMetaLookup(idArr),
  ])

  return rows.map(r => {
    const raw = r.question_answer ?? ''
    const augmented: Record<string, unknown> = {
      ...r,
      question_answer: resolveAnswerText(r.question_id, raw, optionLookup),
      question_value: resolveAnswerValue(r.question_id, raw, optionLookup, metaLookup),
    }
    if (options.includeTotalValue) {
      augmented.question_total_value = resolveAnswerTotalValue(
        r.question_id, raw, optionLookup, metaLookup,
      )
    }
    return augmented
  })
}

export interface SqlFragment {
  sql: string
  params: (string | number)[]
}

export function deptClause(deptFilter: number[], alias = 'csr'): SqlFragment {
  if (deptFilter.length === 0) return { sql: '', params: [] }
  const ph = deptFilter.map(() => '?').join(',')
  return { sql: `AND ${alias}.department_id IN (${ph})`, params: deptFilter }
}

export function formClause(names: string[], alias = 'f'): SqlFragment {
  if (names.length === 0) return { sql: '', params: [] }
  return { sql: `AND ${alias}.form_name IN (${names.map(() => '?').join(',')})`, params: names }
}

/**
 * Form filter for queries whose base table is `submissions` (no existing JOIN
 * to `forms`). Returns the JOIN and WHERE fragments together so callers can
 * splice them in without paying the JOIN cost when no form filter is active.
 *
 * `submissionAlias` is the alias used for the `submissions` row in the query
 * (typically `s` or `sub`). The forms alias is fixed to `f` to match
 * `formClause` and keep parameter naming consistent.
 */
export function formFilter(
  names: string[],
  submissionAlias = 's',
): { join: string; where: string; params: string[] } {
  if (names.length === 0) return { join: '', where: '', params: [] }
  return {
    join:   `JOIN forms f ON f.id = ${submissionAlias}.form_id`,
    where:  `AND f.form_name IN (${names.map(() => '?').join(',')})`,
    params: names,
  }
}

export const CSR_JOIN = `
  JOIN submission_metadata sm_csr  ON sm_csr.submission_id = s.id
  JOIN form_metadata_fields fmf_csr ON sm_csr.field_id = fmf_csr.id AND fmf_csr.field_name = 'CSR'
  JOIN users csr ON csr.id = CAST(sm_csr.value AS UNSIGNED)`

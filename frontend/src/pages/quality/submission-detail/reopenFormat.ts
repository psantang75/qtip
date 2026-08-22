/** Score as a percent, em-dash when null. Shared by the reopen cards. */
export const fmtScore = (n: number | null) => (n == null ? '—' : `${n}%`)

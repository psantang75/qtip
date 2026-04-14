/**
 * Re-exports shared detail primitives so existing write-up imports stay valid.
 * All styling is defined once in components/common/DetailLayout.
 */
export { Section, Sub, InfoRow, NoteBlock, SideCard, SideTitle, ProgressRow } from '@/components/common/DetailLayout'

import type { WriteUpDetail } from '@/services/writeupService'
export type DetailSectionProps = { writeup: WriteUpDetail }

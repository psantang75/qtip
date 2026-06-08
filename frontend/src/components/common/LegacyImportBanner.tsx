import { AlertTriangle } from 'lucide-react'

interface LegacyImportBannerProps {
  /** Original combined coaching_type value from the legacy system, if known. */
  legacyType?: string | null
}

/**
 * Shown at the top of coaching and performance-warning detail pages for records
 * migrated from the legacy QTIP system (before coaching and warnings were split
 * into separate sections). These rows only carry the fields that existed in the
 * old system, so many newer sections are intentionally empty.
 */
export function LegacyImportBanner({ legacyType }: LegacyImportBannerProps) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-700">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
      <p className="text-[13px] leading-relaxed">
        Imported from the legacy QTIP system. This record only contains the
        historical data that existed before coaching and performance warnings
        were split into separate sections, so some fields may be empty.
        {legacyType ? <span className="font-semibold"> Original type: {legacyType}.</span> : null}
      </p>
    </div>
  )
}

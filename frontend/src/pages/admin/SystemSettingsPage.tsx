import KbIndexSchedulerCard from './system-settings/KbIndexSchedulerCard'

/**
 * System Settings hub. Hosts platform-level admin cards that don't
 * belong to a specific feature page (today: KB Index Scheduler; in
 * the future: drift detector cadence, digest scheduler controls,
 * etc.). Designed as a single column so each card can grow its own
 * width-flexible layout without fighting a sibling for grid space.
 */
export default function SystemSettingsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">System Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Platform-wide background workers and scheduled jobs.
        </p>
      </div>

      <KbIndexSchedulerCard />
    </div>
  )
}

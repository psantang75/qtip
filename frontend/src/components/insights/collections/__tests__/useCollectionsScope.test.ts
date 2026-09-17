/**
 * The Collections campaign/currency selection has to survive navigation WITHIN the
 * section, which is a property of the pages agreeing on one scope string rather than
 * of the hook itself. The hook needs a renderer (the frontend Vitest run is
 * `environment: 'node'`), so this covers the stored shape and the page wiring — the
 * two things that actually broke.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '../../../..')
const hook = readFileSync(join(SRC, 'components/insights/collections/useCollectionsScope.ts'), 'utf8')
/** Statements only — the prose explaining the defect names the APIs it is about. */
const hookCode = hook.replace(/\/\*[\s\S]*?\*\//g, '')

/** Every page under Insights → Collections that offers a campaign selector. */
const CAMPAIGN_PAGES = [
  'CollectionsCyclePerformancePage',
  'CollectionsCycleInvoicesPage',
  'CollectionsFailedChargeInvoicesPage',
  'CollectionsCampaignTouchPage',
  'CollectionsAgentPerformancePage',
]

const pageSource = (name: string) =>
  readFileSync(join(SRC, 'pages/insights', `${name}.tsx`), 'utf8')

describe('Collections scope', () => {
  it('stores the selection against the section, not a single page', () => {
    expect(hook).toContain("const SCOPE = 'insights.collections'")
  })

  it('opens on the aggregate campaign in the reporting currency', () => {
    expect(hook).toContain("export const ALL_DECLINED = 'All Declined'")
    expect(hook).toContain("const DEFAULT_CURRENCY = 'USD'")
    expect(hook).toContain("useStickyState(SCOPE, 'campaign', ALL_DECLINED)")
    expect(hook).toContain("useStickyState(SCOPE, 'currency', DEFAULT_CURRENCY)")
  })

  it('reuses the sticky-filter layer rather than a second copy of the plumbing', () => {
    expect(hook).toContain("import { useStickyState } from '@/hooks/useStickyFilters'")
    expect(hookCode).not.toContain('sessionStorage')
  })

  describe.each(CAMPAIGN_PAGES)('%s', (name) => {
    it('takes its campaign from the shared scope', () => {
      expect(pageSource(name)).toContain('useCollectionsScope()')
    })

    /**
     * The defect itself: a page holding its own campaign kept the period on navigation
     * and reset the campaign, so Cycle Performance showed 3 Submission Error invoices
     * and the list behind it showed 523 for the same month.
     */
    it('holds no campaign or currency of its own', () => {
      const src = pageSource(name)
      expect(src).not.toMatch(/useState\(\s*'All Declined'\s*\)/)
      expect(src).not.toMatch(/useState\(\s*'USD'\s*\)/)
    })
  })
})

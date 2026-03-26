/**
 * QualityListPage — shared outer shell for every Quality section list view.
 *
 * Centralises the `p-6 space-y-5` container so a single edit here
 * instantly updates padding/spacing across all list pages.
 *
 * Usage:
 *   <QualityListPage>
 *     <QualityPageHeader ... />
 *     <QualityFilterBar ... />
 *     <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
 *       <Table>...</Table>
 *     </div>
 *     <ListPagination ... />
 *   </QualityListPage>
 */
export function QualityListPage({ children }: { children: React.ReactNode }) {
  return <div className="p-6 space-y-5">{children}</div>
}

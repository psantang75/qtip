/**
 * ListPageShell — shared outer shell for every list page (Quality, Training,
 * Performance Warnings, etc.).
 *
 * Centralises the `p-6 space-y-5` container so a single edit here
 * instantly updates padding/spacing across all list pages.
 *
 * Usage:
 *   <ListPageShell>
 *     <ListPageHeader ... />
 *     <ListFilterBar ... />
 *     <ListCard>
 *       <Table>...</Table>
 *     </ListCard>
 *     <ListPagination ... />
 *   </ListPageShell>
 */
export function ListPageShell({ children }: { children: React.ReactNode }) {
  return <div className="p-6 space-y-5">{children}</div>
}

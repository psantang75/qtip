import { forwardRef } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface RowActionButtonProps extends Omit<ButtonProps, 'variant' | 'size' | 'children'> {
  /** Lucide icon shown to the left of the label */
  icon?: LucideIcon
  /** Visible label (e.g. "View", "Edit") */
  children: React.ReactNode
}

/**
 * RowActionButton — the standard primary-blue action used inside a list row's
 * action cell across every list page (Quality, Training, Performance Warnings,
 * Admin). Centralises sizing, padding, icon size, gap, and the blue link-style
 * colour so all list pages look identical.
 *
 * Spread all other Button props through so callers can still pass `onClick`,
 * `disabled`, `type`, etc.
 */
export const RowActionButton = forwardRef<HTMLButtonElement, RowActionButtonProps>(
  ({ icon: Icon, children, className, ...props }, ref) => {
    return (
      <Button
        ref={ref}
        variant="ghost"
        size="sm"
        className={cn(
          'h-7 px-2 text-[12px] gap-1 text-primary hover:text-primary hover:bg-primary/10',
          className,
        )}
        {...props}
      >
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {children}
      </Button>
    )
  },
)
RowActionButton.displayName = 'RowActionButton'

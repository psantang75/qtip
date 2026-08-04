/**
 * ColorSwatchPicker — a small preset-palette color chooser. Categorical colors
 * (campaign categories) are inherent to that feature, so we offer a curated,
 * on-brand palette plus an optional hex field rather than a full color wheel.
 *
 * Renders a swatch button that opens a Popover grid. No new dependency — built
 * on the existing shadcn Popover + Input.
 */
import { useState } from 'react'
import { Check } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** Curated on-brand categorical palette (distinguishable at chip size). */
const CAMPAIGN_PALETTE = [
  '#00aeef', '#1abc9c', '#f39c12', '#e74c3c',
  '#8e44ad', '#2980b9', '#16a085', '#d35400',
  '#27ae60', '#c0392b', '#2c3e50', '#f1c40f',
]

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export function ColorSwatchPicker({ value, onChange, className }: {
  value: string
  onChange: (hex: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [hex, setHex] = useState(value)

  const applyHex = () => { if (HEX.test(hex)) { onChange(hex); setOpen(false) } }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Choose color"
          className={cn('h-7 w-7 shrink-0 rounded-md border border-slate-200 shadow-sm', className)}
          style={{ backgroundColor: value }}
        />
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3" align="start">
        <div className="grid grid-cols-6 gap-2">
          {CAMPAIGN_PALETTE.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => { onChange(c); setHex(c); setOpen(false) }}
              className="relative h-7 w-7 rounded-md border border-slate-200 transition-transform hover:scale-110"
              style={{ backgroundColor: c }}
              aria-label={c}
            >
              {value.toLowerCase() === c.toLowerCase() && (
                <Check className="absolute inset-0 m-auto h-3.5 w-3.5 text-white drop-shadow" />
              )}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Input
            value={hex}
            onChange={e => setHex(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') applyHex() }}
            placeholder="#00aeef"
            className="h-8 text-[12px]"
          />
          <button
            type="button"
            onClick={applyHex}
            className="h-8 rounded-md bg-primary px-2 text-[12px] font-medium text-white hover:bg-primary/90"
          >
            Set
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

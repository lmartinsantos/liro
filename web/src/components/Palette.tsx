import { useState } from 'react'
import { Hint } from '@/components/ui/hint'
import { Input } from '@/components/ui/input'

export const FILL_SWATCHES = [
  '#fef08a',
  '#f43f5e',
  '#f59e0b',
  '#10b981',
  '#0ea5e9',
  '#8b5cf6',
  '#14b8a6',
  '#ffffff',
  '#1e2a4a',
]

export const STROKE_SWATCHES = ['#1e2a4a', '#f43f5e', '#0ea5e9', '#10b981', '#8b5cf6', '#ffffff']

type Props = {
  fill: string
  stroke: string
  onFill: (c: string) => void
  onStroke: (c: string) => void
}

export function Palette({ fill, stroke, onFill, onStroke }: Props) {
  return (
    <div className="flex w-full flex-col gap-2 px-1 pb-1">
      <MiniPicker label="Fill" value={fill} colors={FILL_SWATCHES} onPick={onFill} />
      <MiniPicker label="Line" value={stroke} colors={STROKE_SWATCHES} onPick={onStroke} />
    </div>
  )
}

function MiniPicker({
  label,
  value,
  colors,
  onPick,
}: {
  label: string
  value: string
  colors: string[]
  onPick: (c: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative flex flex-col items-center gap-1">
      <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
      <Hint label={label} side="right">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="size-8 rounded-full border border-input shadow-none"
          style={{
            background: value,
            boxShadow:
              value.toLowerCase() === '#ffffff' || value.toLowerCase() === '#fafaf9'
                ? 'inset 0 0 0 1px var(--input)'
                : undefined,
          }}
        />
      </Hint>
      {open && (
        <div className="absolute bottom-0 left-full z-30 ml-2 w-44 rounded-2xl bg-card p-2.5 shadow-card">
          <div className="mb-2 grid grid-cols-5 gap-1.5">
            {colors.map((c) => (
              <Hint key={c} label={c} side="top">
                <button
                  type="button"
                  onClick={() => {
                    onPick(c)
                    setOpen(false)
                  }}
                  className="size-6 rounded-full border border-input"
                  style={{
                    background: c,
                    outline: value.toLowerCase() === c.toLowerCase() ? '2px solid var(--ring)' : undefined,
                    outlineOffset: 1,
                  }}
                />
              </Hint>
            ))}
          </div>
          <Input
            value={value}
            onChange={(e) => onPick(e.target.value)}
            className="h-8 px-2 font-mono text-[11px]"
          />
        </div>
      )}
    </div>
  )
}

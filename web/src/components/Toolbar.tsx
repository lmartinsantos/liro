import {
  ArrowUpRight,
  Circle,
  Columns2,
  Diamond,
  Frame,
  Minus,
  MousePointer2,
  Smile,
  Spline,
  Square,
  StickyNote,
  Type,
  Triangle,
  Waypoints,
} from 'lucide-react'
import { Palette } from '@/components/Palette'
import { Button } from '@/components/ui/button'
import type { Tool } from '@/lib/types'

const tools: { id: Tool; label: string; icon: typeof Square; hint: string }[] = [
  { id: 'select', label: 'Select', icon: MousePointer2, hint: 'V' },
  { id: 'rect', label: 'Box', icon: Square, hint: 'R' },
  { id: 'ellipse', label: 'Circle', icon: Circle, hint: 'O' },
  { id: 'line', label: 'Line', icon: Minus, hint: 'L' },
  { id: 'spline', label: 'Spline', icon: Spline, hint: 'S' },
  { id: 'text', label: 'Text', icon: Type, hint: 'T' },
  { id: 'postit', label: 'Note', icon: StickyNote, hint: 'N' },
  { id: 'sticker', label: 'Sticker', icon: Smile, hint: 'E' },
  { id: 'triangle', label: 'Triangle', icon: Triangle, hint: '' },
  { id: 'diamond', label: 'Diamond', icon: Diamond, hint: 'D' },
  { id: 'arrow', label: 'Arrow', icon: ArrowUpRight, hint: 'A' },
  { id: 'connector', label: 'Connector', icon: Waypoints, hint: 'C' },
  { id: 'frame', label: 'Frame', icon: Frame, hint: 'F' },
  { id: 'lane', label: 'Lane', icon: Columns2, hint: 'K' },
]

type Props = {
  tool: Tool
  onTool: (t: Tool) => void
  fill: string
  stroke: string
  onFill: (c: string) => void
  onStroke: (c: string) => void
}

export function Toolbar({ tool, onTool, fill, stroke, onFill, onStroke }: Props) {
  return (
    <div className="pointer-events-auto flex h-fit max-h-full w-fit flex-col items-center gap-0.5 overflow-visible rounded-3xl bg-card px-2.5 py-3.5 shadow-card">
      {tools.map((t, i) => {
        const Icon = t.icon
        const split = i === 1 || i === 6 || i === 11
        return (
          <span key={t.id} className="flex shrink-0 flex-col items-center">
            {split ? <span className="my-1 h-px w-6 bg-border" /> : null}
            <Button
              type="button"
              variant="tool"
              className="h-8 w-8 shrink-0"
              hint={t.hint ? `${t.label} (${t.hint})` : t.label}
              hintSide="right"
              data-active={tool === t.id}
              onClick={() => onTool(t.id)}
            >
              <Icon />
            </Button>
          </span>
        )
      })}
      <span className="my-1 h-px w-6 shrink-0 bg-border" />
      <div className="shrink-0">
        <Palette fill={fill} stroke={stroke} onFill={onFill} onStroke={onStroke} />
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Circle,
  Columns2,
  Cylinder,
  Diamond,
  Frame,
  Hexagon,
  Minus,
  MousePointer2,
  Share2,
  Smile,
  Spline,
  Square,
  SquareRoundCorner,
  StickyNote,
  Type,
  Triangle,
  Waypoints,
} from 'lucide-react'
import { Palette } from '@/components/Palette'
import { Button } from '@/components/ui/button'
import type { Tool } from '@/lib/types'

const SHAPE_TOOLS: {
  id: Tool
  label: string
  icon: typeof Square
  hint: string
}[] = [
  { id: 'rect', label: 'Box', icon: Square, hint: 'R' },
  { id: 'roundrect', label: 'Round', icon: SquareRoundCorner, hint: '' },
  { id: 'ellipse', label: 'Circle', icon: Circle, hint: 'O' },
  { id: 'triangle', label: 'Triangle', icon: Triangle, hint: '' },
  { id: 'diamond', label: 'Diamond', icon: Diamond, hint: 'D' },
  { id: 'arrow', label: 'Arrow', icon: ArrowUpRight, hint: 'A' },
  { id: 'hexagon', label: 'Hexagon', icon: Hexagon, hint: 'H' },
  { id: 'parallelogram', label: 'Parallelogram', icon: Square, hint: 'P' },
  { id: 'cylinder', label: 'Cylinder', icon: Cylinder, hint: '' },
]

const SHAPE_IDS = new Set(SHAPE_TOOLS.map((t) => t.id))

function isShapeTool(tool: Tool) {
  return SHAPE_IDS.has(tool)
}

type ToolItem = { id: Tool; label: string; icon: typeof Square; hint: string }

/** Toolbar rows: tools and separators. Shapes expands into SHAPE_TOOLS. */
const rows: ({ kind: 'tool'; tool: ToolItem } | { kind: 'shapes' } | { kind: 'sep' })[] = [
  { kind: 'tool', tool: { id: 'select', label: 'Select', icon: MousePointer2, hint: 'V' } },
  { kind: 'sep' },
  { kind: 'shapes' },
  { kind: 'sep' },
  { kind: 'tool', tool: { id: 'line', label: 'Line', icon: Minus, hint: 'L' } },
  { kind: 'tool', tool: { id: 'spline', label: 'Spline', icon: Spline, hint: 'S' } },
  { kind: 'tool', tool: { id: 'text', label: 'Text', icon: Type, hint: 'T' } },
  { kind: 'tool', tool: { id: 'postit', label: 'Note', icon: StickyNote, hint: 'N' } },
  { kind: 'tool', tool: { id: 'sticker', label: 'Sticker', icon: Smile, hint: 'E' } },
  { kind: 'sep' },
  { kind: 'tool', tool: { id: 'connector', label: 'Connector', icon: Waypoints, hint: 'C' } },
  { kind: 'tool', tool: { id: 'mindmap', label: 'Mind map', icon: Share2, hint: 'M' } },
  { kind: 'sep' },
  { kind: 'tool', tool: { id: 'frame', label: 'Frame', icon: Frame, hint: 'F' } },
  { kind: 'tool', tool: { id: 'lane', label: 'Lane', icon: Columns2, hint: 'K' } },
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
  const [shapesOpen, setShapesOpen] = useState(false)
  const [lastShape, setLastShape] = useState<Tool>('rect')
  const shapesRef = useRef<HTMLSpanElement>(null)

  if (isShapeTool(tool) && tool !== lastShape) {
    setLastShape(tool)
  }

  useEffect(() => {
    if (!shapesOpen) return
    const onDoc = (e: MouseEvent) => {
      if (shapesRef.current && !shapesRef.current.contains(e.target as Node)) {
        setShapesOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [shapesOpen])

  const activeShape = isShapeTool(tool) ? tool : lastShape
  const ActiveShapeIcon = SHAPE_TOOLS.find((s) => s.id === activeShape)?.icon ?? Square

  return (
    <div className="pointer-events-auto flex h-fit max-h-full w-fit flex-col items-center gap-0.5 overflow-visible rounded-3xl bg-card px-2.5 py-3.5 shadow-card">
      {rows.map((row, i) => {
        if (row.kind === 'sep') {
          return <span key={`sep-${i}`} className="my-1 h-px w-6 shrink-0 bg-border" />
        }
        if (row.kind === 'shapes') {
          return (
            <span key="shapes" ref={shapesRef} className="relative flex shrink-0 flex-col items-center">
              <Button
                type="button"
                variant="tool"
                className="h-8 w-8 shrink-0"
                hint="Shapes"
                hintSide="right"
                data-active={isShapeTool(tool) || shapesOpen}
                onClick={() => {
                  if (!isShapeTool(tool)) onTool(lastShape)
                  setShapesOpen((v) => !v)
                }}
              >
                <ActiveShapeIcon />
              </Button>
              {shapesOpen && (
                <div className="absolute left-full top-0 z-30 ml-2 grid w-[11.5rem] grid-cols-3 gap-1 rounded-2xl bg-card p-2 shadow-card">
                  {SHAPE_TOOLS.map((s) => {
                    const Icon = s.icon
                    return (
                      <Button
                        key={s.id}
                        type="button"
                        variant="tool"
                        className="h-9 w-9"
                        hint={s.hint ? `${s.label} (${s.hint})` : s.label}
                        hintSide="top"
                        data-active={tool === s.id}
                        onClick={() => {
                          onTool(s.id)
                          setLastShape(s.id)
                          setShapesOpen(false)
                        }}
                      >
                        <Icon />
                      </Button>
                    )
                  })}
                </div>
              )}
            </span>
          )
        }
        const t = row.tool
        const Icon = t.icon
        return (
          <Button
            key={t.id}
            type="button"
            variant="tool"
            className="h-8 w-8 shrink-0"
            hint={t.hint ? `${t.label} (${t.hint})` : t.label}
            hintSide="right"
            data-active={tool === t.id}
            onClick={() => {
              setShapesOpen(false)
              onTool(t.id)
            }}
          >
            <Icon />
          </Button>
        )
      })}
      <span className="my-1 h-px w-6 shrink-0 bg-border" />
      <div className="shrink-0">
        <Palette fill={fill} stroke={stroke} onFill={onFill} onStroke={onStroke} />
      </div>
    </div>
  )
}

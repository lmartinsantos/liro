import { Circle, Group, Line, Rect } from 'react-konva'
import {
  nearestPort,
  orthogonalRoute,
  resolveEndpoint,
  routeForConnector,
  sideAnchor,
  SIDES,
  waypointsAfterSegmentDrag,
  type Port,
} from '@/lib/connectors'
import type { CanvasTheme } from '@/lib/canvasTheme'
import type { BoardObject, Side } from '@/lib/types'
import { objectAABB } from '@/lib/ops'

type LivePos = Record<string, { x: number; y: number; w?: number; h?: number }>

type ConnectFrom = { id: string; side: Side; offset: number }

type Props = {
  objects: Record<string, BoardObject>
  livePos?: LivePos
  theme: CanvasTheme
  scale: number
  tool: string
  /** Shape ids that should show ports (hovered / connect targets). */
  portShapeIds: string[]
  connectFrom: ConnectFrom | null
  selectedConnectorId: string | null
  onPortClick: (shapeId: string, port: Port) => void
  onUpdate: (id: string, path: string, value: unknown) => void
  onRewire: (
    connectorId: string,
    end: 'from' | 'to',
    target: { id: string; side: Side; offset: number },
  ) => void
}

const PORT_R = 5

export function ConnectorOverlay({
  objects,
  livePos,
  theme,
  scale,
  tool,
  portShapeIds,
  connectFrom,
  selectedConnectorId,
  onPortClick,
  onUpdate,
  onRewire,
}: Props) {
  const r = PORT_R / scale
  const handleR = 6 / scale

  const conn = selectedConnectorId ? objects[selectedConnectorId] : null
  const route =
    conn?.type === 'connector' ? routeForConnector(conn, objects, livePos) : null

  return (
    <Group listening>
      {portShapeIds.map((id) => {
        const obj = resolveEndpoint(objects, id, livePos)
        if (!obj || obj.type === 'connector') return null
        return (
          <Group key={`ports-${id}`}>
            {SIDES.map((side) => {
              const pt = sideAnchor(obj, side, 0.5)
              return (
                <Circle
                  key={side}
                  x={pt.x}
                  y={pt.y}
                  radius={r}
                  fill={theme.paper}
                  stroke={theme.select}
                  strokeWidth={1.5 / scale}
                  onMouseDown={(e) => {
                    e.cancelBubble = true
                    onPortClick(id, { side, offset: 0.5 })
                  }}
                  onTap={(e) => {
                    e.cancelBubble = true
                    onPortClick(id, { side, offset: 0.5 })
                  }}
                />
              )
            })}
          </Group>
        )
      })}

      {conn && route && route.length >= 4 ? (
        <ConnectorHandles
          connectorId={conn.id}
          route={route}
          objects={objects}
          livePos={livePos}
          theme={theme}
          scale={scale}
          handleR={handleR}
          onUpdate={onUpdate}
          onRewire={onRewire}
        />
      ) : null}

      {connectFrom && tool === 'connector' ? null : null}
    </Group>
  )
}

function ConnectorHandles({
  connectorId,
  route,
  objects,
  livePos,
  theme,
  scale,
  handleR,
  onUpdate,
  onRewire,
}: {
  connectorId: string
  route: number[]
  objects: Record<string, BoardObject>
  livePos?: LivePos
  theme: CanvasTheme
  scale: number
  handleR: number
  onUpdate: (id: string, path: string, value: unknown) => void
  onRewire: (
    connectorId: string,
    end: 'from' | 'to',
    target: { id: string; side: Side; offset: number },
  ) => void
}) {
  const midHandles: { i: number; x: number; y: number; axis: 'x' | 'y' }[] = []
  for (let i = 0; i + 3 < route.length; i += 2) {
    const x1 = route[i]
    const y1 = route[i + 1]
    const x2 = route[i + 2]
    const y2 = route[i + 3]
    const horiz = Math.abs(y1 - y2) < 0.5
    const vert = Math.abs(x1 - x2) < 0.5
    if (!horiz && !vert) continue
    // Skip tiny stubs / first and last short segments near anchors optionally — still allow
    const len = Math.hypot(x2 - x1, y2 - y1)
    if (len < 8) continue
    midHandles.push({
      i: i / 2,
      x: (x1 + x2) / 2,
      y: (y1 + y2) / 2,
      axis: horiz ? 'y' : 'x',
    })
  }

  const start = { x: route[0], y: route[1] }
  const end = { x: route[route.length - 2], y: route[route.length - 1] }

  return (
    <Group>
      {midHandles.map((h) => (
        <Rect
          key={`seg-${h.i}`}
          x={h.x - handleR}
          y={h.y - handleR}
          width={handleR * 2}
          height={handleR * 2}
          fill={theme.paper}
          stroke={theme.select}
          strokeWidth={1.5 / scale}
          draggable
          dragBoundFunc={(pos) => {
            if (h.axis === 'y') return { x: h.x - handleR, y: pos.y }
            return { x: pos.x, y: h.y - handleR }
          }}
          onDragEnd={(e) => {
            const node = e.target
            const value = h.axis === 'y' ? node.y() + handleR : node.x() + handleR
            const next = waypointsAfterSegmentDrag(route, h.i, h.axis, value)
            onUpdate(connectorId, 'points', next)
            // Reset handle visual — parent will re-render from new route
            node.position({ x: h.x - handleR, y: h.y - handleR })
          }}
          onMouseDown={(e) => {
            e.cancelBubble = true
          }}
        />
      ))}
      <EndpointHandle
        end="from"
        x={start.x}
        y={start.y}
        r={handleR}
        theme={theme}
        scale={scale}
        objects={objects}
        livePos={livePos}
        connectorId={connectorId}
        onRewire={onRewire}
      />
      <EndpointHandle
        end="to"
        x={end.x}
        y={end.y}
        r={handleR}
        theme={theme}
        scale={scale}
        objects={objects}
        livePos={livePos}
        connectorId={connectorId}
        onRewire={onRewire}
      />
    </Group>
  )
}

function EndpointHandle({
  end,
  x,
  y,
  r,
  theme,
  scale,
  objects,
  livePos,
  connectorId,
  onRewire,
}: {
  end: 'from' | 'to'
  x: number
  y: number
  r: number
  theme: CanvasTheme
  scale: number
  objects: Record<string, BoardObject>
  livePos?: LivePos
  connectorId: string
  onRewire: (
    connectorId: string,
    end: 'from' | 'to',
    target: { id: string; side: Side; offset: number },
  ) => void
}) {
  return (
    <Circle
      x={x}
      y={y}
      radius={r}
      fill={theme.select}
      stroke={theme.paper}
      strokeWidth={1.5 / scale}
      draggable
      onDragMove={(e) => {
        e.cancelBubble = true
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true
        const pt = { x: e.target.x(), y: e.target.y() }
        const hit = nearestShapePort(objects, livePos, pt, connectorId)
        if (hit) onRewire(connectorId, end, hit)
        else {
          // Snap back
          e.target.position({ x, y })
        }
      }}
      onMouseDown={(e) => {
        e.cancelBubble = true
      }}
    />
  )
}

function nearestShapePort(
  objects: Record<string, BoardObject>,
  livePos: LivePos | undefined,
  pt: { x: number; y: number },
  excludeConnectorId: string,
): { id: string; side: Side; offset: number } | null {
  let best: { id: string; side: Side; offset: number; dist: number } | null = null
  for (const o of Object.values(objects)) {
    if (o.type === 'connector' || o.id === excludeConnectorId) continue
    const live = resolveEndpoint(objects, o.id, livePos) ?? o
    const box = objectAABB(live)
    // Prefer shapes under/near the pointer
    const pad = 40
    const near =
      pt.x >= box.x - pad &&
      pt.x <= box.x + box.w + pad &&
      pt.y >= box.y - pad &&
      pt.y <= box.y + box.h + pad
    if (!near) continue
    const port = nearestPort(live, pt)
    const anchor = sideAnchor(live, port.side, port.offset)
    const dist = Math.hypot(anchor.x - pt.x, anchor.y - pt.y)
    if (!best || dist < best.dist) best = { id: o.id, ...port, dist }
  }
  if (!best) return null
  return { id: best.id, side: best.side, offset: best.offset }
}

/** Rubber-band preview while connecting. */
export function ConnectorPreview({
  from,
  fromSide,
  fromOffset,
  cursor,
  hoverTarget,
  theme,
}: {
  from: BoardObject
  fromSide: Side
  fromOffset: number
  cursor: { x: number; y: number }
  hoverTarget?: { obj: BoardObject; side: Side; offset: number } | null
  theme: CanvasTheme
}) {
  let pts: number[]
  if (hoverTarget) {
    pts = orthogonalRoute(from, hoverTarget.obj, fromSide, hoverTarget.side, {
      fromOffset,
      toOffset: hoverTarget.offset,
    })
  } else {
    // Fake target: tiny box at cursor, approach from nearest side
    const ghost: BoardObject = {
      id: '_ghost',
      type: 'rect',
      x: cursor.x - 1,
      y: cursor.y - 1,
      w: 2,
      h: 2,
      rotation: 0,
      z: '0',
      fill: '',
      stroke: '',
      strokeWidth: 0,
    }
    const port = nearestPort(ghost, cursor)
    pts = orthogonalRoute(from, ghost, fromSide, port.side, {
      fromOffset,
      toOffset: 0.5,
      stub: 16,
    })
  }
  return (
    <Line
      points={pts}
      stroke={theme.select}
      strokeWidth={2}
      dash={[8, 6]}
      listening={false}
      lineJoin="round"
      lineCap="round"
    />
  )
}

import type { BoardObject, Side } from './types'

const SIDES: Side[] = ['top', 'right', 'bottom', 'left']
export const STUB = 24

export type Pt = { x: number; y: number }

export type Port = { side: Side; offset: number }

export type RouteOpts = {
  fromOffset?: number
  toOffset?: number
  waypoints?: number[]
  stub?: number
}

/** Local AABB so this module does not import ops (avoids cycles). */
function shapeBox(obj: BoardObject) {
  if ((obj.type === 'line' || obj.type === 'spline') && obj.points?.length) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let i = 0; i + 1 < obj.points.length; i += 2) {
      const px = obj.x + obj.points[i]
      const py = obj.y + obj.points[i + 1]
      minX = Math.min(minX, px)
      minY = Math.min(minY, py)
      maxX = Math.max(maxX, px)
      maxY = Math.max(maxY, py)
    }
    if (Number.isFinite(minX)) {
      return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) }
    }
  }
  return { x: obj.x, y: obj.y, w: obj.w, h: obj.h }
}

function clamp01(t: number) {
  if (Number.isNaN(t)) return 0.5
  return Math.min(1, Math.max(0, t))
}

export function sideAnchor(obj: BoardObject, side: Side, offset = 0.5): Pt {
  const b = shapeBox(obj)
  const t = clamp01(offset)
  if (side === 'top') return { x: b.x + b.w * t, y: b.y }
  if (side === 'bottom') return { x: b.x + b.w * t, y: b.y + b.h }
  if (side === 'left') return { x: b.x, y: b.y + b.h * t }
  return { x: b.x + b.w, y: b.y + b.h * t }
}

export function sideNormal(side: Side): Pt {
  if (side === 'top') return { x: 0, y: -1 }
  if (side === 'bottom') return { x: 0, y: 1 }
  if (side === 'left') return { x: -1, y: 0 }
  return { x: 1, y: 0 }
}

export function nearestSides(from: BoardObject, to: BoardObject) {
  let best = { fromSide: 'right' as Side, toSide: 'left' as Side, dist: Infinity }
  for (const fs of SIDES) {
    const a = sideAnchor(from, fs)
    for (const ts of SIDES) {
      const b = sideAnchor(to, ts)
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (d < best.dist) best = { fromSide: fs, toSide: ts, dist: d }
    }
  }
  return { fromSide: best.fromSide, toSide: best.toSide }
}

export function nearestPort(obj: BoardObject, point: Pt): Port {
  const b = shapeBox(obj)
  let best: Port = { side: 'right', offset: 0.5 }
  let bestDist = Infinity
  for (const side of SIDES) {
    let offset = 0.5
    if (side === 'top' || side === 'bottom') {
      offset = b.w > 0 ? (point.x - b.x) / b.w : 0.5
    } else {
      offset = b.h > 0 ? (point.y - b.y) / b.h : 0.5
    }
    offset = clamp01(offset)
    const a = sideAnchor(obj, side, offset)
    const d = Math.hypot(a.x - point.x, a.y - point.y)
    if (d < bestDist) {
      bestDist = d
      best = { side, offset }
    }
  }
  return best
}

function almostEq(a: number, b: number, eps = 0.5) {
  return Math.abs(a - b) < eps
}

/** Collapse consecutive duplicates and collinear middle points. */
export function simplifyOrthogonal(pts: Pt[]): Pt[] {
  if (pts.length <= 2) return pts.slice()
  const out: Pt[] = [{ ...pts[0] }]
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]
    const last = out[out.length - 1]
    if (almostEq(last.x, p.x) && almostEq(last.y, p.y)) continue
    out.push({ ...p })
  }
  let i = 1
  while (i < out.length - 1) {
    const a = out[i - 1]
    const b = out[i]
    const c = out[i + 1]
    const colH = almostEq(a.y, b.y) && almostEq(b.y, c.y)
    const colV = almostEq(a.x, b.x) && almostEq(b.x, c.x)
    if (colH || colV) out.splice(i, 1)
    else i++
  }
  return out
}

function flat(pts: Pt[]): number[] {
  const out: number[] = []
  for (const p of pts) out.push(p.x, p.y)
  return out
}

function parseWaypoints(waypoints?: number[]): Pt[] {
  if (!waypoints?.length) return []
  const out: Pt[] = []
  for (let i = 0; i + 1 < waypoints.length; i += 2) {
    out.push({ x: waypoints[i], y: waypoints[i + 1] })
  }
  return out
}

/** Auto orthogonal path from stubA to stubB (both already outside shapes). */
function routeBetweenStubs(a: Pt, fromSide: Side, b: Pt, toSide: Side): Pt[] {
  const fromH = fromSide === 'left' || fromSide === 'right'
  const toH = toSide === 'left' || toSide === 'right'

  if (fromH && toH) {
    // Both horizontal exits
    if ((fromSide === 'right' && a.x <= b.x) || (fromSide === 'left' && a.x >= b.x)) {
      if (almostEq(a.y, b.y)) return [a, { x: b.x, y: a.y }, b]
      const midX = (a.x + b.x) / 2
      return [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b]
    }
    // Facing away or overlapping — go out then U-turn
    const midY = (a.y + b.y) / 2
    return [a, { x: a.x, y: midY }, { x: b.x, y: midY }, b]
  }

  if (!fromH && !toH) {
    // Both vertical exits
    if ((fromSide === 'bottom' && a.y <= b.y) || (fromSide === 'top' && a.y >= b.y)) {
      if (almostEq(a.x, b.x)) return [a, { x: a.x, y: b.y }, b]
      const midY = (a.y + b.y) / 2
      return [a, { x: a.x, y: midY }, { x: b.x, y: midY }, b]
    }
    const midX = (a.x + b.x) / 2
    return [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b]
  }

  // Mixed: L or Z
  if (fromH) {
    // leave horizontally, arrive vertically
    const corner = { x: b.x, y: a.y }
    // If corner would reverse into target stub awkwardly, use Z
    if (
      (toSide === 'top' && corner.y > b.y) ||
      (toSide === 'bottom' && corner.y < b.y) ||
      (fromSide === 'right' && corner.x < a.x) ||
      (fromSide === 'left' && corner.x > a.x)
    ) {
      return [a, { x: b.x, y: a.y }, b]
    }
    return [a, corner, b]
  }

  // leave vertically, arrive horizontally
  const corner = { x: a.x, y: b.y }
  if (
    (toSide === 'left' && corner.x > b.x) ||
    (toSide === 'right' && corner.x < b.x) ||
    (fromSide === 'bottom' && corner.y < a.y) ||
    (fromSide === 'top' && corner.y > a.y)
  ) {
    return [a, { x: a.x, y: b.y }, b]
  }
  return [a, corner, b]
}

function enforceOrthogonal(pts: Pt[]): Pt[] {
  if (pts.length <= 1) return pts.slice()
  const out: Pt[] = [{ ...pts[0] }]
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1]
    const cur = pts[i]
    if (almostEq(prev.x, cur.x) || almostEq(prev.y, cur.y)) {
      out.push({ ...cur })
      continue
    }
    // Insert elbow: prefer matching previous segment direction if any
    out.push({ x: cur.x, y: prev.y })
    out.push({ ...cur })
  }
  return simplifyOrthogonal(out)
}

/**
 * Build full orthogonal polyline including anchors.
 * `waypoints` are interior corners only (absolute board coords).
 */
export function orthogonalRoute(
  from: BoardObject,
  to: BoardObject,
  fromSide: Side,
  toSide: Side,
  opts: RouteOpts = {},
): number[] {
  const stub = opts.stub ?? STUB
  const fromOff = opts.fromOffset ?? 0.5
  const toOff = opts.toOffset ?? 0.5
  const start = sideAnchor(from, fromSide, fromOff)
  const end = sideAnchor(to, toSide, toOff)
  const n0 = sideNormal(fromSide)
  const n1 = sideNormal(toSide)
  const stubA = { x: start.x + n0.x * stub, y: start.y + n0.y * stub }
  const stubB = { x: end.x + n1.x * stub, y: end.y + n1.y * stub }

  const custom = parseWaypoints(opts.waypoints)
  let middle: Pt[]
  if (custom.length) {
    middle = enforceOrthogonal([stubA, ...custom, stubB])
  } else {
    middle = simplifyOrthogonal(routeBetweenStubs(stubA, fromSide, stubB, toSide))
  }

  const full = simplifyOrthogonal([start, ...middle, end])
  return flat(full)
}

/** @deprecated Prefer orthogonalRoute; kept for simple 2-point callers. */
export function connectorPoints(
  from: BoardObject,
  to: BoardObject,
  fromSide: Side,
  toSide: Side,
  opts?: RouteOpts,
) {
  return orthogonalRoute(from, to, fromSide, toSide, opts)
}

export function connectorBounds(pts: number[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i + 1 < pts.length; i += 2) {
    minX = Math.min(minX, pts[i])
    minY = Math.min(minY, pts[i + 1])
    maxX = Math.max(maxX, pts[i])
    maxY = Math.max(maxY, pts[i + 1])
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 1, h: 1 }
  return {
    x: minX,
    y: minY,
    w: Math.max(1, maxX - minX),
    h: Math.max(1, maxY - minY),
  }
}

export function polylineMidpoint(pts: number[]): Pt {
  if (pts.length < 4) return { x: pts[0] ?? 0, y: pts[1] ?? 0 }
  let total = 0
  const segs: number[] = []
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const len = Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1])
    segs.push(len)
    total += len
  }
  if (total < 1e-6) return { x: pts[0], y: pts[1] }
  let remain = total / 2
  for (let i = 0, s = 0; i + 3 < pts.length; i += 2, s++) {
    const len = segs[s]
    if (remain <= len) {
      const t = len < 1e-6 ? 0 : remain / len
      return {
        x: pts[i] + (pts[i + 2] - pts[i]) * t,
        y: pts[i + 1] + (pts[i + 3] - pts[i + 1]) * t,
      }
    }
    remain -= len
  }
  return { x: pts[pts.length - 2], y: pts[pts.length - 1] }
}

/** Arrowhead triangle at the end of the polyline. */
export function arrowHeadPoints(pts: number[], size = 10): number[] | null {
  if (pts.length < 4) return null
  const x2 = pts[pts.length - 2]
  const y2 = pts[pts.length - 1]
  let x1 = pts[pts.length - 4]
  let y1 = pts[pts.length - 3]
  // Walk back if last segment is tiny
  for (let i = pts.length - 4; i >= 0; i -= 2) {
    if (Math.hypot(x2 - pts[i], y2 - pts[i + 1]) > 1) {
      x1 = pts[i]
      y1 = pts[i + 1]
      break
    }
  }
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const px = -uy
  const py = ux
  const baseX = x2 - ux * size
  const baseY = y2 - uy * size
  return [
    x2,
    y2,
    baseX + px * (size * 0.55),
    baseY + py * (size * 0.55),
    baseX - px * (size * 0.55),
    baseY - py * (size * 0.55),
  ]
}

/** Interior waypoints from a full route (drop first/last anchors and stubs if present). */
export function interiorWaypoints(route: number[]): number[] {
  const pts: Pt[] = []
  for (let i = 0; i + 1 < route.length; i += 2) pts.push({ x: route[i], y: route[i + 1] })
  if (pts.length <= 2) return []
  // Drop start and end anchors
  const inner = pts.slice(1, -1)
  return flat(inner)
}

/**
 * After dragging a segment between indices `segIndex` (point i → i+1 in route pts),
 * return new interior waypoints to persist.
 */
export function waypointsAfterSegmentDrag(
  route: number[],
  segIndex: number,
  axis: 'x' | 'y',
  value: number,
): number[] {
  const pts: Pt[] = []
  for (let i = 0; i + 1 < route.length; i += 2) pts.push({ x: route[i], y: route[i + 1] })
  if (segIndex < 0 || segIndex >= pts.length - 1) return interiorWaypoints(route)
  const a = pts[segIndex]
  const b = pts[segIndex + 1]
  if (axis === 'y') {
    a.y = value
    b.y = value
  } else {
    a.x = value
    b.x = value
  }
  // Keep anchors fixed: restore ends
  const start = { x: route[0], y: route[1] }
  const end = { x: route[route.length - 2], y: route[route.length - 1] }
  pts[0] = start
  pts[pts.length - 1] = end
  const ortho = enforceOrthogonal(pts)
  // Interior = everything except anchors
  if (ortho.length <= 2) return []
  return flat(ortho.slice(1, -1))
}

export function resolveEndpoint(
  objects: Record<string, BoardObject>,
  id: string | undefined,
  livePos?: Record<string, { x: number; y: number; w?: number; h?: number }>,
): BoardObject | undefined {
  if (!id) return undefined
  const o = objects[id]
  if (!o) return undefined
  const live = livePos?.[id]
  if (!live) return o
  return {
    ...o,
    x: live.x,
    y: live.y,
    ...(live.w !== undefined ? { w: live.w } : {}),
    ...(live.h !== undefined ? { h: live.h } : {}),
  }
}

export function routeForConnector(
  conn: BoardObject,
  objects: Record<string, BoardObject>,
  livePos?: Record<string, { x: number; y: number; w?: number; h?: number }>,
): number[] | null {
  const from = resolveEndpoint(objects, conn.fromId, livePos)
  const to = resolveEndpoint(objects, conn.toId, livePos)
  if (!from || !to) return null
  return orthogonalRoute(from, to, conn.fromSide ?? 'right', conn.toSide ?? 'left', {
    fromOffset: conn.fromOffset ?? 0.5,
    toOffset: conn.toOffset ?? 0.5,
    waypoints: conn.points,
  })
}

export { SIDES }

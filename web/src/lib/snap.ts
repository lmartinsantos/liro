import { objectAABB } from './ops'
import type { BoardObject } from './types'

export const GRID_SIZE = 32
export const SNAP_THRESHOLD = 8

export type Guide = { orientation: 'h' | 'v'; position: number }

export type SnapResult = {
  x: number
  y: number
  guides: Guide[]
}

export type Box = { x: number; y: number; w: number; h: number }

const SNAP_PREF_KEY = 'liro.snapEnabled'

export function readSnapEnabled(): boolean {
  try {
    const raw = localStorage.getItem(SNAP_PREF_KEY)
    if (raw === null) return true
    return raw === '1' || raw === 'true'
  } catch {
    return true
  }
}

export function writeSnapEnabled(on: boolean) {
  try {
    localStorage.setItem(SNAP_PREF_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function snapValue(value: number, targets: number[], threshold: number): { value: number; guide?: number } {
  let best = value
  let bestDist = threshold
  let guide: number | undefined
  for (const t of targets) {
    const d = Math.abs(value - t)
    if (d < bestDist) {
      bestDist = d
      best = t
      guide = t
    }
  }
  return { value: best, guide }
}

function gridTargetsNear(value: number, grid: number): number[] {
  const base = Math.round(value / grid) * grid
  const out: number[] = []
  for (let i = -2; i <= 2; i++) out.push(base + i * grid)
  return out
}

function collectObjectTargets(
  objects: Record<string, BoardObject>,
  exclude: Set<string>,
  livePos?: Record<string, { x: number; y: number }>,
): { xs: number[]; ys: number[] } {
  const xs: number[] = []
  const ys: number[] = []
  for (const o of Object.values(objects)) {
    if (exclude.has(o.id) || o.type === 'connector') continue
    const live = livePos?.[o.id]
    const box = objectAABB(live ? { ...o, ...live } : o)
    xs.push(box.x, box.x + box.w / 2, box.x + box.w)
    ys.push(box.y, box.y + box.h / 2, box.y + box.h)
  }
  return { xs, ys }
}

/** Snap a box's position (keep w/h). Returns snapped top-left and guides. */
export function snapBox(
  box: Box,
  opts: {
    enabled: boolean
    grid?: number
    threshold?: number
    objects: Record<string, BoardObject>
    exclude: Set<string>
    livePos?: Record<string, { x: number; y: number }>
  },
): SnapResult {
  if (!opts.enabled) return { x: box.x, y: box.y, guides: [] }
  const grid = opts.grid ?? GRID_SIZE
  const threshold = opts.threshold ?? SNAP_THRESHOLD
  const { xs: objXs, ys: objYs } = collectObjectTargets(opts.objects, opts.exclude, opts.livePos)

  const left = snapValue(box.x, [...objXs, ...gridTargetsNear(box.x, grid)], threshold)
  const cx = snapValue(box.x + box.w / 2, [...objXs, ...gridTargetsNear(box.x + box.w / 2, grid)], threshold)
  const right = snapValue(box.x + box.w, [...objXs, ...gridTargetsNear(box.x + box.w, grid)], threshold)
  const top = snapValue(box.y, [...objYs, ...gridTargetsNear(box.y, grid)], threshold)
  const cy = snapValue(box.y + box.h / 2, [...objYs, ...gridTargetsNear(box.y + box.h / 2, grid)], threshold)
  const bottom = snapValue(box.y + box.h, [...objYs, ...gridTargetsNear(box.y + box.h, grid)], threshold)

  type Cand = { pos: number; dist: number; guide?: number }
  const xCands: Cand[] = [
    { pos: left.value, dist: Math.abs(box.x - left.value), guide: left.guide },
    { pos: cx.value - box.w / 2, dist: Math.abs(box.x + box.w / 2 - cx.value), guide: cx.guide },
    { pos: right.value - box.w, dist: Math.abs(box.x + box.w - right.value), guide: right.guide },
  ]
  const yCands: Cand[] = [
    { pos: top.value, dist: Math.abs(box.y - top.value), guide: top.guide },
    { pos: cy.value - box.h / 2, dist: Math.abs(box.y + box.h / 2 - cy.value), guide: cy.guide },
    { pos: bottom.value - box.h, dist: Math.abs(box.y + box.h - bottom.value), guide: bottom.guide },
  ]

  let bestX: Cand = { pos: box.x, dist: threshold }
  for (const c of xCands) {
    if (c.dist < bestX.dist) bestX = c
  }
  let bestY: Cand = { pos: box.y, dist: threshold }
  for (const c of yCands) {
    if (c.dist < bestY.dist) bestY = c
  }

  const guides: Guide[] = []
  if (bestX.guide !== undefined && bestX.dist < threshold) {
    guides.push({ orientation: 'v', position: bestX.guide })
  }
  if (bestY.guide !== undefined && bestY.dist < threshold) {
    guides.push({ orientation: 'h', position: bestY.guide })
  }

  return {
    x: bestX.dist < threshold ? bestX.pos : box.x,
    y: bestY.dist < threshold ? bestY.pos : box.y,
    guides,
  }
}

/** Snap resize box (x,y,w,h) — snaps edges to grid/objects. */
export function snapResizeBox(
  box: Box,
  opts: {
    enabled: boolean
    grid?: number
    threshold?: number
    objects: Record<string, BoardObject>
    exclude: Set<string>
  },
): { box: Box; guides: Guide[] } {
  if (!opts.enabled) return { box, guides: [] }
  const grid = opts.grid ?? GRID_SIZE
  const threshold = opts.threshold ?? SNAP_THRESHOLD
  const { xs: objXs, ys: objYs } = collectObjectTargets(opts.objects, opts.exclude)

  const left = snapValue(box.x, [...objXs, ...gridTargetsNear(box.x, grid)], threshold)
  const right = snapValue(box.x + box.w, [...objXs, ...gridTargetsNear(box.x + box.w, grid)], threshold)
  const top = snapValue(box.y, [...objYs, ...gridTargetsNear(box.y, grid)], threshold)
  const bottom = snapValue(box.y + box.h, [...objYs, ...gridTargetsNear(box.y + box.h, grid)], threshold)

  const snapLeft = left.guide !== undefined && Math.abs(box.x - left.value) < threshold
  const snapRight = right.guide !== undefined && Math.abs(box.x + box.w - right.value) < threshold
  const snapTop = top.guide !== undefined && Math.abs(box.y - top.value) < threshold
  const snapBottom = bottom.guide !== undefined && Math.abs(box.y + box.h - bottom.value) < threshold

  const x = snapLeft ? left.value : box.x
  const y = snapTop ? top.value : box.y
  const r = snapRight ? right.value : box.x + box.w
  const b = snapBottom ? bottom.value : box.y + box.h

  const guides: Guide[] = []
  if (snapLeft && left.guide !== undefined) guides.push({ orientation: 'v', position: left.guide })
  if (snapRight && right.guide !== undefined) guides.push({ orientation: 'v', position: right.guide })
  if (snapTop && top.guide !== undefined) guides.push({ orientation: 'h', position: top.guide })
  if (snapBottom && bottom.guide !== undefined) guides.push({ orientation: 'h', position: bottom.guide })

  return {
    box: { x, y, w: Math.max(8, r - x), h: Math.max(8, b - y) },
    guides,
  }
}

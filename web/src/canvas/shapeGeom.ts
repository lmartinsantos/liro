import type { BoardObject, ObjectType } from '@/lib/types'

export function trianglePoints(w: number, h: number) {
  return [w / 2, 0, w, h, 0, h]
}

export function diamondPoints(w: number, h: number) {
  return [w / 2, 0, w, h / 2, w / 2, h, 0, h / 2]
}

export function arrowPoints(w: number, h: number) {
  return [
    0,
    h * 0.32,
    w * 0.58,
    h * 0.32,
    w * 0.58,
    0,
    w,
    h / 2,
    w * 0.58,
    h,
    w * 0.58,
    h * 0.68,
    0,
    h * 0.68,
  ]
}

/** Flat-top hexagon. */
export function hexagonPoints(w: number, h: number) {
  const inset = w * 0.25
  return [inset, 0, w - inset, 0, w, h / 2, w - inset, h, inset, h, 0, h / 2]
}

/** Parallelogram (flowchart input/output). */
export function parallelogramPoints(w: number, h: number) {
  const skew = Math.min(w * 0.22, h * 0.5)
  return [skew, 0, w, 0, w - skew, h, 0, h]
}

export function polygonFor(type: ObjectType, w: number, h: number) {
  if (type === 'triangle') return trianglePoints(w, h)
  if (type === 'diamond') return diamondPoints(w, h)
  if (type === 'arrow') return arrowPoints(w, h)
  if (type === 'hexagon') return hexagonPoints(w, h)
  if (type === 'parallelogram') return parallelogramPoints(w, h)
  return null
}

export function isPathType(type: ObjectType) {
  return type === 'line' || type === 'spline' || type === 'connector'
}

export function isDrawTool(type: string) {
  return (
    type === 'rect' ||
    type === 'roundrect' ||
    type === 'ellipse' ||
    type === 'line' ||
    type === 'spline' ||
    type === 'postit' ||
    type === 'triangle' ||
    type === 'diamond' ||
    type === 'arrow' ||
    type === 'hexagon' ||
    type === 'parallelogram' ||
    type === 'cylinder' ||
    type === 'frame' ||
    type === 'lane'
  )
}

/** Default / clamped corner radius for roundrect. */
export function roundrectRadius(w: number, h: number, cornerRadius?: number) {
  const max = Math.max(0, Math.min(w, h) / 2)
  if (cornerRadius == null || Number.isNaN(cornerRadius)) return Math.min(16, max)
  return Math.max(0, Math.min(cornerRadius, max))
}

export function isPolygonType(type: ObjectType) {
  return (
    type === 'triangle' ||
    type === 'diamond' ||
    type === 'arrow' ||
    type === 'hexagon' ||
    type === 'parallelogram'
  )
}

export function normalizeBox(x0: number, y0: number, x1: number, y1: number) {
  const x = Math.min(x0, x1)
  const y = Math.min(y0, y1)
  return { x, y, w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }
}

export type Draft = {
  type: ObjectType
  x: number
  y: number
  w: number
  h: number
  points?: number[]
}

export function draftFromDrag(
  type: ObjectType,
  start: { x: number; y: number },
  cur: { x: number; y: number },
): Draft {
  if (type === 'line') {
    return {
      type,
      x: start.x,
      y: start.y,
      w: Math.abs(cur.x - start.x),
      h: Math.abs(cur.y - start.y),
      points: [0, 0, cur.x - start.x, cur.y - start.y],
    }
  }
  const box = normalizeBox(start.x, start.y, cur.x, cur.y)
  return { type, ...box }
}

export function objectFromDraft(
  draft: Draft,
  extras: Pick<BoardObject, 'id' | 'z' | 'fill' | 'stroke' | 'strokeWidth' | 'text'> &
    Partial<Pick<BoardObject, 'parentId' | 'dir' | 'fontFamily' | 'fontSize' | 'bold' | 'italic' | 'textAlign'>>,
): BoardObject {
  const w = Math.max(draft.w, 4)
  const h = Math.max(draft.h, 4)
  return {
    id: extras.id,
    type: draft.type,
    x: draft.x,
    y: draft.y,
    w,
    h,
    rotation: 0,
    z: extras.z,
    fill: extras.fill,
    stroke: extras.stroke,
    strokeWidth: extras.strokeWidth,
    points: draft.points,
    text: extras.text,
    attachments: [],
    parentId: extras.parentId,
    dir: extras.dir,
    fontFamily: extras.fontFamily,
    fontSize: extras.fontSize,
    bold: extras.bold,
    italic: extras.italic,
    textAlign: extras.textAlign,
    cornerRadius: draft.type === 'roundrect' ? roundrectRadius(w, h) : undefined,
  }
}

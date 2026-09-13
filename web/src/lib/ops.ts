import type { BoardObject, DocumentState, ObjectType, Op } from './types'

export function nextZ(objects: Record<string, BoardObject>): string {
  let n = 0
  for (const o of Object.values(objects)) {
    const m = /^a(-?\d+)$/.exec(o.z)
    if (m) n = Math.max(n, Number(m[1]) + 1)
  }
  return `a${n}`
}

export function parseZ(z: string) {
  const m = /^a(-?\d+)$/.exec(z)
  return m ? Number(m[1]) : 0
}

export function isContainer(type: ObjectType) {
  return type === 'group' || type === 'frame' || type === 'lane'
}

export function isConnector(type: ObjectType) {
  return type === 'connector'
}

export function applyOp(doc: DocumentState, op: Op): DocumentState {
  const objects = { ...doc.objects }
  if (op.type === 'create') {
    const obj = op.value as BoardObject
    if (!obj?.id) return doc
    objects[obj.id] = { ...obj, attachments: obj.attachments ?? [] }
  } else if (op.type === 'update') {
    const prev = objects[op.objectId]
    if (!prev || !op.path) return doc
    objects[op.objectId] = { ...prev, [op.path]: op.value }
  } else if (op.type === 'delete') {
    cascadeDelete(objects, op.objectId)
  }
  return { rev: op.seq ?? doc.rev + 1, objects }
}

function cascadeDelete(objects: Record<string, BoardObject>, id: string) {
  const obj = objects[id]
  if (!obj) return
  const keepChildren = isContainer(obj.type)
  delete objects[id]
  for (const [oid, o] of Object.entries(objects)) {
    if (o.parentId === id && keepChildren) {
      objects[oid] = { ...o, parentId: '' }
      continue
    }
    if (o.type === 'connector' && (o.fromId === id || o.toId === id)) {
      delete objects[oid]
    }
  }
}

export function objectAABB(obj: BoardObject) {
  if ((obj.type === 'line' || obj.type === 'spline') && obj.points?.length) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let i = 0; i < obj.points.length; i += 2) {
      const px = obj.x + obj.points[i]
      const py = obj.y + obj.points[i + 1]
      minX = Math.min(minX, px)
      minY = Math.min(minY, py)
      maxX = Math.max(maxX, px)
      maxY = Math.max(maxY, py)
    }
    return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) }
  }
  return { x: obj.x, y: obj.y, w: obj.w, h: obj.h }
}

export function intersectsView(
  obj: BoardObject,
  view: { x: number; y: number; w: number; h: number },
  pad = 80,
  box?: { x: number; y: number; w: number; h: number },
) {
  const b = box ?? objectAABB(obj)
  return !(
    b.x + b.w < view.x - pad ||
    b.y + b.h < view.y - pad ||
    b.x > view.x + view.w + pad ||
    b.y > view.y + view.h + pad
  )
}

export function boxIntersects(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) {
  return !(a.x + a.w < b.x || a.y + a.h < b.y || a.x > b.x + b.w || a.y > b.y + b.h)
}

export function containsPoint(obj: BoardObject, x: number, y: number) {
  const b = objectAABB(obj)
  return x >= b.x && y >= b.y && x <= b.x + b.w && y <= b.y + b.h
}

export function centerOf(obj: BoardObject) {
  const b = objectAABB(obj)
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 }
}

export function childrenOf(id: string, objects: Record<string, BoardObject>) {
  return Object.values(objects).filter((o) => o.parentId === id)
}

export function descendants(id: string, objects: Record<string, BoardObject>) {
  const out: BoardObject[] = []
  const walk = (pid: string) => {
    for (const c of childrenOf(pid, objects)) {
      out.push(c)
      walk(c.id)
    }
  }
  walk(id)
  return out
}

export function moveSet(ids: string[], objects: Record<string, BoardObject>) {
  const out = new Set<string>()
  for (const id of ids) {
    const o = objects[id]
    if (!o || o.type === 'connector') continue
    out.add(id)
    for (const d of descendants(id, objects)) {
      if (d.type !== 'connector') out.add(d.id)
    }
  }
  return [...out]
}

/** Walk up through `group` parents so groups act as a single selectable/movable unit. */
export function groupRoot(id: string, objects: Record<string, BoardObject>) {
  let cur = id
  let parent = objects[cur]?.parentId
  while (parent && objects[parent]?.type === 'group') {
    cur = parent
    parent = objects[cur]?.parentId
  }
  return cur
}

export function isAncestor(maybeParent: string, id: string, objects: Record<string, BoardObject>) {
  let cur = objects[id]?.parentId
  while (cur) {
    if (cur === maybeParent) return true
    cur = objects[cur]?.parentId
  }
  return false
}

export function containerAt(
  x: number,
  y: number,
  objects: Record<string, BoardObject>,
  exclude: Set<string>,
) {
  const hits = Object.values(objects).filter((o) => {
    if (o.type !== 'frame' && o.type !== 'lane') return false
    if (exclude.has(o.id)) return false
    for (const id of exclude) {
      if (isAncestor(id, o.id, objects)) return false
    }
    return containsPoint(o, x, y)
  })
  hits.sort((a, b) => a.w * a.h - b.w * b.h)
  return hits[0] ?? null
}

/**
 * Parent to keep after a move. Co-moved containers keep their children; groups are not
 * drop targets so membership only changes via group/ungroup.
 */
export function parentAfterMove(
  obj: BoardObject,
  x: number,
  y: number,
  objects: Record<string, BoardObject>,
  moving: Set<string>,
) {
  const current = obj.parentId ?? ''
  if (current && moving.has(current)) return current
  if (current && objects[current]?.type === 'group') return current
  return containerAt(x, y, objects, moving)?.id ?? ''
}

export function renderOrder(a: BoardObject, b: BoardObject) {
  const rank = (t: ObjectType) =>
    t === 'frame' ? 0 : t === 'lane' ? 1 : t === 'group' ? 2 : t === 'connector' ? 4 : 3
  const d = rank(a.type) - rank(b.type)
  if (d) return d
  if (a.z === b.z) return a.id.localeCompare(b.id)
  return a.z < b.z ? -1 : 1
}

export function unionBoxes(boxes: { x: number; y: number; w: number; h: number }[]) {
  let x = Infinity
  let y = Infinity
  let r = -Infinity
  let b = -Infinity
  for (const box of boxes) {
    x = Math.min(x, box.x)
    y = Math.min(y, box.y)
    r = Math.max(r, box.x + box.w)
    b = Math.max(b, box.y + box.h)
  }
  return { x, y, w: Math.max(1, r - x), h: Math.max(1, b - y) }
}

export function hitTop(x: number, y: number, objects: Record<string, BoardObject>) {
  const hits = Object.values(objects)
    .filter((o) => o.type !== 'connector' && containsPoint(o, x, y))
    .sort(renderOrder)
  return hits.at(-1) ?? null
}

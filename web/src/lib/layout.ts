import { objectAABB, parseZ } from './ops'
import type { BoardObject } from './types'

export type Align = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'

export function layoutTargets(ids: string[], objects: Record<string, BoardObject>) {
  return ids
    .map((id) => objects[id])
    .filter((o): o is BoardObject => !!o && o.type !== 'connector')
}

export function alignPatches(kind: Align, ids: string[], objects: Record<string, BoardObject>) {
  const items = layoutTargets(ids, objects)
  if (items.length < 2) return []
  const boxes = items.map((o) => ({ o, b: objectAABB(o) }))
  const minX = Math.min(...boxes.map((x) => x.b.x))
  const maxR = Math.max(...boxes.map((x) => x.b.x + x.b.w))
  const minY = Math.min(...boxes.map((x) => x.b.y))
  const maxB = Math.max(...boxes.map((x) => x.b.y + x.b.h))
  const midX = (minX + maxR) / 2
  const midY = (minY + maxB) / 2
  const out: { id: string; path: 'x' | 'y'; value: number }[] = []
  for (const { o, b } of boxes) {
    const dx = o.x - b.x
    const dy = o.y - b.y
    if (kind === 'left') out.push({ id: o.id, path: 'x', value: minX + dx })
    if (kind === 'right') out.push({ id: o.id, path: 'x', value: maxR - b.w + dx })
    if (kind === 'center') out.push({ id: o.id, path: 'x', value: midX - b.w / 2 + dx })
    if (kind === 'top') out.push({ id: o.id, path: 'y', value: minY + dy })
    if (kind === 'bottom') out.push({ id: o.id, path: 'y', value: maxB - b.h + dy })
    if (kind === 'middle') out.push({ id: o.id, path: 'y', value: midY - b.h / 2 + dy })
  }
  return out
}

export function distributePatches(axis: 'x' | 'y', ids: string[], objects: Record<string, BoardObject>) {
  const items = layoutTargets(ids, objects)
  if (items.length < 3) return []
  const boxes = items.map((o) => ({ o, b: objectAABB(o) }))
  boxes.sort((a, c) => (axis === 'x' ? a.b.x - c.b.x : a.b.y - c.b.y))
  const first = boxes[0].b
  const last = boxes[boxes.length - 1].b
  const span =
    axis === 'x' ? last.x + last.w - first.x : last.y + last.h - first.y
  const size = boxes.reduce((s, x) => s + (axis === 'x' ? x.b.w : x.b.h), 0)
  const gap = (span - size) / (boxes.length - 1)
  const out: { id: string; path: 'x' | 'y'; value: number }[] = []
  let cursor = axis === 'x' ? first.x : first.y
  for (const { o, b } of boxes) {
    const delta = axis === 'x' ? o.x - b.x : o.y - b.y
    out.push({ id: o.id, path: axis, value: cursor + delta })
    cursor += (axis === 'x' ? b.w : b.h) + gap
  }
  return out
}

export function zPatches(
  action: 'front' | 'back' | 'forward' | 'backward',
  ids: string[],
  objects: Record<string, BoardObject>,
) {
  const selected = new Set(ids.filter((id) => objects[id]))
  if (selected.size === 0) return []
  const sorted = Object.values(objects).sort((a, b) => {
    const d = parseZ(a.z) - parseZ(b.z)
    return d !== 0 ? d : a.id.localeCompare(b.id)
  })
  const out: { id: string; path: 'z'; value: string }[] = []
  if (action === 'front') {
    let n = Math.max(...sorted.map((o) => parseZ(o.z))) + 1
    for (const id of ids) {
      if (!objects[id]) continue
      out.push({ id, path: 'z', value: `a${n++}` })
    }
    return out
  }
  if (action === 'back') {
    let n = Math.min(...sorted.map((o) => parseZ(o.z))) - selected.size
    for (const id of ids) {
      if (!objects[id]) continue
      out.push({ id, path: 'z', value: `a${n++}` })
    }
    return out
  }
  const dir = action === 'forward' ? 1 : -1
  const order = dir === 1 ? [...sorted].reverse() : sorted
  for (const obj of order) {
    if (!selected.has(obj.id)) continue
    const idx = sorted.findIndex((o) => o.id === obj.id)
    const swapWith = sorted[idx + dir]
    if (!swapWith || selected.has(swapWith.id)) continue
    out.push({ id: obj.id, path: 'z', value: swapWith.z })
    out.push({ id: swapWith.id, path: 'z', value: obj.z })
    const tmp = sorted[idx]
    sorted[idx] = sorted[idx + dir]
    sorted[idx + dir] = tmp
  }
  return out
}

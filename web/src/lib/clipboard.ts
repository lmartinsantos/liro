import { descendants, nextZ, parseZ } from './ops'
import type { BoardObject } from './types'
import { newId } from './utils'

export const CLIP_KIND = 'liro/objects-v1'

export type ClipPayload = {
  kind: typeof CLIP_KIND
  objects: BoardObject[]
}

let memory: BoardObject[] = []
let lastSig = ''
let pasteCount = 0

export function collectCopySet(ids: string[], objects: Record<string, BoardObject>) {
  const set = new Set<string>()
  for (const id of ids) {
    if (!objects[id]) continue
    set.add(id)
    for (const d of descendants(id, objects)) set.add(d.id)
  }
  for (const o of Object.values(objects)) {
    if (o.type === 'connector' && o.fromId && o.toId && set.has(o.fromId) && set.has(o.toId)) {
      set.add(o.id)
    }
  }
  return [...set].map((id) => objects[id]).filter(Boolean)
}

export function rememberCopy(objects: BoardObject[]) {
  memory = objects.map((o) => structuredClone(o))
  lastSig = signature(memory)
  pasteCount = 0
}

export function memoryCopy() {
  return memory
}

export function parseClip(text: string): BoardObject[] | null {
  try {
    const data = JSON.parse(text) as ClipPayload
    if (data.kind !== CLIP_KIND || !Array.isArray(data.objects)) return null
    return data.objects
  } catch {
    return null
  }
}

export function toClipText(objects: BoardObject[]) {
  const payload: ClipPayload = { kind: CLIP_KIND, objects }
  return JSON.stringify(payload)
}

export function cloneForPaste(source: BoardObject[], live: Record<string, BoardObject>, dx = 32, dy = 32) {
  const sig = signature(source)
  if (sig === lastSig) pasteCount += 1
  else {
    lastSig = sig
    pasteCount = 1
  }
  const ox = dx * pasteCount
  const oy = dy * pasteCount
  const idMap = new Map<string, string>()
  for (const o of source) idMap.set(o.id, newId('obj'))
  let z = parseZ(nextZ(live))
  const cloned = source.map((o) => {
    const attachments = (o.attachments ?? []).map((a) => ({ ...a, id: newId('att') }))
    const parentId = o.parentId && idMap.has(o.parentId) ? idMap.get(o.parentId) : ''
    const fromId = o.fromId && idMap.has(o.fromId) ? idMap.get(o.fromId) : undefined
    const toId = o.toId && idMap.has(o.toId) ? idMap.get(o.toId) : undefined
    return {
      ...structuredClone(o),
      id: idMap.get(o.id)!,
      x: o.x + ox,
      y: o.y + oy,
      z: `a${z++}`,
      parentId,
      fromId,
      toId,
      attachments,
    }
  })
  return sortForCreate(cloned.filter((o) => o.type !== 'connector' || (o.fromId && o.toId)))
}

function sortForCreate(objs: BoardObject[]) {
  const rank = (t: string) => (t === 'connector' ? 2 : t === 'frame' || t === 'lane' || t === 'group' ? 0 : 1)
  return [...objs].sort((a, b) => rank(a.type) - rank(b.type))
}

function signature(objects: BoardObject[]) {
  return objects
    .map((o) => o.id)
    .sort()
    .join(',')
}

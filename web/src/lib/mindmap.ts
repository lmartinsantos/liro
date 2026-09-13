import { nextZ } from './ops'
import type { BoardObject } from './types'
import { newId } from './utils'

export const MINDMAP_W = 160
export const MINDMAP_H = 72
export const MINDMAP_GAP_X = 48
export const MINDMAP_GAP_Y = 20

/** Count existing outgoing connectors from a parent (children). */
export function mindmapChildCount(parentId: string, objects: Record<string, BoardObject>) {
  let n = 0
  for (const o of Object.values(objects)) {
    if (o.type === 'connector' && o.fromId === parentId) n += 1
  }
  return n
}

export function mindmapChildBox(parent: BoardObject, childIndex: number) {
  return {
    x: parent.x + parent.w + MINDMAP_GAP_X,
    y: parent.y + childIndex * (MINDMAP_H + MINDMAP_GAP_Y),
    w: MINDMAP_W,
    h: MINDMAP_H,
  }
}

export function buildMindmapRoot(args: {
  x: number
  y: number
  objects: Record<string, BoardObject>
  fill: string
  stroke: string
  text?: string
}): BoardObject {
  return {
    id: newId('obj'),
    type: 'postit',
    x: args.x - MINDMAP_W / 2,
    y: args.y - MINDMAP_H / 2,
    w: MINDMAP_W,
    h: MINDMAP_H,
    rotation: 0,
    z: nextZ(args.objects),
    fill: args.fill,
    stroke: args.stroke,
    strokeWidth: 2,
    text: args.text ?? 'Idea',
    attachments: [],
    textAlign: 'center',
  }
}

export function buildMindmapChild(args: {
  parent: BoardObject
  objects: Record<string, BoardObject>
  fill: string
  stroke: string
  text?: string
}): { node: BoardObject; connector: BoardObject } {
  const idx = mindmapChildCount(args.parent.id, args.objects)
  const box = mindmapChildBox(args.parent, idx)
  const live = { ...args.objects }
  const node: BoardObject = {
    id: newId('obj'),
    type: 'postit',
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    rotation: 0,
    z: nextZ(live),
    fill: args.fill,
    stroke: args.stroke,
    strokeWidth: 2,
    text: args.text ?? 'Branch',
    attachments: [],
    textAlign: 'center',
  }
  live[node.id] = node
  const connector: BoardObject = {
    id: newId('obj'),
    type: 'connector',
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    rotation: 0,
    z: nextZ(live),
    fill: args.stroke,
    stroke: args.stroke,
    strokeWidth: 2,
    fromId: args.parent.id,
    toId: node.id,
    fromSide: 'right',
    toSide: 'left',
    fromOffset: 0.5,
    toOffset: 0.5,
    attachments: [],
  }
  return { node, connector }
}

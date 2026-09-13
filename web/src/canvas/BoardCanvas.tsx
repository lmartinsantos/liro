import type Konva from 'konva'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Layer, Line, Rect, Stage, Transformer } from 'react-konva'
import {
  connectorBounds,
  nearestPort,
  resolveEndpoint,
  routeForConnector,
  type Port,
} from '@/lib/connectors'
import {
  boxIntersects,
  centerOf,
  groupRoot,
  hitTop,
  intersectsView,
  moveSet,
  nextZ,
  objectAABB,
  parentAfterMove,
  renderOrder,
} from '@/lib/ops'
import { DEFAULT_FILL, useCanvasTheme } from '@/lib/canvasTheme'
import {
  bodyFontSize,
  cssFontWeight,
  displayNoteFontSize,
  isTexty,
  NOTE_LINE_HEIGHT,
  NOTE_PAD,
  objectFontFamily,
  objectTextAlign,
  titleFontSize,
} from '@/lib/textStyle'
import { imageFilesFromDataTransfer } from '@/lib/images'
import type { BoardObject, ObjectType, RemoteCursor, Side, Tool } from '@/lib/types'
import { newId } from '@/lib/utils'
import { AttachmentsLayer } from './AttachmentsLayer'
import { ConnectorOverlay, ConnectorPreview } from './ConnectorOverlay'
import { ObjectNode } from './ObjectNode'
import { RemoteCursors } from './RemoteCursors'
import { draftFromDrag, isDrawTool, isPathType, objectFromDraft, type Draft } from './shapeGeom'

type Props = {
  objects: Record<string, BoardObject>
  selectedIds: string[]
  onSelect: (ids: string[]) => void
  tool: Tool
  fill: string
  stroke: string
  strokeWidth: number
  cursors: RemoteCursor[]
  onCreate: (obj: BoardObject) => void
  onUpdate: (id: string, path: string, value: unknown) => void
  onLiveMove: (id: string, x: number, y: number) => void
  onCursor: (x: number, y: number) => void
  onImages?: (files: File[], at: { x: number; y: number }) => void
  textStyle?: {
    fontFamily?: string
    fontSize?: number
    bold?: boolean
    italic?: boolean
    textAlign?: 'left' | 'center' | 'right'
  }
  stickerEmoji?: string
}

export type BoardCanvasHandle = {
  viewCenter: () => { x: number; y: number }
}

const MIN_SCALE = 0.12
const MAX_SCALE = 6

export const BoardCanvas = forwardRef<BoardCanvasHandle, Props>(function BoardCanvas(
  {
    objects,
    selectedIds,
    onSelect,
    tool,
    fill,
    stroke,
    strokeWidth,
    cursors,
    onCreate,
    onUpdate,
    onLiveMove,
    onCursor,
    onImages,
    textStyle,
    stickerEmoji = '🔥',
  },
  ref,
) {
  const theme = useCanvasTheme()
  const wrapRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [pos, setPos] = useState({ x: 80, y: 80 })
  const [scale, setScale] = useState(1)
  const [space, setSpace] = useState(false)
  const [panning, setPanning] = useState(false)
  const panRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [splinePts, setSplinePts] = useState<number[] | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [connectFrom, setConnectFrom] = useState<{
    id: string
    side: Side
    offset: number
  } | null>(null)
  const [hoverPt, setHoverPt] = useState<{ x: number; y: number } | null>(null)
  const [hoverShapeId, setHoverShapeId] = useState<string | null>(null)
  const lastCursor = useRef(0)
  const lastPosSend = useRef<Record<string, number>>({})
  const moveOrigin = useRef<Record<string, { x: number; y: number }>>({})
  const draggingId = useRef<string | null>(null)
  const [livePos, setLivePos] = useState<Record<string, { x: number; y: number }>>({})
  const selectedRef = useRef(selectedIds)
  selectedRef.current = selectedIds

  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null
  const multiSelect = selectedIds.length > 1

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    const preventMiddle = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault()
    }
    el.addEventListener('mousedown', preventMiddle)
    return () => {
      ro.disconnect()
      el.removeEventListener('mousedown', preventMiddle)
    }
  }, [])

  useEffect(() => {
    if (tool !== 'connector') setConnectFrom(null)
  }, [tool])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e)) {
        e.preventDefault()
        setSpace(true)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpace(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  useEffect(() => {
    const stage = stageRef.current
    const tr = trRef.current
    if (!stage || !tr) return
    if (!selectedIds.length || tool !== 'select' || editing) {
      tr.nodes([])
      return
    }
    const nodes = selectedIds.flatMap((id) => {
      const obj = objects[id]
      if (!obj || obj.type === 'connector' || isPathType(obj.type)) return []
      const node = stage.findOne('#' + id)
      return node ? [node] : []
    })
    tr.nodes(nodes)
    tr.getLayer()?.batchDraw()
  }, [selectedIds, objects, tool, editing])

  const view = useMemo(
    () => ({
      x: -pos.x / scale,
      y: -pos.y / scale,
      w: size.w / scale,
      h: size.h / scale,
    }),
    [pos.x, pos.y, scale, size.w, size.h],
  )

  useImperativeHandle(
    ref,
    () => ({
      viewCenter: () => ({
        x: view.x + view.w / 2,
        y: view.y + view.h / 2,
      }),
    }),
    [view],
  )

  const visible = useMemo(() => {
    return Object.values(objects)
      .filter((o) => {
        if (o.type === 'connector') {
          const pts = routeForConnector(o, objects, livePos)
          if (!pts) return false
          return intersectsView(o, view, 80, connectorBounds(pts))
        }
        const live = livePos[o.id]
        if (live) return intersectsView(o, view, 80, objectAABB({ ...o, ...live }))
        return intersectsView(o, view)
      })
      .sort(renderOrder)
  }, [objects, view, livePos])

  const toBoard = useCallback(
    (sx: number, sy: number) => ({
      x: (sx - pos.x) / scale,
      y: (sy - pos.y) / scale,
    }),
    [pos.x, pos.y, scale],
  )

  const refreshTransformer = useCallback(() => {
    const tr = trRef.current
    if (!tr) return
    tr.forceUpdate()
    tr.getLayer()?.batchDraw()
  }, [])

  const pointerBoard = () => {
    const stage = stageRef.current
    const p = stage?.getPointerPosition()
    if (!p) return null
    return toBoard(p.x, p.y)
  }

  const emitCursor = (pt: { x: number; y: number }) => {
    const now = performance.now()
    if (now - lastCursor.current < 40) return
    lastCursor.current = now
    onCursor(pt.x, pt.y)
  }

  const finishConnect = (
    from: { id: string; side: Side; offset: number },
    to: { id: string; side: Side; offset: number },
  ) => {
    if (from.id === to.id) return
    const fromObj = objects[from.id]
    const toObj = objects[to.id]
    if (!fromObj || !toObj || fromObj.type === 'connector' || toObj.type === 'connector') {
      setConnectFrom(null)
      return
    }
    onCreate({
      id: newId('obj'),
      type: 'connector',
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      rotation: 0,
      z: nextZ(objects),
      fill: stroke,
      stroke,
      strokeWidth,
      fromId: from.id,
      toId: to.id,
      fromSide: from.side,
      toSide: to.side,
      fromOffset: from.offset,
      toOffset: to.offset,
      attachments: [],
    })
    setConnectFrom(null)
  }

  const pickPort = (shapeId: string, port: Port) => {
    if (tool !== 'connector') return
    if (!connectFrom) {
      setConnectFrom({ id: shapeId, side: port.side, offset: port.offset })
      return
    }
    finishConnect(connectFrom, { id: shapeId, side: port.side, offset: port.offset })
  }

  const pickObject = (id: string, shift: boolean) => {
    if (tool === 'connector') {
      const target = objects[id]
      if (!target || target.type === 'connector') {
        setConnectFrom(null)
        return
      }
      const pt = hoverPt ?? { x: target.x + target.w / 2, y: target.y + target.h / 2 }
      const port = nearestPort(target, pt)
      if (!connectFrom) {
        setConnectFrom({ id, side: port.side, offset: port.offset })
        return
      }
      finishConnect(connectFrom, { id, side: port.side, offset: port.offset })
      return
    }
    const pickId = shift ? id : groupRoot(id, objects)
    if (shift) {
      const next = selectedRef.current.includes(pickId)
        ? selectedRef.current.filter((x) => x !== pickId)
        : [...selectedRef.current, pickId]
      onSelect(next)
      return
    }
    // Keep multi-select when clicking an already-selected item (drag the selection).
    if (selectedRef.current.includes(pickId) && selectedRef.current.length > 1) return
    if (selectedRef.current.includes(id) && selectedRef.current.length > 1) return
    onSelect([pickId])
  }

  const rewireConnector = (
    connectorId: string,
    end: 'from' | 'to',
    target: { id: string; side: Side; offset: number },
  ) => {
    const conn = objects[connectorId]
    if (!conn || conn.type !== 'connector') return
    if (end === 'from') {
      onUpdate(connectorId, 'fromId', target.id)
      onUpdate(connectorId, 'fromSide', target.side)
      onUpdate(connectorId, 'fromOffset', target.offset)
    } else {
      onUpdate(connectorId, 'toId', target.id)
      onUpdate(connectorId, 'toSide', target.side)
      onUpdate(connectorId, 'toOffset', target.offset)
    }
    onUpdate(connectorId, 'points', [])
  }

  const finishDraft = (d: Draft | null) => {
    if (!d) return
    const tooSmall = !isPathType(d.type) && d.w < 8 && d.h < 8
    const lineShort =
      (d.type === 'line' || d.type === 'spline') &&
      (d.points?.length ?? 0) >= 4 &&
      Math.hypot(d.points![2], d.points![3]) < 3
    if (tooSmall || lineShort) {
      setDraft(null)
      return
    }
    const isNote = d.type === 'postit'
    const isFrame = d.type === 'frame'
    const isLane = d.type === 'lane'
    const extras: Parameters<typeof objectFromDraft>[1] = {
      id: newId('obj'),
      z: nextZ(objects),
      fill: isNote
        ? fill === '#93c5fd'
          ? '#fef08a'
          : fill
        : isFrame
          ? '#faf8f3'
          : isLane
            ? '#f3efe6'
            : fill,
      stroke: isNote ? '#ca8a04' : isFrame ? '#c4b8a5' : isLane ? '#b8a99a' : stroke,
      strokeWidth: isNote || isFrame || isLane ? 1 : strokeWidth,
      text: isNote ? '' : isFrame ? 'Frame' : isLane ? 'Lane' : undefined,
      fontFamily: isNote ? textStyle?.fontFamily : undefined,
      fontSize: isNote ? textStyle?.fontSize : undefined,
      bold: isNote ? textStyle?.bold : undefined,
      italic: isNote ? textStyle?.italic : undefined,
      textAlign: isNote ? textStyle?.textAlign : undefined,
    }
    if (isLane) extras.dir = 'h'
    const selectedFrame = selectedRef.current
      .map((id) => objects[id])
      .find((o) => o?.type === 'frame')
    if (isLane && selectedFrame) {
      const lanes = Object.values(objects).filter((o) => o.type === 'lane' && o.parentId === selectedFrame.id)
      const bodyY = selectedFrame.y + 28
      const bodyH = Math.max(40, selectedFrame.h - 28)
      const n = lanes.length + 1
      const h = bodyH / n
      extras.parentId = selectedFrame.id
      const stacked: Draft = {
        type: 'lane',
        x: selectedFrame.x,
        y: bodyY + lanes.length * h,
        w: selectedFrame.w,
        h,
      }
      const created = objectFromDraft(stacked, extras)
      onCreate(created)
      lanes.forEach((lane, i) => {
        onUpdate(lane.id, 'x', selectedFrame.x)
        onUpdate(lane.id, 'y', bodyY + i * h)
        onUpdate(lane.id, 'w', selectedFrame.w)
        onUpdate(lane.id, 'h', h)
      })
      setDraft(null)
      return
    }
    const created = objectFromDraft(d, extras)
    if (created.w < (isFrame ? 80 : 16)) created.w = isFrame ? 240 : created.w
    if (created.h < (isFrame ? 80 : 16)) created.h = isFrame ? 180 : created.h
    onCreate(created)
    if (isNote) {
      setEditing(created.id)
      setEditText('')
      onSelect([created.id])
    }
    if (isFrame) {
      for (const o of Object.values(objects)) {
        if (o.id === created.id || o.type === 'connector' || o.type === 'frame') continue
        const mid = centerOf(o)
        if (mid.x >= created.x && mid.y >= created.y && mid.x <= created.x + created.w && mid.y <= created.y + created.h) {
          onUpdate(o.id, 'parentId', created.id)
        }
      }
    }
    setDraft(null)
  }

  const commitSpline = (pts: number[]) => {
    if (pts.length < 4) {
      setSplinePts(null)
      return
    }
    let minX = Infinity
    let minY = Infinity
    for (let i = 0; i < pts.length; i += 2) {
      minX = Math.min(minX, pts[i])
      minY = Math.min(minY, pts[i + 1])
    }
    const rel: number[] = []
    for (let i = 0; i < pts.length; i += 2) {
      rel.push(pts[i] - minX, pts[i + 1] - minY)
    }
    onCreate({
      id: newId('obj'),
      type: 'spline',
      x: minX,
      y: minY,
      w: 1,
      h: 1,
      rotation: 0,
      z: nextZ(objects),
      fill: 'transparent',
      stroke,
      strokeWidth,
      points: rel,
      attachments: [],
    })
    setSplinePts(null)
  }

  const placeText = (pt: { x: number; y: number }) => {
    const id = newId('obj')
    const fontSize = textStyle?.fontSize ?? 20
    onCreate({
      id,
      type: 'text',
      x: pt.x,
      y: pt.y,
      w: 240,
      h: Math.max(48, Math.round(fontSize * 1.5)),
      rotation: 0,
      z: nextZ(objects),
      fill: fill === DEFAULT_FILL ? theme.ink : fill,
      stroke: 'transparent',
      strokeWidth: 0,
      text: '',
      fontFamily: textStyle?.fontFamily,
      fontSize,
      bold: textStyle?.bold,
      italic: textStyle?.italic,
      textAlign: textStyle?.textAlign,
      attachments: [],
    })
    setEditing(id)
    setEditText('')
    onSelect([id])
  }

  const placeSticker = (pt: { x: number; y: number }) => {
    const size = 64
    const id = newId('obj')
    onCreate({
      id,
      type: 'sticker',
      x: pt.x - size / 2,
      y: pt.y - size / 2,
      w: size,
      h: size,
      rotation: 0,
      z: nextZ(objects),
      fill: 'transparent',
      stroke: 'transparent',
      strokeWidth: 0,
      text: stickerEmoji,
      attachments: [],
    })
    onSelect([id])
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return
      if (e.key === 'Enter' && splinePts) {
        e.preventDefault()
        commitSpline(splinePts)
        return
      }
      if (e.key === 'Enter' && !editing && tool === 'select' && selectedIds.length === 1) {
        const obj = objects[selectedIds[0]]
        if (obj && isTexty(obj.type)) {
          e.preventDefault()
          setEditing(obj.id)
          setEditText(obj.text ?? '')
          onSelect([obj.id])
          return
        }
      }
      if (e.key === 'Escape') {
        setDraft(null)
        setSplinePts(null)
        setEditing(null)
        setConnectFrom(null)
        setMarquee(null)
        onSelect([])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [splinePts, onSelect, objects, stroke, strokeWidth, editing, tool, selectedIds])

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const stage = stageRef.current
    if (!stage) return
    const pointer = stage.getPointerPosition()
    if (!pointer) return
    const old = scale
    const next = clamp(old * (e.evt.deltaY > 0 ? 0.92 : 1.08), MIN_SCALE, MAX_SCALE)
    const mouse = {
      x: (pointer.x - pos.x) / old,
      y: (pointer.y - pos.y) / old,
    }
    setScale(next)
    setPos({
      x: pointer.x - mouse.x * next,
      y: pointer.y - mouse.y * next,
    })
  }

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const pt = pointerBoard()
    if (!pt) return
    const middle = e.evt.button === 1
    if (space || middle) {
      setPanning(true)
      panRef.current = { x: pos.x, y: pos.y, px: e.evt.clientX, py: e.evt.clientY }
      return
    }
    if (tool === 'text') {
      placeText(pt)
      return
    }
    if (tool === 'sticker') {
      placeSticker(pt)
      return
    }
    if (tool === 'connector') {
      const hit = hitTop(pt.x, pt.y, objects)
      if (hit) pickObject(hit.id, false)
      else setConnectFrom(null)
      return
    }
    if (tool === 'spline') {
      setSplinePts((prev) => (prev ? [...prev, pt.x, pt.y] : [pt.x, pt.y]))
      return
    }
    if (isDrawTool(tool)) {
      dragStart.current = pt
      setDraft(draftFromDrag(tool as ObjectType, pt, pt))
      return
    }
    if (e.target === e.target.getStage()) {
      dragStart.current = pt
      setMarquee({ x: pt.x, y: pt.y, w: 0, h: 0 })
    }
  }

  const onMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const pt = pointerBoard()
    if (pt) {
      emitCursor(pt)
      setHoverPt(pt)
      if (tool === 'connector') {
        const hit = hitTop(pt.x, pt.y, objects)
        setHoverShapeId(hit && hit.type !== 'connector' ? hit.id : null)
      } else {
        setHoverShapeId(null)
      }
    }
    if (panning && panRef.current) {
      setPos({
        x: panRef.current.x + (e.evt.clientX - panRef.current.px),
        y: panRef.current.y + (e.evt.clientY - panRef.current.py),
      })
      return
    }
    if (marquee && dragStart.current && pt) {
      setMarquee({
        x: Math.min(dragStart.current.x, pt.x),
        y: Math.min(dragStart.current.y, pt.y),
        w: Math.abs(pt.x - dragStart.current.x),
        h: Math.abs(pt.y - dragStart.current.y),
      })
      return
    }
    if (dragStart.current && isDrawTool(tool) && tool !== 'spline') {
      setDraft(draftFromDrag(tool as ObjectType, dragStart.current, pt ?? dragStart.current))
    }
  }

  const onMouseUp = () => {
    if (panning) {
      setPanning(false)
      panRef.current = null
    }
    if (marquee) {
      if (marquee.w > 6 || marquee.h > 6) {
        const hits = [
          ...new Set(
            Object.values(objects)
              .filter((o) => o.type !== 'connector' && boxIntersects(objectAABB(o), marquee))
              .map((o) => groupRoot(o.id, objects)),
          ),
        ]
        onSelect(hits)
      } else {
        onSelect([])
      }
      setMarquee(null)
    }
    if (draft && tool !== 'spline') {
      finishDraft(draft)
    }
    dragStart.current = null
  }

  const onDblClick = () => {
    if (splinePts) commitSpline(splinePts)
  }

  const movingIds = (id: string) => {
    const selected = selectedRef.current
    // Multi-select drag: move the whole selection (and each item's descendants).
    if (selected.includes(id) && selected.length > 1) return moveSet(selected, objects)
    // Group members drag as the group; frames/lanes still move via moveSet(descendants).
    return moveSet([groupRoot(id, objects)], objects)
  }

  const handleChange = (id: string, patch: Partial<BoardObject>) => {
    if ('x' in patch && 'y' in patch && !('w' in patch)) {
      const origin = moveOrigin.current[id] ?? { x: objects[id]?.x ?? 0, y: objects[id]?.y ?? 0 }
      const dx = (patch.x ?? 0) - origin.x
      const dy = (patch.y ?? 0) - origin.y
      const ids = movingIds(id)
      const exclude = new Set(ids)
      for (const mid of ids) {
        const start = moveOrigin.current[mid] ?? { x: objects[mid]?.x ?? 0, y: objects[mid]?.y ?? 0 }
        const nx = start.x + dx
        const ny = start.y + dy
        onUpdate(mid, 'x', nx)
        onUpdate(mid, 'y', ny)
        const o = objects[mid]
        if (!o || o.type === 'frame' || o.type === 'group' || o.type === 'connector') continue
        const nextParent = parentAfterMove(o, nx + o.w / 2, ny + o.h / 2, objects, exclude)
        if ((o.parentId ?? '') !== nextParent) onUpdate(mid, 'parentId', nextParent)
      }
      moveOrigin.current = {}
      draggingId.current = null
      setLivePos({})
      return
    }
    for (const [k, v] of Object.entries(patch)) {
      onUpdate(id, k, v)
    }
  }

  const handleLiveMove = (id: string, x: number, y: number) => {
    draggingId.current = id
    if (!moveOrigin.current[id] && objects[id]) {
      for (const mid of movingIds(id)) {
        const o = objects[mid]
        if (o) moveOrigin.current[mid] = { x: o.x, y: o.y }
      }
    }
    const origin = moveOrigin.current[id] ?? { x: objects[id]?.x ?? 0, y: objects[id]?.y ?? 0 }
    const dx = x - origin.x
    const dy = y - origin.y
    const ids = movingIds(id)
    const preview: Record<string, { x: number; y: number }> = {}
    const stage = stageRef.current
    for (const mid of ids) {
      const start = moveOrigin.current[mid] ?? { x: objects[mid]?.x ?? 0, y: objects[mid]?.y ?? 0 }
      const next = { x: start.x + dx, y: start.y + dy }
      preview[mid] = next
      if (mid !== id) {
        const node = stage?.findOne('#' + mid)
        node?.position(next)
      }
    }
    setLivePos(preview)
    refreshTransformer()

    const pt = pointerBoard()
    if (pt) emitCursor(pt)

    const now = performance.now()
    if (now - (lastPosSend.current[id] ?? 0) < 50) return
    lastPosSend.current[id] = now
    for (const mid of ids) {
      onLiveMove(mid, preview[mid].x, preview[mid].y)
    }
  }

  const startEdit = (id: string) => {
    const obj = objects[id]
    if (!obj) return
    setEditing(id)
    setEditText(obj.text ?? '')
    onSelect([id])
  }

  const commitEdit = () => {
    if (editing) {
      onUpdate(editing, 'text', editText)
      const obj = objects[editing]
      if (obj?.type === 'text') {
        const fontSize = bodyFontSize(obj)
        const lines = Math.max(1, editText.split('\n').length)
        const nextH = Math.max(Math.round(fontSize * 1.4), Math.round(lines * fontSize * 1.25 + 8))
        if (nextH !== obj.h) onUpdate(editing, 'h', nextH)
      }
    }
    setEditing(null)
  }

  const growTextBox = (value: string) => {
    if (!editing) return
    const obj = objects[editing]
    if (!obj || obj.type !== 'text') return
    const fontSize = bodyFontSize(obj)
    const lines = Math.max(1, value.split('\n').length)
    const nextH = Math.max(Math.round(fontSize * 1.4), Math.round(lines * fontSize * 1.25 + 8))
    if (nextH > obj.h) onUpdate(editing, 'h', nextH)
  }

  const editObj = editing ? objects[editing] : null
  const titleBar = editObj && (editObj.type === 'frame' || (editObj.type === 'lane' && editObj.dir === 'v'))
  const liveFont =
    editObj?.type === 'postit'
      ? displayNoteFontSize({
          w: editObj.w,
          h: editObj.h,
          text: editText,
          fontFamily: objectFontFamily(editObj),
          fontSize: editObj.fontSize,
          bold: editObj.bold,
          italic: editObj.italic,
        })
      : editObj?.type === 'text'
        ? bodyFontSize(editObj)
        : editObj
          ? titleFontSize(editObj)
          : 15
  const editStyle = editObj
    ? {
        left: pos.x + editObj.x * scale + (editObj.type === 'text' ? 0 : NOTE_PAD.x * scale),
        top:
          pos.y +
          editObj.y * scale +
          (editObj.type === 'postit' ? NOTE_PAD.y * scale : titleBar ? 6 * scale : 0),
        width: Math.max(
          80,
          editObj.w * scale - (editObj.type === 'text' ? 0 : NOTE_PAD.xTotal * scale),
        ),
        height: Math.max(
          28,
          editObj.type === 'text'
            ? editObj.h * scale
            : titleBar
              ? 28 * scale
              : (editObj.h - NOTE_PAD.yTotal) * scale,
        ),
        fontSize: liveFont * scale,
      }
    : null

  const gridSize = 32 * scale
  const gridPos = `${pos.x}px ${pos.y}px`
  const fromObj = connectFrom ? resolveEndpoint(objects, connectFrom.id, livePos) : null
  const selectedConnectorId =
    selectedId && objects[selectedId]?.type === 'connector' ? selectedId : null
  const portShapeIds = useMemo(() => {
    const ids = new Set<string>()
    if (tool === 'connector') {
      if (hoverShapeId) ids.add(hoverShapeId)
      if (connectFrom) ids.add(connectFrom.id)
    }
    return [...ids]
  }, [tool, hoverShapeId, connectFrom])

  const hoverConnectTarget = useMemo(() => {
    if (!connectFrom || !hoverShapeId || hoverShapeId === connectFrom.id || !hoverPt) return null
    const obj = resolveEndpoint(objects, hoverShapeId, livePos)
    if (!obj || obj.type === 'connector') return null
    const port = nearestPort(obj, hoverPt)
    return { obj, side: port.side, offset: port.offset }
  }, [connectFrom, hoverShapeId, hoverPt, objects, livePos])

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full overflow-hidden"
      style={{
        cursor: space || panning ? 'grab' : tool === 'select' ? 'default' : 'crosshair',
        backgroundColor: theme.bg,
        backgroundImage: `radial-gradient(${theme.grid} 1px, transparent 1px)`,
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: gridPos,
      }}
      onDragOver={(e) => {
        if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(e) => {
        if (!onImages) return
        const files = imageFilesFromDataTransfer(e.dataTransfer)
        if (!files.length) return
        e.preventDefault()
        const rect = wrapRef.current?.getBoundingClientRect()
        if (!rect) return
        onImages(files, toBoard(e.clientX - rect.left, e.clientY - rect.top))
      }}
    >
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={pos.x}
        y={pos.y}
        scaleX={scale}
        scaleY={scale}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onDblClick={onDblClick}
      >
        <Layer>
          {visible.map((obj) => (
            <ObjectNode
              key={obj.id}
              obj={obj}
              objects={objects}
              selected={selectedIds.includes(obj.id)}
              listening={tool === 'select' || tool === 'connector' ? !space && !editing : false}
              theme={theme}
              editing={editing === obj.id}
              preview={draggingId.current === obj.id ? undefined : livePos[obj.id]}
              livePos={livePos}
              onSelect={pickObject}
              onChange={handleChange}
              onLiveMove={handleLiveMove}
              onEditText={startEdit}
              onLiveTransform={refreshTransformer}
            />
          ))}
          {draft && (
            <DraftNode
              draft={draft}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
              frameFill={theme.frame}
              frameStroke={theme.frameStroke}
            />
          )}
          {splinePts && splinePts.length >= 2 && (
            <Line
              points={splinePts}
              stroke={stroke}
              strokeWidth={strokeWidth}
              tension={0.45}
              lineCap="round"
              listening={false}
            />
          )}
          {marquee && (
            <Rect
              x={marquee.x}
              y={marquee.y}
              width={marquee.w}
              height={marquee.h}
              fill={theme.selectFill}
              stroke={theme.select}
              strokeWidth={Math.max(1, 1.5 / scale)}
              dash={[6 / scale, 4 / scale]}
              listening={false}
            />
          )}
          {fromObj && connectFrom && hoverPt && (
            <ConnectorPreview
              from={fromObj}
              fromSide={connectFrom.side}
              fromOffset={connectFrom.offset}
              cursor={hoverPt}
              hoverTarget={hoverConnectTarget}
              theme={theme}
            />
          )}
          <ConnectorOverlay
            objects={objects}
            livePos={livePos}
            theme={theme}
            scale={scale}
            tool={tool}
            portShapeIds={portShapeIds}
            connectFrom={connectFrom}
            selectedConnectorId={tool === 'select' ? selectedConnectorId : null}
            onPortClick={pickPort}
            onUpdate={onUpdate}
            onRewire={rewireConnector}
          />
          <Transformer
            ref={trRef}
            rotateEnabled={!multiSelect}
            keepRatio={
              !multiSelect &&
              (objects[selectedIds[0]]?.type === 'image' || objects[selectedIds[0]]?.type === 'sticker')
            }
            enabledAnchors={
              multiSelect || (selectedId && objects[selectedId] && isPathType(objects[selectedId].type))
                ? []
                : undefined
            }
            boundBoxFunc={(_old, box) => {
              if (box.width < 8 || box.height < 8) return _old
              return box
            }}
            borderStroke={theme.select}
            anchorStroke={theme.select}
            anchorFill={theme.paper}
          />
        </Layer>
        <Layer listening={false}>
          <AttachmentsLayer objects={visible} theme={theme} />
          <RemoteCursors cursors={cursors} />
        </Layer>
      </Stage>
      {editObj && editStyle && (
        <textarea
          autoFocus
          value={editText}
          onChange={(e) => {
            const value = e.target.value
            setEditText(value)
            growTextBox(value)
          }}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              commitEdit()
            }
          }}
          placeholder={
            editObj.type === 'postit'
              ? 'Write a note…'
              : editObj.type === 'text'
                ? 'Type something…'
                : editObj.type === 'frame'
                  ? 'Frame title'
                  : editObj.type === 'lane'
                    ? 'Lane title'
                    : 'Label'
          }
          className="absolute z-20 resize-none border-0 p-0 outline-none"
          style={{
            ...editStyle,
            fontFamily: objectFontFamily(editObj),
            fontWeight: editObj.type === 'frame' ? 700 : cssFontWeight(editObj),
            fontStyle: editObj.italic ? 'italic' : 'normal',
            lineHeight: editObj.type === 'postit' ? NOTE_LINE_HEIGHT : 1.15,
            textAlign: objectTextAlign(editObj),
            color: editObj.type === 'text' ? editObj.fill || theme.ink : '#1e2a4a',
            caretColor: editObj.type === 'text' ? editObj.fill || theme.ink : '#1e2a4a',
            background: 'transparent',
            boxShadow: 'none',
            colorScheme: 'light',
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
            transform: editObj.rotation ? `rotate(${editObj.rotation}deg)` : undefined,
            transformOrigin: 'top left',
          }}
        />
      )}
    </div>
  )
})

function DraftNode({
  draft,
  fill,
  stroke,
  strokeWidth,
  frameFill,
  frameStroke,
}: {
  draft: Draft
  fill: string
  stroke: string
  strokeWidth: number
  frameFill: string
  frameStroke: string
}) {
  if (draft.type === 'line' && draft.points) {
    return (
      <Line
        x={draft.x}
        y={draft.y}
        points={draft.points}
        stroke={stroke}
        strokeWidth={strokeWidth}
        listening={false}
      />
    )
  }
  const frameLike = draft.type === 'frame' || draft.type === 'lane'
  if (draft.type === 'ellipse') {
    return (
      <Rect
        x={draft.x}
        y={draft.y}
        width={draft.w}
        height={draft.h}
        cornerRadius={999}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        opacity={0.85}
        listening={false}
      />
    )
  }
  return (
    <Rect
      x={draft.x}
      y={draft.y}
      width={draft.w}
      height={draft.h}
      fill={frameLike ? frameFill : fill}
      stroke={frameLike ? frameStroke : stroke}
      strokeWidth={strokeWidth}
      opacity={0.85}
      listening={false}
    />
  )
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}

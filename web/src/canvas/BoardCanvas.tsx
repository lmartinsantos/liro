import type Konva from 'konva'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Ellipse, Layer, Line, Rect, Stage, Transformer } from 'react-konva'
import {
  arrowHeadPoints,
  connectorPreviewPoints,
  nearestPort,
  polylineMidpoint,
  resolveEndpoint,
  routeForConnector,
  STUB,
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
  unionBoxes,
} from '@/lib/ops'
import { DEFAULT_FILL, useCanvasTheme } from '@/lib/canvasTheme'
import {
  bodyFontSize,
  cssFontWeight,
  displayNoteFontSize,
  isTexty,
  konvaFontStyle,
  measureNoteTextHeight,
  NOTE_LINE_HEIGHT,
  NOTE_PAD,
  noteFontPref,
  noteTextBox,
  objectFontFamily,
  objectTextAlign,
  titleFontSize,
  useFontEpoch,
} from '@/lib/textStyle'
import { imageFilesFromDataTransfer } from '@/lib/images'
import { buildMindmapChild, buildMindmapRoot } from '@/lib/mindmap'
import { GRID_SIZE, type Guide, readSnapEnabled, snapBox, snapResizeBox } from '@/lib/snap'
import type { BoardObject, ObjectType, RemoteCursor, Side, Tool } from '@/lib/types'
import { newId } from '@/lib/utils'
import { AttachmentsLayer } from './AttachmentsLayer'
import { ConnectorOverlay } from './ConnectorOverlay'
import { ObjectNode } from './ObjectNode'
import { RemoteCursors } from './RemoteCursors'
import {
  draftFromDrag,
  isDrawTool,
  isPathType,
  nodeLod,
  objectFromDraft,
  type Draft,
} from './shapeGeom'

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
  onCreateMany?: (objs: BoardObject[]) => void
  onUpdate: (id: string, path: string, value: unknown) => void
  onLiveMove: (id: string, x: number, y: number) => void
  onCommitPatches?: (patches: { id: string; path: string; value: unknown }[]) => void
  onCursor: (x: number, y: number) => void
  onImages?: (files: File[], at: { x: number; y: number }) => void
  textStyle?: {
    fontFamily?: string
    fontSize?: number
    bold?: boolean
    italic?: boolean
    textAlign?: 'left' | 'center' | 'right'
    /** Notes default to auto size (unset) and centered text (unset). */
    noteFontSize?: number
    noteTextAlign?: 'left' | 'center' | 'right'
  }
  stickerEmoji?: string
  snapEnabled?: boolean
  /** Pan/zoom only — no select, edit, or create. */
  readOnly?: boolean
}

export type BoardCanvasHandle = {
  viewCenter: () => { x: number; y: number }
  fitObjects: (objects: Record<string, BoardObject>, pad?: number) => void
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
    onCreateMany,
    onUpdate,
    onLiveMove,
    onCommitPatches,
    onCursor,
    onImages,
    textStyle,
    stickerEmoji = '🔥',
    snapEnabled: snapEnabledProp,
    readOnly = false,
  },
  ref,
) {
  const theme = useCanvasTheme()
  const fontEpoch = useFontEpoch()
  const wrapRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [pos, setPos] = useState({ x: 80, y: 80 })
  const [scale, setScale] = useState(1)
  const [space, setSpace] = useState(false)
  const [panning, setPanning] = useState(false)
  const snapEnabled = snapEnabledProp ?? readSnapEnabled()
  const snapEnabledRef = useRef(snapEnabled)
  snapEnabledRef.current = snapEnabled
  const panRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [splinePts, setSplinePts] = useState<number[] | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const marqueeRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const marqueeNodeRef = useRef<Konva.Rect>(null)
  const dragLayerRef = useRef<Konva.Layer>(null)
  const liftedRef = useRef<{ node: Konva.Node; index: number }[]>([])
  const [connectFrom, setConnectFrom] = useState<{
    id: string
    side: Side
    offset: number
  } | null>(null)
  const [hoverShapeId, setHoverShapeId] = useState<string | null>(null)
  const lastCursor = useRef(0)
  const lastPosSend = useRef<Record<string, number>>({})
  const moveOrigin = useRef<Record<string, { x: number; y: number }>>({})
  const draggingId = useRef<string | null>(null)
  const selectedRef = useRef(selectedIds)
  selectedRef.current = selectedIds
  const objectsRef = useRef(objects)
  objectsRef.current = objects
  const toolRef = useRef(tool)
  toolRef.current = tool
  const hoverPtRef = useRef<{ x: number; y: number } | null>(null)
  const hoverShapeIdRef = useRef<string | null>(null)
  const previewLineRef = useRef<Konva.Line>(null)
  const previewPtsRef = useRef<number[]>([])
  const connectFromRef = useRef(connectFrom)
  connectFromRef.current = connectFrom
  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate
  const onCreateRef = useRef(onCreate)
  onCreateRef.current = onCreate
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const onLiveMoveRef = useRef(onLiveMove)
  onLiveMoveRef.current = onLiveMove
  const onCommitRef = useRef(onCommitPatches)
  onCommitRef.current = onCommitPatches
  const strokeRef = useRef(stroke)
  strokeRef.current = stroke
  const strokeWidthRef = useRef(strokeWidth)
  strokeWidthRef.current = strokeWidth
  const livePosRef = useRef<Record<string, { x: number; y: number }>>({})
  const movingIdsRef = useRef<string[] | null>(null)
  const dragNodesRef = useRef(new Map<string, Konva.Node>())
  const dragConnsRef = useRef(
    new Map<string, { route: Konva.Line | null; head: Konva.Line | null; label: Konva.Text | null }>(),
  )
  const connectorsByEndRef = useRef(new Map<string, string[]>())
  const guideVRef = useRef<Konva.Line>(null)
  const guideHRef = useRef<Konva.Line>(null)
  const guideDrawRef = useRef({
    vOn: false,
    hOn: false,
    vPts: [0, 0, 0, 0] as number[],
    hPts: [0, 0, 0, 0] as number[],
  })
  const viewRef = useRef({ x: 0, y: 0, w: 1, h: 1 })
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  const contentLayerRef = useRef<Konva.Layer>(null)
  // Live stage transform; ahead of pos/scale state while a pan or wheel gesture is running.
  const txRef = useRef({ x: pos.x, y: pos.y, scale })
  const gestureRef = useRef(false)
  const viewRafRef = useRef(0)
  const wheelTimerRef = useRef(0)
  if (!gestureRef.current) txRef.current = { x: pos.x, y: pos.y, scale }
  const editingRef = useRef(editing)
  editingRef.current = editing
  const paintGuidesRef = useRef<(guides: Guide[]) => void>(() => {})
  const paintPreviewRef = useRef<() => void>(() => {})
  const paintMarqueeRef = useRef<(m: { x: number; y: number; w: number; h: number } | null) => void>(
    () => {},
  )

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
    if (tool !== 'connector') {
      setConnectFrom(null)
      hoverShapeIdRef.current = null
      setHoverShapeId(null)
      previewPtsRef.current = []
    }
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
    if (readOnly || !selectedIds.length || tool !== 'select' || editing) {
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
  }, [selectedIds, objects, tool, editing, readOnly])

  const view = useMemo(
    () => ({
      x: -pos.x / scale,
      y: -pos.y / scale,
      w: size.w / scale,
      h: size.h / scale,
    }),
    [pos.x, pos.y, scale, size.w, size.h],
  )

  const endGesture = () => {
    window.clearTimeout(wheelTimerRef.current)
    wheelTimerRef.current = 0
    if (viewRafRef.current) cancelAnimationFrame(viewRafRef.current)
    viewRafRef.current = 0
    if (gestureRef.current) {
      gestureRef.current = false
      contentLayerRef.current?.listening(true)
    }
  }

  useImperativeHandle(
    ref,
    () => ({
      viewCenter: () => {
        const tx = txRef.current
        return {
          x: (size.w / 2 - tx.x) / tx.scale,
          y: (size.h / 2 - tx.y) / tx.scale,
        }
      },
      fitObjects: (objs, pad = 48) => {
        const boxes = Object.values(objs)
          .filter((o) => o.type !== 'connector')
          .map((o) => objectAABB(o))
        if (!boxes.length || size.w < 8 || size.h < 8) return
        const box = unionBoxes(boxes)
        const next = clamp(
          Math.min((size.w - pad * 2) / box.w, (size.h - pad * 2) / box.h),
          MIN_SCALE,
          MAX_SCALE,
        )
        endGesture()
        setScale(next)
        setPos({
          x: size.w / 2 - (box.x + box.w / 2) * next,
          y: size.h / 2 - (box.y + box.h / 2) * next,
        })
      },
    }),
    [size.w, size.h],
  )

  viewRef.current = view

  const connectorsByEnd = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const o of Object.values(objects)) {
      if (o.type !== 'connector') continue
      if (o.fromId) {
        const list = map.get(o.fromId)
        if (list) list.push(o.id)
        else map.set(o.fromId, [o.id])
      }
      if (o.toId && o.toId !== o.fromId) {
        const list = map.get(o.toId)
        if (list) list.push(o.id)
        else map.set(o.toId, [o.id])
      }
    }
    return map
  }, [objects])
  connectorsByEndRef.current = connectorsByEnd

  const visible = useMemo(() => {
    // Overscan so content revealed by a running pan/zoom is already mounted.
    const cull = {
      x: view.x - view.w / 2,
      y: view.y - view.h / 2,
      w: view.w * 2,
      h: view.h * 2,
    }
    return Object.values(objects)
      .filter((o) => {
        if (o.type === 'connector') {
          const box = connectorCullBox(o, objects)
          if (!box) return false
          return intersectsView(o, cull, 80 + STUB, box)
        }
        return intersectsView(o, cull)
      })
      .sort(renderOrder)
  }, [objects, view])
  const withAttachments = useMemo(() => visible.filter((o) => o.attachments?.length), [visible])

  const paintGuides = (guides: Guide[]) => {
    const frame = viewRef.current
    const sc = scaleRef.current
    const span = Math.max(frame.w, frame.h) * 2
    const sw = Math.max(1, 1 / sc)
    const dash = [6 / sc, 4 / sc]
    const v = guides.find((g) => g.orientation === 'v')
    const h = guides.find((g) => g.orientation === 'h')
    const draw = guideDrawRef.current
    const vLine = guideVRef.current
    const hLine = guideHRef.current
    if (v) {
      draw.vOn = true
      draw.vPts = [v.position, frame.y - span, v.position, frame.y + frame.h + span]
      if (vLine) {
        vLine.visible(true)
        vLine.points(draw.vPts)
        vLine.strokeWidth(sw)
        vLine.dash(dash)
      }
    } else if (draw.vOn) {
      draw.vOn = false
      vLine?.visible(false)
    }
    if (h) {
      draw.hOn = true
      draw.hPts = [frame.x - span, h.position, frame.x + frame.w + span, h.position]
      if (hLine) {
        hLine.visible(true)
        hLine.points(draw.hPts)
        hLine.strokeWidth(sw)
        hLine.dash(dash)
      }
    } else if (draw.hOn) {
      draw.hOn = false
      hLine?.visible(false)
    }
    ;(vLine ?? hLine)?.getLayer()?.batchDraw()
  }
  paintGuidesRef.current = paintGuides

  const paintMarquee = (m: { x: number; y: number; w: number; h: number } | null) => {
    marqueeRef.current = m
    const node = marqueeNodeRef.current
    if (!node) return
    if (!m) {
      if (!node.visible()) return
      node.visible(false)
    } else {
      const sc = txRef.current.scale
      node.setAttrs({
        visible: true,
        x: m.x,
        y: m.y,
        width: m.w,
        height: m.h,
        strokeWidth: Math.max(1, 1.5 / sc),
        dash: [6 / sc, 4 / sc],
      })
    }
    node.getLayer()?.batchDraw()
  }
  paintMarqueeRef.current = paintMarquee

  const paintConnectorPreview = () => {
    const line = previewLineRef.current
    const from = connectFromRef.current
    const pt = hoverPtRef.current
    if (!from || !pt) {
      previewPtsRef.current = []
      if (line) {
        line.visible(false)
        line.getLayer()?.batchDraw()
      }
      return
    }
    const objs = objectsRef.current
    const fromObj = resolveEndpoint(objs, from.id, livePosRef.current)
    if (!fromObj || fromObj.type === 'connector') {
      previewPtsRef.current = []
      line?.visible(false)
      return
    }
    const hoverId = hoverShapeIdRef.current
    let hoverTarget: { obj: (typeof fromObj); side: Side; offset: number } | null = null
    if (hoverId && hoverId !== from.id) {
      const target = resolveEndpoint(objs, hoverId, livePosRef.current)
      if (target && target.type !== 'connector') {
        const port = nearestPort(target, pt)
        hoverTarget = { obj: target, side: port.side, offset: port.offset }
      }
    }
    const pts = connectorPreviewPoints(fromObj, from.side, from.offset, pt, hoverTarget)
    previewPtsRef.current = pts
    if (!line) return
    line.visible(pts.length >= 4)
    line.points(pts)
    line.getLayer()?.batchDraw()
  }
  paintPreviewRef.current = paintConnectorPreview

  useEffect(() => {
    paintPreviewRef.current()
  }, [connectFrom, hoverShapeId, objects])

  const toBoard = useCallback((sx: number, sy: number) => {
    const tx = txRef.current
    return {
      x: (sx - tx.x) / tx.scale,
      y: (sy - tx.y) / tx.scale,
    }
  }, [])

  /** Hide mounted (overscanned) nodes outside the live viewport so Konva skips drawing them. */
  const cullMounted = () => {
    const layer = contentLayerRef.current
    const stage = stageRef.current
    if (!layer || !stage) return false
    let changed = false
    const tx = txRef.current
    const live = {
      x: -tx.x / tx.scale,
      y: -tx.y / tx.scale,
      w: stage.width() / tx.scale,
      h: stage.height() / tx.scale,
    }
    const objs = objectsRef.current
    const selected = selectedRef.current
    for (const child of layer.getChildren()) {
      const id = child.id()
      const obj = id ? objs[id] : undefined
      if (!obj) continue
      let on = true
      if (obj.type !== 'connector' && !selected.includes(id)) {
        const box = objectAABB(obj)
        box.x += child.x() - obj.x
        box.y += child.y() - obj.y
        on = intersectsView(obj, live, obj.rotation ? Math.max(obj.w, obj.h) : 40, box)
      }
      if (child.visible() !== on) {
        child.visible(on)
        changed = true
      }
    }
    return changed
  }

  const applyView = () => {
    viewRafRef.current = 0
    const stage = stageRef.current
    const tx = txRef.current
    if (stage) {
      stage.position({ x: tx.x, y: tx.y })
      stage.scale({ x: tx.scale, y: tx.scale })
      cullMounted()
      stage.batchDraw()
    }
    const el = wrapRef.current
    if (el) {
      const grid = GRID_SIZE * tx.scale
      el.style.backgroundSize = `${grid}px ${grid}px`
      el.style.backgroundPosition = `${tx.x}px ${tx.y}px`
    }
  }

  const commitView = () => {
    window.clearTimeout(wheelTimerRef.current)
    wheelTimerRef.current = 0
    if (!gestureRef.current) return
    if (viewRafRef.current) {
      cancelAnimationFrame(viewRafRef.current)
      applyView()
    }
    gestureRef.current = false
    const layer = contentLayerRef.current
    if (layer) {
      layer.listening(true)
      layer.batchDraw()
    }
    const tx = txRef.current
    setPos({ x: tx.x, y: tx.y })
    setScale(tx.scale)
  }

  /** Move the stage to `next` on the next frame; React state catches up in commitView. */
  const moveView = (next: { x: number; y: number; scale: number }) => {
    txRef.current = next
    if (!gestureRef.current) {
      gestureRef.current = true
      contentLayerRef.current?.listening(false)
    }
    if (editingRef.current) {
      commitView()
      return
    }
    if (!viewRafRef.current) viewRafRef.current = requestAnimationFrame(applyView)
  }

  useEffect(
    () => () => {
      window.clearTimeout(wheelTimerRef.current)
      cancelAnimationFrame(viewRafRef.current)
    },
    [],
  )

  useLayoutEffect(() => {
    if (cullMounted()) contentLayerRef.current?.batchDraw()
  }, [visible, selectedIds, size.w, size.h])

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
      previewPtsRef.current = []
      setConnectFrom({ id: shapeId, side: port.side, offset: port.offset })
      return
    }
    finishConnect(connectFrom, { id: shapeId, side: port.side, offset: port.offset })
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

  const pickPortRef = useRef(pickPort)
  pickPortRef.current = pickPort
  const rewireRef = useRef(rewireConnector)
  rewireRef.current = rewireConnector
  const handlePortClick = useCallback((shapeId: string, port: Port) => {
    pickPortRef.current(shapeId, port)
  }, [])
  const handleRewire = useCallback(
    (connectorId: string, end: 'from' | 'to', target: { id: string; side: Side; offset: number }) => {
      rewireRef.current(connectorId, end, target)
    },
    [],
  )

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
      fontSize: isNote ? textStyle?.noteFontSize || undefined : undefined,
      bold: isNote ? textStyle?.bold : undefined,
      italic: isNote ? textStyle?.italic : undefined,
      textAlign: isNote ? textStyle?.noteTextAlign : undefined,
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

  const placeMindmap = (pt: { x: number; y: number }) => {
    const parentId = selectedRef.current.length === 1 ? selectedRef.current[0] : null
    const parent = parentId ? objects[parentId] : null
    const noteFill = fill === DEFAULT_FILL ? '#fde68a' : fill
    if (parent && parent.type !== 'connector') {
      const { node, connector } = buildMindmapChild({
        parent,
        objects,
        fill: noteFill,
        stroke,
      })
      if (onCreateMany) onCreateMany([node, connector])
      else {
        onCreate(node)
        onCreate(connector)
      }
      onSelect([node.id])
      return
    }
    const root = buildMindmapRoot({
      x: pt.x,
      y: pt.y,
      objects,
      fill: noteFill,
      stroke,
    })
    onCreate(root)
    onSelect([root.id])
  }

  useEffect(() => {
    if (readOnly) return
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
        paintMarqueeRef.current(null)
        onSelect([])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [splinePts, onSelect, objects, stroke, strokeWidth, editing, tool, selectedIds, readOnly])

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const stage = stageRef.current
    if (!stage) return
    const pointer = stage.getPointerPosition()
    if (!pointer) return
    const tx = txRef.current
    const old = tx.scale
    const next = clamp(old * (e.evt.deltaY > 0 ? 0.92 : 1.08), MIN_SCALE, MAX_SCALE)
    const mouse = {
      x: (pointer.x - tx.x) / old,
      y: (pointer.y - tx.y) / old,
    }
    moveView({
      x: pointer.x - mouse.x * next,
      y: pointer.y - mouse.y * next,
      scale: next,
    })
    window.clearTimeout(wheelTimerRef.current)
    wheelTimerRef.current = window.setTimeout(commitView, 120)
  }

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const pt = pointerBoard()
    if (!pt) return
    const middle = e.evt.button === 1
    if (readOnly || space || middle) {
      setPanning(true)
      panRef.current = {
        x: txRef.current.x,
        y: txRef.current.y,
        px: e.evt.clientX,
        py: e.evt.clientY,
      }
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
    if (tool === 'mindmap') {
      if (e.target === e.target.getStage()) placeMindmap(pt)
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
      paintMarquee({ x: pt.x, y: pt.y, w: 0, h: 0 })
    }
  }

  const onMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const pt = pointerBoard()
    if (pt && !readOnly) {
      emitCursor(pt)
      hoverPtRef.current = pt
      if (tool === 'connector') {
        const hit = hitTop(pt.x, pt.y, objectsRef.current)
        const next = hit && hit.type !== 'connector' ? hit.id : null
        if (next !== hoverShapeIdRef.current) {
          hoverShapeIdRef.current = next
          setHoverShapeId(next)
        }
        paintPreviewRef.current()
      }
    }
    if (panning && panRef.current) {
      moveView({
        x: panRef.current.x + (e.evt.clientX - panRef.current.px),
        y: panRef.current.y + (e.evt.clientY - panRef.current.py),
        scale: txRef.current.scale,
      })
      return
    }
    if (readOnly) return
    if (marqueeRef.current && dragStart.current && pt) {
      paintMarquee({
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
      commitView()
    }
    const marquee = marqueeRef.current
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
      paintMarquee(null)
    }
    if (draft && tool !== 'spline') {
      finishDraft(draft)
    }
    dragStart.current = null
  }

  const onDblClick = () => {
    if (readOnly) return
    if (splinePts) commitSpline(splinePts)
  }

  const ensureMoving = (id: string) => {
    if (movingIdsRef.current) return movingIdsRef.current
    const objs = objectsRef.current
    const selected = selectedRef.current
    // Multi-select drag: move the whole selection (and each item's descendants).
    // Group members drag as the group; frames/lanes still move via moveSet(descendants).
    const ids =
      selected.includes(id) && selected.length > 1
        ? moveSet(selected, objs)
        : moveSet([groupRoot(id, objs)], objs)
    movingIdsRef.current = ids
    for (const mid of ids) {
      const o = objs[mid]
      if (o && !moveOrigin.current[mid]) moveOrigin.current[mid] = { x: o.x, y: o.y }
    }
    liftToDragLayer(ids)
    return ids
  }

  /** Draw moving shapes (and their connectors) on their own layer so the static notes paint once. */
  const liftToDragLayer = (ids: string[]) => {
    const content = contentLayerRef.current
    const dragLayer = dragLayerRef.current
    if (!content || !dragLayer || liftedRef.current.length) return
    const lift = new Set(ids)
    for (const id of ids) {
      for (const cid of connectorsByEndRef.current.get(id) ?? []) lift.add(cid)
    }
    const lifted: { node: Konva.Node; index: number }[] = []
    for (const child of content.getChildren()) {
      if (lift.has(child.id())) lifted.push({ node: child, index: child.zIndex() })
    }
    lifted.sort((a, b) => a.index - b.index)
    for (const { node } of lifted) node.moveTo(dragLayer)
    liftedRef.current = lifted
    content.batchDraw()
  }

  const dropFromDragLayer = () => {
    const content = contentLayerRef.current
    const lifted = liftedRef.current
    liftedRef.current = []
    if (!content || !lifted.length) return
    for (const { node, index } of lifted) {
      if (!node.getParent()) continue
      node.moveTo(content)
      node.zIndex(Math.min(index, content.getChildren().length - 1))
    }
    content.batchDraw()
    dragLayerRef.current?.batchDraw()
  }

  const clearDrag = () => {
    dropFromDragLayer()
    movingIdsRef.current = null
    livePosRef.current = {}
    dragNodesRef.current.clear()
    dragConnsRef.current.clear()
    draggingId.current = null
    moveOrigin.current = {}
    paintGuidesRef.current([])
  }

  const commitPatches = (patches: { id: string; path: string; value: unknown }[]) => {
    if (!patches.length) return
    const commit = onCommitRef.current
    if (commit) {
      commit(patches)
      return
    }
    for (const p of patches) onUpdateRef.current(p.id, p.path, p.value)
  }

  const paintMovedConnectors = (ids: string[], preview: Record<string, { x: number; y: number }>) => {
    const stage = stageRef.current
    const objs = objectsRef.current
    const seen = new Set<string>()
    for (const mid of ids) {
      const list = connectorsByEndRef.current.get(mid)
      if (!list) continue
      for (const cid of list) {
        if (seen.has(cid)) continue
        seen.add(cid)
        const conn = objs[cid]
        if (!conn) continue
        const pts = routeForConnector(conn, objs, preview)
        if (!pts) continue
        let nodes = dragConnsRef.current.get(cid)
        if (!nodes) {
          nodes = {
            route: (stage?.findOne('#route-' + cid) as Konva.Line | undefined) ?? null,
            head: (stage?.findOne('#head-' + cid) as Konva.Line | undefined) ?? null,
            label: (stage?.findOne('#label-' + cid) as Konva.Text | undefined) ?? null,
          }
          dragConnsRef.current.set(cid, nodes)
        }
        nodes.route?.points(pts)
        const head = arrowHeadPoints(pts, 10)
        if (nodes.head) {
          if (head) {
            nodes.head.visible(true)
            nodes.head.points(head)
          } else {
            nodes.head.visible(false)
          }
        }
        if (nodes.label) {
          const mid = polylineMidpoint(pts)
          nodes.label.position({ x: mid.x + 6, y: mid.y - 8 })
        }
      }
    }
  }

  const pickImpl = useRef<(id: string, shift: boolean) => void>(() => {})
  const changeImpl = useRef<(id: string, patch: Partial<BoardObject>) => void>(() => {})
  const liveImpl = useRef<(id: string, x: number, y: number) => void>(() => {})
  const editImpl = useRef<(id: string) => void>(() => {})

  pickImpl.current = (id, shift) => {
    const objs = objectsRef.current
    if (toolRef.current === 'connector') {
      const target = objs[id]
      if (!target || target.type === 'connector') {
        setConnectFrom(null)
        return
      }
      const pt = hoverPtRef.current ?? { x: target.x + target.w / 2, y: target.y + target.h / 2 }
      const port = nearestPort(target, pt)
      const from = connectFromRef.current
      if (!from) {
        previewPtsRef.current = []
        setConnectFrom({ id, side: port.side, offset: port.offset })
        return
      }
      finishConnect(from, { id, side: port.side, offset: port.offset })
      return
    }
    const pickId = shift ? id : groupRoot(id, objs)
    if (shift) {
      const next = selectedRef.current.includes(pickId)
        ? selectedRef.current.filter((x) => x !== pickId)
        : [...selectedRef.current, pickId]
      onSelectRef.current(next)
      return
    }
    if (selectedRef.current.includes(pickId) && selectedRef.current.length > 1) return
    if (selectedRef.current.includes(id) && selectedRef.current.length > 1) return
    onSelectRef.current([pickId])
  }

  changeImpl.current = (id, patch) => {
    const objs = objectsRef.current
    if ('x' in patch && 'y' in patch && !('w' in patch)) {
      const origin = moveOrigin.current[id] ?? { x: objs[id]?.x ?? 0, y: objs[id]?.y ?? 0 }
      const dragged = objs[id]
      const raw = { x: patch.x ?? 0, y: patch.y ?? 0 }
      const ids = movingIdsRef.current ?? ensureMoving(id)
      const exclude = new Set(ids)
      const snapped = snapBox(
        { x: raw.x, y: raw.y, w: dragged?.w ?? 1, h: dragged?.h ?? 1 },
        { enabled: snapEnabledRef.current, objects: objs, exclude, grid: GRID_SIZE },
      )
      const dx = snapped.x - origin.x
      const dy = snapped.y - origin.y
      const patches: { id: string; path: string; value: unknown }[] = []
      for (const mid of ids) {
        const start = moveOrigin.current[mid] ?? { x: objs[mid]?.x ?? 0, y: objs[mid]?.y ?? 0 }
        const nx = start.x + dx
        const ny = start.y + dy
        patches.push({ id: mid, path: 'x', value: nx }, { id: mid, path: 'y', value: ny })
        const o = objs[mid]
        if (!o || o.type === 'frame' || o.type === 'group' || o.type === 'connector') continue
        const nextParent = parentAfterMove(o, nx + o.w / 2, ny + o.h / 2, objs, exclude)
        if ((o.parentId ?? '') !== nextParent) patches.push({ id: mid, path: 'parentId', value: nextParent })
      }
      commitPatches(patches)
      clearDrag()
      return
    }
    if ('x' in patch && 'y' in patch && ('w' in patch || 'h' in patch)) {
      const exclude = new Set([id])
      const snapped = snapResizeBox(
        {
          x: patch.x ?? objs[id]?.x ?? 0,
          y: patch.y ?? objs[id]?.y ?? 0,
          w: patch.w ?? objs[id]?.w ?? 8,
          h: patch.h ?? objs[id]?.h ?? 8,
        },
        { enabled: snapEnabledRef.current, objects: objs, exclude, grid: GRID_SIZE },
      )
      const patches: { id: string; path: string; value: unknown }[] = [
        { id, path: 'x', value: snapped.box.x },
        { id, path: 'y', value: snapped.box.y },
        { id, path: 'w', value: snapped.box.w },
        { id, path: 'h', value: snapped.box.h },
      ]
      if ('rotation' in patch) patches.push({ id, path: 'rotation', value: patch.rotation })
      commitPatches(patches)
      paintGuidesRef.current([])
      return
    }
    const patches = Object.entries(patch).map(([path, value]) => ({ id, path, value }))
    commitPatches(patches)
  }

  liveImpl.current = (id, x, y) => {
    draggingId.current = id
    const objs = objectsRef.current
    const ids = ensureMoving(id)
    const origin = moveOrigin.current[id] ?? { x: objs[id]?.x ?? 0, y: objs[id]?.y ?? 0 }
    const dragged = objs[id]
    const exclude = new Set(ids)
    const snapped = snapBox(
      { x, y, w: dragged?.w ?? 1, h: dragged?.h ?? 1 },
      { enabled: snapEnabledRef.current, objects: objs, exclude, grid: GRID_SIZE },
    )
    paintGuidesRef.current(snapped.guides)
    const dx = snapped.x - origin.x
    const dy = snapped.y - origin.y
    const preview: Record<string, { x: number; y: number }> = {}
    const stage = stageRef.current
    for (const mid of ids) {
      const start = moveOrigin.current[mid] ?? { x: objs[mid]?.x ?? 0, y: objs[mid]?.y ?? 0 }
      const next = { x: start.x + dx, y: start.y + dy }
      preview[mid] = next
      let node = dragNodesRef.current.get(mid)
      if (!node) {
        const found = stage?.findOne('#' + mid)
        if (found) {
          node = found
          dragNodesRef.current.set(mid, found)
        }
      }
      node?.position(next)
    }
    livePosRef.current = preview
    paintMovedConnectors(ids, preview)
    refreshTransformer()

    const pt = pointerBoard()
    if (pt) emitCursor(pt)

    const now = performance.now()
    if (now - (lastPosSend.current[id] ?? 0) < 50) return
    lastPosSend.current[id] = now
    for (const mid of ids) {
      onLiveMoveRef.current(mid, preview[mid].x, preview[mid].y)
    }
  }

  editImpl.current = (id) => {
    const obj = objectsRef.current[id]
    if (!obj) return
    setEditing(id)
    setEditText(obj.text ?? '')
    onSelectRef.current([id])
  }

  const pickObject = useCallback((id: string, shift: boolean) => {
    pickImpl.current(id, shift)
  }, [])

  const handleChange = useCallback((id: string, patch: Partial<BoardObject>) => {
    changeImpl.current(id, patch)
  }, [])

  const handleLiveMove = useCallback((id: string, x: number, y: number) => {
    liveImpl.current(id, x, y)
  }, [])

  const startEdit = useCallback((id: string) => {
    editImpl.current(id)
  }, [])

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
          fontSize: noteFontPref(editObj),
          bold: editObj.bold,
          italic: editObj.italic,
        })
      : editObj?.type === 'text'
        ? bodyFontSize(editObj)
        : editObj
          ? titleFontSize(editObj)
          : 15
  const notePadTop = (() => {
    if (editObj?.type !== 'postit') return 0
    const box = noteTextBox(editObj.w, editObj.h)
    const textH = measureNoteTextHeight(
      editText || ' ',
      box.width,
      liveFont,
      objectFontFamily(editObj),
      konvaFontStyle(editObj),
    )
    return Math.max(0, (box.height - textH) / 2)
  })()
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
        paddingTop: notePadTop * scale,
      }
    : null

  const gridSize = GRID_SIZE * scale
  const gridPos = `${pos.x}px ${pos.y}px`
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
  const nodeListening =
    readOnly
      ? false
      : tool === 'select' || tool === 'connector' || tool === 'mindmap'
        ? !space && !editing
        : false
  const nodeDraggable = !readOnly && tool === 'select' && !space && !editing

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full overflow-hidden"
      style={{
        cursor: readOnly || space || panning ? 'grab' : tool === 'select' ? 'default' : 'crosshair',
        backgroundColor: theme.bg,
        backgroundImage: `radial-gradient(${theme.grid} 1px, transparent 1px)`,
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: gridPos,
      }}
      onDragOver={(e) => {
        if (readOnly || !onImages) return
        if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(e) => {
        if (readOnly || !onImages) return
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
        <Layer ref={contentLayerRef}>
          {visible.map((obj) => (
            <ObjectNode
              key={obj.id}
              obj={obj}
              objects={objects}
              selected={selectedIds.includes(obj.id)}
              listening={nodeListening}
              draggable={nodeDraggable}
              theme={theme}
              editing={editing === obj.id}
              lod={nodeLod(obj, scale)}
              fontEpoch={fontEpoch}
              onSelect={pickObject}
              onChange={handleChange}
              onLiveMove={handleLiveMove}
              onEditText={startEdit}
              onLiveTransform={refreshTransformer}
            />
          ))}
        </Layer>
        <Layer ref={dragLayerRef} />
        <Layer>
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
          <Rect
            ref={marqueeNodeRef}
            visible={false}
            fill={theme.selectFill}
            stroke={theme.select}
            listening={false}
          />
          {connectFrom && !readOnly && (
            <Line
              ref={previewLineRef}
              points={previewPtsRef.current}
              visible={previewPtsRef.current.length >= 4}
              stroke={theme.select}
              strokeWidth={2}
              dash={[8, 6]}
              listening={false}
              lineJoin="round"
              lineCap="round"
            />
          )}
          {!readOnly && (
            <ConnectorOverlay
              objects={objects}
              theme={theme}
              scale={tool === 'connector' || selectedConnectorId ? scale : 1}
              tool={tool}
              portShapeIds={portShapeIds}
              connectFrom={connectFrom}
              selectedConnectorId={tool === 'select' ? selectedConnectorId : null}
              onPortClick={handlePortClick}
              onUpdate={onUpdate}
              onRewire={handleRewire}
            />
          )}
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
              if (!snapEnabledRef.current || !selectedId) return box
              const snapped = snapResizeBox(
                { x: box.x, y: box.y, w: box.width, h: box.height },
                {
                  enabled: true,
                  objects,
                  exclude: new Set([selectedId]),
                  grid: GRID_SIZE,
                },
              )
              paintGuidesRef.current(snapped.guides)
              return {
                ...box,
                x: snapped.box.x,
                y: snapped.box.y,
                width: snapped.box.w,
                height: snapped.box.h,
              }
            }}
            onTransformEnd={() => paintGuidesRef.current([])}
            borderStroke={theme.select}
            anchorStroke={theme.select}
            anchorFill={theme.paper}
          />
          <Line
            ref={guideVRef}
            points={guideDrawRef.current.vPts}
            visible={guideDrawRef.current.vOn}
            stroke={theme.select}
            strokeWidth={Math.max(1, 1 / scale)}
            dash={[6 / scale, 4 / scale]}
            listening={false}
          />
          <Line
            ref={guideHRef}
            points={guideDrawRef.current.hPts}
            visible={guideDrawRef.current.hOn}
            stroke={theme.select}
            strokeWidth={Math.max(1, 1 / scale)}
            dash={[6 / scale, 4 / scale]}
            listening={false}
          />
        </Layer>
        <Layer listening={false}>
          <AttachmentsLayer objects={withAttachments} theme={theme} />
          <RemoteCursors cursors={cursors} />
        </Layer>
      </Stage>
      {editObj?.type === 'postit' && editStyle && !editText && (
        // Native textarea placeholders ignore text-align/padding in some browsers (Safari).
        <div
          aria-hidden
          className="pointer-events-none absolute z-20 flex items-center"
          style={{
            ...editStyle,
            paddingTop: 0,
            justifyContent:
              objectTextAlign(editObj) === 'center'
                ? 'center'
                : objectTextAlign(editObj) === 'right'
                  ? 'flex-end'
                  : 'flex-start',
            fontFamily: objectFontFamily(editObj),
            fontWeight: cssFontWeight(editObj),
            fontStyle: editObj.italic ? 'italic' : 'normal',
            lineHeight: NOTE_LINE_HEIGHT,
            textAlign: objectTextAlign(editObj),
            color: theme.muted,
            whiteSpace: 'pre-wrap',
            transform: editObj.rotation ? `rotate(${editObj.rotation}deg)` : undefined,
            transformOrigin: 'top left',
          }}
        >
          Write a note…
        </div>
      )}
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
              ? undefined
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
  if (draft.type === 'roundrect') {
    const r = Math.min(16, Math.min(draft.w, draft.h) / 2)
    return (
      <Rect
        x={draft.x}
        y={draft.y}
        width={draft.w}
        height={draft.h}
        cornerRadius={r}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        opacity={0.85}
        listening={false}
      />
    )
  }
  if (draft.type === 'cylinder') {
    const ry = Math.min(draft.h * 0.16, draft.w * 0.22)
    const rx = draft.w / 2
    const topY = draft.y + ry
    const botY = draft.y + draft.h - ry
    return (
      <>
        <Rect
          x={draft.x}
          y={topY}
          width={draft.w}
          height={Math.max(4, botY - topY)}
          fill={fill}
          strokeEnabled={false}
          opacity={0.85}
          listening={false}
        />
        <Ellipse
          x={draft.x + rx}
          y={botY}
          radiusX={rx}
          radiusY={ry}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={0.85}
          listening={false}
        />
        <Ellipse
          x={draft.x + rx}
          y={topY}
          radiusX={rx}
          radiusY={ry}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={0.85}
          listening={false}
        />
        <Line
          points={[draft.x, topY, draft.x, botY]}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={0.85}
          listening={false}
        />
        <Line
          points={[draft.x + draft.w, topY, draft.x + draft.w, botY]}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={0.85}
          listening={false}
        />
      </>
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

function connectorCullBox(o: BoardObject, objects: Record<string, BoardObject>) {
  const from = o.fromId ? objects[o.fromId] : undefined
  const to = o.toId ? objects[o.toId] : undefined
  if (!from || !to) return null
  const a = objectAABB(from)
  const b = objectAABB(to)
  let minX = Math.min(a.x, b.x)
  let minY = Math.min(a.y, b.y)
  let maxX = Math.max(a.x + a.w, b.x + b.w)
  let maxY = Math.max(a.y + a.h, b.y + b.h)
  const wp = o.points
  if (wp) {
    for (let i = 0; i + 1 < wp.length; i += 2) {
      minX = Math.min(minX, wp[i])
      maxX = Math.max(maxX, wp[i])
      minY = Math.min(minY, wp[i + 1])
      maxY = Math.max(maxY, wp[i + 1])
    }
  }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) }
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

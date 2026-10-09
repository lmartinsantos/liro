import type Konva from 'konva'
import { memo, useRef, useState } from 'react'
import { Circle, Ellipse, Group, Line, Rect, Shape, Text } from 'react-konva'
import { arrowHeadPoints, polylineMidpoint, routeForConnector } from '@/lib/connectors'
import { type CanvasTheme } from '@/lib/canvasTheme'
import {
  bodyFontSize,
  displayNoteFontSize,
  konvaFontStyle,
  NOTE_LINE_HEIGHT,
  NOTE_PAD,
  noteFontPref,
  objectFontFamily,
  objectTextAlign,
  titleFontSize,
} from '@/lib/textStyle'
import type { BoardObject } from '@/lib/types'
import { BoardImage } from './BoardImage'
import { type NodeLod, polygonFor, roundrectRadius } from './shapeGeom'

type LivePos = Record<string, { x: number; y: number; w?: number; h?: number }>

type Props = {
  obj: BoardObject
  objects: Record<string, BoardObject>
  selected: boolean
  listening: boolean
  draggable?: boolean
  theme: CanvasTheme
  editing?: boolean
  lod?: NodeLod
  /** Changes when web fonts load; remounts text so Konva re-measures. */
  fontEpoch?: number
  preview?: { x: number; y: number }
  livePos?: LivePos
  onSelect: (id: string, shift: boolean) => void
  onChange: (id: string, patch: Partial<BoardObject>) => void
  onLiveMove: (id: string, x: number, y: number) => void
  onEditText: (id: string) => void
  onLiveTransform?: () => void
}

function samePreview(
  a?: { x: number; y: number },
  b?: { x: number; y: number },
) {
  if (a === b) return true
  if (!a || !b) return !a && !b
  return a.x === b.x && a.y === b.y
}

function endpointKey(objects: Record<string, BoardObject>, id: string | undefined, livePos?: LivePos) {
  if (!id) return ''
  const o = objects[id]
  if (!o) return ''
  const live = livePos?.[id]
  const x = live?.x ?? o.x
  const y = live?.y ?? o.y
  const w = live?.w ?? o.w
  const h = live?.h ?? o.h
  return `${x},${y},${w},${h},${o.rotation}`
}

function objectPropsEqual(prev: Props, next: Props) {
  if (prev.obj !== next.obj) return false
  if (prev.selected !== next.selected) return false
  if (prev.listening !== next.listening) return false
  if (prev.draggable !== next.draggable) return false
  if (prev.theme !== next.theme) return false
  if (prev.editing !== next.editing) return false
  if (prev.lod !== next.lod) return false
  if (prev.fontEpoch !== next.fontEpoch) return false
  if (!samePreview(prev.preview, next.preview)) return false
  if (prev.onSelect !== next.onSelect) return false
  if (prev.onChange !== next.onChange) return false
  if (prev.onLiveMove !== next.onLiveMove) return false
  if (prev.onEditText !== next.onEditText) return false
  if (prev.onLiveTransform !== next.onLiveTransform) return false
  if (next.obj.type === 'connector') {
    if (endpointKey(prev.objects, prev.obj.fromId, prev.livePos) !== endpointKey(next.objects, next.obj.fromId, next.livePos)) {
      return false
    }
    if (endpointKey(prev.objects, prev.obj.toId, prev.livePos) !== endpointKey(next.objects, next.obj.toId, next.livePos)) {
      return false
    }
  }
  return true
}

function ObjectNodeInner({
  obj,
  objects,
  selected,
  listening,
  draggable: draggableProp,
  theme,
  editing,
  lod = 'full',
  fontEpoch,
  preview,
  livePos,
  onSelect,
  onChange,
  onLiveMove,
  onEditText,
  onLiveTransform,
}: Props) {
  const groupRef = useRef<Konva.Group>(null)
  const noteLive = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const noteShadowRef = useRef<Konva.Rect>(null)
  const noteBodyRef = useRef<Konva.Rect>(null)
  const noteBarRef = useRef<Konva.Rect>(null)
  const noteTextRef = useRef<Konva.Text>(null)
  // React mirror of live box so parent re-renders don't snap attrs; Konva is updated imperatively first.
	const [noteBox, setNoteBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [liveCornerRadius, setLiveCornerRadius] = useState<number | null>(null)
  const path = obj.type === 'line' || obj.type === 'spline'
  const poly = polygonFor(obj.type, obj.w, obj.h)
  const canDrag = (draggableProp ?? listening) && !editing && obj.type !== 'connector'
  const cornerR =
    obj.type === 'roundrect'
      ? (liveCornerRadius ?? roundrectRadius(obj.w, obj.h, obj.cornerRadius))
      : 0
  const noteW = obj.type === 'postit' ? (noteBox?.w ?? obj.w) : obj.w
  const noteH = obj.type === 'postit' ? (noteBox?.h ?? obj.h) : obj.h

  const applyNoteBox = (box: { w: number; h: number }) => {
    noteShadowRef.current?.width(box.w)
    noteShadowRef.current?.height(box.h)
    noteBodyRef.current?.width(box.w)
    noteBodyRef.current?.height(box.h)
    noteBarRef.current?.width(box.w)
    const textNode = noteTextRef.current
    if (textNode) {
      const font = displayNoteFontSize({
        w: box.w,
        h: box.h,
        text: obj.text || '',
        fontFamily: objectFontFamily(obj),
        fontSize: noteFontPref(obj),
        bold: obj.bold,
        italic: obj.italic,
      })
      textNode.width(box.w - NOTE_PAD.xTotal)
      textNode.height(box.h - NOTE_PAD.yTotal)
      textNode.fontSize(font)
    }
  }

  const commitTransform = (node: Konva.Group) => {
    if (obj.type === 'postit') {
      const box = noteLive.current
      node.scaleX(1)
      node.scaleY(1)
      noteLive.current = null
      setNoteBox(null)
      onChange(obj.id, {
        x: node.x(),
        y: node.y(),
        w: box?.w ?? obj.w,
        h: box?.h ?? obj.h,
        rotation: node.rotation(),
      })
      return
    }
    const w = Math.max(8, obj.w * (node.scaleX() || 1))
    const h = Math.max(8, obj.h * (node.scaleY() || 1))
    node.scaleX(1)
    node.scaleY(1)
    onChange(obj.id, {
      x: node.x(),
      y: node.y(),
      w,
      h,
      rotation: node.rotation(),
    })
  }

  const pick = (e: Konva.KonvaEventObject<MouseEvent | Event>) => {
    e.cancelBubble = true
    const shift = 'shiftKey' in e.evt ? e.evt.shiftKey : false
    onSelect(obj.id, shift)
  }

  if (obj.type === 'connector') {
    const pts = routeForConnector(obj, objects, livePos)
    if (!pts || pts.length < 4) return null
    const mid = polylineMidpoint(pts)
    const head = arrowHeadPoints(pts, 10)
    const color = selected ? theme.select : obj.stroke || theme.ink
    return (
      <Group id={obj.id} listening={listening} onClick={pick} onTap={pick}>
        <Line
          id={`route-${obj.id}`}
          points={pts}
          stroke={color}
          strokeWidth={obj.strokeWidth || 2}
          lineJoin="round"
          lineCap="round"
          hitStrokeWidth={18}
        />
        {head ? (
          <Line
            id={`head-${obj.id}`}
            points={head}
            closed
            fill={color}
            stroke={color}
            strokeWidth={1}
            listening={false}
          />
        ) : null}
        {obj.text && !editing ? (
          <Text
            id={`label-${obj.id}`}
            x={mid.x + 6}
            y={mid.y - 8}
            text={obj.text}
            fill={theme.ink}
            fontFamily={objectFontFamily(obj)}
            fontSize={12}
            fontStyle={konvaFontStyle(obj)}
            listening={false}
          />
        ) : null}
      </Group>
    )
  }

  return (
    <Group
      id={obj.id}
      ref={groupRef}
      x={noteBox?.x ?? preview?.x ?? obj.x}
      y={noteBox?.y ?? preview?.y ?? obj.y}
      rotation={obj.rotation}
      draggable={canDrag}
      listening={listening}
      onClick={pick}
      onTap={pick}
      onDblClick={(e) => {
        e.cancelBubble = true
        if (obj.type === 'postit' || obj.type === 'text' || obj.type === 'frame' || obj.type === 'lane' || obj.type === 'connector') {
          onEditText(obj.id)
        }
      }}
      onDragMove={(e) => {
        onLiveMove(obj.id, e.target.x(), e.target.y())
      }}
      onDragEnd={(e) => {
        onChange(obj.id, { x: e.target.x(), y: e.target.y() })
      }}
      onTransform={() => {
        if (obj.type !== 'postit') return
        const node = groupRef.current
        if (!node) return
        const prev = noteLive.current ?? { x: obj.x, y: obj.y, w: obj.w, h: obj.h }
        const next = {
          x: node.x(),
          y: node.y(),
          w: Math.max(32, prev.w * (node.scaleX() || 1)),
          h: Math.max(32, prev.h * (node.scaleY() || 1)),
        }
        node.scaleX(1)
        node.scaleY(1)
        noteLive.current = next
        applyNoteBox(next)
        node.getLayer()?.batchDraw()
        onLiveTransform?.()
        setNoteBox(next)
      }}
      onTransformEnd={() => {
        const node = groupRef.current
        if (node) commitTransform(node)
      }}
    >
      {obj.type === 'rect' && (
        <Rect
          width={obj.w}
          height={obj.h}
          fill={obj.fill}
          stroke={obj.stroke}
          strokeWidth={obj.strokeWidth}
          perfectDrawEnabled={false}
        />
      )}
      {obj.type === 'roundrect' && (
        <>
          <Rect
            width={obj.w}
            height={obj.h}
            cornerRadius={cornerR}
            fill={obj.fill}
            stroke={obj.stroke}
            strokeWidth={obj.strokeWidth}
            perfectDrawEnabled={false}
          />
          {selected && listening && (
            <Circle
              x={cornerR}
              y={0}
              radius={7}
              fill={theme.paper}
              stroke={theme.select}
              strokeWidth={1.5}
              draggable
              dragBoundFunc={(pos) => {
                const max = Math.min(obj.w, obj.h) / 2
                return { x: Math.max(0, Math.min(max, pos.x)), y: 0 }
              }}
              onMouseDown={(e) => {
                e.cancelBubble = true
              }}
              onTouchStart={(e) => {
                e.cancelBubble = true
              }}
              onDragStart={(e) => {
                e.cancelBubble = true
              }}
              onDragMove={(e) => {
                e.cancelBubble = true
                const max = Math.min(obj.w, obj.h) / 2
                const r = Math.max(0, Math.min(max, e.target.x()))
                e.target.x(r)
                e.target.y(0)
                setLiveCornerRadius(r)
              }}
              onDragEnd={(e) => {
                e.cancelBubble = true
                const max = Math.min(obj.w, obj.h) / 2
                const r = Math.max(0, Math.min(max, e.target.x()))
                setLiveCornerRadius(null)
                onChange(obj.id, { cornerRadius: r })
              }}
            />
          )}
        </>
      )}
      {obj.type === 'ellipse' && (
        <Ellipse
          x={obj.w / 2}
          y={obj.h / 2}
          radiusX={obj.w / 2}
          radiusY={obj.h / 2}
          fill={obj.fill}
          stroke={obj.stroke}
          strokeWidth={obj.strokeWidth}
          perfectDrawEnabled={false}
        />
      )}
      {obj.type === 'cylinder' && (() => {
        // Standing cylinder (side elevation): elliptical top cap, body, bottom front arc.
        const ry = Math.min(obj.h * 0.16, obj.w * 0.22)
        const rx = obj.w / 2
        const topY = ry
        const botY = obj.h - ry
        return (
          <>
            <Rect
              y={topY}
              width={obj.w}
              height={Math.max(4, botY - topY)}
              fill={obj.fill}
              strokeEnabled={false}
            />
            <Line
              points={[0, topY, 0, botY]}
              stroke={obj.stroke}
              strokeWidth={obj.strokeWidth}
            />
            <Line
              points={[obj.w, topY, obj.w, botY]}
              stroke={obj.stroke}
              strokeWidth={obj.strokeWidth}
            />
            <Shape
              sceneFunc={(ctx, shape) => {
                ctx.beginPath()
                ctx.ellipse(rx, botY, rx, ry, 0, 0, Math.PI, false)
                ctx.fillStrokeShape(shape)
              }}
              fill={obj.fill}
              stroke={obj.stroke}
              strokeWidth={obj.strokeWidth}
            />
            <Ellipse
              x={rx}
              y={topY}
              radiusX={rx}
              radiusY={ry}
              fill={obj.fill}
              stroke={obj.stroke}
              strokeWidth={obj.strokeWidth}
            />
          </>
        )
      })()}
      {obj.type === 'postit' && (
        <>
          {lod === 'full' && (
            <Rect
              ref={noteShadowRef}
              y={3}
              width={noteW}
              height={noteH}
              fill={theme.postitShadow}
              cornerRadius={8}
              perfectDrawEnabled={false}
              listening={false}
            />
          )}
          <Rect
            ref={noteBodyRef}
            width={noteW}
            height={noteH}
            fill={obj.fill}
            stroke={selected ? obj.stroke : 'rgba(0,0,0,0.08)'}
            strokeWidth={1}
            cornerRadius={8}
            perfectDrawEnabled={false}
          />
          {lod === 'full' && (
            <Rect
              ref={noteBarRef}
              width={noteW}
              height={8}
              fill="rgba(0,0,0,0.06)"
              perfectDrawEnabled={false}
              listening={false}
            />
          )}
          {!editing && lod === 'full' && (
            <Text
              key={fontEpoch}
              ref={noteTextRef}
              x={NOTE_PAD.x}
              y={NOTE_PAD.y}
              width={noteW - NOTE_PAD.xTotal}
              height={noteH - NOTE_PAD.yTotal}
              text={obj.text || 'Write a note…'}
              fill={obj.text ? '#1e2a4a' : theme.muted}
              fontFamily={objectFontFamily(obj)}
              fontSize={displayNoteFontSize({
                w: noteW,
                h: noteH,
                text: obj.text || '',
                fontFamily: objectFontFamily(obj),
                fontSize: noteFontPref(obj),
                bold: obj.bold,
                italic: obj.italic,
              })}
              fontStyle={konvaFontStyle(obj)}
              align={objectTextAlign(obj)}
              verticalAlign="middle"
              lineHeight={NOTE_LINE_HEIGHT}
              wrap="word"
              listening={false}
            />
          )}
        </>
      )}
      {obj.type === 'text' && (
        <>
          <Rect width={obj.w} height={obj.h} fill="transparent" />
          {!editing && (
            <Text
              key={fontEpoch}
              width={obj.w}
              height={obj.h}
              text={obj.text || 'Type something…'}
              fill={obj.text ? obj.fill || theme.ink : theme.muted}
              fontFamily={objectFontFamily(obj)}
              fontSize={bodyFontSize(obj)}
              fontStyle={konvaFontStyle(obj)}
              align={objectTextAlign(obj)}
              wrap="word"
              listening={false}
            />
          )}
        </>
      )}
      {obj.type === 'sticker' && (
        <>
          <Rect width={obj.w} height={obj.h} fill="transparent" />
          {/* Unconstrained Text: boxed width + fontSize=min(w,h) makes Konva drop/clip emojis */}
          <Text
            x={(obj.w - Math.min(obj.w, obj.h)) / 2}
            y={(obj.h - Math.min(obj.w, obj.h)) / 2}
            text={obj.text || '⭐'}
            fontSize={Math.min(obj.w, obj.h)}
            listening={false}
          />
        </>
      )}
      {obj.type === 'frame' && (
        <>
          <Rect
            width={obj.w}
            height={obj.h}
            fill={obj.fill || theme.frame}
            stroke={selected ? theme.select : obj.stroke || theme.frameStroke}
            strokeWidth={1.5}
            cornerRadius={16}
            perfectDrawEnabled={false}
          />
          <Rect width={obj.w} height={28} fill={theme.bar} cornerRadius={[16, 16, 0, 0]} />
          {!editing && (
            <Text
              x={10}
              y={6}
              width={obj.w - 20}
              text={obj.text || 'Frame'}
              fill={theme.ink}
              fontFamily={objectFontFamily(obj)}
              fontSize={titleFontSize(obj)}
              fontStyle={obj.italic ? 'italic bold' : 'bold'}
              listening={false}
            />
          )}
        </>
      )}
      {obj.type === 'lane' &&
        (obj.dir === 'v' ? (
          <>
            <Rect
              width={obj.w}
              height={obj.h}
              fill={obj.fill || theme.frame}
              stroke={selected ? theme.select : obj.stroke || theme.frameStroke}
              strokeWidth={1}
              cornerRadius={12}
              perfectDrawEnabled={false}
            />
            <Rect width={obj.w} height={28} fill={theme.bar} cornerRadius={[12, 12, 0, 0]} />
            {!editing && (
              <Text
                x={8}
                y={6}
                width={obj.w - 16}
                text={obj.text || 'Lane'}
                fill={theme.ink}
                fontFamily={objectFontFamily(obj)}
                fontSize={titleFontSize(obj)}
                fontStyle={konvaFontStyle({ bold: obj.bold ?? false, italic: obj.italic })}
                listening={false}
              />
            )}
          </>
        ) : (
          <>
            <Rect
              width={obj.w}
              height={obj.h}
              fill={obj.fill || theme.frame}
              stroke={selected ? theme.select : obj.stroke || theme.frameStroke}
              strokeWidth={1}
              cornerRadius={12}
              perfectDrawEnabled={false}
            />
            <Rect width={28} height={obj.h} fill={theme.bar} cornerRadius={[12, 0, 0, 12]} />
            {!editing && (
              <Text
                x={6}
                y={obj.h / 2}
                rotation={-90}
                offsetX={0}
                offsetY={0}
                text={obj.text || 'Lane'}
                fill={theme.ink}
                fontFamily={objectFontFamily(obj)}
                fontSize={titleFontSize(obj)}
                fontStyle={konvaFontStyle({ bold: obj.bold ?? false, italic: obj.italic })}
                listening={false}
              />
            )}
          </>
        ))}
      {obj.type === 'group' && (
        <Rect
          width={obj.w}
          height={obj.h}
          fill={theme.groupFill}
          stroke={selected ? theme.select : theme.frameStroke}
          strokeWidth={1}
          dash={[6, 4]}
        />
      )}
      {obj.type === 'image' && (
        <BoardImage src={obj.src} width={obj.w} height={obj.h} theme={theme} />
      )}
      {path && (
        <Line
          points={obj.points ?? [0, 0, obj.w, obj.h]}
          stroke={obj.stroke}
          strokeWidth={obj.strokeWidth}
          lineCap="round"
          lineJoin="round"
          tension={obj.type === 'spline' ? 0.45 : 0}
          hitStrokeWidth={16}
        />
      )}
      {poly && (
        <Line
          points={poly}
          closed
          fill={obj.fill}
          stroke={obj.stroke}
          strokeWidth={obj.strokeWidth}
          lineJoin="round"
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  )
}

export const ObjectNode = memo(ObjectNodeInner, objectPropsEqual)

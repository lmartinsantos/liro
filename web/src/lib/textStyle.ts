import { useSyncExternalStore } from 'react'
import { CANVAS_FONT } from '@/lib/canvasTheme'
import type { BoardObject } from '@/lib/types'

export const TEXT_FONTS = [
  { id: CANVAS_FONT, label: 'Jakarta' },
  { id: 'ui-sans-serif, system-ui, sans-serif', label: 'Sans' },
  { id: 'Georgia, "Times New Roman", serif', label: 'Serif' },
  { id: 'ui-monospace, SFMono-Regular, Menlo, monospace', label: 'Mono' },
] as const

export const TEXT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64]

/** Padding around postit body text (matches Konva Text + edit overlay). */
export const NOTE_PAD = {
  x: 10,
  y: 16,
  /** Horizontal inset total (left + right). */
  xTotal: 20,
  /** Vertical inset total (top bar + bottom). */
  yTotal: 26,
} as const

export const NOTE_LINE_HEIGHT = 1.25
export const NOTE_FONT_MIN = 10
export const NOTE_FONT_MAX = 96
const NOTE_REF_SIDE = 160
const NOTE_REF_FONT = 22
/** Auto-size cap as a fraction of the note's shorter side. */
const NOTE_AUTO_RATIO = 0.4
const NOTE_AUTO_MAX = 480

export function objectFontFamily(obj: Pick<BoardObject, 'fontFamily'>) {
  return obj.fontFamily || CANVAS_FONT
}

export function konvaFontStyle(obj: Pick<BoardObject, 'bold' | 'italic'>) {
  if (obj.bold && obj.italic) return 'bold italic'
  if (obj.bold) return 'bold'
  if (obj.italic) return 'italic'
  return 'normal'
}

export function cssFontWeight(obj: Pick<BoardObject, 'bold'>) {
  return obj.bold ? 700 : 400
}

/** Notes created before auto-fit stored the old shared defaults (20px, left); render them as auto + centered. */
export function isLegacyNoteStyle(obj: Partial<Pick<BoardObject, 'type' | 'fontSize' | 'textAlign'>>) {
  return obj.type === 'postit' && obj.fontSize === 20 && obj.textAlign === 'left'
}

/** Note font preference; undefined means auto-fit. */
export function noteFontPref(obj: Pick<BoardObject, 'type' | 'fontSize' | 'textAlign'>) {
  return isLegacyNoteStyle(obj) ? undefined : obj.fontSize || undefined
}

export function objectTextAlign(obj: Pick<BoardObject, 'textAlign'> & Partial<Pick<BoardObject, 'type' | 'fontSize'>>) {
  if (isLegacyNoteStyle(obj)) return 'center'
  if (obj.textAlign === 'left' || obj.textAlign === 'center' || obj.textAlign === 'right') return obj.textAlign
  return obj.type === 'postit' ? 'center' : 'left'
}

function noteSide(w: number, h: number) {
  return Math.max(1, Math.min(w, h))
}

/**
 * Preferred type size scaled with the note box.
 * `fontSize` is the preferred size at NOTE_REF_SIDE (default 22); it grows/shrinks with the note.
 */
export function noteFontSize(obj: Pick<BoardObject, 'w' | 'h' | 'fontSize'>) {
  const preferredAtRef = obj.fontSize || NOTE_REF_FONT
  const scale = noteSide(obj.w, obj.h) / NOTE_REF_SIDE
  return Math.max(NOTE_FONT_MIN, Math.min(NOTE_FONT_MAX, preferredAtRef * scale))
}

/** Persist a chosen on-screen size as fontSize at the reference side. */
export function noteStoredFontSize(desiredPx: number, w: number, h: number) {
  const scale = noteSide(w, h) / NOTE_REF_SIDE
  return Math.max(NOTE_FONT_MIN, Math.min(NOTE_FONT_MAX, desiredPx / scale))
}

export function noteTextBox(w: number, h: number) {
  return {
    width: Math.max(1, w - NOTE_PAD.xTotal),
    height: Math.max(1, h - NOTE_PAD.yTotal),
  }
}

type FitNoteArgs = {
  w: number
  h: number
  text: string
  fontFamily?: string
  fontSize?: number
  bold?: boolean
  italic?: boolean
}

let measureCtx: CanvasRenderingContext2D | null = null

function getMeasureCtx() {
  if (typeof document === 'undefined') return null
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d')
  }
  return measureCtx
}

/** Word-wrap height estimate aligned with Konva/CSS `word` wrap + lineHeight. */
export function measureNoteTextHeight(
  text: string,
  maxWidth: number,
  fontSize: number,
  fontFamily: string,
  fontStyle: string,
  lineHeight = NOTE_LINE_HEIGHT,
) {
  const ctx = getMeasureCtx()
  if (!ctx || maxWidth <= 0 || fontSize <= 0) {
    return fontSize * lineHeight
  }
  ctx.font = `${fontStyle} ${fontSize}px ${fontFamily}`
  const paragraphs = text.length ? text.split('\n') : ['']
  let lines = 0
  for (const para of paragraphs) {
    if (!para) {
      lines += 1
      continue
    }
    const words = para.split(/\s+/)
    let line = ''
    for (const word of words) {
      if (!word) continue
      const next = line ? `${line} ${word}` : word
      if (ctx.measureText(next).width <= maxWidth) {
        line = next
        continue
      }
      if (line) lines += 1
      if (ctx.measureText(word).width <= maxWidth) {
        line = word
        continue
      }
      // Break oversized words.
      let rest = word
      while (rest) {
        let cut = 1
        while (cut < rest.length && ctx.measureText(rest.slice(0, cut + 1)).width <= maxWidth) {
          cut += 1
        }
        lines += 1
        rest = rest.slice(cut)
      }
      line = ''
    }
    if (line) lines += 1
  }
  return Math.max(1, lines) * fontSize * lineHeight
}

/**
 * Auto (no fontSize): largest size that fits the padded box, capped relative to the note side.
 * Explicit fontSize: preferred size scaled with the note, shrunk to fit.
 * Empty notes size against the placeholder so canvas and edit overlay match.
 */
export function fitNoteFontSize({
  w,
  h,
  text,
  fontFamily,
  fontSize,
  bold,
  italic,
}: FitNoteArgs) {
  const max = fontSize ? NOTE_FONT_MAX : NOTE_AUTO_MAX
  const base = fontSize
    ? noteFontSize({ w, h, fontSize })
    : Math.max(NOTE_FONT_MIN, Math.min(max, noteSide(w, h) * NOTE_AUTO_RATIO))
  const { width: boxW, height: boxH } = noteTextBox(w, h)
  const family = fontFamily || CANVAS_FONT
  const style = konvaFontStyle({ bold, italic })
  const sample = text.trim() ? text : 'Write a note…'

  // Slack so Konva's own wrap never drops a last line our estimate thought fit.
  const fits = (size: number) =>
    measureNoteTextHeight(sample, boxW - 2, size, family, style) <= boxH - 1

  if (fits(base)) return base

  let lo = NOTE_FONT_MIN
  let hi = base
  let best = NOTE_FONT_MIN
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2
    if (fits(mid)) {
      best = mid
      lo = mid
    } else {
      hi = mid
    }
  }
  return Math.max(NOTE_FONT_MIN, Math.min(max, best))
}

const noteFontCache = new Map<string, number>()
const NOTE_FONT_CACHE_MAX = 4000

let fontEpoch = 0
const fontListeners = new Set<() => void>()

function bumpFontEpoch() {
  noteFontCache.clear()
  fontEpoch += 1
  for (const l of fontListeners) l()
}

if (typeof document !== 'undefined' && document.fonts) {
  // Web fonts swap in after first paint; sizes measured with the fallback font are wrong.
  document.fonts.addEventListener('loadingdone', bumpFontEpoch)
  void Promise.all([
    document.fonts.load(`400 16px ${CANVAS_FONT}`),
    document.fonts.load(`700 16px ${CANVAS_FONT}`),
  ])
    .catch(() => undefined)
    .then(bumpFontEpoch)
}

/** Increments whenever web fonts finish loading; key canvas text on it to re-measure. */
export function useFontEpoch() {
  return useSyncExternalStore(
    (cb) => {
      fontListeners.add(cb)
      return () => fontListeners.delete(cb)
    },
    () => fontEpoch,
    () => 0,
  )
}

/** Scale with the note box, then shrink so wrapped text fits the padded area. */
export function displayNoteFontSize(args: FitNoteArgs) {
  const w = Math.round(args.w)
  const h = Math.round(args.h)
  const key = `${w}\0${h}\0${args.fontSize ?? ''}\0${args.bold ? 1 : 0}${args.italic ? 1 : 0}\0${args.fontFamily ?? ''}\0${args.text}`
  const hit = noteFontCache.get(key)
  if (hit !== undefined) return hit
  const size = fitNoteFontSize({ ...args, w, h })
  if (noteFontCache.size >= NOTE_FONT_CACHE_MAX) {
    const oldest = noteFontCache.keys().next().value
    if (oldest !== undefined) noteFontCache.delete(oldest)
  }
  noteFontCache.set(key, size)
  return size
}

export function titleFontSize(obj: BoardObject) {
  return obj.fontSize || Math.max(11, Math.min(18, obj.h * 0.08, obj.w * 0.06))
}

export function bodyFontSize(obj: BoardObject) {
  if (obj.fontSize) return obj.fontSize
  return Math.max(14, Math.min(96, obj.h * 0.72))
}

export function isTexty(type: BoardObject['type']) {
  return type === 'postit' || type === 'text' || type === 'frame' || type === 'lane' || type === 'connector'
}

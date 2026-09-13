import { useTheme } from '@/lib/theme'

export const CANVAS_FONT = 'Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif'
export const DEFAULT_FILL = '#93c5fd'
export const POSTIT_FILL = '#fef08a'

export type CanvasTheme = {
  bg: string
  grid: string
  select: string
  selectFill: string
  ink: string
  muted: string
  frame: string
  frameStroke: string
  groupFill: string
  bar: string
  paper: string
  postitShadow: string
  comment: string
  linkBg: string
  linkFg: string
  defaultStroke: string
}

export const canvasThemes: Record<'light' | 'dark', CanvasTheme> = {
  light: {
    bg: '#f3f5f8',
    grid: 'rgba(30, 42, 74, 0.12)',
    select: '#4a5580',
    selectFill: 'rgba(74, 85, 128, 0.10)',
    ink: '#1e2a4a',
    muted: '#6b7088',
    frame: '#eef1f6',
    frameStroke: '#c8cdd8',
    groupFill: 'rgba(74, 85, 128, 0.06)',
    bar: 'rgba(30, 42, 74, 0.06)',
    paper: '#ffffff',
    postitShadow: 'rgba(20, 30, 70, 0.16)',
    comment: '#f43f5e',
    linkBg: '#1e2a4a',
    linkFg: '#f3f5f8',
    defaultStroke: '#1e2a4a',
  },
  dark: {
    bg: '#1a1d2e',
    grid: 'rgba(243, 245, 248, 0.10)',
    select: '#c4c9d8',
    selectFill: 'rgba(196, 201, 216, 0.12)',
    ink: '#f3f5f8',
    muted: '#9aa0b4',
    frame: '#252838',
    frameStroke: 'rgba(255,255,255,0.14)',
    groupFill: 'rgba(196, 201, 216, 0.06)',
    bar: 'rgba(243, 245, 248, 0.08)',
    paper: '#252838',
    postitShadow: 'rgba(0, 0, 0, 0.45)',
    comment: '#f43f5e',
    linkBg: '#e8ebf2',
    linkFg: '#1e2a4a',
    defaultStroke: '#e8ebf2',
  },
}

export function isThemeStroke(color: string) {
  return (
    color === '#1c1917' ||
    color === canvasThemes.light.defaultStroke ||
    color === canvasThemes.dark.defaultStroke
  )
}

export function useCanvasTheme() {
  const { resolved } = useTheme()
  return canvasThemes[resolved]
}

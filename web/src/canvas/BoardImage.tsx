import { useEffect, useState } from 'react'
import { Image, Rect } from 'react-konva'
import type { CanvasTheme } from '@/lib/canvasTheme'

const cache = new Map<string, HTMLImageElement>()

function useHtmlImage(src?: string) {
  const cached = src ? cache.get(src) : undefined
  const [loadedSrc, setLoadedSrc] = useState(cached?.complete ? src : undefined)

  useEffect(() => {
    if (!src || cache.get(src)?.complete) return
    let cancelled = false
    const el = new window.Image()
    el.onload = () => {
      cache.set(src, el)
      if (!cancelled) setLoadedSrc(src)
    }
    el.onerror = () => {
      if (!cancelled) setLoadedSrc(undefined)
    }
    el.src = src
    return () => {
      cancelled = true
      el.onload = null
      el.onerror = null
    }
  }, [src])

  if (src && cache.get(src)?.complete) return cache.get(src)!
  if (src && loadedSrc === src) return cache.get(src) ?? null
  return null
}

type Props = {
  src?: string
  width: number
  height: number
  theme: CanvasTheme
}

export function BoardImage({ src, width, height, theme }: Props) {
  const image = useHtmlImage(src)
  return (
    <>
      <Rect width={width} height={height} fill={theme.bar} cornerRadius={8} />
      {image ? <Image image={image} width={width} height={height} cornerRadius={8} /> : null}
    </>
  )
}

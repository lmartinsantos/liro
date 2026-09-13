import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type HintSide = 'top' | 'right' | 'bottom' | 'left'

const DELAY_MS = 250

const sideClass: Record<HintSide, string> = {
  top: 'bottom-full left-1/2 mb-1.5 -translate-x-1/2',
  bottom: 'top-full left-1/2 mt-1.5 -translate-x-1/2',
  right: 'left-full top-1/2 ml-2.5 -translate-y-1/2',
  left: 'right-full top-1/2 mr-2.5 -translate-y-1/2',
}

export function Hint({
  label,
  side = 'top',
  children,
}: {
  label: string
  side?: HintSide
  children: ReactNode
}) {
  const [show, setShow] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  useEffect(() => () => clear(), [])

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => {
        clear()
        timer.current = setTimeout(() => setShow(true), DELAY_MS)
      }}
      onMouseLeave={() => {
        clear()
        setShow(false)
      }}
    >
      {children}
      {show && (
        <span
          role="tooltip"
          className={cn(
            'pointer-events-none absolute z-50 whitespace-nowrap rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground shadow-card',
            sideClass[side],
          )}
        >
          {label}
        </span>
      )}
    </span>
  )
}

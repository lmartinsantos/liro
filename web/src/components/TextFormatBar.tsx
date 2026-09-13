import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Minus,
  Plus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  TEXT_FONTS,
  TEXT_SIZES,
  bodyFontSize,
  noteFontSize,
  noteStoredFontSize,
  objectFontFamily,
  objectTextAlign,
  titleFontSize,
} from '@/lib/textStyle'
import type { BoardObject } from '@/lib/types'

type Props = {
  obj: BoardObject
  onChange: (path: string, value: unknown) => void
}

export function TextFormatBar({ obj, onChange }: Props) {
  const family = objectFontFamily(obj)
  const size = Math.round(
    obj.type === 'postit'
      ? noteFontSize(obj)
      : obj.type === 'frame' || obj.type === 'lane'
        ? titleFontSize(obj)
        : bodyFontSize(obj),
  )
  const align = objectTextAlign(obj)
  const showSize = obj.type === 'text' || obj.type === 'postit' || obj.type === 'frame' || obj.type === 'lane'
  const showAlign = obj.type === 'text' || obj.type === 'postit'

  const setSize = (next: number) => {
    if (obj.type === 'postit') {
      onChange('fontSize', noteStoredFontSize(next, obj.w, obj.h))
      return
    }
    onChange('fontSize', next)
  }

  const bumpSize = (dir: -1 | 1) => {
    const idx = TEXT_SIZES.findIndex((n) => n >= size)
    const at = idx < 0 ? TEXT_SIZES.length - 1 : idx
    const next = TEXT_SIZES[Math.max(0, Math.min(TEXT_SIZES.length - 1, at + dir))]
    setSize(next)
  }

  return (
    // Keep the inline text editor focused for buttons; allow <select> to take focus/open.
    <div
      className="flex items-center gap-0.5"
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest('select')) return
        e.preventDefault()
      }}
    >
      <select
        value={TEXT_FONTS.some((f) => f.id === family) ? family : TEXT_FONTS[0].id}
        onChange={(e) => onChange('fontFamily', e.target.value)}
        className="h-8 w-[7.25rem] rounded-full border border-input bg-card px-2 text-xs font-semibold outline-none"
        aria-label="Font"
      >
        {TEXT_FONTS.map((f) => (
          <option key={f.label} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
      {showSize ? (
        <select
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          className="h-8 w-[3.5rem] rounded-full border border-input bg-card px-1.5 text-xs font-semibold tabular-nums outline-none"
          aria-label="Size"
        >
          {!TEXT_SIZES.includes(size) ? <option value={size}>{size}</option> : null}
          {TEXT_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={obj.bold ? 'size-8 bg-accent text-accent-foreground' : 'size-8'}
        hint="Bold"
        onClick={() => onChange('bold', !obj.bold)}
      >
        <Bold />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={obj.italic ? 'size-8 bg-accent text-accent-foreground' : 'size-8'}
        hint="Italic"
        onClick={() => onChange('italic', !obj.italic)}
      >
        <Italic />
      </Button>
      {showAlign ? (
        <>
          <span className="mx-1 h-6 w-px bg-border" />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={align === 'left' ? 'size-8 bg-accent text-accent-foreground' : 'size-8'}
            hint="Align left"
            onClick={() => onChange('textAlign', 'left')}
          >
            <AlignLeft />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={align === 'center' ? 'size-8 bg-accent text-accent-foreground' : 'size-8'}
            hint="Align center"
            onClick={() => onChange('textAlign', 'center')}
          >
            <AlignCenter />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={align === 'right' ? 'size-8 bg-accent text-accent-foreground' : 'size-8'}
            hint="Align right"
            onClick={() => onChange('textAlign', 'right')}
          >
            <AlignRight />
          </Button>
        </>
      ) : null}
      {showSize ? (
        <>
          <span className="mx-1 h-6 w-px bg-border" />
          <Button type="button" variant="ghost" size="icon" className="size-8" hint="Smaller" onClick={() => bumpSize(-1)}>
            <Minus />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-8" hint="Larger" onClick={() => bumpSize(1)}>
            <Plus />
          </Button>
        </>
      ) : null}
    </div>
  )
}

import type { ReactNode } from 'react'
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  BringToFront,
  ChevronsDown,
  ChevronsUp,
  Group,
  SendToBack,
  Ungroup,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Align } from '@/lib/layout'
import { layoutTargets } from '@/lib/layout'

type Props = {
  selectedIds: string[]
  objects: Record<string, import('@/lib/types').BoardObject>
  onAlign: (kind: Align) => void
  onDistribute: (axis: 'x' | 'y') => void
  onZ: (action: 'front' | 'back' | 'forward' | 'backward') => void
  onGroup: () => void
  onUngroup: () => void
}

export function LayoutBar({
  selectedIds,
  objects,
  onAlign,
  onDistribute,
  onZ,
  onGroup,
  onUngroup,
}: Props) {
  if (selectedIds.length === 0) return null
  const targets = layoutTargets(selectedIds, objects)
  const canAlign = targets.length >= 2
  const canDistribute = targets.length >= 3
  const canGroup = targets.length >= 2
  const canUngroup = selectedIds.some((id) => {
    const o = objects[id]
    if (!o) return false
    return o.type === 'group' || (!!o.parentId && objects[o.parentId]?.type === 'group')
  })

  return (
    <div className="flex items-center gap-0.5">
      <IconBtn title="Send backward ([" onClick={() => onZ('backward')}>
        <ChevronsDown />
      </IconBtn>
      <IconBtn title="Send to back" onClick={() => onZ('back')}>
        <SendToBack />
      </IconBtn>
      <IconBtn title="Bring forward (])" onClick={() => onZ('forward')}>
        <ChevronsUp />
      </IconBtn>
      <IconBtn title="Bring to front" onClick={() => onZ('front')}>
        <BringToFront />
      </IconBtn>
      <span className="mx-1 h-6 w-px bg-border" />
      <IconBtn title="Align left" disabled={!canAlign} onClick={() => onAlign('left')}>
        <AlignStartVertical />
      </IconBtn>
      <IconBtn title="Align center" disabled={!canAlign} onClick={() => onAlign('center')}>
        <AlignCenterVertical />
      </IconBtn>
      <IconBtn title="Align right" disabled={!canAlign} onClick={() => onAlign('right')}>
        <AlignEndVertical />
      </IconBtn>
      <IconBtn title="Align top" disabled={!canAlign} onClick={() => onAlign('top')}>
        <AlignStartHorizontal />
      </IconBtn>
      <IconBtn title="Align middle" disabled={!canAlign} onClick={() => onAlign('middle')}>
        <AlignCenterHorizontal />
      </IconBtn>
      <IconBtn title="Align bottom" disabled={!canAlign} onClick={() => onAlign('bottom')}>
        <AlignEndHorizontal />
      </IconBtn>
      <span className="mx-1 h-6 w-px bg-border" />
      <IconBtn title="Distribute horizontally" disabled={!canDistribute} onClick={() => onDistribute('x')}>
        <AlignCenterVertical className="opacity-70" />
      </IconBtn>
      <IconBtn title="Distribute vertically" disabled={!canDistribute} onClick={() => onDistribute('y')}>
        <AlignCenterHorizontal className="opacity-70" />
      </IconBtn>
      <span className="mx-1 h-6 w-px bg-border" />
      <IconBtn title="Group (⌘G)" disabled={!canGroup} onClick={onGroup}>
        <Group />
      </IconBtn>
      <IconBtn title="Ungroup (⌘⇧G)" disabled={!canUngroup} onClick={onUngroup}>
        <Ungroup />
      </IconBtn>
    </div>
  )
}

function IconBtn({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Button type="button" variant="tool" hint={title} hintSide="top" disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  )
}

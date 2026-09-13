import { Group, Label, Path, Tag, Text } from 'react-konva'
import { CANVAS_FONT } from '@/lib/canvasTheme'
import type { RemoteCursor } from '@/lib/types'

type Props = {
  cursors: RemoteCursor[]
}

export function RemoteCursors({ cursors }: Props) {
  return (
    <>
      {cursors.map((c) => (
        <Group key={c.sessionId} x={c.x} y={c.y} listening={false}>
          <Path
            data="M0 0 L0 16.8 L4.6 13 L9.2 20.5 L12.8 18.7 L7.4 11.2 L14.8 11.2 Z"
            fill={c.color}
            stroke="#fff"
            strokeWidth={0.8}
          />
          <Label x={14} y={16}>
            <Tag fill={c.color} cornerRadius={999} />
            <Text text={c.name} fill="#fff" padding={4} fontSize={11} fontFamily={CANVAS_FONT} fontStyle="600" />
          </Label>
        </Group>
      ))}
    </>
  )
}

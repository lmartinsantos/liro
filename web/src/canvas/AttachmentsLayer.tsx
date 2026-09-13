import { Circle, Group, Label, Tag, Text } from 'react-konva'
import { CANVAS_FONT, type CanvasTheme } from '@/lib/canvasTheme'
import type { BoardObject } from '@/lib/types'

const EMOJI_SIZE = 20
const EMOJI_INSET = 4
const EMOJI_GAP = 22

type Props = {
  objects: BoardObject[]
  theme: CanvasTheme
}

export function AttachmentsLayer({ objects, theme }: Props) {
  return (
    <>
      {objects.flatMap((obj) => {
        let emojiIndex = 0
        return (obj.attachments ?? []).map((att, i) => {
          const x = obj.x + obj.w - 10 + (att.offsetX ?? 0) - i * 4
          const y = obj.y - 6 + (att.offsetY ?? 0) + i * 2
          if (att.type === 'emoji') {
            const idx = emojiIndex++
            return (
              <Text
                key={att.id}
                x={obj.x + obj.w - EMOJI_INSET - EMOJI_SIZE - idx * EMOJI_GAP}
                y={obj.y + obj.h - EMOJI_INSET - EMOJI_SIZE}
                text={att.emoji ?? '⭐'}
                fontSize={EMOJI_SIZE}
                listening={false}
              />
            )
          }
          if (att.type === 'comment') {
            return (
              <Group key={att.id} x={x} y={y} listening={false}>
                <Circle radius={8} fill={theme.comment} />
                <Text
                  text="💬"
                  fontSize={10}
                  x={-7}
                  y={-6}
                  width={16}
                  align="center"
                />
              </Group>
            )
          }
          return (
            <Label key={att.id} x={obj.x + (att.offsetX ?? 4)} y={obj.y + obj.h + 4} listening={false}>
              <Tag fill={theme.linkBg} cornerRadius={999} />
              <Text
                text={att.label || att.url || 'link'}
                fill={theme.linkFg}
                padding={4}
                fontSize={10}
                fontFamily={CANVAS_FONT}
                fontStyle="600"
              />
            </Label>
          )
        })
      })}
    </>
  )
}

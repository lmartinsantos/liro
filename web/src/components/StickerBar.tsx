import { Hint } from '@/components/ui/hint'

export const STICKER_EMOJIS = ['🔥', '✅', '❤️', '👀', '🎉', '👍', '❓', '💡', '🚀', '⚠️', '⭐', '😀']

type Props = {
  emoji: string
  onPick: (emoji: string) => void
}

export function StickerBar({ emoji, onPick }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-0.5 px-1">
      {STICKER_EMOJIS.map((e) => (
        <Hint key={e} label={e} side="top">
          <button
            type="button"
            className="size-8 rounded-full text-lg hover:bg-accent data-[active=true]:bg-accent"
            data-active={emoji === e}
            onClick={() => onPick(e)}
          >
            {e}
          </button>
        </Hint>
      ))}
    </div>
  )
}

import { Link2, MessageSquare, Smile, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Hint } from '@/components/ui/hint'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Attachment, BoardObject, User } from '@/lib/types'
import { newId } from '@/lib/utils'

const EMOJIS = ['🔥', '✅', '❤️', '👀', '🎉', '👍', '❓', '💡', '🚀', '⚠️']

type Props = {
  obj: BoardObject
  user: User
  onAttachments: (next: Attachment[]) => void
  onDelete: () => void
}

export function AttachBar({ obj, user, onAttachments, onDelete }: Props) {
  const [mode, setMode] = useState<'emoji' | 'comment' | 'link' | null>(null)
  const [comment, setComment] = useState('')
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')

  const add = (att: Attachment) => {
    onAttachments([...(obj.attachments ?? []), att])
    setMode(null)
    setComment('')
    setUrl('')
    setLabel('')
  }

  return (
    <div className="min-w-[16rem]">
      <div className="flex items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          hint="Emoji"
          onClick={() => setMode(mode === 'emoji' ? null : 'emoji')}
        >
          <Smile /> Emoji
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          hint="Comment"
          onClick={() => setMode(mode === 'comment' ? null : 'comment')}
        >
          <MessageSquare /> Comment
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          hint="Link"
          onClick={() => setMode(mode === 'link' ? null : 'link')}
        >
          <Link2 /> Link
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-auto text-destructive"
          hint="Delete"
          onClick={onDelete}
        >
          <Trash2 />
        </Button>
      </div>
      {mode === 'emoji' && (
        <div className="flex flex-wrap gap-1 px-1 pb-1">
          {EMOJIS.map((e) => (
            <Hint key={e} label={e} side="top">
              <button
                type="button"
                className="size-8 rounded-full text-lg hover:bg-accent"
                onClick={() => {
                  const emojiCount = (obj.attachments ?? []).filter((a) => a.type === 'emoji').length
                  add({
                    id: newId('att'),
                    type: 'emoji',
                    emoji: e,
                    // Bottom-right inside the object; each extra emoji floats left.
                    offsetX: obj.w - 4 - 20 - emojiCount * 22,
                    offsetY: obj.h - 4 - 20,
                  })
                }}
              >
                {e}
              </button>
            </Hint>
          ))}
        </div>
      )}
      {mode === 'comment' && (
        <form
          className="flex gap-2 px-1 pb-1"
          onSubmit={(e) => {
            e.preventDefault()
            if (!comment.trim()) return
            add({
              id: newId('att'),
              type: 'comment',
              authorId: user.id,
              authorName: user.name,
              text: comment.trim(),
              createdAt: new Date().toISOString(),
            })
          }}
        >
          <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment on this object" />
          <Button type="submit" size="sm" hint="Add comment">
            Add
          </Button>
        </form>
      )}
      {mode === 'link' && (
        <form
          className="grid grid-cols-[1fr_1fr_auto] gap-2 px-1 pb-1"
          onSubmit={(e) => {
            e.preventDefault()
            if (!url.trim()) return
            add({
              id: newId('att'),
              type: 'link',
              url: url.trim(),
              label: label.trim() || url.trim(),
            })
          }}
        >
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" />
          <Button type="submit" size="sm" hint="Add link">
            Add
          </Button>
        </form>
      )}
      {(obj.attachments?.length ?? 0) > 0 && (
        <ul className="mt-1 max-h-28 space-y-1 overflow-auto border-t border-border px-1 pt-2 text-xs font-semibold text-muted-foreground">
          {obj.attachments!.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2">
              <span className="truncate">
                {a.type === 'emoji' && a.emoji}
                {a.type === 'comment' && `${a.authorName}: ${a.text}`}
                {a.type === 'link' && (a.label || a.url)}
              </span>
              <Hint label="Remove" side="top">
                <button
                  type="button"
                  className="text-destructive hover:underline"
                  onClick={() => onAttachments((obj.attachments ?? []).filter((x) => x.id !== a.id))}
                >
                  remove
                </button>
              </Hint>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

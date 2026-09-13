import { Send, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ChatMessage } from '@/lib/types'

type Props = {
  open: boolean
  onClose: () => void
  messages: ChatMessage[]
  onSend: (text: string) => void
}

export function ChatPanel({ open, onClose, messages, onSend }: Props) {
  const [text, setText] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, open])

  if (!open) return null

  return (
    <aside className="flex h-full w-[min(22rem,92vw)] shrink-0 flex-col rounded-l-3xl bg-card shadow-card">
      <header className="flex h-14 items-center justify-between px-5">
        <div>
          <p className="text-lg font-semibold">Board chat</p>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Everyone on this board
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" hint="Close chat" hintSide="left" onClick={onClose}>
          <X />
        </Button>
      </header>
      <div className="flex-1 space-y-2 overflow-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="rounded-3xl bg-background px-4 py-10 text-center text-sm text-muted-foreground">
            No messages yet. Say hello.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className="rounded-2xl bg-background px-3 py-2 shadow-card">
            <div className="mb-0.5 flex items-baseline gap-2">
              <span className="text-sm font-semibold" style={{ color: m.color }}>
                {m.authorName}
              </span>
              <span className="text-[11px] font-semibold text-muted-foreground">
                {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <p className="text-sm leading-snug">{m.text}</p>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form
        className="flex gap-2 p-3"
        onSubmit={(e) => {
          e.preventDefault()
          const t = text.trim()
          if (!t) return
          onSend(t)
          setText('')
        }}
      >
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message the board" />
        <Button type="submit" size="icon" hint="Send">
          <Send />
        </Button>
      </form>
    </aside>
  )
}

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { BoardCanvas, type BoardCanvasHandle } from '@/canvas/BoardCanvas'
import { Brand } from '@/components/Brand'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import type { DocumentState, Meta } from '@/lib/types'
import { clearUnlockToken, readUnlockToken } from '@/lib/utils'

const POLL_MS = 4000
const noop = () => {}

export function ViewPage() {
  const { boardId = '' } = useParams()
  const [search] = useSearchParams()
  const embed = search.get('embed') === '1'
  const canvasRef = useRef<BoardCanvasHandle>(null)
  const fitted = useRef(false)

  const [meta, setMeta] = useState<Meta | null>(null)
  const [doc, setDoc] = useState<DocumentState | null>(null)
  const [needsPassword, setNeedsPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    fitted.current = false
  }, [boardId])

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const out = await api.getDocument(boardId)
        if (cancelled) return
        setMeta(out.meta)
        setDoc(out.document)
        setNeedsPassword(false)
        setErr(null)
      } catch (e) {
        if (cancelled) return
        const msg = (e as Error).message
        if (msg === 'password required' || msg === 'incorrect password') {
          setNeedsPassword(true)
          setDoc(null)
          try {
            const m = await api.getBoard(boardId)
            if (!cancelled) setMeta(m)
          } catch {
            /* ignore */
          }
          if (readUnlockToken(boardId)) clearUnlockToken(boardId)
        } else {
          setErr(msg)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [boardId, tick])

  useEffect(() => {
    if (needsPassword) return
    const timer = window.setInterval(() => setTick((n) => n + 1), POLL_MS)
    return () => window.clearInterval(timer)
  }, [needsPassword, boardId])

  useEffect(() => {
    if (!doc || fitted.current) return
    const id = window.requestAnimationFrame(() => {
      canvasRef.current?.fitObjects(doc.objects)
      fitted.current = true
    })
    return () => window.cancelAnimationFrame(id)
  }, [doc])

  if (err && !needsPassword) {
    return (
      <Shell embed={embed}>
        <p className="text-sm font-semibold text-destructive">{err}</p>
        {!embed && (
          <Link to="/" className="mt-4 text-sm font-semibold text-muted-foreground hover:text-foreground">
            ← All boards
          </Link>
        )}
      </Shell>
    )
  }

  if (needsPassword) {
    return (
      <Shell embed={embed}>
        {!embed && (
          <Link
            to="/"
            className="text-xs font-bold uppercase tracking-wide text-muted-foreground hover:text-foreground"
          >
            ← All boards
          </Link>
        )}
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight">{meta?.name ?? 'Board'}</h1>
        <p className="mt-2 text-sm text-muted-foreground">This board is password-protected.</p>
        {err && <p className="mt-3 text-sm font-semibold text-destructive">{err}</p>}
        <form
          className="mt-6 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setErr(null)
            try {
              await api.unlockBoard(boardId, password)
              setPassword('')
              setTick((n) => n + 1)
            } catch (e) {
              setErr((e as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Board password"
            autoFocus
          />
          <Button type="submit" disabled={busy || !password}>
            Unlock
          </Button>
        </form>
      </Shell>
    )
  }

  if (!doc) {
    return (
      <Shell embed={embed}>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Shell>
    )
  }

  return (
    <div className="relative h-svh w-full overflow-hidden bg-background">
      {!embed && (
        <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-3">
          <div className="pointer-events-auto flex h-14 items-center gap-3 rounded-3xl bg-card px-4 shadow-card">
            <Brand />
            <span className="text-muted-foreground">/</span>
            <span className="max-w-[14rem] truncate text-sm font-semibold">{meta?.name ?? 'Board'}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              View only
            </span>
          </div>
          <div className="pointer-events-auto flex h-14 items-center gap-1 rounded-3xl bg-card px-2 shadow-card">
            <ThemeToggle />
            <Button type="button" variant="ghost" asChild>
              <Link to={`/b/${boardId}`}>Join</Link>
            </Button>
          </div>
        </header>
      )}
      <BoardCanvas
        ref={canvasRef}
        objects={doc.objects}
        selectedIds={[]}
        onSelect={noop}
        tool="select"
        fill="#ffffff"
        stroke="#1e2a4a"
        strokeWidth={2}
        cursors={[]}
        onCreate={noop}
        onUpdate={noop}
        onLiveMove={noop}
        onCursor={noop}
        readOnly
      />
    </div>
  )
}

function Shell({ embed, children }: { embed: boolean; children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      {!embed && (
        <div className="flex items-center justify-between p-4">
          <Brand />
          <ThemeToggle />
        </div>
      )}
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 pb-16">{children}</div>
    </div>
  )
}

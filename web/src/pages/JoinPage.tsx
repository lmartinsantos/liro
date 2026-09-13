import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Brand } from '@/components/Brand'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import type { Meta, User } from '@/lib/types'
import { readUnlockToken, clearUnlockToken, sessionKey } from '@/lib/utils'

export function JoinPage() {
  const { boardId = '' } = useParams()
  const nav = useNavigate()
  const [meta, setMeta] = useState<Meta | null>(null)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const m = await api.getBoard(boardId)
        if (cancelled) return
        setMeta(m)
        if (m.archivedAt) {
          setUnlocked(false)
          return
        }
        if (!m.hasPassword) {
          setUnlocked(true)
          return
        }
        if (readUnlockToken(boardId)) {
          try {
            await api.listUsers(boardId)
            const full = await api.getBoard(boardId)
            if (cancelled) return
            setMeta(full)
            setUnlocked(true)
          } catch {
            clearUnlockToken(boardId)
          }
        }
      } catch (e) {
        if (!cancelled) setErr((e as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [boardId])

  const enter = (user: User) => {
    sessionStorage.setItem(sessionKey(boardId), JSON.stringify(user))
    nav(`/b/${boardId}/board`)
  }

  if (meta?.archivedAt) {
    return (
      <Shell>
        <Link
          to="/"
          className="text-xs font-bold uppercase tracking-wide text-muted-foreground hover:text-foreground"
        >
          ← All boards
        </Link>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight">{meta.name}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This board is archived. Restore it from the home page to join again.
        </p>
      </Shell>
    )
  }

  const needsPassword = Boolean(meta?.hasPassword && !unlocked)

  return (
    <Shell>
      <Link
        to="/"
        className="text-xs font-bold uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        ← All boards
      </Link>
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight">{meta?.name ?? 'Board'}</h1>
      {needsPassword ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">This board is password-protected.</p>
          {err && <p className="mt-3 text-sm font-semibold text-destructive">{err}</p>}
          <form
            className="mt-8 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault()
              setBusy(true)
              setErr(null)
              try {
                await api.unlockBoard(boardId, password)
                const full = await api.getBoard(boardId)
                setMeta(full)
                setUnlocked(true)
                setPassword('')
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
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted-foreground">Who are you on this board?</p>
          {err && <p className="mt-3 text-sm font-semibold text-destructive">{err}</p>}

          <ul className="mt-8 space-y-2">
            {(meta?.users ?? []).map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => enter(u)}
                  className="flex w-full items-center gap-3 rounded-2xl bg-background px-3 py-2 text-left shadow-card transition-colors hover:bg-accent"
                >
                  <span className="size-8 rounded-full" style={{ background: u.color }} />
                  <span className="text-sm font-semibold">{u.name}</span>
                </button>
              </li>
            ))}
            {(meta?.users.length ?? 0) === 0 && (
              <li className="rounded-3xl bg-background px-4 py-8 text-center text-sm text-muted-foreground">
                Nobody has joined yet. Add yourself below.
              </li>
            )}
          </ul>

          <form
            className="mt-8 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!name.trim()) return
              setBusy(true)
              setErr(null)
              try {
                const user = await api.addUser(boardId, name.trim())
                enter(user)
              } catch (e) {
                setErr((e as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New display name" />
            <Button type="submit" disabled={busy}>
              Join
            </Button>
          </form>
        </>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background">
      <header className="flex h-14 items-center justify-between px-3 md:h-16 md:px-6">
        <Brand />
        <ThemeToggle />
      </header>
      <div className="flex min-h-0 flex-1 px-2 pb-2 md:px-3 md:pb-3">
        <main className="mx-auto flex h-full w-full max-w-lg flex-col overflow-y-auto rounded-3xl bg-card p-6 shadow-card md:p-10">
          {children}
        </main>
      </div>
    </div>
  )
}

import {
  Archive,
  ArrowRight,
  Download,
  Ellipsis,
  KeyRound,
  Lock,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  BoardMenu,
  DeleteBoardDialog,
  MenuItem,
  PasswordPromptDialog,
  SetPasswordDialog,
  downloadBoard,
  runProtected,
} from '@/components/BoardActions'
import { Brand } from '@/components/Brand'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import type { Meta } from '@/lib/types'

export function HomePage() {
  const nav = useNavigate()
  const [boards, setBoards] = useState<Meta[]>([])
  const [archived, setArchived] = useState<Meta[]>([])
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [passwordBoard, setPasswordBoard] = useState<Meta | null>(null)
  const [deleteBoard, setDeleteBoard] = useState<Meta | null>(null)
  const [prompt, setPrompt] = useState<{
    title: string
    description?: string
    confirmLabel?: string
    destructive?: boolean
    run: (password: string) => Promise<void>
  } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    const [active, archivedList] = await Promise.all([
      api.listBoards(),
      api.listBoards({ archived: true }),
    ])
    setBoards(active)
    setArchived(archivedList)
  }

  useEffect(() => {
    void load().catch((e: Error) => setErr(e.message))
  }, [])

  const withPrompt = (
    board: Meta,
    title: string,
    action: (password?: string) => Promise<void>,
    opts?: { description?: string; confirmLabel?: string; destructive?: boolean },
  ) => {
    void runProtected(board, action, (run) =>
      setPrompt({
        title,
        description: opts?.description,
        confirmLabel: opts?.confirmLabel,
        destructive: opts?.destructive,
        run,
      }),
    ).catch((e: Error) => setErr(e.message))
  }

  const renderRow = (b: Meta, mode: 'active' | 'archived') => (
    <li key={b.id} className="relative">
      <div className="flex items-center gap-1 rounded-2xl bg-background px-2 py-1.5 shadow-card">
        {mode === 'active' ? (
          <Link
            to={`/b/${b.id}`}
            className="flex min-w-0 flex-1 items-center justify-between rounded-xl px-2 py-1.5 transition-colors hover:bg-accent"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                {b.hasPassword && <Lock className="size-3.5 shrink-0 text-muted-foreground" />}
                {b.name}
              </p>
              <p className="text-xs font-semibold text-muted-foreground">
                {b.users.length} {b.users.length === 1 ? 'person' : 'people'}
                {b.createdAt ? ` · ${new Date(b.createdAt).toLocaleDateString()}` : ''}
              </p>
            </div>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        ) : (
          <div className="min-w-0 flex-1 px-2 py-1.5">
            <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
              {b.hasPassword && <Lock className="size-3.5 shrink-0 text-muted-foreground" />}
              {b.name}
            </p>
            <p className="text-xs font-semibold text-muted-foreground">Archived</p>
          </div>
        )}
        <div className="relative">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9"
            hint="Board actions"
            onClick={() => setMenuId(menuId === b.id ? null : b.id)}
          >
            <Ellipsis />
          </Button>
          {menuId === b.id && (
            <BoardMenu>
              {mode === 'active' ? (
                <MenuItem
                  onClick={() => {
                    setMenuId(null)
                    withPrompt(b, 'Archive board', async (password) => {
                      await api.archiveBoard(b.id, password)
                      await load()
                    })
                  }}
                >
                  <Archive className="size-4" /> Archive
                </MenuItem>
              ) : (
                <MenuItem
                  onClick={() => {
                    setMenuId(null)
                    withPrompt(b, 'Restore board', async (password) => {
                      await api.restoreBoard(b.id, password)
                      await load()
                    })
                  }}
                >
                  <RotateCcw className="size-4" /> Restore
                </MenuItem>
              )}
              <MenuItem
                onClick={() => {
                  setMenuId(null)
                  withPrompt(b, 'Download board', async (password) => {
                    await downloadBoard(b, password)
                  })
                }}
              >
                <Download className="size-4" /> Download
              </MenuItem>
              {mode === 'active' && (
                <MenuItem
                  onClick={() => {
                    setMenuId(null)
                    setPasswordBoard(b)
                  }}
                >
                  <KeyRound className="size-4" /> Password
                </MenuItem>
              )}
              <MenuItem
                destructive
                onClick={() => {
                  setMenuId(null)
                  setDeleteBoard(b)
                }}
              >
                <Trash2 className="size-4" /> Delete
              </MenuItem>
            </BoardMenu>
          )}
        </div>
      </div>
    </li>
  )

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background" onClick={() => setMenuId(null)}>
      <header className="flex h-14 items-center justify-between px-3 md:h-16 md:px-6">
        <Brand />
        <ThemeToggle />
      </header>
      <div className="flex min-h-0 flex-1 px-2 pb-2 md:px-3 md:pb-3">
        <main className="mx-auto flex h-full w-full max-w-3xl flex-col overflow-y-auto rounded-3xl bg-card p-6 shadow-card md:p-10">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            Self-hosted whiteboard
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight">Boards</h1>
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">
            Infinite canvas, live cursors, sticky notes, and a board chat. Boards are just JSON files
            on disk.
          </p>

          <form
            className="mt-8 flex flex-wrap gap-2"
            onSubmit={async (e) => {
              e.preventDefault()
              setBusy(true)
              setErr(null)
              try {
                const board = await api.createBoard(name.trim() || 'Untitled board')
                nav(`/b/${board.id}`)
              } catch (e) {
                setErr((e as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name a new board"
              className="min-w-[12rem] flex-1"
            />
            <Button type="submit" disabled={busy}>
              <Plus /> Create
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <Upload /> Upload
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                setBusy(true)
                setErr(null)
                try {
                  const board = await api.importBoard(file)
                  await load()
                  nav(`/b/${board.id}`)
                } catch (e) {
                  setErr((e as Error).message)
                } finally {
                  setBusy(false)
                }
              }}
            />
          </form>
          {err && <p className="mt-3 text-sm font-semibold text-destructive">{err}</p>}

          <ul className="mt-10 space-y-2" onClick={(e) => e.stopPropagation()}>
            {boards.map((b) => renderRow(b, 'active'))}
            {boards.length === 0 && (
              <li className="rounded-3xl bg-background px-4 py-10 text-center text-sm text-muted-foreground">
                No boards yet. Create one above or upload a backup.
              </li>
            )}
          </ul>

          {archived.length > 0 && (
            <section className="mt-12" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                Archived
              </h2>
              <ul className="mt-3 space-y-2">{archived.map((b) => renderRow(b, 'archived'))}</ul>
            </section>
          )}
        </main>
      </div>

      {passwordBoard && (
        <SetPasswordDialog
          open
          board={passwordBoard}
          onClose={() => setPasswordBoard(null)}
          onDone={() => void load()}
        />
      )}
      {deleteBoard && (
        <DeleteBoardDialog
          open
          board={deleteBoard}
          onClose={() => setDeleteBoard(null)}
          onDeleted={() => void load()}
        />
      )}
      {prompt && (
        <PasswordPromptDialog
          open
          title={prompt.title}
          description={prompt.description}
          confirmLabel={prompt.confirmLabel}
          destructive={prompt.destructive}
          onClose={() => setPrompt(null)}
          onConfirm={async (password) => {
            await prompt.run(password)
            await load()
          }}
        />
      )}
    </div>
  )
}

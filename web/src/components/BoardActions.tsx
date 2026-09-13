import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api, downloadBlob } from '@/lib/api'
import type { Meta } from '@/lib/types'

type PasswordPromptProps = {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  destructive?: boolean
  onClose: () => void
  onConfirm: (password: string) => Promise<void>
}

export function PasswordPromptDialog({
  open,
  title,
  description,
  confirmLabel = 'Continue',
  destructive,
  onClose,
  onConfirm,
}: PasswordPromptProps) {
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setPassword('')
    setErr(null)
    setBusy(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset()
          onClose()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setErr(null)
            try {
              await onConfirm(password)
              reset()
              onClose()
            } catch (e) {
              setErr((e as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          <Input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Board password"
          />
          {err && <p className="text-sm font-semibold text-destructive">{err}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy} variant={destructive ? 'destructive' : 'default'}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type SetPasswordDialogProps = {
  open: boolean
  board: Meta
  onClose: () => void
  onDone: (meta: Meta) => void
}

export function SetPasswordDialog({ open, board, onClose, onDone }: SetPasswordDialogProps) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const clearing = board.hasPassword && next === ''

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setCurrent('')
          setNext('')
          setErr(null)
          onClose()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{board.hasPassword ? 'Change password' : 'Set password'}</DialogTitle>
          <DialogDescription>
            {board.hasPassword
              ? 'Enter the current password. Leave the new password blank to remove protection.'
              : 'Anyone with this password can join and manage the board.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setErr(null)
            try {
              const meta = await api.setPassword(board.id, current, next)
              onDone(meta)
              setCurrent('')
              setNext('')
              onClose()
            } catch (e) {
              setErr((e as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          {board.hasPassword && (
            <Input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              placeholder="Current password"
              autoFocus
            />
          )}
          <Input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder={board.hasPassword ? 'New password (blank to clear)' : 'New password'}
            autoFocus={!board.hasPassword}
          />
          {err && <p className="text-sm font-semibold text-destructive">{err}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || (!board.hasPassword && !next.trim())}
              variant={clearing ? 'destructive' : 'default'}
            >
              {clearing ? 'Remove password' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type DeleteDialogProps = {
  open: boolean
  board: Meta
  onClose: () => void
  onDeleted: () => void
}

export function DeleteBoardDialog({ open, board, onClose, onDeleted }: DeleteDialogProps) {
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setPassword('')
          setErr(null)
          onClose()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete board</DialogTitle>
          <DialogDescription>
            Permanently delete “{board.name}”. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setErr(null)
            try {
              await api.deleteBoard(board.id, password)
              onDeleted()
              onClose()
            } catch (e) {
              setErr((e as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          {board.hasPassword && (
            <Input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Board password"
            />
          )}
          {err && <p className="text-sm font-semibold text-destructive">{err}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy} variant="destructive">
              Delete forever
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export async function runProtected(
  board: Meta,
  action: (password?: string) => Promise<void>,
  prompt: (run: (password: string) => Promise<void>) => void,
) {
  if (!board.hasPassword) {
    await action()
    return
  }
  prompt(async (password) => {
    await action(password)
  })
}

export async function downloadBoard(board: Meta, password?: string) {
  const { blob, filename } = await api.exportBoard(board.id, password)
  downloadBlob(blob, filename)
}

export function shareViewUrl(boardId: string) {
  return `${window.location.origin}/b/${boardId}/view`
}

export function embedSnippet(boardId: string) {
  const src = `${window.location.origin}/b/${boardId}/view?embed=1`
  return `<iframe src="${src}" width="100%" height="480" style="border:0" loading="lazy" title="Liro board"></iframe>`
}

type EmbedDialogProps = {
  open: boolean
  boardId: string
  boardName: string
  onClose: () => void
}

export function EmbedDialog({ open, boardId, boardName, onClose }: EmbedDialogProps) {
  const [copied, setCopied] = useState<'link' | 'embed' | null>(null)
  const viewUrl = shareViewUrl(boardId)
  const snippet = embedSnippet(boardId)

  const copy = async (kind: 'link' | 'embed', text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(kind)
    window.setTimeout(() => setCopied(null), 1500)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setCopied(null)
          onClose()
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Embed & share</DialogTitle>
          <DialogDescription>
            Read-only link and embed code for “{boardName}”. Viewers can pan and zoom but not edit.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Share link
            </label>
            <div className="flex gap-2">
              <Input readOnly value={viewUrl} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
              <Button type="button" variant="secondary" onClick={() => void copy('link', viewUrl)}>
                {copied === 'link' ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Embed code
            </label>
            <textarea
              readOnly
              value={snippet}
              rows={3}
              className="w-full resize-none rounded-2xl border border-input bg-transparent px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onFocus={(e) => e.target.select()}
            />
            <DialogFooter className="mt-0">
              <Button type="button" variant="ghost" onClick={onClose}>
                Close
              </Button>
              <Button type="button" onClick={() => void copy('embed', snippet)}>
                {copied === 'embed' ? 'Copied' : 'Copy embed'}
              </Button>
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function BoardMenu({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={
        className ??
        'absolute right-0 top-full z-20 mt-1 min-w-[11rem] rounded-2xl bg-card p-1 shadow-card'
      }
      role="menu"
    >
      {children}
    </div>
  )
}

export function MenuItem({
  children,
  onClick,
  destructive,
}: {
  children: ReactNode
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold transition-colors hover:bg-accent ${
        destructive ? 'text-destructive' : ''
      }`}
    >
      {children}
    </button>
  )
}

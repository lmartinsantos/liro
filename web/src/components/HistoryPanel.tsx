import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api } from '@/lib/api'
import type { SnapshotInfo } from '@/lib/types'

type Props = {
  open: boolean
  boardId: string
  onClose: () => void
  onRestored?: () => void
}

function formatTs(ts: number) {
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return String(ts)
  }
}

export function HistoryPanel({ open, boardId, onClose, onRestored }: Props) {
  const [list, setList] = useState<SnapshotInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [confirmTs, setConfirmTs] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    setErr(null)
    try {
      setList(await api.listSnapshots(boardId))
    } catch (e) {
      setErr((e as Error).message)
    }
  }, [boardId])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      try {
        const next = await api.listSnapshots(boardId)
        if (!cancelled) {
          setList(next)
          setErr(null)
        }
      } catch (e) {
        if (!cancelled) setErr((e as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, boardId])

  const saveNow = async () => {
    setBusy(true)
    setErr(null)
    try {
      await api.createSnapshot(boardId)
      await refresh()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const restore = async (ts: number) => {
    setBusy(true)
    setErr(null)
    try {
      await api.restoreSnapshot(boardId, ts)
      setConfirmTs(null)
      onRestored?.()
      onClose()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose()
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Version history</DialogTitle>
            <DialogDescription>
              Auto-saved snapshots of this board. Restoring replaces the canvas for everyone currently
              connected.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void saveNow()}>
              Save snapshot now
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void refresh()}>
              Refresh
            </Button>
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {list.length === 0 && (
              <li className="rounded-xl px-3 py-6 text-center text-sm text-muted-foreground">
                No snapshots yet. Save one now, or wait for an auto-save.
              </li>
            )}
            {list.map((s) => (
              <li
                key={s.timestamp}
                className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 hover:bg-muted/60"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{formatTs(s.timestamp)}</div>
                  <div className="text-xs text-muted-foreground">{s.files.join(', ')}</div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirmTs(s.timestamp)}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmTs !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmTs(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore snapshot?</DialogTitle>
            <DialogDescription>
              This replaces the current board for all collaborators. The current state is saved first so
              you can undo the restore from history.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmTs(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={busy || confirmTs === null}
              onClick={() => confirmTs !== null && void restore(confirmTs)}
            >
              Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

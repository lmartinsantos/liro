import { Archive, Code2, Download, Ellipsis, History, KeyRound, Magnet, MessageCircle, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AttachBar } from '@/components/AttachBar'
import {
  BoardMenu,
  DeleteBoardDialog,
  EmbedDialog,
  MenuItem,
  PasswordPromptDialog,
  SetPasswordDialog,
  downloadBoard,
  runProtected,
} from '@/components/BoardActions'
import { Brand } from '@/components/Brand'
import { ChatPanel } from '@/components/ChatPanel'
import { HistoryPanel } from '@/components/HistoryPanel'
import { LayoutBar } from '@/components/LayoutBar'
import { StickerBar, STICKER_EMOJIS } from '@/components/StickerBar'
import { TextFormatBar } from '@/components/TextFormatBar'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Toolbar } from '@/components/Toolbar'
import { Button } from '@/components/ui/button'
import { CANVAS_FONT, DEFAULT_FILL, POSTIT_FILL, isThemeStroke, useCanvasTheme } from '@/lib/canvasTheme'
import { BoardCanvas, type BoardCanvasHandle } from '@/canvas/BoardCanvas'
import { api } from '@/lib/api'
import {
  cloneForPaste,
  collectCopySet,
  memoryCopy,
  parseClip,
  rememberCopy,
  toClipText,
} from '@/lib/clipboard'
import {
  IMAGE_MAX_BYTES,
  fitImageSize,
  imageFilesFromClipboard,
  imageNaturalSize,
  imageObject,
  persistImageFiles,
  ensureUploadable,
} from '@/lib/images'
import { alignPatches, distributePatches, layoutTargets, type Align, zPatches } from '@/lib/layout'
import { containerAt, nextZ, objectAABB, unionBoxes } from '@/lib/ops'
import { readSnapEnabled, writeSnapEnabled } from '@/lib/snap'
import { isTexty } from '@/lib/textStyle'
import type { Attachment, BoardObject, Meta, Tool, User } from '@/lib/types'
import { useBoardSession } from '@/lib/useBoardSession'
import { newId, sessionKey } from '@/lib/utils'

const toolKeys: Record<string, Tool> = {
  v: 'select',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  s: 'spline',
  n: 'postit',
  e: 'sticker',
  t: 'text',
  d: 'diamond',
  a: 'arrow',
  h: 'hexagon',
  p: 'parallelogram',
  c: 'connector',
  m: 'mindmap',
  f: 'frame',
  k: 'lane',
}

export function BoardPage() {
  const { boardId = '' } = useParams()
  const nav = useNavigate()
  const user = useMemo(() => readUser(boardId), [boardId])
  const [tool, setTool] = useState<Tool>('select')
  const canvas = useCanvasTheme()
  const [fill, setFill] = useState(DEFAULT_FILL)
  const [stroke, setStroke] = useState(canvas.defaultStroke)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [chatOpen, setChatOpen] = useState(false)

  useEffect(() => {
    if (!user) nav(`/b/${boardId}`, { replace: true })
  }, [user, boardId, nav])

  if (!user) return null

  return (
    <BoardSession
      boardId={boardId}
      user={user}
      tool={tool}
      setTool={setTool}
      fill={fill}
      setFill={setFill}
      stroke={stroke}
      setStroke={setStroke}
      selectedIds={selectedIds}
      setSelectedIds={setSelectedIds}
      chatOpen={chatOpen}
      setChatOpen={setChatOpen}
    />
  )
}

function BoardSession({
  boardId,
  user,
  tool,
  setTool,
  fill,
  setFill,
  stroke,
  setStroke,
  selectedIds,
  setSelectedIds,
  chatOpen,
  setChatOpen,
}: {
  boardId: string
  user: User
  tool: Tool
  setTool: (t: Tool) => void
  fill: string
  setFill: (c: string) => void
  stroke: string
  setStroke: (c: string) => void
  selectedIds: string[]
  setSelectedIds: (ids: string[]) => void
  chatOpen: boolean
  setChatOpen: (v: boolean) => void
}) {
  const nav = useNavigate()
  const session = useBoardSession(boardId, user)
  const canvas = useCanvasTheme()
  const canvasRef = useRef<BoardCanvasHandle>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [embedOpen, setEmbedOpen] = useState(false)
  const [prompt, setPrompt] = useState<{
    title: string
    run: (password: string) => Promise<void>
  } | null>(null)
  const [localMeta, setLocalMeta] = useState<Meta | null>(null)
  const [typeStyle, setTypeStyle] = useState<{
    fontFamily: string
    fontSize: number
    bold: boolean
    italic: boolean
    textAlign: 'left' | 'center' | 'right'
  }>({
    fontFamily: CANVAS_FONT,
    fontSize: 20,
    bold: false,
    italic: false,
    textAlign: 'left',
  })
  const [stickerEmoji, setStickerEmoji] = useState(STICKER_EMOJIS[0])
  const [snapEnabled, setSnapEnabled] = useState(readSnapEnabled)
  const [historyOpen, setHistoryOpen] = useState(false)
  const objects = session.doc.objects
  const selected = selectedIds.length === 1 ? objects[selectedIds[0]] : undefined
  const showType = tool === 'postit' || tool === 'text' || !!(selected && isTexty(selected.type))
  const showSticker = tool === 'sticker' || selected?.type === 'sticker'
  const activeStickerEmoji = selected?.type === 'sticker' ? (selected.text || stickerEmoji) : stickerEmoji
  const typeTarget: BoardObject =
    selected && isTexty(selected.type)
      ? selected
      : {
          id: '_type',
          type: tool === 'text' ? 'text' : 'postit',
          x: 0,
          y: 0,
          w: 160,
          h: 160,
          rotation: 0,
          z: '0',
          fill,
          stroke,
          strokeWidth: 2,
          fontFamily: typeStyle.fontFamily,
          fontSize: typeStyle.fontSize,
          bold: typeStyle.bold,
          italic: typeStyle.italic,
          textAlign: typeStyle.textAlign,
        }

  const applyPatches = useCallback(
    (patches: { id: string; path: string; value: unknown }[]) => {
      if (!patches.length) return
      session.withBatch(() => {
        for (const p of patches) session.updateObject(p.id, p.path, p.value)
      })
    },
    [session],
  )

  const groupSelected = useCallback(() => {
    const members = layoutTargets(selectedIds, objects)
    if (members.length < 2) return
    const box = unionBoxes(members.map((o) => objectAABB(o)))
    const id = newId('obj')
    const group: BoardObject = {
      id,
      type: 'group',
      x: box.x - 8,
      y: box.y - 8,
      w: box.w + 16,
      h: box.h + 16,
      rotation: 0,
      z: nextZ(objects),
      fill: 'transparent',
      stroke: canvas.frameStroke,
      strokeWidth: 1,
      attachments: [],
    }
    session.withBatch(() => {
      session.createObject(group)
      for (const m of members) session.updateObject(m.id, 'parentId', id)
    })
    setSelectedIds([id])
  }, [canvas.frameStroke, objects, selectedIds, session, setSelectedIds])

  const copySelected = useCallback(async () => {
    const set = collectCopySet(selectedIds, objects)
    if (!set.length) return
    rememberCopy(set)
    try {
      await navigator.clipboard.writeText(toClipText(set))
    } catch {
      /* in-memory clipboard still works */
    }
  }, [objects, selectedIds])

  const pasteClipboard = useCallback(async () => {
    let source = memoryCopy()
    try {
      const parsed = parseClip(await navigator.clipboard.readText())
      if (parsed?.length) source = parsed
    } catch {
      /* use memory */
    }
    if (!source.length) return
    const clones = cloneForPaste(source, objects)
    session.withBatch(() => {
      for (const o of clones) session.createObject(o)
    })
    setSelectedIds(clones.map((o) => o.id))
    setTool('select')
  }, [objects, session, setSelectedIds, setTool])

  const addImageFiles = useCallback(
    async (files: File[], at: { x: number; y: number }) => {
      const ids: string[] = []
      const live = { ...objects }
      let i = 0
      let lastError = ''
      const created: BoardObject[] = []
      for (const file of files) {
        if (file.size > IMAGE_MAX_BYTES) {
          lastError = 'Image is too large (max 12MB)'
          continue
        }
        try {
          const ready = await ensureUploadable(file)
          const dims = await imageNaturalSize(ready)
          const fitted = fitImageSize(dims.w, dims.h)
          const uploaded = await api.uploadAsset(boardId, ready)
          const x = at.x - fitted.w / 2 + i * 24
          const y = at.y - fitted.h / 2 + i * 24
          const host = containerAt(x + fitted.w / 2, y + fitted.h / 2, live, new Set())
          const obj = imageObject({
            id: newId('obj'),
            z: nextZ(live),
            x,
            y,
            w: fitted.w,
            h: fitted.h,
            src: uploaded.src,
            text: file.name,
            parentId: host?.id,
          })
          created.push(obj)
          live[obj.id] = obj
          ids.push(obj.id)
          i += 1
        } catch (err) {
          lastError = err instanceof Error ? err.message : 'Could not paste image'
          console.warn('image paste failed', err)
        }
      }
      if (created.length) {
        session.withBatch(() => {
          for (const obj of created) session.createObject(obj)
        })
        setSelectedIds(ids)
        setTool('select')
        setNotice(null)
      } else if (lastError) {
        setNotice(lastError)
        window.setTimeout(() => setNotice(null), 4000)
      }
    },
    [boardId, objects, session, setSelectedIds, setTool],
  )

  const ungroupSelected = useCallback(() => {
    const groups = new Set<string>()
    for (const id of selectedIds) {
      const o = objects[id]
      if (!o) continue
      if (o.type === 'group') groups.add(id)
      else if (o.parentId && objects[o.parentId]?.type === 'group') groups.add(o.parentId)
    }
    const nextSel: string[] = []
    for (const g of groups) {
      for (const o of Object.values(objects)) {
        if (o.parentId === g) nextSel.push(o.id)
      }
    }
    session.withBatch(() => {
      for (const g of groups) session.deleteObject(g)
    })
    setSelectedIds(nextSel)
  }, [objects, selectedIds, session, setSelectedIds])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        if (e.shiftKey) ungroupSelected()
        else groupSelected()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        void copySelected()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        void copySelected().then(() => pasteClipboard())
        return
      }
      if (e.key === ']' || e.key === '[') {
        e.preventDefault()
        applyPatches(zPatches(e.key === ']' ? 'forward' : 'backward', selectedIds, objects))
        return
      }
      const t = toolKeys[e.key.toLowerCase()]
      if (t && !e.metaKey && !e.ctrlKey) setTool(t)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        session.redo()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) session.redo()
        else session.undo()
        return
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && selectedIds.length) {
        e.preventDefault()
        session.withBatch(() => {
          for (const id of selectedIds) session.deleteObject(id)
        })
        setSelectedIds([])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    applyPatches,
    copySelected,
    groupSelected,
    objects,
    pasteClipboard,
    selectedIds,
    session,
    setSelectedIds,
    setTool,
    ungroupSelected,
  ])

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      const images = imageFilesFromClipboard(e.clipboardData)
      if (images.length) {
        e.preventDefault()
        const at = canvasRef.current?.viewCenter() ?? { x: 80, y: 80 }
        void persistImageFiles(images).then((files) => addImageFiles(files, at))
        return
      }
      e.preventDefault()
      void pasteClipboard()
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addImageFiles, pasteClipboard])

  useEffect(() => {
    if (isThemeStroke(stroke)) setStroke(canvas.defaultStroke)
  }, [canvas.defaultStroke, setStroke, stroke])

  useEffect(() => {
    if (tool === 'postit') setFill(POSTIT_FILL)
    if (tool === 'text') setFill(canvas.ink)
    if (tool === 'frame' || tool === 'lane') setFill(canvas.frame)
  }, [tool, canvas.ink, canvas.frame, setFill])

  const applyColor = (kind: 'fill' | 'stroke', color: string) => {
    if (kind === 'fill') setFill(color)
    else setStroke(color)
    if (!selectedIds.length) return
    session.withBatch(() => {
      for (const id of selectedIds) session.updateObject(id, kind, color)
    })
  }

  const boardMeta: Meta = localMeta ?? session.meta ?? {
    id: boardId,
    name: 'Board',
    createdAt: '',
    users: [],
  }

  const withPrompt = (title: string, action: (password?: string) => Promise<void>) => {
    void runProtected(boardMeta, action, (run) => setPrompt({ title, run })).catch((e: Error) =>
      setNotice(e.message),
    )
  }

  return (
    <div className="flex h-svh flex-col bg-background" onClick={() => setMenuOpen(false)}>
      <header
        className={`pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3 ${
          menuOpen ? 'z-30' : 'z-10'
        }`}
      >
        <div className="pointer-events-auto relative flex h-14 items-center gap-3 rounded-3xl bg-card px-4 shadow-card">
          <Brand />
          <span className="text-muted-foreground">/</span>
          <span className="max-w-[14rem] truncate text-sm font-semibold">
            {session.meta?.name ?? 'Board'}
          </span>
          <span
            className="ml-1 size-2 rounded-full"
            title={session.connected ? 'Live' : 'Reconnecting'}
            style={{ background: session.connected ? 'var(--success)' : 'var(--muted-foreground)' }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            hint="Embed & share"
            onClick={(e) => {
              e.stopPropagation()
              setEmbedOpen(true)
            }}
          >
            <Code2 />
          </Button>
          <div className="relative">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              hint="Board menu"
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen((v) => !v)
              }}
            >
              <Ellipsis />
            </Button>
            {menuOpen && (
              <div onClick={(e) => e.stopPropagation()}>
                <BoardMenu className="absolute right-0 top-full z-30 mt-1 min-w-[11rem] rounded-2xl bg-card p-1 shadow-card">
                  <MenuItem
                    onClick={() => {
                      setMenuOpen(false)
                      setPasswordOpen(true)
                    }}
                  >
                    <KeyRound className="size-4" /> Password
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setMenuOpen(false)
                      setHistoryOpen(true)
                    }}
                  >
                    <History className="size-4" /> History
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setMenuOpen(false)
                      withPrompt('Download board', async (password) => {
                        await downloadBoard(boardMeta, password)
                      })
                    }}
                  >
                    <Download className="size-4" /> Download
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setMenuOpen(false)
                      withPrompt('Archive board', async (password) => {
                        await api.archiveBoard(boardId, password)
                        nav('/')
                      })
                    }}
                  >
                    <Archive className="size-4" /> Archive
                  </MenuItem>
                  <MenuItem
                    destructive
                    onClick={() => {
                      setMenuOpen(false)
                      setDeleteOpen(true)
                    }}
                  >
                    <Trash2 className="size-4" /> Delete
                  </MenuItem>
                </BoardMenu>
              </div>
            )}
          </div>
        </div>
        <div className="pointer-events-auto flex h-14 items-center gap-1 rounded-3xl bg-card px-2 shadow-card">
          <div className="flex items-center -space-x-1.5 px-2">
            {session.presence.map((p) => (
              <span
                key={p.sessionId}
                title={p.name}
                className="size-7 rounded-full border-2 border-card"
                style={{ background: p.color }}
              />
            ))}
            <span className="pl-2 pr-1 text-xs font-semibold text-muted-foreground">{user.name}</span>
          </div>
          <ThemeToggle />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            hint={snapEnabled ? 'Snap on (toggle)' : 'Snap off (toggle)'}
            data-active={snapEnabled}
            onClick={() => {
              setSnapEnabled((v) => {
                writeSnapEnabled(!v)
                return !v
              })
            }}
          >
            <Magnet />
          </Button>
          <Button type="button" variant="ghost" hint="Chat" onClick={() => setChatOpen(!chatOpen)}>
            <MessageCircle /> Chat
          </Button>
        </div>
      </header>

      <div className="pointer-events-none absolute bottom-4 left-3 top-[5.5rem] z-10 flex items-start">
        <Toolbar
          tool={tool}
          onTool={setTool}
          fill={fill}
          stroke={stroke}
          onFill={(c) => applyColor('fill', c)}
          onStroke={(c) => applyColor('stroke', c)}
        />
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <BoardCanvas
            ref={canvasRef}
            objects={objects}
            selectedIds={selectedIds}
            onSelect={setSelectedIds}
            tool={tool}
            fill={fill}
            stroke={stroke}
            strokeWidth={2}
            cursors={Object.values(session.cursors)}
            onCreate={(obj) => {
              session.createObject(obj)
              if (obj.type !== 'connector' && obj.type !== 'sticker' && tool !== 'mindmap') {
                setTool('select')
              }
              setSelectedIds([obj.id])
            }}
            onCreateMany={(objs) => {
              session.withBatch(() => {
                for (const o of objs) session.createObject(o)
              })
              const last = [...objs].reverse().find((o) => o.type !== 'connector')
              if (last) setSelectedIds([last.id])
            }}
            onUpdate={session.updateObject}
            onLiveMove={(id, x, y) => {
              session.updateObjectLive(id, 'x', x)
              session.updateObjectLive(id, 'y', y)
            }}
            onCursor={session.sendCursor}
            onImages={(files, at) => {
              void persistImageFiles(files).then((copies) => addImageFiles(copies, at))
            }}
            textStyle={typeStyle}
            stickerEmoji={stickerEmoji}
            snapEnabled={snapEnabled}
          />
          {notice && (
            <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center">
              <div className="rounded-2xl bg-card px-4 py-2 text-sm font-medium shadow-card">
                {notice}
              </div>
            </div>
          )}
          {(selectedIds.length > 0 || showType || showSticker) && (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-20">
              <div className="pointer-events-auto flex max-w-[min(96vw,64rem)] flex-wrap items-center justify-center gap-2 rounded-3xl bg-card p-2 shadow-card">
                {selectedIds.length > 0 && (
                  <LayoutBar
                    selectedIds={selectedIds}
                    objects={objects}
                    onAlign={(kind: Align) => applyPatches(alignPatches(kind, selectedIds, objects))}
                    onDistribute={(axis) => applyPatches(distributePatches(axis, selectedIds, objects))}
                    onZ={(action) => applyPatches(zPatches(action, selectedIds, objects))}
                    onGroup={groupSelected}
                    onUngroup={ungroupSelected}
                  />
                )}
                {showType && (
                  <>
                    {selectedIds.length > 0 ? <span className="h-8 w-px bg-border" /> : null}
                    <TextFormatBar
                      obj={typeTarget}
                      onChange={(path, value) => {
                        if (selected && isTexty(selected.type)) session.updateObject(selected.id, path, value)
                        if (path === 'fontFamily') setTypeStyle((s) => ({ ...s, fontFamily: String(value) }))
                        if (path === 'fontSize') setTypeStyle((s) => ({ ...s, fontSize: Number(value) }))
                        if (path === 'bold') setTypeStyle((s) => ({ ...s, bold: Boolean(value) }))
                        if (path === 'italic') setTypeStyle((s) => ({ ...s, italic: Boolean(value) }))
                        if (path === 'textAlign' && (value === 'left' || value === 'center' || value === 'right')) {
                          setTypeStyle((s) => ({ ...s, textAlign: value }))
                        }
                      }}
                    />
                  </>
                )}
                {showSticker && (
                  <>
                    {(selectedIds.length > 0 || showType) ? <span className="h-8 w-px bg-border" /> : null}
                    <StickerBar
                      emoji={activeStickerEmoji}
                      onPick={(e) => {
                        setStickerEmoji(e)
                        if (selected?.type === 'sticker') session.updateObject(selected.id, 'text', e)
                      }}
                    />
                  </>
                )}
                {selected && (
                  <>
                    <span className="h-8 w-px bg-border" />
                    <AttachBar
                      obj={selected}
                      user={user}
                      onAttachments={(next: Attachment[]) => session.updateObject(selected.id, 'attachments', next)}
                      onDelete={() => {
                        session.deleteObject(selected.id)
                        setSelectedIds([])
                      }}
                    />
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        <ChatPanel
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          messages={session.chat}
          onSend={session.sendChat}
        />
      </div>

      {passwordOpen && (
        <SetPasswordDialog
          open
          board={boardMeta}
          onClose={() => setPasswordOpen(false)}
          onDone={(m) => {
            setLocalMeta(m)
            setPasswordOpen(false)
          }}
        />
      )}
      {embedOpen && (
        <EmbedDialog
          open
          boardId={boardId}
          boardName={boardMeta.name}
          onClose={() => setEmbedOpen(false)}
        />
      )}
      {deleteOpen && (
        <DeleteBoardDialog
          open
          board={boardMeta}
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => nav('/')}
        />
      )}
      {prompt && (
        <PasswordPromptDialog
          open
          title={prompt.title}
          onClose={() => setPrompt(null)}
          onConfirm={async (password) => {
            await prompt.run(password)
          }}
        />
      )}
      <HistoryPanel
        open={historyOpen}
        boardId={boardId}
        onClose={() => setHistoryOpen(false)}
      />
    </div>
  )
}

function readUser(boardId: string): User | null {
  try {
    const raw = sessionStorage.getItem(sessionKey(boardId))
    if (!raw) return null
    return JSON.parse(raw) as User
  } catch {
    return null
  }
}

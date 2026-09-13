import { useCallback, useEffect, useRef, useState } from 'react'
import { applyOp } from './ops'
import type {
  BoardObject,
  ChatMessage,
  DocumentState,
  Meta,
  Op,
  RemoteCursor,
  Session,
  User,
  WsIncoming,
} from './types'
import { getSessionId, newId, readUnlockToken } from './utils'

type Inverse = Op

type UndoStep = {
  undo: Inverse[]
  redo: Op[]
}

export function useBoardSession(boardId: string, user: User) {
  const [doc, setDoc] = useState<DocumentState>({ rev: 0, objects: {} })
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [meta, setMeta] = useState<Meta | null>(null)
  const [presence, setPresence] = useState<Session[]>([])
  const [cursors, setCursors] = useState<Record<string, RemoteCursor>>({})
  const [ready, setReady] = useState(false)
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const pendingRef = useRef(new Set<string>())
  const undoRef = useRef<UndoStep[]>([])
  const redoRef = useRef<UndoStep[]>([])
  const batchRef = useRef<UndoStep | null>(null)
  const replayingRef = useRef(false)
  const objectsRef = useRef(doc.objects)
  objectsRef.current = doc.objects

  const send = useCallback((payload: unknown) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload))
    }
  }, [])

  const pushUndo = useCallback((step: UndoStep) => {
    if (!step.undo.length) return
    undoRef.current.push(step)
    if (undoRef.current.length > 80) undoRef.current.shift()
    if (!replayingRef.current) redoRef.current = []
  }, [])

  const commitOp = useCallback(
    (op: Op, inverse?: Inverse) => {
      pendingRef.current.add(op.id)
      setDoc((d) => applyOp(d, op))
      send({ type: 'op', op })
      if (!inverse || replayingRef.current) return
      const batch = batchRef.current
      if (batch) {
        batch.redo.push(op)
        batch.undo.push(inverse)
        return
      }
      pushUndo({ undo: [inverse], redo: [op] })
    },
    [pushUndo, send],
  )

  const withBatch = useCallback(
    (fn: () => void) => {
      if (batchRef.current) {
        fn()
        return
      }
      batchRef.current = { undo: [], redo: [] }
      try {
        fn()
      } finally {
        const step = batchRef.current
        batchRef.current = null
        if (step && step.undo.length) pushUndo(step)
      }
    },
    [pushUndo],
  )

  const createObject = useCallback(
    (obj: BoardObject) => {
      const op: Op = {
        id: newId('op'),
        type: 'create',
        objectId: obj.id,
        value: obj,
        actorId: user.id,
      }
      const inverse: Op = {
        id: newId('op'),
        type: 'delete',
        objectId: obj.id,
        actorId: user.id,
      }
      commitOp(op, inverse)
    },
    [commitOp, user.id],
  )

  const updateObjectLive = useCallback(
    (objectId: string, path: string, value: unknown) => {
      const op: Op = {
        id: newId('op'),
        type: 'update',
        objectId,
        path,
        value,
        actorId: user.id,
      }
      pendingRef.current.add(op.id)
      send({ type: 'op', op })
    },
    [send, user.id],
  )

  const updateObject = useCallback(
    (objectId: string, path: string, value: unknown) => {
      const prev = objectsRef.current[objectId] as unknown as Record<string, unknown> | undefined
      const op: Op = {
        id: newId('op'),
        type: 'update',
        objectId,
        path,
        value,
        actorId: user.id,
      }
      const inverse: Op | undefined = prev
        ? {
            id: newId('op'),
            type: 'update',
            objectId,
            path,
            value: prev[path],
            actorId: user.id,
          }
        : undefined
      commitOp(op, inverse)
    },
    [commitOp, user.id],
  )

  const deleteObject = useCallback(
    (objectId: string) => {
      const prev = objectsRef.current[objectId]
      if (!prev) return
      const op: Op = {
        id: newId('op'),
        type: 'delete',
        objectId,
        actorId: user.id,
      }
      const inverse: Op = {
        id: newId('op'),
        type: 'create',
        objectId,
        value: prev,
        actorId: user.id,
      }
      commitOp(op, inverse)
    },
    [commitOp, user.id],
  )

  const applyHistoryOp = useCallback(
    (template: Op) => {
      const op: Op = { ...template, id: newId('op'), value: template.value }
      pendingRef.current.add(op.id)
      setDoc((d) => applyOp(d, op))
      send({ type: 'op', op })
    },
    [send],
  )

  const undo = useCallback(() => {
    const step = undoRef.current.pop()
    if (!step) return
    replayingRef.current = true
    for (const inv of [...step.undo].reverse()) applyHistoryOp(inv)
    redoRef.current.push(step)
    replayingRef.current = false
  }, [applyHistoryOp])

  const redo = useCallback(() => {
    const step = redoRef.current.pop()
    if (!step) return
    replayingRef.current = true
    for (const op of step.redo) applyHistoryOp(op)
    undoRef.current.push(step)
    if (undoRef.current.length > 80) undoRef.current.shift()
    replayingRef.current = false
  }, [applyHistoryOp])

  const sendCursor = useCallback(
    (x: number, y: number) => {
      send({ type: 'cursor', x, y })
    },
    [send],
  )

  const sendChat = useCallback(
    (text: string) => {
      send({ type: 'chat', text })
    },
    [send],
  )

  useEffect(() => {
    const sessionId = getSessionId()
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const unlock = readUnlockToken(boardId)
    const unlockQ = unlock ? `&unlock=${encodeURIComponent(unlock)}` : ''
    const url = `${proto}//${location.host}/ws/boards/${boardId}?userId=${encodeURIComponent(user.id)}&sessionId=${encodeURIComponent(sessionId)}${unlockQ}`
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)
    ws.onclose = () => {
      setConnected(false)
      setReady(false)
    }
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as WsIncoming
      if (msg.type === 'state') {
        if (msg.document) setDoc(msg.document)
        if (msg.chat) setChat(msg.chat.messages ?? [])
        if (msg.meta) setMeta(msg.meta)
        if (msg.presence) setPresence(msg.presence)
        setReady(true)
        undoRef.current = []
        redoRef.current = []
      } else if (msg.type === 'op' && msg.op) {
        if (pendingRef.current.has(msg.op.id)) {
          pendingRef.current.delete(msg.op.id)
          setDoc((d) => ({ ...d, rev: msg.op!.seq ?? d.rev }))
        } else {
          setDoc((d) => applyOp(d, msg.op!))
        }
      } else if (msg.type === 'cursor' && msg.sessionId) {
        if (msg.sessionId === sessionId) return
        setCursors((c) => ({
          ...c,
          [msg.sessionId!]: {
            sessionId: msg.sessionId!,
            userId: msg.userId ?? '',
            name: msg.name ?? '',
            color: msg.color ?? '#888',
            x: msg.x ?? 0,
            y: msg.y ?? 0,
          },
        }))
      } else if (msg.type === 'presence') {
        setPresence(msg.presence ?? [])
        const live = new Set((msg.presence ?? []).map((s) => s.sessionId))
        setCursors((c) => {
          const next = { ...c }
          for (const k of Object.keys(next)) {
            if (!live.has(k)) delete next[k]
          }
          return next
        })
      } else if (msg.type === 'chat' && msg.message) {
        setChat((rows) => [...rows, msg.message!])
      }
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [boardId, user.id])

  return {
    doc,
    chat,
    meta,
    presence,
    cursors,
    ready,
    connected,
    createObject,
    updateObject,
    updateObjectLive,
    deleteObject,
    withBatch,
    undo,
    redo,
    sendCursor,
    sendChat,
  }
}

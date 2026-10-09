import { useCallback, useEffect, useRef, useState } from 'react'
import { applyOp, applyOps } from './ops'
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

const RETRY_BASE_MS = 500
const RETRY_MAX_MS = 10_000
const HEARTBEAT_MS = 20_000
const STALE_MS = 45_000
const CLOSE_POLICY_VIOLATION = 1008

export function useBoardSession(boardId: string, user: User) {
  const [doc, setDoc] = useState<DocumentState>({ rev: 0, objects: {} })
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [meta, setMeta] = useState<Meta | null>(null)
  const [presence, setPresence] = useState<Session[]>([])
  const [cursors, setCursors] = useState<Record<string, RemoteCursor>>({})
  const [ready, setReady] = useState(false)
  const [connected, setConnected] = useState(false)
  const [fatal, setFatal] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)
  /** True once the current socket has received its `state`; ops sent earlier would race the rebase. */
  const syncedRef = useRef(false)
  /** Committed ops not yet acknowledged by the server, in send order. Replayed after reconnect. */
  const outboxRef = useRef(new Map<string, Op>())
  /** Streaming (drag) ops: never queued, only used to recognise their echo. */
  const liveOpsRef = useRef(new Set<string>())
  const undoRef = useRef<UndoStep[]>([])
  const redoRef = useRef<UndoStep[]>([])
  const batchRef = useRef<UndoStep | null>(null)
  const batchOpsRef = useRef<Op[] | null>(null)
  const replayingRef = useRef(false)
  const objectsRef = useRef(doc.objects)
  objectsRef.current = doc.objects

  const send = useCallback((payload: unknown) => {
    const ws = wsRef.current
    if (ws && syncedRef.current && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload))
      return true
    }
    return false
  }, [])

  const syncPending = useCallback(() => setPendingCount(outboxRef.current.size), [])

  const sendOp = useCallback(
    (op: Op) => {
      outboxRef.current.set(op.id, op)
      syncPending()
      send({ type: 'op', op })
    },
    [send, syncPending],
  )

  const pushUndo = useCallback((step: UndoStep) => {
    if (!step.undo.length) return
    undoRef.current.push(step)
    if (undoRef.current.length > 80) undoRef.current.shift()
    if (!replayingRef.current) redoRef.current = []
  }, [])

  const commitOp = useCallback(
    (op: Op, inverse?: Inverse) => {
      const batch = batchRef.current
      if (batch) {
        batchOpsRef.current?.push(op)
        sendOp(op)
        if (!inverse || replayingRef.current) return
        batch.redo.push(op)
        batch.undo.push(inverse)
        return
      }
      setDoc((d) => applyOp(d, op))
      sendOp(op)
      if (!inverse || replayingRef.current) return
      pushUndo({ undo: [inverse], redo: [op] })
    },
    [pushUndo, sendOp],
  )

  const withBatch = useCallback(
    (fn: () => void) => {
      if (batchRef.current) {
        fn()
        return
      }
      batchRef.current = { undo: [], redo: [] }
      batchOpsRef.current = []
      try {
        fn()
      } finally {
        const step = batchRef.current
        const ops = batchOpsRef.current ?? []
        batchRef.current = null
        batchOpsRef.current = null
        if (ops.length) setDoc((d) => applyOps(d, ops))
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
      if (send({ type: 'op', op })) liveOpsRef.current.add(op.id)
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

  const replayOps = useCallback(
    (templates: Op[]) => {
      const ops: Op[] = templates.map((template) => ({
        ...template,
        id: newId('op'),
        value: template.value,
      }))
      if (ops.length) setDoc((d) => applyOps(d, ops))
      for (const op of ops) sendOp(op)
    },
    [sendOp],
  )

  const undo = useCallback(() => {
    const step = undoRef.current.pop()
    if (!step) return
    replayingRef.current = true
    replayOps([...step.undo].reverse())
    redoRef.current.push(step)
    replayingRef.current = false
  }, [replayOps])

  const redo = useCallback(() => {
    const step = redoRef.current.pop()
    if (!step) return
    replayingRef.current = true
    replayOps(step.redo)
    undoRef.current.push(step)
    if (undoRef.current.length > 80) undoRef.current.shift()
    replayingRef.current = false
  }, [replayOps])

  const sendCursor = useCallback(
    (x: number, y: number) => {
      send({ type: 'cursor', x, y })
    },
    [send],
  )

  const sendChat = useCallback(
    (text: string) => send({ type: 'chat', text }),
    [send],
  )

  useEffect(() => {
    const sessionId = getSessionId()
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    let ws: WebSocket | null = null
    let stopped = false
    let attempt = 0
    let retryTimer: number | undefined
    let lastSeen = Date.now()
    let firstState = true
    let stateOnSocket = false
    const outbox = outboxRef.current
    const liveOps = liveOpsRef.current

    const buildUrl = () => {
      const unlock = readUnlockToken(boardId)
      const unlockQ = unlock ? `&unlock=${encodeURIComponent(unlock)}` : ''
      return `${proto}//${location.host}/ws/boards/${boardId}?userId=${encodeURIComponent(user.id)}&sessionId=${encodeURIComponent(sessionId)}${unlockQ}`
    }

    const scheduleRetry = () => {
      if (stopped || retryTimer !== undefined) return
      const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt)
      attempt++
      retryTimer = window.setTimeout(
        () => {
          retryTimer = undefined
          connect()
        },
        delay / 2 + Math.random() * (delay / 2),
      )
    }

    const detach = (sock: WebSocket, code?: number) => {
      if (ws !== sock) return
      sock.onopen = sock.onclose = sock.onmessage = null
      if (sock.readyState === WebSocket.CONNECTING || sock.readyState === WebSocket.OPEN) sock.close()
      ws = null
      wsRef.current = null
      syncedRef.current = false
      liveOpsRef.current.clear()
      setConnected(false)
      setReady(false)
      if (code === CLOSE_POLICY_VIOLATION) {
        stopped = true
        setFatal(true)
        return
      }
      scheduleRetry()
    }

    const reconnectNow = () => {
      if (stopped || ws) return
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer)
        retryTimer = undefined
      }
      attempt = 0
      connect()
    }

    const onState = (sock: WebSocket, msg: WsIncoming) => {
      attempt = 0
      const resetHistory = firstState || stateOnSocket
      firstState = false
      stateOnSocket = true
      const queued = [...outbox.values()]
      if (msg.document) setDoc(applyOps(msg.document, queued))
      if (msg.chat) setChat(msg.chat.messages ?? [])
      if (msg.meta) setMeta(msg.meta)
      if (msg.presence) setPresence(msg.presence)
      setCursors({})
      liveOpsRef.current.clear()
      if (resetHistory) {
        undoRef.current = []
        redoRef.current = []
      }
      syncedRef.current = true
      setReady(true)
      setConnected(true)
      for (const op of queued) sock.send(JSON.stringify({ type: 'op', op }))
    }

    const connect = () => {
      if (stopped || ws) return
      const sock = new WebSocket(buildUrl())
      ws = sock
      wsRef.current = sock
      stateOnSocket = false
      lastSeen = Date.now()
      sock.onopen = () => {
        lastSeen = Date.now()
      }
      sock.onclose = (ev) => detach(sock, ev.code)
      sock.onmessage = (ev) => {
        lastSeen = Date.now()
        handleMessage(sock, JSON.parse(ev.data as string) as WsIncoming)
      }
    }

    const heartbeat = window.setInterval(() => {
      if (!ws) return
      if (Date.now() - lastSeen > STALE_MS) {
        detach(ws)
        return
      }
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
    }, HEARTBEAT_MS)

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (ws && Date.now() - lastSeen > STALE_MS) detach(ws)
      reconnectNow()
    }

    window.addEventListener('online', reconnectNow)
    document.addEventListener('visibilitychange', onVisible)

    const handleMessage = (sock: WebSocket, msg: WsIncoming) => {
      if (msg.type === 'state') {
        onState(sock, msg)
      } else if (msg.type === 'op' && msg.op) {
        const op = msg.op
        if (outboxRef.current.delete(op.id)) {
          syncPending()
          setDoc((d) => ({ ...d, rev: op.seq ?? d.rev }))
        } else if (liveOpsRef.current.delete(op.id)) {
          setDoc((d) => ({ ...d, rev: op.seq ?? d.rev }))
        } else {
          setDoc((d) => applyOp(d, op))
        }
      } else if (msg.type === 'error') {
        if (msg.op) {
          liveOpsRef.current.delete(msg.op.id)
          if (outboxRef.current.delete(msg.op.id)) syncPending()
        }
        if (msg.error) console.warn('liro:', msg.error)
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

    connect()

    return () => {
      stopped = true
      if (retryTimer !== undefined) clearTimeout(retryTimer)
      clearInterval(heartbeat)
      window.removeEventListener('online', reconnectNow)
      document.removeEventListener('visibilitychange', onVisible)
      if (ws) {
        const sock = ws
        sock.onopen = sock.onclose = sock.onmessage = null
        sock.close()
      }
      ws = null
      wsRef.current = null
      syncedRef.current = false
      outbox.clear()
      liveOps.clear()
      setPendingCount(0)
      setFatal(false)
    }
  }, [boardId, user.id, syncPending])

  return {
    doc,
    chat,
    meta,
    presence,
    cursors,
    ready,
    connected,
    fatal,
    pendingCount,
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

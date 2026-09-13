import type { Meta, SnapshotInfo, User } from './types'
import { readUnlockToken, writeUnlockToken } from './utils'

export type UploadedAsset = {
  name: string
  src: string
  type: string
}

type UnlockResult = {
  token: string
  expiresAt: string
}

function unlockHeaders(boardId?: string, password?: string): HeadersInit {
  const headers: Record<string, string> = {}
  if (boardId) {
    const token = readUnlockToken(boardId)
    if (token) headers['X-Board-Unlock'] = token
  }
  if (password) headers['X-Board-Password'] = password
  return headers
}

async function req<T>(path: string, init?: RequestInit & { boardId?: string }): Promise<T> {
  const { boardId, headers: initHeaders, ...rest } = init ?? {}
  const headers: Record<string, string> = {
    ...(initHeaders as Record<string, string>),
  }
  if (!headers['Content-Type'] && rest.body && !(rest.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }
  if (boardId) {
    const token = readUnlockToken(boardId)
    if (token) headers['X-Board-Unlock'] = token
  }
  const res = await fetch(path, {
    ...rest,
    headers,
  })
  if (!res.ok) {
    let msg = res.statusText
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) msg = body.error
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  listBoards: (opts?: { archived?: boolean }) =>
    req<Meta[]>(`/api/boards${opts?.archived ? '?archived=1' : ''}`),
  createBoard: (name: string) =>
    req<Meta>('/api/boards', { method: 'POST', body: JSON.stringify({ name }) }),
  getBoard: (id: string) => req<Meta>(`/api/boards/${id}`, { boardId: id }),
  unlockBoard: async (id: string, password: string) => {
    const out = await req<UnlockResult>(`/api/boards/${id}/unlock`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    })
    writeUnlockToken(id, out.token)
    return out
  },
  setPassword: (id: string, password: string, newPassword: string) =>
    req<Meta>(`/api/boards/${id}/password`, {
      method: 'POST',
      boardId: id,
      body: JSON.stringify({ password, newPassword }),
    }),
  archiveBoard: (id: string, password?: string) =>
    req<Meta>(`/api/boards/${id}/archive`, {
      method: 'POST',
      boardId: id,
      body: JSON.stringify({ password: password ?? '' }),
    }),
  restoreBoard: (id: string, password?: string) =>
    req<Meta>(`/api/boards/${id}/restore`, {
      method: 'POST',
      boardId: id,
      body: JSON.stringify({ password: password ?? '' }),
    }),
  deleteBoard: (id: string, password?: string) =>
    req<void>(`/api/boards/${id}`, {
      method: 'DELETE',
      boardId: id,
      headers: unlockHeaders(id, password),
      body: JSON.stringify({ password: password ?? '' }),
    }),
  exportBoard: async (id: string, password?: string) => {
    const headers = unlockHeaders(id, password) as Record<string, string>
    const res = await fetch(`/api/boards/${id}/export`, { headers })
    if (!res.ok) {
      let msg = res.statusText
      try {
        const data = (await res.json()) as { error?: string }
        if (data.error) msg = data.error
      } catch {
        /* ignore */
      }
      throw new Error(msg)
    }
    const blob = await res.blob()
    const dispo = res.headers.get('Content-Disposition') ?? ''
    const match = /filename="([^"]+)"/.exec(dispo)
    return { blob, filename: match?.[1] ?? 'board.liro.zip' }
  },
  importBoard: async (file: File) => {
    const body = new FormData()
    body.append('file', file)
    const res = await fetch('/api/boards/import', { method: 'POST', body })
    if (!res.ok) {
      let msg = res.statusText
      try {
        const data = (await res.json()) as { error?: string }
        if (data.error) msg = data.error
      } catch {
        /* ignore */
      }
      throw new Error(msg)
    }
    return (await res.json()) as Meta
  },
  listUsers: (id: string) => req<User[]>(`/api/boards/${id}/users`, { boardId: id }),
  addUser: (id: string, name: string) =>
    req<User>(`/api/boards/${id}/users`, {
      method: 'POST',
      boardId: id,
      body: JSON.stringify({ name }),
    }),
  listSnapshots: (id: string) => req<SnapshotInfo[]>(`/api/boards/${id}/snapshots`, { boardId: id }),
  uploadAsset: async (boardId: string, file: File) => {
    const body = new FormData()
    body.append('file', file)
    const headers = unlockHeaders(boardId) as Record<string, string>
    const res = await fetch(`/api/boards/${boardId}/assets`, { method: 'POST', body, headers })
    if (!res.ok) {
      let msg = res.statusText
      try {
        const data = (await res.json()) as { error?: string }
        if (data.error) msg = data.error
      } catch {
        /* ignore */
      }
      throw new Error(msg)
    }
    return (await res.json()) as UploadedAsset
  },
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

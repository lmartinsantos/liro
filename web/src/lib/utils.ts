import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function newId(prefix: string) {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${prefix}_${hex}`
}

export function sessionKey(boardId: string) {
  return `liro.user.${boardId}`
}

export function unlockKey(boardId: string) {
  return `liro.unlock.${boardId}`
}

export function readUnlockToken(boardId: string): string | null {
  return sessionStorage.getItem(unlockKey(boardId))
}

export function writeUnlockToken(boardId: string, token: string) {
  sessionStorage.setItem(unlockKey(boardId), token)
}

export function clearUnlockToken(boardId: string) {
  sessionStorage.removeItem(unlockKey(boardId))
}

export function getSessionId() {
  const key = 'liro.sessionId'
  let id = sessionStorage.getItem(key)
  if (!id) {
    id = newId('ses')
    sessionStorage.setItem(key, id)
  }
  return id
}

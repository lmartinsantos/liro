import type { BoardObject } from './types'

export const IMAGE_MAX_BYTES = 12 * 1024 * 1024
const MAX_EDGE = 720

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export function isImageType(type: string) {
  return ALLOWED.has(type)
}

export function isImageFile(file: File) {
  if (ALLOWED.has(file.type)) return true
  return !file.type && /\.(png|jpe?g|gif|webp)$/i.test(file.name)
}

export function imageFilesFromClipboard(data: DataTransfer | null) {
  if (!data) return []
  const fromItems: File[] = []
  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i]
    if (item.kind === 'file' && (isImageType(item.type) || item.type.startsWith('image/'))) {
      const file = item.getAsFile()
      if (file) fromItems.push(file)
    }
  }
  if (fromItems.length) return preferUploadable(fromItems)
  return preferUploadable([...data.files].filter((f) => isImageFile(f) || f.type.startsWith('image/')))
}

/** Clipboard blobs can vanish after the paste event; copy bytes immediately. */
export function persistImageFiles(files: File[]) {
  return Promise.all(
    files.map(async (file) => {
      const buf = await file.arrayBuffer()
      const type = file.type.startsWith('image/') ? file.type : 'image/png'
      const ext = type === 'image/jpeg' ? 'jpg' : type.split('/')[1] || 'png'
      return new File([buf], file.name || `paste.${ext}`, { type })
    }),
  )
}

export async function ensureUploadable(file: File) {
  if (isImageType(file.type)) return file
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not read image')
  ctx.drawImage(bitmap, 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((next) => (next ? resolve(next) : reject(new Error('Could not encode image'))), 'image/png')
  })
  return new File([blob], `${file.name || 'paste'}.png`, { type: 'image/png' })
}

function preferUploadable(files: File[]) {
  const preferred = files.filter((f) => isImageType(f.type))
  return preferred.length ? preferred : files
}

export function imageFilesFromDataTransfer(data: DataTransfer | null) {
  if (!data) return []
  return [...data.files].filter((f) => isImageFile(f) || f.type.startsWith('image/'))
}

export function imageNaturalSize(file: File) {
  return new Promise<{ w: number; h: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('invalid image'))
    }
    img.src = url
  })
}

export function fitImageSize(w: number, h: number, max = MAX_EDGE) {
  if (w < 1 || h < 1) return { w: 240, h: 180 }
  const s = Math.min(1, max / Math.max(w, h))
  return { w: Math.max(32, Math.round(w * s)), h: Math.max(32, Math.round(h * s)) }
}

export function imageObject(partial: {
  id: string
  z: string
  x: number
  y: number
  w: number
  h: number
  src: string
  text?: string
  parentId?: string
}): BoardObject {
  return {
    id: partial.id,
    type: 'image',
    x: partial.x,
    y: partial.y,
    w: partial.w,
    h: partial.h,
    rotation: 0,
    z: partial.z,
    fill: 'transparent',
    stroke: '',
    strokeWidth: 0,
    src: partial.src,
    text: partial.text,
    attachments: [],
    parentId: partial.parentId,
  }
}

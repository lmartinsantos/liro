export type User = {
  id: string
  name: string
  color: string
}

export type Meta = {
  id: string
  name: string
  createdAt: string
  users: User[]
  archivedAt?: string | null
  hasPassword?: boolean
}

export type Attachment = {
  id: string
  type: 'emoji' | 'comment' | 'link'
  emoji?: string
  offsetX?: number
  offsetY?: number
  authorId?: string
  authorName?: string
  text?: string
  url?: string
  label?: string
  createdAt?: string
}

export type ObjectType =
  | 'rect'
  | 'roundrect'
  | 'ellipse'
  | 'line'
  | 'spline'
  | 'postit'
  | 'triangle'
  | 'diamond'
  | 'arrow'
  | 'hexagon'
  | 'parallelogram'
  | 'cylinder'
  | 'text'
  | 'frame'
  | 'lane'
  | 'group'
  | 'connector'
  | 'image'
  | 'sticker'

export type Side = 'top' | 'right' | 'bottom' | 'left'

export type BoardObject = {
  id: string
  type: ObjectType
  x: number
  y: number
  w: number
  h: number
  rotation: number
  z: string
  fill: string
  stroke: string
  strokeWidth: number
  /** Corner radius for roundrect (and optional future rounded shapes). */
  cornerRadius?: number
  points?: number[]
  text?: string
  attachments?: Attachment[]
  parentId?: string
  fromId?: string
  toId?: string
  fromSide?: Side
  toSide?: Side
  fromOffset?: number
  toOffset?: number
  dir?: 'h' | 'v'
  src?: string
  fontFamily?: string
  fontSize?: number
  bold?: boolean
  italic?: boolean
  textAlign?: 'left' | 'center' | 'right'
}

export type DocumentState = {
  rev: number
  objects: Record<string, BoardObject>
}

export type ChatMessage = {
  id: string
  authorId: string
  authorName: string
  color: string
  text: string
  createdAt: string
}

export type ChatLog = {
  messages: ChatMessage[]
}

export type Session = {
  sessionId: string
  userId: string
  name: string
  color: string
}

export type Op = {
  id: string
  type: 'create' | 'update' | 'delete'
  objectId: string
  path?: string
  value?: unknown
  actorId: string
  seq?: number
}

export type Tool =
  | 'select'
  | 'rect'
  | 'roundrect'
  | 'ellipse'
  | 'line'
  | 'spline'
  | 'postit'
  | 'triangle'
  | 'diamond'
  | 'arrow'
  | 'hexagon'
  | 'parallelogram'
  | 'cylinder'
  | 'text'
  | 'connector'
  | 'frame'
  | 'lane'
  | 'sticker'
  | 'mindmap'

export type RemoteCursor = {
  sessionId: string
  userId: string
  name: string
  color: string
  x: number
  y: number
}

export type SnapshotInfo = {
  timestamp: number
  files: string[]
}

export type WsIncoming = {
  type: 'state' | 'op' | 'cursor' | 'presence' | 'chat' | 'error'
  op?: Op
  x?: number
  y?: number
  text?: string
  message?: ChatMessage
  document?: DocumentState
  chat?: ChatLog
  meta?: Meta
  presence?: Session[]
  sessionId?: string
  userId?: string
  name?: string
  color?: string
  error?: string
}

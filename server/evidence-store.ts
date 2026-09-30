import fs from 'node:fs'
import path from 'node:path'
import { cleanLine } from '../lib/text.ts'
import { invalid } from './errors.ts'
import { sha256Hex } from './hash.ts'

/**
 * Evidence object store.
 *
 * Files are content-addressed: stored at evidence/ab/<sha256>, outside any
 * served directory, and only ever read back through the authorised download
 * endpoint. The declared MIME type is never trusted. The bytes are sniffed,
 * and anything that is not a PDF, PNG, JPEG or valid UTF-8 text is refused.
 * A file that claims one type and sniffs as another is refused as well.
 */

export type StoredKind = 'pdf' | 'png' | 'jpeg' | 'text' | 'json'

export const ALLOWED_TYPES: Record<StoredKind, { mime: string; label: string; extensions: string[] }> = {
  pdf: { mime: 'application/pdf', label: 'PDF', extensions: ['.pdf'] },
  png: { mime: 'image/png', label: 'PNG image', extensions: ['.png'] },
  jpeg: { mime: 'image/jpeg', label: 'JPEG image', extensions: ['.jpg', '.jpeg'] },
  json: { mime: 'application/json', label: 'JSON', extensions: ['.json'] },
  text: { mime: 'text/plain', label: 'Text (log, email, CSV, notes)', extensions: ['.txt', '.log', '.csv', '.eml', '.md', '.xml', '.yaml', '.yml'] },
}

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  return sig.every((b, i) => bytes[i] === b)
}

/** Sniff the real content type from the bytes. */
export function sniff(bytes: Uint8Array): StoredKind | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf' // %PDF-
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg'
  // Text: must decode as UTF-8 and contain no NUL bytes.
  if (bytes.includes(0)) return null
  let decoded: string
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
  const trimmed = decoded.trim()
  if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && isJson(trimmed)) return 'json'
  return 'text'
}

function isJson(s: string): boolean {
  try {
    JSON.parse(s)
    return true
  } catch {
    return false
  }
}

function declaredKind(mime: string): StoredKind | null {
  const m = mime.toLowerCase().split(';')[0]!.trim()
  if (m === 'application/pdf') return 'pdf'
  if (m === 'image/png') return 'png'
  if (m === 'image/jpeg') return 'jpeg'
  if (m === 'application/json') return 'json'
  if (m.startsWith('text/') || m === 'message/rfc822' || m === 'application/xml' || m === '' || m === 'application/octet-stream') return 'text'
  return null
}

export function safeFileName(name: string): string {
  const base = cleanLine(path.basename(name.replace(/\\/g, '/')))
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120)
  return base || 'evidence.bin'
}

export interface Validated {
  kind: StoredKind
  mime: string
  sha256: string
  size: number
  fileName: string
}

export function validateUpload(bytes: Uint8Array, declaredMime: string, fileName: string, maxBytes: number): Validated {
  if (bytes.length === 0) throw invalid('Empty file', 'The uploaded file is empty.')
  if (bytes.length > maxBytes) {
    throw invalid('File too large', `Evidence files are limited to ${Math.round(maxBytes / 1048576)} MiB; this one is ${(bytes.length / 1048576).toFixed(1)} MiB.`)
  }
  const kind = sniff(bytes)
  if (!kind) {
    throw invalid('File type not accepted', 'Accepted evidence types are PDF, PNG, JPEG and UTF-8 text (logs, email, JSON, CSV). The file content matched none of them.')
  }
  const declared = declaredKind(declaredMime)
  // A text file that happens to be valid JSON is still text; the reverse is not allowed.
  const compatible = declared === kind || (declared === 'text' && kind === 'json')
  if (!compatible) {
    throw invalid(
      'File type mismatch',
      `The file was declared as ${declaredMime || 'unknown'} but its content is ${ALLOWED_TYPES[kind].label}. Files whose content does not match their declared type are refused.`,
    )
  }
  const safeName = safeFileName(fileName)
  const ext = path.extname(safeName).toLowerCase()
  if (ext && !ALLOWED_TYPES[kind].extensions.includes(ext) && !(kind === 'json' && ALLOWED_TYPES.text.extensions.includes(ext))) {
    throw invalid('File extension mismatch', `A ${ALLOWED_TYPES[kind].label} file cannot be stored with the extension "${ext}".`)
  }
  return { kind, mime: ALLOWED_TYPES[kind].mime, sha256: sha256Hex(bytes), size: bytes.length, fileName: safeName }
}

export function objectPath(evidenceDir: string, sha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('invalid object key')
  return path.join(evidenceDir, sha256.slice(0, 2), sha256)
}

export function storeObject(evidenceDir: string, sha256: string, bytes: Uint8Array): void {
  const file = objectPath(evidenceDir, sha256)
  if (fs.existsSync(file)) return
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, bytes, { mode: 0o600 })
  fs.renameSync(tmp, file)
}

export function readObject(evidenceDir: string, sha256: string): Uint8Array | null {
  const file = objectPath(evidenceDir, sha256)
  return fs.existsSync(file) ? fs.readFileSync(file) : null
}

export interface ObjectVerification {
  present: boolean
  ok: boolean
  observed: string | null
}

export function verifyObject(evidenceDir: string, sha256: string): ObjectVerification {
  const bytes = readObject(evidenceDir, sha256)
  if (!bytes) return { present: false, ok: false, observed: null }
  const observed = sha256Hex(bytes)
  return { present: true, ok: observed === sha256, observed }
}

import crypto from 'node:crypto'
import { canonicalJson } from '../lib/engine/ledger.ts'
import type { Hasher } from '../lib/engine/ledger.ts'

export function sha256Hex(input: string | Uint8Array): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

export const nodeSha256: Hasher = async (input: string) => sha256Hex(input)

/** Integrity hash of a record: SHA-256 over its canonical JSON, excluding the hash field itself. */
export function recordHash(record: Record<string, unknown>, exclude = 'integrityHash'): string {
  const copy: Record<string, unknown> = { ...record }
  delete copy[exclude]
  return sha256Hex(canonicalJson(copy))
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url')
}

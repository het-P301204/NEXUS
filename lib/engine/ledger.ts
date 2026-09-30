import type { AuditEvent } from '../../types/domain.ts'

/**
 * The audit ledger's hash chain.
 *
 * Each entry's hash is SHA-256 over the previous entry's hash and the
 * entry's own canonical content. Change any byte of any entry and its
 * recomputed hash no longer matches the stored one. Recompute the stored
 * hash as well, and the next entry's `prevHash` no longer matches it.
 * Either way, verification names the first entry where the chain breaks.
 *
 * The hash function is injected so the same verifier runs on the server
 * (node:crypto) and in the browser (Web Crypto). The browser re-verifies
 * independently rather than trusting the server's answer.
 *
 * Limit, stated plainly: someone with write access to the database file can
 * rewrite the whole chain from the break onwards. The mitigation is the
 * exported anchor -- a head hash held outside the database -- which a
 * rewritten chain cannot match. See docs/threat-model.md.
 */

export const GENESIS_HASH = '0'.repeat(64)

export type Hasher = (input: string) => Promise<string>

/** Deterministic JSON: object keys sorted recursively, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return 'null'
    return JSON.stringify(value ?? null)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
}

export type HashableAudit = Omit<AuditEvent, 'hash' | 'prevHash'>

/** The exact string that is hashed for an entry. */
export function auditHashInput(prevHash: string, entry: HashableAudit): string {
  const content = {
    seq: entry.seq,
    id: entry.id,
    at: entry.at,
    actorId: entry.actorId,
    actorRole: entry.actorRole,
    eventType: entry.eventType,
    objectType: entry.objectType,
    objectId: entry.objectId,
    caseId: entry.caseId,
    source: entry.source,
    summary: entry.summary,
    payload: entry.payload,
  }
  return `${prevHash}\n${canonicalJson(content)}`
}

export type BreakKind = 'hash_mismatch' | 'prev_link_mismatch' | 'sequence_gap'

export interface ChainBreak {
  seq: number
  id: string
  kind: BreakKind
  expectedHash: string
  observedHash: string
  explanation: string
}

export interface ChainVerification {
  ok: boolean
  checked: number
  headSeq: number
  headHash: string
  breaks: ChainBreak[]
  firstBreak: ChainBreak | null
  anchor: { matched: boolean; seq: number; expected: string; observed: string | null } | null
}

export interface AnchorInput {
  seq: number
  hash: string
}

export async function verifyChain(
  entries: AuditEvent[],
  hasher: Hasher,
  anchor: AnchorInput | null = null,
): Promise<ChainVerification> {
  const sorted = [...entries].sort((a, b) => a.seq - b.seq)
  const breaks: ChainBreak[] = []
  let prevHash = GENESIS_HASH
  let expectedSeq = sorted[0]?.seq ?? 1
  for (const e of sorted) {
    if (e.seq !== expectedSeq) {
      breaks.push({
        seq: e.seq,
        id: e.id,
        kind: 'sequence_gap',
        expectedHash: '',
        observedHash: '',
        explanation: `Expected entry ${expectedSeq}, found ${e.seq}. ${e.seq - expectedSeq} entr${e.seq - expectedSeq === 1 ? 'y is' : 'ies are'} missing.`,
      })
    }
    if (e.prevHash !== prevHash) {
      breaks.push({
        seq: e.seq,
        id: e.id,
        kind: 'prev_link_mismatch',
        expectedHash: prevHash,
        observedHash: e.prevHash,
        explanation: `The previous-hash link does not match the hash of the entry before it. An earlier entry was altered and re-hashed, or removed.`,
      })
    }
    const recomputed = await hasher(auditHashInput(e.prevHash, e))
    if (recomputed !== e.hash) {
      breaks.push({
        seq: e.seq,
        id: e.id,
        kind: 'hash_mismatch',
        expectedHash: recomputed,
        observedHash: e.hash,
        explanation: 'The stored hash does not match the entry\'s content. The entry was modified after it was written.',
      })
    }
    prevHash = e.hash
    expectedSeq = e.seq + 1
  }
  const head = sorted.at(-1)
  let anchorResult: ChainVerification['anchor'] = null
  if (anchor) {
    const at = sorted.find((e) => e.seq === anchor.seq)
    anchorResult = {
      matched: !!at && at.hash === anchor.hash,
      seq: anchor.seq,
      expected: anchor.hash,
      observed: at?.hash ?? null,
    }
  }
  return {
    ok: breaks.length === 0 && (anchorResult ? anchorResult.matched : true),
    checked: sorted.length,
    headSeq: head?.seq ?? 0,
    headHash: head?.hash ?? GENESIS_HASH,
    breaks,
    firstBreak: breaks[0] ?? null,
    anchor: anchorResult,
  }
}

/** Web Crypto SHA-256, hex. Available in browsers and in Node 24. */
export const webCryptoSha256: Hasher = async (input: string) => {
  const bytes = new TextEncoder().encode(input)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

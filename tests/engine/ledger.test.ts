import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { AuditEvent } from '../../types/domain.ts'
import { GENESIS_HASH, auditHashInput, canonicalJson, verifyChain, webCryptoSha256 } from '../../lib/engine/ledger.ts'

const sha = async (s: string) => crypto.createHash('sha256').update(s).digest('hex')

function chain(n: number): AuditEvent[] {
  const out: AuditEvent[] = []
  let prev = GENESIS_HASH
  for (let i = 1; i <= n; i++) {
    const base = {
      seq: i,
      id: `AE-${String(i).padStart(6, '0')}`,
      at: new Date(Date.UTC(2026, 8, 29, 8, i)).toISOString(),
      actorId: 'u-lead',
      actorRole: 'psirt_lead' as const,
      eventType: 'CLOCK_EVENT_RECORDED',
      objectType: 'clock_event',
      objectId: `CE-${i}`,
      caseId: 'CASE-T',
      source: 'ui' as const,
      summary: `entry ${i}`,
      payload: { n: i, nested: { b: 2, a: 1 } },
    }
    const hash = crypto.createHash('sha256').update(auditHashInput(prev, base)).digest('hex')
    out.push({ ...base, prevHash: prev, hash })
    prev = hash
  }
  return out
}

describe('canonical JSON', () => {
  it('orders keys so that equal objects hash equally', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe('{"a":{"c":[3,{"e":0,"f":1}],"d":2},"b":1}')
  })
  it('omits undefined and keeps null', () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}')
  })
})

describe('hash-chain verification', () => {
  it('verifies an intact chain', async () => {
    const r = await verifyChain(chain(6), sha)
    expect(r.ok).toBe(true)
    expect(r.checked).toBe(6)
    expect(r.headSeq).toBe(6)
  })

  it('names the altered entry when content changes but the stored hash does not', async () => {
    const c = chain(6)
    c[2] = { ...c[2]!, summary: 'entry 3 (amended)' }
    const r = await verifyChain(c, sha)
    expect(r.ok).toBe(false)
    expect(r.firstBreak?.id).toBe('AE-000003')
    expect(r.firstBreak?.kind).toBe('hash_mismatch')
    expect(r.firstBreak?.observedHash).toBe(chain(6)[2]!.hash)
  })

  it('names the next entry when an attacker also recomputes the altered entry\'s hash', async () => {
    const c = chain(6)
    const altered = { ...c[2]!, summary: 'entry 3 (amended)' }
    altered.hash = crypto.createHash('sha256').update(auditHashInput(altered.prevHash, altered)).digest('hex')
    c[2] = altered
    const r = await verifyChain(c, sha)
    expect(r.firstBreak?.id).toBe('AE-000004')
    expect(r.firstBreak?.kind).toBe('prev_link_mismatch')
  })

  it('detects a deleted entry', async () => {
    const c = chain(6)
    c.splice(3, 1)
    const r = await verifyChain(c, sha)
    expect(r.ok).toBe(false)
    expect(r.breaks.map((b) => b.kind)).toContain('sequence_gap')
    expect(r.breaks.map((b) => b.kind)).toContain('prev_link_mismatch')
  })

  it('detects a fully rewritten chain through an external anchor', async () => {
    const original = chain(6)
    const anchor = { seq: 6, hash: original[5]!.hash }
    // Rewrite everything from entry 2 onward, consistently re-hashed.
    const rewritten: AuditEvent[] = [original[0]!]
    let prev = original[0]!.hash
    for (const e of original.slice(1)) {
      const next = { ...e, summary: `${e.summary} (rewritten)`, prevHash: prev }
      next.hash = crypto.createHash('sha256').update(auditHashInput(prev, next)).digest('hex')
      rewritten.push(next)
      prev = next.hash
    }
    const withoutAnchor = await verifyChain(rewritten, sha)
    expect(withoutAnchor.ok).toBe(true) // the stated limit of a hash chain on its own
    const withAnchor = await verifyChain(rewritten, sha, anchor)
    expect(withAnchor.ok).toBe(false)
    expect(withAnchor.anchor?.matched).toBe(false)
  })

  it('computes the same hashes with Web Crypto as with node:crypto, so the browser can verify independently', async () => {
    const r = await verifyChain(chain(4), webCryptoSha256)
    expect(r.ok).toBe(true)
  })
})

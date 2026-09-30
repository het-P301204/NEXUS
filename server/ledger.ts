import type { AuditEvent, RoleId } from '../types/domain.ts'
import { GENESIS_HASH, auditHashInput, verifyChain } from '../lib/engine/ledger.ts'
import type { AnchorInput, ChainVerification } from '../lib/engine/ledger.ts'
import type { Db } from './db.ts'
import { setMeta } from './db.ts'
import { nodeSha256, sha256Hex } from './hash.ts'

/**
 * Append-only audit ledger.
 *
 * `appendAudit` is the only writer. It runs inside the caller's transaction,
 * so a mutation and its ledger entry commit together or not at all. The
 * table itself rejects UPDATE and DELETE (see db.ts).
 *
 * Payloads carry identifiers and hashes, never evidence content, passwords
 * or session tokens.
 */

export interface AuditInput {
  actorId: string
  actorRole: RoleId | 'system'
  eventType: string
  objectType: string
  objectId: string
  caseId: string | null
  source: AuditEvent['source']
  summary: string
  payload?: Record<string, unknown>
  at: string
}

export function appendAudit(db: Db, input: AuditInput): AuditEvent {
  const last = db.prepare('SELECT seq, hash FROM audit_events ORDER BY seq DESC LIMIT 1').get() as
    | { seq: number; hash: string }
    | undefined
  const seq = (last?.seq ?? 0) + 1
  const prevHash = last?.hash ?? GENESIS_HASH
  const entry: Omit<AuditEvent, 'hash'> = {
    seq,
    id: `AE-${String(seq).padStart(6, '0')}`,
    at: input.at,
    actorId: input.actorId,
    actorRole: input.actorRole,
    eventType: input.eventType,
    objectType: input.objectType,
    objectId: input.objectId,
    caseId: input.caseId,
    source: input.source,
    summary: input.summary,
    payload: input.payload ?? {},
    prevHash,
  }
  const hash = sha256Hex(auditHashInput(prevHash, entry))
  const full: AuditEvent = { ...entry, hash }
  db.prepare(
    'INSERT INTO audit_events(seq, id, at, case_id, event_type, data, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(seq, full.id, full.at, full.caseId, full.eventType, JSON.stringify(stripHashes(full)), prevHash, hash)
  return full
}

/** The chain columns are the source of truth for hashes; `data` carries the content. */
function stripHashes(e: AuditEvent): Omit<AuditEvent, 'hash' | 'prevHash'> {
  const { hash: _h, prevHash: _p, ...rest } = e
  return rest
}

export function readLedger(db: Db, opts: { caseId?: string; limit?: number; beforeSeq?: number } = {}): AuditEvent[] {
  const where: string[] = []
  const params: Array<string | number> = []
  if (opts.caseId) {
    where.push('case_id = ?')
    params.push(opts.caseId)
  }
  if (opts.beforeSeq) {
    where.push('seq < ?')
    params.push(opts.beforeSeq)
  }
  const sql = `SELECT seq, data, prev_hash, hash FROM audit_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY seq ${opts.limit ? 'DESC LIMIT ' + Math.floor(opts.limit) : 'ASC'}`
  const rows = db.prepare(sql).all(...params) as Array<{ seq: number; data: string; prev_hash: string; hash: string }>
  const out = rows.map((r) => ({ ...(JSON.parse(r.data) as Omit<AuditEvent, 'hash' | 'prevHash'>), seq: r.seq, prevHash: r.prev_hash, hash: r.hash }))
  return opts.limit ? out.reverse() : out
}

export function ledgerHead(db: Db): { seq: number; hash: string; at: string | null } {
  const row = db.prepare('SELECT seq, hash, at FROM audit_events ORDER BY seq DESC LIMIT 1').get() as
    | { seq: number; hash: string; at: string }
    | undefined
  return row ? { seq: row.seq, hash: row.hash, at: row.at } : { seq: 0, hash: GENESIS_HASH, at: null }
}

export async function verifyLedger(db: Db, anchor: AnchorInput | null = null): Promise<ChainVerification> {
  return verifyChain(readLedger(db), nodeSha256, anchor)
}

export function cacheVerification(db: Db, result: ChainVerification, at: string, actorId: string): void {
  setMeta(
    db,
    'last_verification',
    JSON.stringify({ at, actorId, ok: result.ok, checked: result.checked, headSeq: result.headSeq, firstBreak: result.firstBreak }),
  )
}

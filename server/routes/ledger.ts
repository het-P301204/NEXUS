import { z } from 'zod'
import type { Hono } from 'hono'
import type { AuditEvent } from '../../types/domain.ts'
import type { LedgerResponse, TamperSimulationResponse, VerifyResponse } from '../../types/api.ts'
import { verifyChain } from '../../lib/engine/ledger.ts'
import type { Deps, Env } from '../context.ts'
import { nowIso, requirePermission, requireUser } from '../context.ts'
import { getMeta, tx } from '../db.ts'
import { invalid, notFound } from '../errors.ts'
import { appendAudit, cacheVerification, ledgerHead, readLedger, verifyLedger } from '../ledger.ts'
import { nodeSha256 } from '../hash.ts'
import { getOrg } from '../repo.ts'
import { notify } from '../services.ts'
import { parseBody } from '../validation.ts'

export function ledgerRoutes(app: Hono<Env>, deps: Deps): void {
  const { db, config } = deps

  app.get('/api/ledger', (c) => {
    requireUser(c)
    const caseId = c.req.query('caseId')
    const entries = readLedger(db, caseId ? { caseId } : {})
    const last = getMeta(db, 'last_verification')
    const body: LedgerResponse = { entries, head: ledgerHead(db), lastVerification: last ? JSON.parse(last) : null }
    return c.json(body)
  })

  /** Verify the real stored chain, then record that verification ran. */
  app.post('/api/ledger/verify', async (c) => {
    const user = requirePermission(c, 'ledger.verify')
    const input = await parseBody(
      c,
      z.object({ anchor: z.object({ seq: z.number().int().positive(), hash: z.string().regex(/^[0-9a-f]{64}$/) }).nullable().default(null) }),
    )
    const result = await verifyLedger(db, input.anchor)
    // The stored chain's own result is what the system-wide integrity status shows.
    // A caller-supplied anchor is checked and reported to that caller only, so a
    // made-up anchor cannot raise an alarm for everyone.
    const chainIntact = result.breaks.length === 0
    const anchorMismatch = chainIntact && result.anchor !== null && !result.anchor.matched
    const at = nowIso(deps)
    tx(db, () => {
      cacheVerification(db, { ...result, ok: chainIntact, anchor: null }, at, user.id)
      appendAudit(db, {
        actorId: user.id,
        actorRole: user.role,
        eventType: !chainIntact ? 'LEDGER_INTEGRITY_EXCEPTION' : anchorMismatch ? 'LEDGER_ANCHOR_MISMATCH' : 'LEDGER_VERIFIED',
        objectType: 'ledger',
        objectId: 'audit_events',
        caseId: null,
        source: 'ui',
        summary: !chainIntact
          ? `Integrity exception at ${result.firstBreak?.id ?? 'unknown entry'}`
          : anchorMismatch
            ? `Ledger chain intact (${result.checked} entries); it does not reproduce the supplied anchor at seq ${result.anchor!.seq}`
            : `Ledger integrity verified: ${result.checked} entries, head ${result.headHash.slice(0, 12)}`,
        payload: { ok: result.ok, checked: result.checked, headSeq: result.headSeq, headHash: result.headHash, firstBreak: result.firstBreak?.id ?? null, anchor: input.anchor },
        at,
      })
      notify(deps, {
        userIds: [user.id],
        kind: 'ledger_verified',
        severity: !chainIntact ? 'critical' : anchorMismatch ? 'watch' : 'info',
        title: !chainIntact ? 'Ledger integrity exception' : anchorMismatch ? 'Anchor does not match' : 'Ledger verification completed',
        body: !chainIntact
          ? `Chain broken at ${result.firstBreak?.id}.`
          : anchorMismatch
            ? `The chain is intact but does not reproduce the anchor at seq ${result.anchor!.seq}. Check that the anchor file is genuine.`
            : `${result.checked} entries verified.`,
        caseId: null,
        link: '/ledger',
      })
    })
    const body: VerifyResponse = { result, verifiedAt: at }
    return c.json(body)
  })

  app.get('/api/ledger/anchor', (c) => {
    requireUser(c)
    const head = ledgerHead(db)
    c.header('Content-Disposition', `attachment; filename="nexus-ledger-anchor-${head.seq}.json"`)
    return c.json({
      kind: 'nexus-ledger-anchor',
      organization: getOrg(db).name,
      seq: head.seq,
      hash: head.hash,
      at: head.at,
      exportedAt: nowIso(deps),
      note: 'Keep this file outside NEXUS. A ledger rewritten after this point cannot reproduce this hash at this sequence number.',
    })
  })

  /**
   * DEMO / SIMULATION. Verifies an in-memory copy of the ledger with one
   * entry altered. The stored ledger is not touched -- it cannot be: the
   * table rejects updates.
   */
  app.post('/api/demo/ledger/simulate', async (c) => {
    requirePermission(c, 'ledger.verify')
    if (!config.demoMode) throw notFound('Resource', 'simulate')
    const input = await parseBody(c, z.object({ seq: z.number().int().positive(), field: z.enum(['summary', 'actor', 'timestamp', 'payload']).default('summary') }))
    const entries = readLedger(db)
    const target = entries.find((e) => e.seq === input.seq)
    if (!target) throw invalid('Unknown entry', `There is no ledger entry with sequence ${input.seq}.`)
    const copy: AuditEvent[] = entries.map((e) => ({ ...e, payload: { ...e.payload } }))
    const t = copy.find((e) => e.seq === input.seq)!
    let original: string
    let altered: string
    if (input.field === 'summary') {
      original = t.summary
      altered = t.summary.replace(/REPORT|verified|established|recorded|added/i, (m) => (m.toUpperCase() === 'REPORT' ? 'NOT REPORTABLE' : m === 'verified' ? 'waived' : 'withdrawn'))
      if (altered === original) altered = `${original} (amended)`
      t.summary = altered
    } else if (input.field === 'actor') {
      original = t.actorId
      altered = t.actorId === 'u-exec' ? 'u-legal' : 'u-exec'
      t.actorId = altered
    } else if (input.field === 'timestamp') {
      original = t.at
      altered = new Date(Date.parse(t.at) - 6 * 3600_000).toISOString()
      t.at = altered
    } else {
      original = JSON.stringify(t.payload)
      t.payload = { ...t.payload, tampered: true }
      altered = JSON.stringify(t.payload)
    }
    const result = await verifyChain(copy, nodeSha256)
    const body: TamperSimulationResponse = { simulation: true, target: { seq: t.seq, id: t.id, field: input.field, original, altered }, result }
    return c.json(body)
  })
}

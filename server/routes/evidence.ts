import { z } from 'zod'
import type { Hono } from 'hono'
import type { Evidence, EvidenceLink } from '../../types/domain.ts'
import type { EvidenceChainNode, EvidenceDetailResponse, EvidenceListItem } from '../../types/api.ts'
import { cleanLine } from '../../lib/text.ts'
import type { Deps, Env } from '../context.ts'
import { nowIso, requirePermission, requireUser } from '../context.ts'
import { nextId, tx } from '../db.ts'
import { ApiError, forbidden, invalid, notFound } from '../errors.ts'
import { appendAudit } from '../ledger.ts'
import { canReadEvidence, loadCaseForWrite, redactEvidence } from '../authz.ts'
import { getEvidence, insertEvidence, insertLink, listCases, listEvidence, listLinks, listReports, loadBundle } from '../repo.ts'
import { readObject, storeObject, validateUpload, verifyObject } from '../evidence-store.ts'
import { evidenceType, id, instant, line, parseValue, requiredLine, text } from '../validation.ts'

const metaSchema = z.object({
  caseId: id,
  type: evidenceType,
  title: requiredLine(200),
  description: text(4000).default(''),
  source: requiredLine(240),
  sourceCreatedAt: instant.nullable().default(null),
  classification: z.enum(['internal', 'restricted']).default('internal'),
})

export function evidenceRoutes(app: Hono<Env>, deps: Deps): void {
  const { db, config } = deps

  app.get('/api/evidence', (c) => {
    const user = requireUser(c)
    requirePermission(c, 'evidence.read')
    const links = listLinks(db)
    const cases = new Map(listCases(db).map((x) => [x.id, x.title]))
    const items: EvidenceListItem[] = listEvidence(db).map((e) => ({
      ...redactEvidence(user, e),
      links: links.filter((l) => l.evidenceId === e.id).map((l) => ({ targetType: l.targetType, targetId: l.targetId })),
      caseTitle: e.caseId ? (cases.get(e.caseId) ?? null) : null,
    }))
    return c.json({ items })
  })

  app.get('/api/evidence/:id', (c) => {
    const user = requirePermission(c, 'evidence.read')
    const e = getEvidence(db, c.req.param('id'))
    if (!e) throw notFound('Evidence', c.req.param('id'))
    const readable = canReadEvidence(user, e)
    const links = listLinks(db, [e.id])
    // The chain labels its first node with the evidence title, so it is built from
    // the record as this user may see it.
    const chain = e.caseId ? buildChains(deps, redactEvidence(user, e), links) : []
    const integrity = e.hasFile ? verifyObject(config.evidenceDir, e.sha256) : { present: false, ok: true, observed: null }
    let preview: string | null = null
    if (readable && e.hasFile && e.mimeType && (e.mimeType.startsWith('text/') || e.mimeType === 'application/json')) {
      const bytes = readObject(config.evidenceDir, e.sha256)
      if (bytes) preview = new TextDecoder().decode(bytes.slice(0, 64 * 1024))
    }
    const body: EvidenceDetailResponse = {
      evidence: redactEvidence(user, e),
      links: links.map((l) => ({ targetType: l.targetType, targetId: l.targetId })),
      chain,
      integrity: { ...integrity, checkedAt: nowIso(deps) },
      preview,
    }
    return c.json(body)
  })

  /** Download. Authorised per object; never served from a public path. */
  app.get('/api/evidence/:id/file', (c) => {
    const user = requirePermission(c, 'evidence.read')
    const e = getEvidence(db, c.req.param('id'))
    if (!e || !e.hasFile) throw notFound('Evidence file', c.req.param('id'))
    if (!canReadEvidence(user, e)) throw forbidden('This evidence is restricted. Your role cannot read restricted evidence.')
    const bytes = readObject(config.evidenceDir, e.sha256)
    if (!bytes) throw new ApiError(410, 'EVIDENCE_OBJECT_MISSING', 'Evidence object missing', `The stored object for ${e.id} is not in the evidence store. Integrity exception.`)
    const inline = c.req.query('inline') === '1' && (e.mimeType === 'image/png' || e.mimeType === 'image/jpeg')
    const type = e.mimeType === 'application/pdf' || e.mimeType?.startsWith('image/') ? e.mimeType : 'text/plain; charset=utf-8'
    c.header('Content-Type', type)
    c.header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${(e.fileName ?? e.id).replace(/["\\]/g, '_')}"`)
    c.header('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox")
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Cache-Control', 'private, no-store')
    c.header('X-Evidence-SHA256', e.sha256)
    return c.body(new Uint8Array(bytes))
  })

  /**
   * Upload. Multipart (file + metadata fields) or JSON (text evidence such as
   * an analyst note). Either way the content is hashed on the server and the
   * hash is what the record carries.
   */
  app.post('/api/evidence', async (c) => {
    const user = requirePermission(c, 'evidence.write')
    const contentType = c.req.header('content-type') ?? ''
    let meta: z.output<typeof metaSchema>
    let bytes: Uint8Array
    let declaredMime: string
    let fileName: string
    if (contentType.startsWith('multipart/form-data')) {
      const form = await c.req.parseBody()
      const file = form.file
      if (!(file instanceof File)) throw invalid('File required', 'Attach a file in the "file" field.')
      if (file.size > config.maxUploadBytes) {
        throw invalid('File too large', `Evidence files are limited to ${Math.round(config.maxUploadBytes / 1048576)} MiB.`)
      }
      meta = parseValue(metaSchema, {
        caseId: form.caseId,
        type: form.type,
        title: form.title,
        description: form.description ?? '',
        source: form.source,
        sourceCreatedAt: form.sourceCreatedAt ? form.sourceCreatedAt : null,
        classification: form.classification ?? 'internal',
      })
      bytes = new Uint8Array(await file.arrayBuffer())
      declaredMime = file.type
      fileName = file.name
    } else {
      const raw = await c.req.json().catch(() => {
        throw invalid('Request body is not JSON', 'Send multipart/form-data with a file, or JSON with a text body.')
      })
      const parsed = parseValue(metaSchema.extend({ content: text(200_000).pipe(z.string().min(1, 'Evidence content is empty')), fileName: line(120).default('') }), raw)
      meta = parsed
      bytes = new TextEncoder().encode(parsed.content)
      declaredMime = 'text/plain'
      fileName = parsed.fileName || `${cleanLine(parsed.title).slice(0, 60) || 'note'}.txt`
    }
    const theCase = loadCaseForWrite(db, user, meta.caseId)
    const validated = validateUpload(bytes, declaredMime, fileName, config.maxUploadBytes)
    const now = nowIso(deps)
    if (meta.sourceCreatedAt && Date.parse(meta.sourceCreatedAt) > deps.now().getTime() + 120_000) {
      throw invalid('Timestamp in the future', 'The artifact creation time cannot be later than now.')
    }
    const evidence: Evidence = {
      id: nextId(db, 'EV'),
      caseId: theCase.id,
      type: meta.type,
      title: meta.title,
      description: meta.description,
      source: meta.source,
      sourceCreatedAt: meta.sourceCreatedAt,
      uploadedAt: now,
      ownerId: user.id,
      classification: meta.classification,
      sha256: validated.sha256,
      fileName: validated.fileName,
      mimeType: validated.mime,
      sizeBytes: validated.size,
      hasFile: true,
    }
    storeObject(config.evidenceDir, validated.sha256, bytes)
    tx(db, () => {
      insertEvidence(db, evidence)
      appendAudit(db, {
        actorId: user.id,
        actorRole: user.role,
        eventType: 'EVIDENCE_ADDED',
        objectType: 'evidence',
        objectId: evidence.id,
        caseId: theCase.id,
        source: 'ui',
        summary: `${evidence.id} ${evidence.type.replace(/_/g, ' ').toLowerCase()} added${evidence.classification === 'restricted' ? ' (restricted)' : ''}`,
        payload: { evidenceId: evidence.id, type: evidence.type, sha256: evidence.sha256, sizeBytes: evidence.sizeBytes, classification: evidence.classification },
        at: now,
      })
    })
    return c.json({ id: evidence.id, sha256: evidence.sha256 }, 201)
  })

  app.post('/api/evidence/:id/links', async (c) => {
    const user = requirePermission(c, 'evidence.write')
    const e = getEvidence(db, c.req.param('id'))
    if (!e || !e.caseId) throw notFound('Evidence', c.req.param('id'))
    const theCase = loadCaseForWrite(db, user, e.caseId)
    const input = parseValue(
      z.object({ targetType: z.enum(['clock_event', 'determination', 'decision', 'report', 'vulnerability', 'case']), targetId: id }),
      await c.req.json().catch(() => ({})),
    )
    const bundle = loadBundle(db, theCase.id)!
    const exists =
      (input.targetType === 'clock_event' && bundle.events.some((x) => x.id === input.targetId)) ||
      (input.targetType === 'determination' && bundle.determinations.some((x) => x.id === input.targetId)) ||
      (input.targetType === 'decision' && bundle.decisions.some((x) => x.id === input.targetId)) ||
      (input.targetType === 'report' && bundle.reports.some((x) => x.id === input.targetId)) ||
      (input.targetType === 'vulnerability' && bundle.vulnerability.id === input.targetId) ||
      (input.targetType === 'case' && theCase.id === input.targetId)
    if (!exists) throw invalid('Target not in case', `${input.targetId} is not a ${input.targetType.replace(/_/g, ' ')} in ${theCase.id}.`)
    const now = nowIso(deps)
    tx(db, () => {
      const added = insertLink(db, { evidenceId: e.id, targetType: input.targetType, targetId: input.targetId }, now, user.id)
      if (added) {
        appendAudit(db, {
          actorId: user.id,
          actorRole: user.role,
          eventType: 'EVIDENCE_LINKED',
          objectType: 'evidence',
          objectId: e.id,
          caseId: theCase.id,
          source: 'ui',
          summary: `${e.id} linked to ${input.targetId}`,
          payload: { evidenceId: e.id, targetType: input.targetType, targetId: input.targetId, sha256: e.sha256 },
          at: now,
        })
      }
    })
    return c.json({ ok: true })
  })

  app.post('/api/evidence/:id/verify', (c) => {
    const user = requirePermission(c, 'evidence.read')
    const e = getEvidence(db, c.req.param('id'))
    if (!e) throw notFound('Evidence', c.req.param('id'))
    const result = e.hasFile ? verifyObject(config.evidenceDir, e.sha256) : { present: false, ok: true, observed: null }
    const now = nowIso(deps)
    tx(db, () => {
      appendAudit(db, {
        actorId: user.id,
        actorRole: user.role,
        eventType: result.ok ? 'EVIDENCE_VERIFIED' : 'EVIDENCE_INTEGRITY_EXCEPTION',
        objectType: 'evidence',
        objectId: e.id,
        caseId: e.caseId,
        source: 'ui',
        summary: `${e.id} integrity ${result.ok ? 'verified' : 'exception'}`,
        payload: { evidenceId: e.id, expected: e.sha256, observed: result.observed },
        at: now,
      })
    })
    return c.json({ ...result, expected: e.sha256, checkedAt: now })
  })
}

/** Every path from an evidence item to the reports that rest on it. */
function buildChains(deps: Deps, e: Evidence, links: EvidenceLink[]): EvidenceChainNode[][] {
  const bundle = loadBundle(deps.db, e.caseId!)
  if (!bundle) return []
  const reports = listReports(deps.db, bundle.case.id)
  const evNode: EvidenceChainNode = { id: e.id, kind: 'evidence', label: e.title, detail: e.type.replace(/_/g, ' '), at: e.uploadedAt }
  const chains: EvidenceChainNode[][] = []
  const decisionTail = (decisionId: string): EvidenceChainNode[][] => {
    const d = bundle.decisions.find((x) => x.id === decisionId)
    if (!d) return []
    const dNode: EvidenceChainNode = { id: d.id, kind: 'decision', label: d.outcome === 'REPORT' ? 'Decision: report' : 'Decision: not required', detail: d.rationale.slice(0, 120), at: d.decidedAt }
    const rs = reports.filter((r) => r.decisionId === d.id)
    if (rs.length === 0) return [[dNode]]
    return rs.map((r) => [dNode, { id: r.id, kind: 'report' as const, label: r.title, detail: r.stage.replace(/_/g, ' '), at: r.generatedAt }])
  }
  for (const l of links) {
    if (l.targetType === 'clock_event') {
      const ev = bundle.events.find((x) => x.id === l.targetId)
      if (!ev) continue
      const node: EvidenceChainNode = { id: ev.id, kind: 'clock_event', label: ev.type.replace(/_/g, ' ').toLowerCase(), detail: ev.source, at: ev.occurredAt }
      const decisions = bundle.decisions.filter((d) => d.awarenessEventIds.includes(ev.id) || d.awarenessEventIds.includes(ev.supersedesId ?? ''))
      if (decisions.length === 0) chains.push([evNode, node])
      for (const d of decisions) {
        const dets = bundle.determinations.filter((x) => d.determinationIds.includes(x.id)).slice(0, 1)
        const detNodes = dets.map((x) => ({ id: x.id, kind: 'determination' as const, label: `${bundle.products.find((p) => p.id === x.productId)?.name}: ${x.result.replace(/_/g, ' ').toLowerCase()}`, detail: x.rationale.slice(0, 100), at: x.recordedAt }))
        for (const tail of decisionTail(d.id)) chains.push([evNode, node, ...detNodes, ...tail])
      }
    } else if (l.targetType === 'determination') {
      const det = bundle.determinations.find((x) => x.id === l.targetId)
      if (!det) continue
      const node: EvidenceChainNode = { id: det.id, kind: 'determination', label: `${bundle.products.find((p) => p.id === det.productId)?.name}: ${det.result.replace(/_/g, ' ').toLowerCase()}`, detail: det.rationale.slice(0, 100), at: det.recordedAt }
      const decisions = bundle.decisions.filter((d) => d.determinationIds.includes(det.id))
      if (decisions.length === 0) chains.push([evNode, node])
      for (const d of decisions) for (const tail of decisionTail(d.id)) chains.push([evNode, node, ...tail])
    } else if (l.targetType === 'decision') {
      for (const tail of decisionTail(l.targetId)) chains.push([evNode, ...tail])
    } else if (l.targetType === 'report') {
      const r = reports.find((x) => x.id === l.targetId)
      if (r) chains.push([evNode, { id: r.id, kind: 'report', label: r.title, detail: r.stage.replace(/_/g, ' '), at: r.generatedAt }])
    }
  }
  if (chains.length === 0) chains.push([evNode])
  // Longest, most complete chains first; identical paths once.
  const seen = new Set<string>()
  return chains
    .sort((a, b) => b.length - a.length)
    .filter((ch) => {
      const k = ch.map((n) => n.id).join('>')
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .slice(0, 8)
}


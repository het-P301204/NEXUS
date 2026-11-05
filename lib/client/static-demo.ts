import type { ErrorBody } from '../../server/errors.ts'
import type { AuditEvent, Notification } from '../../types/domain.ts'
import type {
  CaseListItem,
  ComponentListItem,
  EvidenceListItem,
  LedgerResponse,
  NotificationsResponse,
  ProductListItem,
  SearchResult,
  TamperSimulationResponse,
  VerifyResponse,
} from '../../types/api.ts'
import type { AnchorInput } from '../engine/ledger.ts'
import { verifyChain, webCryptoSha256 } from '../engine/ledger.ts'
import { nowMs, syncServerTime } from './useNow.ts'

/**
 * The static demo's stand-in for the API server.
 *
 * `npm run build:pages` seeds the real server in memory, signs in as one
 * persona, and records every read the UI makes into dist/demo/snapshot.json
 * (downloads in dist/demo/files.json; scripts/demo-snapshot.ts). In the
 * static build, every request the client
 * would send to /api is answered here from that snapshot instead.
 *
 * Reads are served as recorded. The checks that only read -- ledger chain
 * verification, the tamper simulation, evidence re-hashing -- are recomputed
 * in the browser with the same engine code the server uses. Everything that
 * would change state is refused with a structured error, because there is
 * nothing behind this page to change.
 */

export interface DemoFile {
  /** Content-Type and Content-Disposition as the server sent them. */
  type: string
  disposition: string | null
  base64: string
}

export interface DemoSnapshot {
  version: 1
  capturedAt: string
  personaId: string
  responses: Record<string, unknown>
  /** Paths of the recorded downloads, which live in demo/files.json. */
  files: string[]
}

let snapshot: Promise<DemoSnapshot> | null = null
let downloads: Promise<Record<string, DemoFile>> | null = null

/** The downloads are half the recording; they are fetched on the first one. */
function loadFiles(): Promise<Record<string, DemoFile>> {
  if (!downloads) {
    downloads = fetch(`${import.meta.env.BASE_URL}demo/files.json`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`demo downloads answered ${res.status}`)
        return (await res.json()) as Record<string, DemoFile>
      })
      .catch((err: unknown) => {
        downloads = null
        throw err
      })
  }
  return downloads
}

async function recordedFile(s: DemoSnapshot, key: string): Promise<DemoFile | null> {
  if (!s.files.includes(key)) return null
  return (await loadFiles())[key] ?? null
}

export function loadSnapshot(): Promise<DemoSnapshot> {
  if (!snapshot) {
    snapshot = fetch(`${import.meta.env.BASE_URL}demo/snapshot.json`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`demo snapshot answered ${res.status}`)
        const s = (await res.json()) as DemoSnapshot
        // Every recorded response carries the capture instant as "now"; the
        // demo clock starts there.
        syncServerTime(s.capturedAt)
        return s
      })
      .catch((err: unknown) => {
        snapshot = null
        throw err
      })
  }
  return snapshot
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function failure(status: number, error: ErrorBody): Response {
  return json({ error }, status)
}

const READ_ONLY: ErrorBody = {
  code: 'STATIC_DEMO_READ_ONLY',
  title: 'Read-only demo',
  reason:
    'This is the static demo: synthetic data recorded from a NEXUS server, with no server behind it, so nothing can be saved. Run NEXUS locally (see the README) to record events, determinations, decisions and reports.',
}

function demoNowIso(): string {
  return new Date(nowMs()).toISOString()
}

function decode(base64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function ledger(s: DemoSnapshot): LedgerResponse {
  return s.responses['/api/ledger'] as LedgerResponse
}

function list<T>(s: DemoSnapshot, key: string, field: string): T[] {
  const body = s.responses[key] as Record<string, unknown> | undefined
  return (body?.[field] as T[] | undefined) ?? []
}

/** The server's search (server/routes/ops.ts), run over the recorded lists. */
function search(s: DemoSnapshot, raw: string): SearchResult[] {
  const q = raw.trim().toLowerCase().slice(0, 100)
  if (q.length < 2) return []
  const hit = (...fields: Array<string | null | undefined>) => fields.some((f) => f?.toLowerCase().includes(q))
  const results: SearchResult[] = []
  for (const c of list<CaseListItem>(s, '/api/cases', 'items')) {
    if (hit(c.id, c.title, c.cve, ...c.tags)) {
      results.push({ kind: 'case', id: c.id, label: c.title, sublabel: `${c.id} · ${c.status.replace(/_/g, ' ')}`, href: `/cases/${c.id}` })
    }
  }
  for (const v of list<{ id: string; cve: string | null; title: string; cwe: string | null }>(s, '/api/vulnerabilities', 'items')) {
    if (hit(v.cve, v.id, v.title, v.cwe)) results.push({ kind: 'vulnerability', id: v.id, label: v.cve ?? v.id, sublabel: v.title, href: `/vulnerabilities/${v.id}` })
  }
  for (const p of list<ProductListItem>(s, '/api/products', 'items')) {
    if (hit(p.id, p.name)) results.push({ kind: 'product', id: p.id, label: p.name, sublabel: `${p.id} · v${p.version}`, href: `/products/${p.id}` })
  }
  for (const comp of list<ComponentListItem>(s, '/api/components', 'items')) {
    if (hit(comp.name, comp.purl)) results.push({ kind: 'component', id: comp.id, label: comp.name, sublabel: comp.purl, href: `/products?view=components&q=${encodeURIComponent(comp.id)}` })
  }
  for (const e of list<EvidenceListItem>(s, '/api/evidence', 'items')) {
    if (!e.redacted && hit(e.id, e.title, e.sha256)) results.push({ kind: 'evidence', id: e.id, label: e.title, sublabel: `${e.id} · ${e.type.replace(/_/g, ' ')}`, href: `/evidence/${e.id}` })
  }
  return results.slice(0, 30)
}

/** The server's tamper simulation (server/routes/ledger.ts), on an in-memory copy of the recorded ledger. */
async function simulateTamper(s: DemoSnapshot, seq: number, field: 'summary' | 'actor' | 'timestamp' | 'payload'): Promise<Response> {
  const copy: AuditEvent[] = ledger(s).entries.map((e) => ({ ...e, payload: { ...e.payload } }))
  const t = copy.find((e) => e.seq === seq)
  if (!t) return failure(400, { code: 'VALIDATION_FAILED', title: 'Unknown entry', reason: `There is no ledger entry with sequence ${seq}.` })
  let original: string
  let altered: string
  if (field === 'summary') {
    original = t.summary
    altered = t.summary.replace(/REPORT|verified|established|recorded|added/i, (m) => (m.toUpperCase() === 'REPORT' ? 'NOT REPORTABLE' : m === 'verified' ? 'waived' : 'withdrawn'))
    if (altered === original) altered = `${original} (amended)`
    t.summary = altered
  } else if (field === 'actor') {
    original = t.actorId
    altered = t.actorId === 'u-exec' ? 'u-legal' : 'u-exec'
    t.actorId = altered
  } else if (field === 'timestamp') {
    original = t.at
    altered = new Date(Date.parse(t.at) - 6 * 3600_000).toISOString()
    t.at = altered
  } else {
    original = JSON.stringify(t.payload)
    t.payload = { ...t.payload, tampered: true }
    altered = JSON.stringify(t.payload)
  }
  const result = await verifyChain(copy, webCryptoSha256)
  const body: TamperSimulationResponse = { simulation: true, target: { seq: t.seq, id: t.id, field, original, altered }, result }
  return json(body)
}

async function readBody(init: RequestInit | undefined): Promise<Record<string, unknown>> {
  if (typeof init?.body !== 'string') return {}
  try {
    return JSON.parse(init.body) as Record<string, unknown>
  } catch {
    return {}
  }
}

function markRead(s: DemoSnapshot, id: string | null): void {
  const body = s.responses['/api/notifications'] as NotificationsResponse | undefined
  if (!body) return
  const at = demoNowIso()
  body.stored = body.stored.map((n: Notification) => (n.readAt || (id !== null && n.id !== id) ? n : { ...n, readAt: at }))
}

async function handle(s: DemoSnapshot, method: string, url: URL, init: RequestInit | undefined): Promise<Response> {
  const path = url.pathname

  if (method === 'GET') {
    const file = (await recordedFile(s, path + url.search)) ?? (await recordedFile(s, path))
    if (file) {
      const headers: Record<string, string> = { 'content-type': file.type }
      if (file.disposition) headers['content-disposition'] = file.disposition
      return new Response(decode(file.base64), { status: 200, headers })
    }
    if (path === '/api/search') return json({ results: search(s, url.searchParams.get('q') ?? '') })
    if (path === '/api/ledger' && url.searchParams.has('caseId')) {
      const caseId = url.searchParams.get('caseId')
      const all = ledger(s)
      return json({ ...all, entries: all.entries.filter((e) => e.caseId === caseId) } satisfies LedgerResponse)
    }
    const key = path + url.search
    if (key in s.responses) return json(s.responses[key])
    return failure(404, {
      code: 'NOT_IN_STATIC_DEMO',
      title: 'Not in the static demo',
      reason: `The static demo recorded what the seeded demo organisation shows; ${path} was not part of it. Run NEXUS locally for the full application.`,
    })
  }

  if (method === 'POST' && path === '/api/ledger/verify') {
    const { anchor } = (await readBody(init)) as { anchor?: AnchorInput | null }
    const body: VerifyResponse = { result: await verifyChain(ledger(s).entries, webCryptoSha256, anchor ?? null), verifiedAt: demoNowIso() }
    return json(body)
  }

  if (method === 'POST' && path === '/api/demo/ledger/simulate') {
    const input = await readBody(init)
    const field = (input.field ?? 'summary') as 'summary' | 'actor' | 'timestamp' | 'payload'
    return simulateTamper(s, Number(input.seq), field)
  }

  const verify = /^\/api\/evidence\/([^/]+)\/verify$/.exec(path)
  if (method === 'POST' && verify) {
    const id = decodeURIComponent(verify[1]!)
    const item = list<EvidenceListItem>(s, '/api/evidence', 'items').find((e) => e.id === id)
    if (!item) return failure(404, { code: 'NOT_FOUND', title: 'Evidence not found', reason: `There is no evidence item ${id}.` })
    const file = await recordedFile(s, `/api/evidence/${id}/file`)
    if (!item.hasFile || !file) return json({ present: false, ok: true, observed: null, expected: item.sha256, checkedAt: demoNowIso() })
    const observed = await sha256Hex(decode(file.base64))
    return json({ present: true, ok: observed === item.sha256, observed, expected: item.sha256, checkedAt: demoNowIso() })
  }

  // Marking notifications read is kept for the length of the visit, so the
  // notification centre behaves; it is not an action on the record.
  const read = /^\/api\/notifications\/([^/]+)\/read$/.exec(path)
  if (method === 'POST' && read) {
    markRead(s, decodeURIComponent(read[1]!))
    return json({ ok: true })
  }
  if (method === 'POST' && path === '/api/notifications/read-all') {
    markRead(s, null)
    return json({ ok: true })
  }

  return failure(403, READ_ONLY)
}

/** Drop-in for `fetch` against /api, answered from the snapshot. */
export async function demoFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const url = new URL(raw, 'http://static-demo.invalid')
  const method = (init?.method ?? 'GET').toUpperCase()
  let s: DemoSnapshot
  try {
    s = await loadSnapshot()
  } catch {
    // The same failure the client reports when the server is down.
    throw new TypeError('static demo snapshot unavailable')
  }
  return handle(s, method, url, init)
}

export async function demoCapturedAt(): Promise<string> {
  return (await loadSnapshot()).capturedAt
}

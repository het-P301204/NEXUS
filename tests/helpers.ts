import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AffectednessStepId, Answer, AwarenessCriterion, Case, ClockEvent, ClockEventType, Decision, Determination, Evidence, Product, StepAnswer, Vulnerability } from '../types/domain.ts'
import type { CaseBundle } from '../lib/engine/bundle.ts'
import { emptyAnswers, evaluateAffectedness } from '../lib/engine/affectedness.ts'
import type { Config } from '../server/config.ts'
import type { Deps } from '../server/context.ts'
import { openDb } from '../server/db.ts'
import { createApp } from '../server/app.ts'
import { seedFresh } from '../server/bootstrap.ts'

// Engine fixtures ---------------------------------------------------------------------

export function ev(type: ClockEventType, occurredAt: string, extra: Partial<ClockEvent> = {}): ClockEvent {
  return {
    id: extra.id ?? `CE-${type}-${occurredAt}`,
    caseId: 'CASE-T',
    type,
    occurredAt,
    timezone: 'UTC',
    actorId: 'u-lead',
    source: 'test source',
    sourceKind: 'system_of_record',
    evidenceIds: [],
    criterionId: null,
    responsibleRole: null,
    supersedesId: null,
    correctionReason: null,
    decisionId: null,
    reportId: null,
    note: '',
    recordedAt: extra.recordedAt ?? occurredAt,
    integrityHash: 'x',
    ...extra,
  }
}

export function answers(spec: Partial<Record<AffectednessStepId, Answer | [Answer, string[]]>>): Record<AffectednessStepId, StepAnswer> {
  const a = emptyAnswers()
  for (const [k, v] of Object.entries(spec) as Array<[AffectednessStepId, Answer | [Answer, string[]]]>) {
    a[k] = Array.isArray(v) ? { answer: v[0], note: '', evidenceIds: v[1] } : { answer: v, note: '', evidenceIds: [] }
  }
  return a
}

export const PRODUCT: Product = {
  id: 'PRD-T',
  name: 'Test Gateway',
  version: '1.0',
  lifecycle: 'active',
  ownerId: 'u-lead',
  description: '',
  sbomStatus: 'current',
  sbomGeneratedAt: null,
  environment: 'lab',
  exposure: 'internet_facing',
  madeAvailableInEu: true,
}

export const VULN: Vulnerability = {
  id: 'VUL-T',
  cve: 'CVE-2026-990000',
  title: 'Test vulnerability',
  cwe: null,
  cvssScore: 9,
  cvssVector: null,
  severity: 'CRITICAL',
  description: 'A test vulnerability.',
  componentId: 'CMP-T',
  affectedVersions: '<2.0.0',
  fixedVersion: '2.0.0',
  exploitability: '',
  exploitation: 'CONFIRMED',
  source: 'test',
  discoveredAt: '2026-09-20T00:00:00.000Z',
  vendorAdvisory: null,
  threatIntelReference: null,
  createdAt: '2026-09-20T00:00:00.000Z',
  createdBy: 'u-lead',
}

export function evidenceItem(id: string, type: Evidence['type'], extra: Partial<Evidence> = {}): Evidence {
  return {
    id,
    caseId: 'CASE-T',
    type,
    title: id,
    description: '',
    source: 'test',
    sourceCreatedAt: null,
    uploadedAt: '2026-09-20T00:00:00.000Z',
    ownerId: 'u-lead',
    classification: 'internal',
    sha256: '0'.repeat(64),
    fileName: null,
    mimeType: null,
    sizeBytes: 0,
    hasFile: false,
    ...extra,
  }
}

export function determination(productId: string, a: Record<AffectednessStepId, StepAnswer>, extra: Partial<Determination> = {}): Determination {
  const e = evaluateAffectedness(a)
  return {
    id: extra.id ?? `DET-${productId}`,
    caseId: 'CASE-T',
    productId,
    productComponentId: null,
    answers: a,
    result: e.result,
    vexStatus: e.vexStatus,
    vexJustification: e.justification,
    rationale: 'test rationale',
    analystId: 'u-eng',
    recordedAt: '2026-09-21T00:00:00.000Z',
    confidence: 'HIGH',
    unresolved: '',
    nextAction: '',
    nextActionOwnerId: null,
    nextActionDue: null,
    supersedesId: null,
    ...extra,
  }
}

export function decision(outcome: Decision['outcome'], decidedAt: string, extra: Partial<Decision> = {}): Decision {
  return {
    id: extra.id ?? 'DEC-T',
    caseId: 'CASE-T',
    outcome,
    nonReportReason: outcome === 'DO_NOT_REPORT' ? 'NOT_AFFECTED' : null,
    suggestedOutcome: outcome,
    divergenceReason: null,
    affectednessResult: 'AFFECTED',
    determinationIds: [],
    exploitation: 'CONFIRMED',
    exploitationBasis: '',
    awarenessEventIds: [],
    ruleSetVersion: 'test',
    ruleTrace: { ruleSetVersion: 'test', evaluatedAt: decidedAt, steps: [] },
    rationale: 'A rationale long enough to satisfy the completeness check for tests.',
    analystId: 'u-lead',
    decidedAt,
    confidence: 'HIGH',
    unresolved: '',
    evidenceIds: [],
    supersedesId: null,
    ...extra,
  }
}

export const CRITERIA: AwarenessCriterion[] = [
  { id: 'AC-V', label: 'PSIRT confirmation', description: 'x', scope: 'vulnerability', responsibleRole: 'psirt_lead', requiredEvidenceTypes: ['TICKET'], active: true },
  { id: 'AC-E', label: 'Validated exploitation', description: 'x', scope: 'exploitation', responsibleRole: 'security_manager', requiredEvidenceTypes: ['EXPLOIT_EVIDENCE'], active: true },
]

export function bundle(extra: Partial<CaseBundle> = {}): CaseBundle {
  const c: Case = {
    id: 'CASE-T',
    title: 'Test case',
    vulnerabilityId: VULN.id,
    ownerId: 'u-lead',
    collaboratorIds: [],
    tags: [],
    lifecycle: 'open',
    lifecycleReason: null,
    productIds: [PRODUCT.id],
    createdAt: '2026-09-20T00:00:00.000Z',
    createdBy: 'u-lead',
    summary: '',
  }
  return {
    case: c,
    vulnerability: VULN,
    products: [PRODUCT],
    productComponents: [{ id: 'PC-T', productId: PRODUCT.id, componentId: 'CMP-T', version: '1.5.0', relation: 'direct', viaId: null, usage: '' }],
    components: [{ id: 'CMP-T', name: 'testlib', purl: 'pkg:generic/testlib', ecosystem: 'C', supplier: 'test' }],
    events: [],
    determinations: [],
    decisions: [],
    evidence: [],
    evidenceLinks: [],
    reports: [],
    reviews: [],
    threatIntel: [],
    criteria: CRITERIA,
    ...extra,
  }
}

// Server harness ------------------------------------------------------------------------

export const NOW = new Date('2026-09-30T12:00:00.000Z')
export const ORIGIN = 'http://localhost:5173'

export interface Harness {
  deps: Deps
  request: (path: string, init?: RequestInit) => Promise<Response>
  as: (userId: string) => Promise<Client>
  cleanup: () => void
}

export interface Client {
  userId: string
  csrf: string
  get: (path: string) => Promise<Response>
  post: (path: string, body?: unknown, opts?: { csrf?: string | null; origin?: string | null }) => Promise<Response>
  patch: (path: string, body: unknown) => Promise<Response>
  put: (path: string, body: unknown) => Promise<Response>
  upload: (path: string, form: FormData) => Promise<Response>
}

export async function harness(opts: { seed?: boolean; demoMode?: boolean; rateLimitScale?: number } = {}): Promise<Harness> {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-test-'))
  const config: Config = {
    production: false,
    port: 8787,
    appOrigin: ORIGIN,
    demoMode: opts.demoMode ?? true,
    storageDir,
    dbPath: ':memory:',
    evidenceDir: path.join(storageDir, 'evidence'),
    maxUploadBytes: 1024 * 1024,
    sessionTtlMs: 8 * 3600_000,
    sessionIdleMs: 3600_000,
    rateLimitScale: opts.rateLimitScale ?? 100,
  }
  const db = openDb(':memory:')
  let now = NOW.getTime()
  const deps: Deps = { db, config, now: () => new Date(now) }
  if (opts.seed !== false) await seedFresh(db, config, NOW)
  const app = createApp(deps)
  process.env.NEXUS_QUIET = '1'
  const request = async (p: string, init: RequestInit = {}) => app.request(`http://localhost${p}`, init)
  const as = async (userId: string): Promise<Client> => {
    const res = await request('/api/session/persona', { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ userId }) })
    if (res.status !== 200) throw new Error(`persona login failed: ${res.status} ${await res.text()}`)
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!
    const session = (await (await request('/api/session', { headers: { cookie } })).json()) as { csrfToken: string }
    const send = (method: string, p: string, body?: unknown, o: { csrf?: string | null; origin?: string | null } = {}) =>
      request(p, {
        method,
        headers: {
          cookie,
          'content-type': 'application/json',
          ...(o.origin === null ? {} : { origin: o.origin ?? ORIGIN }),
          ...(o.csrf === null ? {} : { 'x-csrf-token': o.csrf ?? session.csrfToken }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    return {
      userId,
      csrf: session.csrfToken,
      get: (p) => request(p, { headers: { cookie } }),
      post: (p, body, o) => send('POST', p, body ?? {}, o),
      patch: (p, body) => send('PATCH', p, body),
      put: (p, body) => send('PUT', p, body),
      upload: (p, form) => request(p, { method: 'POST', headers: { cookie, origin: ORIGIN, 'x-csrf-token': session.csrfToken }, body: form }),
    }
  }
  return {
    deps: Object.assign(deps, {
      setNow: (d: Date) => {
        now = d.getTime()
      },
    }),
    request,
    as,
    cleanup: () => {
      db.close()
      fs.rmSync(storageDir, { recursive: true, force: true })
    },
  }
}

export async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T
}

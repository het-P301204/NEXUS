import crypto from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CaseDetailResponse, CaseListItem, ImportPreview, TamperSimulationResponse, VerifyResponse } from '../../types/api.ts'
import { harness, json } from '../helpers.ts'
import type { Harness } from '../helpers.ts'

let h: Harness
let cases: CaseListItem[]
const byTitle = (s: string) => cases.find((c) => c.title.toLowerCase().includes(s))!

beforeAll(async () => {
  h = await harness()
  const lead = await h.as('u-lead')
  cases = (await json<{ items: CaseListItem[] }>(await lead.get('/api/cases'))).items
}, 60_000)
afterAll(() => h.cleanup())

describe('seeded demo state', () => {
  it('covers every case state the demo is meant to show', () => {
    const statuses = new Set(cases.map((c) => c.status))
    for (const s of ['INVESTIGATING', 'AWARENESS_ESTABLISHED', 'DETERMINATION_PENDING', 'REPORTABLE', 'NOT_REPORTABLE', 'SUBMITTED', 'CLOSED']) expect(statuses, s).toContain(s)
    expect(byTitle('mosquitto').status).toBe('NOT_REPORTABLE') // transitional: both dates before 11 Sep
    expect(byTitle('jackson').status).toBe('SUBMITTED') // vulnerability before, exploitation after
    expect(byTitle('busybox').nextDeadline?.status).toBe('CRITICAL')
  })

  it('verifies the seeded ledger', async () => {
    const lead = await h.as('u-lead')
    const r = await json<VerifyResponse>(await lead.post('/api/ledger/verify', { anchor: null }))
    expect(r.result.ok).toBe(true)
    expect(r.result.checked).toBeGreaterThan(150)
  })
})

describe('authentication and request integrity', () => {
  it('refuses unauthenticated API access with a structured error', async () => {
    const res = await h.request('/api/cases')
    expect(res.status).toBe(401)
    const body = await json<{ error: { code: string; reason: string } }>(res)
    expect(body.error.code).toBe('SESSION_REQUIRED')
  })

  it('refuses state-changing requests without the session CSRF token', async () => {
    const lead = await h.as('u-lead')
    const res = await lead.post(`/api/cases/${byTitle('nginx').id}/comments`, { body: 'hi' }, { csrf: null })
    expect(res.status).toBe(403)
    expect((await json<{ error: { code: string } }>(res)).error.code).toBe('CSRF_REJECTED')
  })

  it('refuses state-changing requests from another origin', async () => {
    const lead = await h.as('u-lead')
    const res = await lead.post(`/api/cases/${byTitle('nginx').id}/comments`, { body: 'hi' }, { origin: 'https://evil.example' })
    expect(res.status).toBe(403)
    expect((await json<{ error: { code: string } }>(res)).error.code).toBe('ORIGIN_REJECTED')
  })

  it('sends security headers and no stack traces', async () => {
    const res = await h.request('/api/session')
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const bad = await h.request('/api/nope')
    expect(await bad.text()).not.toMatch(/at \w+ \(/)
  })

  it('rate-limits sign-in attempts', async () => {
    const strict = await harness({ seed: false, rateLimitScale: 1 })
    const statuses: number[] = []
    for (let i = 0; i < 12; i++) {
      const r = await strict.request('/api/session/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' }, body: JSON.stringify({ email: 'x@example.com', password: 'wrong' }) })
      statuses.push(r.status)
    }
    strict.cleanup()
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true)
    expect(statuses.at(-1)).toBe(429)
  })
})

describe('authorization is enforced on the server', () => {
  it('refuses a Read Only user every write', async () => {
    const ro = await h.as('u-ro')
    const res = await ro.post('/api/cases', { title: 'x', vulnerabilityId: 'VUL-0012', productIds: ['PRD-SEG'] })
    expect(res.status).toBe(403)
    expect((await json<{ error: { code: string } }>(res)).error.code).toBe('PERMISSION_DENIED')
  })

  it('lets Read Only verify the ledger (verification changes nothing)', async () => {
    const ro = await h.as('u-ro')
    expect((await ro.post('/api/ledger/verify', { anchor: null })).status).toBe(200)
  })

  it('refuses an analyst acting on a case they neither own nor collaborate on (object-level)', async () => {
    const c = byTitle('curl') // owned by u-analyst2
    const priya = await h.as('u-analyst') // not owner, not collaborator
    const res = await priya.post(`/api/cases/${c.id}/determinations`, { productId: 'PRD-SCA', answers: {}, rationale: 'twenty characters at least', confidence: 'HIGH' })
    expect(res.status).toBe(403)
  })

  it('refuses awareness establishment to roles without the designated authority', async () => {
    const eng = await h.as('u-eng')
    const res = await eng.post(`/api/cases/${byTitle('nginx').id}/events`, { type: 'VULNERABILITY_AWARENESS', occurredAt: '2026-09-30T11:00:00Z', timezone: 'UTC', source: 'x', sourceKind: 'system_of_record', criterionId: 'AC-01' })
    expect(res.status).toBe(403)
  })

  it('withholds restricted evidence from roles that cannot read it', async () => {
    const c = byTitle('openssl x.509 policy over-read -- secureedge')
    const analyst = await h.as('u-analyst')
    const detail = await json<CaseDetailResponse>(await analyst.get(`/api/cases/${c.id}`))
    const restricted = detail.bundle.evidence.find((e) => e.classification === 'restricted')!
    expect(restricted.redacted).toBe(true)
    expect(restricted.title).toBe('Restricted evidence')
    expect((await analyst.get(`/api/evidence/${restricted.id}/file`)).status).toBe(403)
    const legal = await h.as('u-legal')
    const file = await legal.get(`/api/evidence/${restricted.id}/file`)
    expect(file.status).toBe(200)
    expect(file.headers.get('content-disposition')).toMatch(/^attachment/)
    expect(file.headers.get('content-security-policy')).toContain('sandbox')
  })
})

describe('clock of record', () => {
  it('establishes awareness only against a criterion with its required evidence, and only once', async () => {
    const lead = await h.as('u-lead')
    const c = byTitle('nginx')
    const url = `/api/cases/${c.id}/events`
    const base = { type: 'VULNERABILITY_AWARENESS', occurredAt: '2026-09-30T11:00:00Z', timezone: 'Europe/Berlin', source: 'PSIRT tracker', sourceKind: 'system_of_record' }
    expect((await lead.post(url, base)).status).toBe(422) // no criterion
    const noEvidence = await lead.post(url, { ...base, criterionId: 'AC-01' })
    expect((await json<{ error: { code: string } }>(noEvidence)).error.code).toBe('AWARENESS_EVIDENCE_REQUIRED')
    // attach a ticket, then establish
    const ev = await json<{ id: string }>(await lead.post('/api/evidence', { caseId: c.id, type: 'TICKET', title: 'PSIRT ticket', source: 'tracker', content: 'confirmed' }))
    const ok = await lead.post(url, { ...base, criterionId: 'AC-01', evidenceIds: [ev.id] })
    expect(ok.status).toBe(201)
    const again = await lead.post(url, { ...base, criterionId: 'AC-01', evidenceIds: [ev.id] })
    expect(again.status).toBe(409)
    expect((await json<{ error: { code: string } }>(again)).error.code).toBe('EVENT_ALREADY_RECORDED')
  })

  it('refuses a timestamp in the future', async () => {
    const lead = await h.as('u-lead')
    const res = await lead.post(`/api/cases/${byTitle('nginx').id}/events`, { type: 'OCCURRENCE', occurredAt: '2026-10-05T00:00:00Z', timezone: 'UTC', source: 'x', sourceKind: 'external_document' })
    expect((await json<{ error: { code: string } }>(res)).error.code).toBe('TIMESTAMP_IN_FUTURE')
  })

  it('corrects a timestamp with a new event, preserves the original, and moves the deadline', async () => {
    const mgr = await h.as('u-mgr')
    const c = byTitle('openssl x.509 policy over-read -- secureedge')
    const before = await json<CaseDetailResponse>(await mgr.get(`/api/cases/${c.id}`))
    const ea = before.bundle.events.find((e) => e.type === 'EXPLOITATION_AWARENESS')!
    const due = before.analysis.deadlines[0]!.dueAt!
    // Five minutes earlier keeps exploitation awareness after vulnerability
    // awareness, so it remains the later instant that starts the clock.
    const earlier = new Date(Date.parse(ea.occurredAt) - 5 * 60_000).toISOString()
    const res = await mgr.post(`/api/cases/${c.id}/events/${ea.id}/correct`, { occurredAt: earlier, timezone: 'UTC', source: 'SOC case system', sourceKind: 'system_of_record', reason: 'Validated against the SOC case system timestamp, five minutes earlier.' })
    expect(res.status).toBe(201)
    const after = await json<CaseDetailResponse>(await mgr.get(`/api/cases/${c.id}`))
    expect(Date.parse(after.analysis.deadlines[0]!.dueAt!)).toBe(Date.parse(due) - 5 * 60_000)
    expect(after.bundle.events.find((e) => e.id === ea.id)!.occurredAt).toBe(ea.occurredAt) // original untouched
  })

  it('refuses to correct a server-witnessed timestamp', async () => {
    const mgr = await h.as('u-mgr')
    const c = byTitle('busybox')
    const d = await json<CaseDetailResponse>(await mgr.get(`/api/cases/${c.id}`))
    const decisionEvent = d.bundle.events.find((e) => e.type === 'DECISION')!
    const res = await mgr.post(`/api/cases/${c.id}/events/${decisionEvent.id}/correct`, { occurredAt: '2026-09-29T00:00:00Z', timezone: 'UTC', source: 'x', sourceKind: 'analyst_attestation', reason: 'Trying to move a server-witnessed time.' })
    expect((await json<{ error: { code: string } }>(res)).error.code).toBe('CORRECTION_NOT_ALLOWED')
  })

  it('rejects edits to history at the database level', () => {
    expect(() => h.deps.db.prepare("UPDATE clock_events SET data = '{}'").run()).toThrow(/append-only/)
    expect(() => h.deps.db.prepare('DELETE FROM audit_events').run()).toThrow(/append-only/)
    expect(() => h.deps.db.prepare('DELETE FROM decisions').run()).toThrow(/append-only/)
  })
})

describe('determinations and decisions', () => {
  it('computes the result on the server from the answers', async () => {
    const lead = await h.as('u-lead')
    const c = byTitle('openssl x.509 policy over-read -- secureedge')
    const res = await lead.post(`/api/cases/${c.id}/determinations`, {
      productId: 'PRD-BCC',
      answers: { component_present: { answer: 'YES' }, vulnerable_version: { answer: 'YES' }, functionality_enabled: { answer: 'YES' }, feature_reachable: { answer: 'NO' }, product_validation: { answer: 'YES' } },
      rationale: 'Console uses the JVM TLS stack, not OpenSSL.',
      confidence: 'HIGH',
      result: 'NOT_AFFECTED', // ignored: the client does not decide the result
    })
    const body = await json<{ result: string }>(res)
    // Deciding answer has no evidence, so the server records UNDER INVESTIGATION.
    expect(res.status).toBe(422) // ...which requires a next action, owner and due time
    expect(JSON.stringify(body)).toMatch(/next action/i)
  })

  it('refuses an incomplete decision not to report, field by field', async () => {
    const lead = await h.as('u-lead')
    const c = byTitle('nginx')
    const res = await lead.post(`/api/cases/${c.id}/decisions`, { outcome: 'DO_NOT_REPORT', rationale: 'Too short for a record that nobody will question later on.', confidence: 'HIGH' })
    expect(res.status).toBe(422)
    const body = await json<{ error: { fields: Record<string, string> } }>(res)
    expect(Object.keys(body.error.fields)).toEqual(expect.arrayContaining(['nonReportReason', 'affectedness', 'exploitation', 'evidenceIds']))
  })

  it('records a complete non-report decision, sends its decision record to review, and puts it in force only on approval', async () => {
    const lead = await h.as('u-lead')
    const c = byTitle('libxml2')
    // libxml2 already has a decision; use a scenario that sets up a non-report
    const s = await json<{ caseId: string }>(await lead.post('/api/demo/scenarios/02'))
    const d = await json<CaseDetailResponse>(await lead.get(`/api/cases/${s.caseId}`))
    expect(d.analysis.suggestion.outcome).toBe('DO_NOT_REPORT')
    const evidenceIds = d.bundle.evidence.slice(0, 2).map((e) => e.id)
    const res = await lead.post(`/api/cases/${s.caseId}/decisions`, { outcome: 'DO_NOT_REPORT', nonReportReason: 'NOT_AFFECTED', rationale: 'The agent never links the text-format parser; the vulnerable code is not in any execution path.', confidence: 'HIGH', evidenceIds })
    expect(res.status).toBe(201)
    const body = await json<{ decisionRecordId: string }>(res)
    const after = await json<CaseDetailResponse>(await lead.get(`/api/cases/${s.caseId}`))
    expect(after.analysis.status).toBe('NOT_REPORTABLE')
    expect(after.bundle.reports.find((r) => r.id === body.decisionRecordId)?.stage).toBe('INTERNAL_REVIEW')
    expect(after.bundle.events.some((e) => e.type === 'DECISION' && e.sourceKind === 'nexus_server')).toBe(true)
    // Not reporting is the higher-risk decision: it is recorded, but not in force on the analyst's word.
    expect(after.analysis.decisionStanding?.inForce).toBe(false)
    const comp = await h.as('u-comp')
    const review = await comp.post(`/api/cases/${s.caseId}/reviews`, { targetType: 'report', targetId: body.decisionRecordId, action: 'APPROVE', comment: 'Evidence supports not affected.' })
    expect(review.status).toBe(201)
    const approved = await json<CaseDetailResponse>(await lead.get(`/api/cases/${s.caseId}`))
    expect(approved.analysis.decisionStanding?.inForce).toBe(true)
    expect(c).toBeDefined()
  })

  it('requires a divergence reason when the decision differs from the rule evaluation', async () => {
    const lead = await h.as('u-lead')
    const c = byTitle('curl')
    const res = await lead.post(`/api/cases/${c.id}/decisions`, { outcome: 'REPORT', rationale: 'Precautionary early warning while reachability is being established.', confidence: 'LOW', unresolved: 'Reachability not established.' })
    const body = await json<{ error: { fields: Record<string, string> } }>(res)
    expect(res.status).toBe(422)
    expect(body.error.fields.divergenceReason).toBeDefined()
  })
})

describe('review, approval and submission', () => {
  it('enforces separation of duties and the approval policy, then submits (simulated)', async () => {
    const c = byTitle('busybox')
    const priya = await h.as('u-analyst') // generated the report
    const d = await json<CaseDetailResponse>(await priya.get(`/api/cases/${c.id}`))
    const ew = d.bundle.reports.filter((r) => r.kind === 'EARLY_WARNING').sort((a, b) => b.minor - a.minor)[0]!
    expect(ew.stage).toBe('INTERNAL_REVIEW')
    const lead = await h.as('u-lead') // recorded the decision
    const self = await lead.post(`/api/cases/${c.id}/reviews`, { targetType: 'report', targetId: ew.id, action: 'APPROVE', comment: '' })
    expect((await json<{ error: { code: string } }>(self)).error.code).toBe('SEPARATION_OF_DUTIES')
    const mgr = await h.as('u-mgr')
    const ok = await json<{ advanced: string }>(await mgr.post(`/api/cases/${c.id}/reviews`, { targetType: 'report', targetId: ew.id, action: 'APPROVE', comment: 'Approved.' }))
    expect(ok.advanced).toBe('APPROVED')
    expect((await mgr.post(`/api/reports/${ew.id}/transition`, { to: 'READY' })).status).toBe(200)
    const sub = await json<{ submission: { reference: string } }>(await mgr.post(`/api/reports/${ew.id}/transition`, { to: 'SUBMITTED' }))
    expect(sub.submission.reference).toMatch(/^SIM-ENISA-SRP-/)
    const after = await json<CaseDetailResponse>(await mgr.get(`/api/cases/${c.id}`))
    expect(after.analysis.status).toBe('SUBMITTED')
    expect(after.analysis.deadlines[0]!.status).toBe('COMPLETED')
    expect(after.analysis.completeness.items.find((i) => i.id === 'submission')!.state).toBe('satisfied')
  })

  it('refuses a submission without a decision to report', async () => {
    const lead = await h.as('u-lead')
    const c = byTitle('nginx')
    const r = await json<{ id: string }>(await lead.post(`/api/cases/${c.id}/reports`, { kind: 'EARLY_WARNING' }))
    await lead.post(`/api/reports/${r.id}/transition`, { to: 'INTERNAL_REVIEW' })
    const mgr = await h.as('u-mgr')
    await mgr.post(`/api/cases/${c.id}/reviews`, { targetType: 'report', targetId: r.id, action: 'APPROVE', comment: '' })
    // Refused already at READY: nothing is marked ready without the decision that authorises it.
    const ready = await lead.post(`/api/reports/${r.id}/transition`, { to: 'READY' })
    expect((await json<{ error: { code: string } }>(ready)).error.code).toBe('NO_DECISION_TO_REPORT')
    const res = await lead.post(`/api/reports/${r.id}/transition`, { to: 'SUBMITTED' })
    expect(res.status).toBe(409)
  })

  it('versions reports instead of replacing them', async () => {
    const lead = await h.as('u-lead')
    const c = byTitle('libarchive')
    const a = await json<{ version: string }>(await lead.post(`/api/cases/${c.id}/reports`, { kind: 'FINAL_REPORT' }))
    const b = await json<{ version: string }>(await lead.post(`/api/cases/${c.id}/reports`, { kind: 'FINAL_REPORT' }))
    expect(a.version).toBe('1.0')
    expect(b.version).toBe('1.1')
  })
})

describe('evidence uploads', () => {
  it('refuses a file whose content does not match its declared type', async () => {
    const lead = await h.as('u-lead')
    const form = new FormData()
    for (const [k, v] of Object.entries({ caseId: byTitle('nginx').id, type: 'SCREENSHOT', title: 'Screenshot', source: 'test' })) form.append(k, v)
    form.append('file', new File(['<script>alert(1)</script>'], 'shot.png', { type: 'image/png' }))
    const res = await lead.upload('/api/evidence', form)
    expect(res.status).toBe(422)
    expect(JSON.stringify(await res.json())).toMatch(/type mismatch|not accepted/i)
  })

  it('hashes an accepted upload on the server', async () => {
    const lead = await h.as('u-lead')
    const form = new FormData()
    for (const [k, v] of Object.entries({ caseId: byTitle('nginx').id, type: 'LOG', title: 'Log', source: 'test' })) form.append(k, v)
    form.append('file', new File(['line one\n'], 'x.log', { type: 'text/plain' }))
    const body = await json<{ sha256: string }>(await lead.upload('/api/evidence', form))
    expect(body.sha256).toBe(crypto.createHash('sha256').update('line one' + String.fromCharCode(10)).digest('hex'))
  })
})

describe('import', () => {
  it('previews errors and refuses to commit anything while any record is invalid', async () => {
    const lead = await h.as('u-lead')
    const csv = 'cve,title,severity,description,affected_versions,source,discovered_at,exploitation\nCVE-2026-997001,Good one,HIGH,A valid description,<1.0,test,2026-09-29T00:00:00Z,UNKNOWN\nNOT-A-CVE,Bad one,HIGH,A valid description,<1.0,test,2026-09-29T00:00:00Z,UNKNOWN\n'
    const p = await json<ImportPreview>(await lead.post('/api/import/preview', { kind: 'vulnerabilities', format: 'csv', content: csv }))
    expect(p.valid).toHaveLength(1)
    expect(p.errors).toHaveLength(1)
    expect(p.canCommit).toBe(false)
    const res = await lead.post('/api/import/commit', { token: p.token })
    expect((await json<{ error: { code: string } }>(res)).error.code).toBe('IMPORT_HAS_ERRORS')
    const vulns = await json<{ items: Array<{ cve: string }> }>(await lead.get('/api/vulnerabilities'))
    expect(vulns.items.some((v) => v.cve === 'CVE-2026-997001')).toBe(false)
  })
})

describe('ledger tamper simulation', () => {
  it('reports the exception on a copy and leaves the stored ledger intact', async () => {
    const lead = await h.as('u-lead')
    const sim = await json<TamperSimulationResponse>(await lead.post('/api/demo/ledger/simulate', { seq: 20, field: 'summary' }))
    expect(sim.simulation).toBe(true)
    expect(sim.result.ok).toBe(false)
    expect(sim.result.firstBreak?.seq).toBe(20)
    const real = await json<VerifyResponse>(await lead.post('/api/ledger/verify', { anchor: null }))
    expect(real.result.ok).toBe(true)
  })

  it('does not exist when demo mode is off', async () => {
    const prod = await harness({ seed: true, demoMode: false })
    const lead = await prod.as('u-lead').catch(() => null)
    // persona sign-in is itself a demo feature
    expect(lead).toBeNull()
    expect((await prod.request('/api/session/personas')).status).toBe(404)
    prod.cleanup()
  })
})

describe('exports', () => {
  it('neutralises formula injection in the case CSV', async () => {
    const lead = await h.as('u-lead')
    const c = byTitle('nginx')
    await lead.patch(`/api/cases/${c.id}`, { title: '=HYPERLINK("http://evil.example","x")' })
    const csv = await (await lead.get('/api/export/cases?format=csv')).text()
    expect(csv).toContain(`"'=HYPERLINK(`)
  })

  it('strips bidi controls at the input boundary', async () => {
    const lead = await h.as('u-lead')
    const c = byTitle('hyperlink') ?? byTitle('nginx')
    await lead.patch(`/api/cases/${c.id}`, { title: `nginx ${String.fromCodePoint(0x202e)}gnirts` })
    const d = await json<CaseDetailResponse>(await lead.get(`/api/cases/${c.id}`))
    expect(d.bundle.case.title).toBe('nginx gnirts')
  })

  it('keeps the chain intact after every operation in this suite', async () => {
    const lead = await h.as('u-lead')
    const r = await json<VerifyResponse>(await lead.post('/api/ledger/verify', { anchor: null }))
    expect(r.result.ok).toBe(true)
  })
})

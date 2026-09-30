import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CaseDetailResponse, CaseListItem, ImportPreview, ReportDetailResponse, SystemStatus } from '../../types/api.ts'
import type { AuditEvent } from '../../types/domain.ts'
import type { Config } from '../../server/config.ts'
import { createApp } from '../../server/app.ts'
import { openDb, setSequence } from '../../server/db.ts'
import { seedFresh } from '../../server/bootstrap.ts'
import { objectPath } from '../../server/evidence-store.ts'
import { sessionCookieName } from '../../server/security.ts'
import { NOW, ORIGIN, harness, json } from '../helpers.ts'
import type { Client, Harness } from '../helpers.ts'

/**
 * Adversarial security review of the NEXUS API.
 *
 * Two kinds of test live here:
 *
 *   F1-F10   Issues the review confirmed. Each was first written as a failing test that
 *            demonstrated the exploit, then fixed; the test now pins the secure behaviour.
 *
 *   the rest Attacks that were tried and are not exploitable. They pin the controls that
 *            stopped them.
 *
 * Setup runs through `scenario()`, which rethrows: a setup that breaks (seed data changed, a
 * route moved) fails the test instead of letting it pass vacuously.
 */

type ErrorBody = { error: { code: string; reason: string } }
const code = async (r: Response) => (await json<ErrorBody>(r)).error?.code

const cleanups: Array<() => void> = []
async function fresh(): Promise<Harness> {
  const x = await harness()
  cleanups.push(x.cleanup)
  return x
}
afterAll(() => {
  for (const c of cleanups) c()
})

async function scenario<T>(fn: () => Promise<T>): Promise<T | null> {
  return fn()
}

function setNow(x: Harness, iso: string): void {
  ;(x.deps as unknown as { setNow: (d: Date) => void }).setNow(new Date(iso))
}

interface CaseIds {
  nginx: string
  seg: string
  busybox: string
  curl: string
  jackson: string
  sqlite: string
}

async function caseIds(x: Harness): Promise<CaseIds> {
  const lead = await x.as('u-lead')
  const items = (await json<{ items: CaseListItem[] }>(await lead.get('/api/cases'))).items
  const find = (s: string) => items.find((c) => c.title.toLowerCase().includes(s))!.id
  return {
    nginx: find('nginx'),
    seg: find('openssl x.509 policy over-read -- secureedge'),
    busybox: find('busybox'),
    curl: find('curl'),
    jackson: find('jackson'),
    sqlite: find('sqlite'),
  }
}

async function detail(client: Client, caseId: string): Promise<CaseDetailResponse> {
  return json<CaseDetailResponse>(await client.get(`/api/cases/${caseId}`))
}

async function report(client: Client, id: string): Promise<ReportDetailResponse> {
  return json<ReportDetailResponse>(await client.get(`/api/reports/${id}`))
}

/** A raw signed-in session, for requests the Client helper cannot shape (no token, foreign token). */
async function rawSession(x: Harness, userId: string): Promise<{ cookie: string; csrf: string }> {
  const res = await x.request('/api/session/persona', { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ userId }) })
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!
  const s = await json<{ csrfToken: string }>(await x.request('/api/session', { headers: { cookie } }))
  return { cookie, csrf: s.csrfToken }
}

const SEG_RESTRICTED_TITLE = 'Customer advisory draft (privileged)'
const SEG_RESTRICTED_SOURCE = 'Legal / customer success'
const SEG_RESTRICTED_FILE = 'customer-advisory-draft.txt'
const RLO = String.fromCodePoint(0x202e)

// Shared, read-mostly harness for refusals and redaction checks.
let h: Harness
let ids: CaseIds
beforeAll(async () => {
  h = await harness()
  cleanups.push(h.cleanup)
  ids = await caseIds(h)
}, 60_000)

// ==================================================================================================
// CONFIRMED ISSUES
// ==================================================================================================

describe('confirmed issues, fixed (regression tests)', () => {
  it('F1 report content carries the title and source of restricted evidence to every role', async () => {
    const s = await scenario(async () => {
      const x = await fresh()
      const { seg } = await caseIds(x)
      // u-analyst owns this case but has no evidence.read_restricted; generating a report is enough.
      const analyst = await x.as('u-analyst')
      const gen = await analyst.post(`/api/cases/${seg}/reports`, { kind: 'EARLY_WARNING' })
      expect(gen.status).toBe(201)
      const { id } = await json<{ id: string }>(gen)
      const ro = await x.as('u-ro')
      const detailRes = await ro.get(`/api/reports/${id}`)
      expect(detailRes.status).toBe(200)
      return {
        detail: await detailRes.text(),
        md: await (await ro.get(`/api/reports/${id}/export?format=md`)).text(),
        html: await (await ro.get(`/api/reports/${id}/export?format=html`)).text(),
        json: await (await ro.get(`/api/reports/${id}/export?format=json`)).text(),
      }
    })
    if (!s) return
    for (const body of [s.detail, s.md, s.html, s.json]) {
      expect(body).not.toContain(SEG_RESTRICTED_TITLE)
      expect(body).not.toContain(SEG_RESTRICTED_SOURCE)
    }
  })

  it('F2a evidence detail leaks the restricted title through the evidence chain', async () => {
    const s = await scenario(async () => {
      const lead = await h.as('u-lead')
      const restricted = (await detail(lead, ids.seg)).bundle.evidence.find((e) => e.classification === 'restricted')!
      const ro = await h.as('u-ro')
      const res = await ro.get(`/api/evidence/${restricted.id}`)
      expect(res.status).toBe(200)
      const body = await json<{ evidence: { title: string; redacted?: boolean }; chain: Array<Array<{ label: string }>> }>(res)
      expect(body.evidence.redacted).toBe(true) // the record itself is redacted...
      return body
    })
    if (!s) return
    // ...but the chain's first node is built from the unredacted record.
    expect(JSON.stringify(s.chain)).not.toContain(SEG_RESTRICTED_TITLE)
  })

  it('F2b case detail leaks a restricted title through a data-quality warning', async () => {
    const s = await scenario(async () => {
      const x = await fresh()
      const { jackson } = await caseIds(x)
      const lead = await x.as('u-lead')
      const d = await detail(lead, jackson)
      const ea = d.bundle.events.find((e) => e.type === 'EXPLOITATION_AWARENESS')!
      const ew = d.bundle.events.find((e) => e.type === 'EARLY_WARNING_SUBMITTED')!
      expect(Date.parse(ew.occurredAt)).toBeLessThan(Date.parse('2026-09-30T11:59:00Z'))
      const up = await lead.post('/api/evidence', {
        caseId: jackson,
        type: 'EMAIL',
        title: 'F2B-SECRET counsel memo',
        source: 'F2B-SECRET outside counsel',
        content: 'privileged',
        classification: 'restricted',
        sourceCreatedAt: '2026-09-30T11:59:00Z', // after the early warning it will "support"
      })
      expect(up.status).toBe(201)
      const ev = await json<{ id: string }>(up)
      expect((await lead.post(`/api/evidence/${ev.id}/links`, { targetType: 'clock_event', targetId: ea.id })).status).toBe(200)
      const ro = await x.as('u-ro')
      const roView = await detail(ro, jackson)
      expect(roView.bundle.evidence.find((e) => e.id === ev.id)!.title).toBe('Restricted evidence')
      return { detail: JSON.stringify(roView), exportJson: await (await ro.get(`/api/cases/${jackson}/export`)).text() }
    })
    if (!s) return
    expect(s.detail).not.toContain('F2B-SECRET')
    expect(s.exportJson).not.toContain('F2B-SECRET')
  })

  it('F3a the person who recorded the decision can approve a report generated before it', async () => {
    const s = await scenario(async () => {
      const x = await fresh()
      const { nginx } = await caseIds(x)
      const mgr = await x.as('u-mgr')
      const lead = await x.as('u-lead')
      const { id } = await json<{ id: string }>(await mgr.post(`/api/cases/${nginx}/reports`, { kind: 'EARLY_WARNING' }))
      expect((await mgr.post(`/api/reports/${id}/transition`, { to: 'INTERNAL_REVIEW' })).status).toBe(200)
      const dec = await lead.post(`/api/cases/${nginx}/decisions`, {
        outcome: 'REPORT',
        rationale: 'Precautionary early warning while exploitation evidence is validated by the SOC.',
        confidence: 'HIGH',
        divergenceReason: 'Rule evaluation pending; reporting precautionarily.',
      })
      expect(dec.status).toBe(201)
      return { approve: await lead.post(`/api/cases/${nginx}/reviews`, { targetType: 'report', targetId: id, action: 'APPROVE', comment: 'ok' }) }
    })
    if (!s) return
    // u-lead recorded the decision this early warning will be submitted under.
    expect(s.approve.status).toBe(403)
    expect(await code(s.approve)).toBe('SEPARATION_OF_DUTIES')
  })

  it('F3b a report generated before the current decision is submitted as that decision\'s early warning', async () => {
    const s = await scenario(async () => {
      const x = await fresh()
      const { nginx } = await caseIds(x)
      const mgr = await x.as('u-mgr')
      const lead = await x.as('u-lead')
      const exec = await x.as('u-exec')
      const { id } = await json<{ id: string }>(await mgr.post(`/api/cases/${nginx}/reports`, { kind: 'EARLY_WARNING' }))
      await mgr.post(`/api/reports/${id}/transition`, { to: 'INTERNAL_REVIEW' })
      const dec = await lead.post(`/api/cases/${nginx}/decisions`, {
        outcome: 'REPORT',
        rationale: 'Precautionary early warning while exploitation evidence is validated by the SOC.',
        confidence: 'HIGH',
        divergenceReason: 'Rule evaluation pending; reporting precautionarily.',
      })
      expect(dec.status).toBe(201)
      expect((await json<{ advanced: string }>(await exec.post(`/api/cases/${nginx}/reviews`, { targetType: 'report', targetId: id, action: 'APPROVE', comment: 'ok' }))).advanced).toBe('APPROVED')
      const r = await report(lead, id)
      expect(r.report.decisionId).toBeNull()
      expect(JSON.stringify(r.report.content)).toContain('No reportability decision has been recorded.')
      return {
        ready: await lead.post(`/api/reports/${id}/transition`, { to: 'READY' }),
        submit: await lead.post(`/api/reports/${id}/transition`, { to: 'SUBMITTED' }),
      }
    })
    if (!s) return
    // A version generated before the decision cannot be marked ready, let alone submitted as that
    // decision's early warning.
    expect(s.ready.status).toBe(409)
    expect(await code(s.ready)).toBe('REPORT_DECISION_MISMATCH')
    expect(s.submit.status).toBe(409)
  })

  async function nonReportCase(x: Harness): Promise<{ caseId: string; recordId: string; decisionId: string }> {
    const lead = await x.as('u-lead')
    const { caseId } = await json<{ caseId: string }>(await lead.post('/api/demo/scenarios/02'))
    const d = await detail(lead, caseId)
    const res = await lead.post(`/api/cases/${caseId}/decisions`, {
      outcome: 'DO_NOT_REPORT',
      nonReportReason: 'NOT_AFFECTED',
      rationale: 'The agent never links the text-format parser; the vulnerable code is not in any execution path.',
      confidence: 'HIGH',
      evidenceIds: d.bundle.evidence.slice(0, 2).map((e) => e.id),
    })
    expect(res.status).toBe(201)
    const body = await json<{ id: string; decisionRecordId: string }>(res)
    return { caseId, recordId: body.decisionRecordId, decisionId: body.id }
  }

  it('F4a a case can be closed while its non-report decision record is still unreviewed', async () => {
    const s = await scenario(async () => {
      const x = await fresh()
      const { caseId, recordId } = await nonReportCase(x)
      const lead = await x.as('u-lead')
      expect((await report(lead, recordId)).report.stage).toBe('INTERNAL_REVIEW')
      return { close: await lead.post(`/api/cases/${caseId}/lifecycle`, { action: 'close', reason: 'Not affected; closing the case.' }) }
    })
    if (!s) return
    expect(s.close.status).toBe(409)
  })

  it('F4b rejecting the decision record leaves the non-report decision in force (clocks stay stopped)', async () => {
    const s = await scenario(async () => {
      const x = await fresh()
      const { caseId, recordId, decisionId } = await nonReportCase(x)
      const legal = await x.as('u-legal')
      const rej = await json<{ advanced: string }>(await legal.post(`/api/cases/${caseId}/reviews`, { targetType: 'report', targetId: recordId, action: 'REJECT', comment: 'Reachability claim is not evidenced.' }))
      expect(rej.advanced).toBe('DRAFT')
      const d = await detail(await x.as('u-lead'), caseId)
      return { decisionId, deadlines: d.analysis.deadlines, standing: d.analysis.decisionStanding }
    })
    if (!s) return
    expect(s.standing?.inForce).toBe(false)
    expect(s.deadlines.some((d) => d.status === 'NOT_APPLICABLE' && d.reason.includes(s.decisionId))).toBe(false)
  })

  it('F5 reviews (approve/reject) are accepted on a closed case', async () => {
    const s = await scenario(async () => {
      const x = await fresh()
      const { caseId, recordId } = await nonReportCase(x)
      const lead = await x.as('u-lead')
      const comp = await x.as('u-comp')
      expect((await comp.post(`/api/cases/${caseId}/reviews`, { targetType: 'report', targetId: recordId, action: 'APPROVE', comment: 'Evidence supports not affected.' })).status).toBe(201)
      expect((await lead.post(`/api/cases/${caseId}/lifecycle`, { action: 'close', reason: 'Not affected; closing the case.' })).status).toBe(200)
      const legal = await x.as('u-legal')
      return {
        reject: await legal.post(`/api/cases/${caseId}/reviews`, { targetType: 'report', targetId: recordId, action: 'REJECT', comment: 'Reopening the question after close.' }),
        comment: await legal.post(`/api/cases/${caseId}/comments`, { body: 'A note on a closed case.' }),
      }
    })
    if (!s) return
    expect(s.reject.status).toBe(403)
    expect(s.comment.status).toBe(403)
  })

  it('F6 bidi controls enter the portfolio through the component import and the purl field', async () => {
    const s = await scenario(async () => {
      const x = await fresh()
      const lead = await x.as('u-lead')
      const csv = `name,purl,ecosystem,supplier,product_id,version,relation,usage
evillib,pkg:generic/evillib@1.0,C,Evil Corp,PRD-SEG,1.0${RLO}0.1-,direct,note${RLO}eton
`
      const p = await json<ImportPreview>(await lead.post('/api/import/preview', { kind: 'components', format: 'csv', content: csv }))
      expect(p.canCommit).toBe(true)
      expect((await lead.post('/api/import/commit', { token: p.token })).status).toBe(200)
      const add = await lead.post('/api/products/PRD-SEG/components', { component: { name: 'purllib', purl: `pkg:generic/purl${RLO}bil@2.0`, ecosystem: 'C', supplier: 'x' }, version: '2.0', relation: 'direct' })
      return { add, product: await (await lead.get('/api/products/PRD-SEG')).text(), components: await (await lead.get('/api/components')).text() }
    })
    if (!s) return
    // Imported free text is cleaned; a purl, which is ASCII by specification, is refused outright.
    expect(s.add.status).toBe(422)
    expect(s.product).not.toContain(RLO)
    expect(s.components).not.toContain(RLO)
  })

  it('F11 a new product-component mapping gets a fresh id (seeded fixed ids no longer collide)', async () => {
    const x = await fresh()
    const lead = await x.as('u-lead')
    // Before the fix, nextId('PC') returned the seeded PC-0001 and every new mapping failed with a 500.
    const add = await lead.post('/api/products/PRD-SEG/components', { component: { name: 'newlib', purl: 'pkg:generic/newlib@2.0', ecosystem: 'C', supplier: 'x' }, version: '2.0', relation: 'direct' })
    expect(add.status).toBe(201)
    const again = await lead.post('/api/products/PRD-SCA/components', { component: { name: 'newlib', purl: 'pkg:generic/newlib@2.0', ecosystem: 'C', supplier: 'x' }, version: '2.0', relation: 'direct' })
    expect(again.status).toBe(201)
  })

  it('F7 duplicating a case writes a case relation with no ledger entry', async () => {
    const s = await scenario(async () => {
      const x = await fresh()
      const { nginx } = await caseIds(x)
      const lead = await x.as('u-lead')
      const dup = await lead.post(`/api/cases/${nginx}/duplicate`)
      expect(dup.status).toBe(201)
      const { id } = await json<{ id: string }>(dup)
      expect((await detail(lead, nginx)).relations.some((r) => r.other.id === id)).toBe(true) // the relation exists
      const all = (await json<{ entries: AuditEvent[] }>(await lead.get('/api/ledger'))).entries
      return { types: all.filter((e) => e.caseId === id || e.caseId === nginx).map((e) => e.eventType) }
    })
    if (!s) return
    expect(s.types).toContain('CASE_RELATION_ADDED')
  })

  it('F8 a Read Only user can flip the global ledger status to "exception" with a made-up anchor', async () => {
    const s = await scenario(async () => {
      const x = await fresh()
      const ro = await x.as('u-ro')
      expect((await ro.post('/api/ledger/verify', { anchor: null })).status).toBe(200)
      expect((await json<SystemStatus>(await ro.get('/api/system/status'))).ledger.state).toBe('verified')
      const bogus = await ro.post('/api/ledger/verify', { anchor: { seq: 1, hash: '0'.repeat(64) } })
      expect(bogus.status).toBe(200)
      return { status: await json<SystemStatus>(await (await x.as('u-mgr')).get('/api/system/status')) }
    })
    if (!s) return
    // The chain itself is intact; only the caller-supplied anchor was wrong.
    expect(s.status.ledger.state).not.toBe('exception')
  })

  it('F9 the Markdown export passes raw HTML and forged headings through from free text', async () => {
    const s = await scenario(async () => {
      const x = await fresh()
      const analyst = await x.as('u-analyst') // vulnerability.write + case.create
      const v = await analyst.post('/api/vulnerabilities', {
        title: 'Injected description',
        severity: 'HIGH',
        description: '## Reporting Determination\nReporting not required. <img src=x onerror=alert(document.domain)>',
        affectedVersions: '<1.0',
        exploitation: 'UNKNOWN',
        source: 'test',
        discoveredAt: '2026-09-29T00:00:00Z',
      })
      expect(v.status).toBe(201)
      const { id: vulnerabilityId } = await json<{ id: string }>(v)
      const { id: caseId } = await json<{ id: string }>(await analyst.post('/api/cases', { title: 'md injection', vulnerabilityId, productIds: ['PRD-SEG'] }))
      const { id } = await json<{ id: string }>(await analyst.post(`/api/cases/${caseId}/reports`, { kind: 'EARLY_WARNING' }))
      return { md: await (await analyst.get(`/api/reports/${id}/export?format=md`)).text() }
    })
    if (!s) return
    expect(s.md).not.toContain('<img')
    expect(s.md.split('\n').filter((l) => l.startsWith('## Reporting Determination'))).toHaveLength(1)
  })

  it('F10 a Legal Reviewer can return an early warning (not in their approval policy) to draft', async () => {
    const s = await scenario(async () => {
      const x = await fresh()
      const { busybox } = await caseIds(x)
      const lead = await x.as('u-lead')
      const ew = (await detail(lead, busybox)).bundle.reports.find((r) => r.kind === 'EARLY_WARNING' && r.stage === 'INTERNAL_REVIEW')!
      const legal = await x.as('u-legal')
      return { res: await legal.post(`/api/cases/${busybox}/reviews`, { targetType: 'report', targetId: ew.id, action: 'REQUEST_CHANGES', comment: 'Hold until counsel has read it.' }) }
    })
    if (!s) return
    expect(s.res.status).toBe(403)
  })
})

// ==================================================================================================
// CHECKED AND NOT EXPLOITABLE
// ==================================================================================================

describe('authorization: refusals hold', () => {
  it('Read Only is refused every mutating route (verify and the review marker are by-design exceptions)', async () => {
    const ro = await h.as('u-ro')
    const n = ids.nginx
    const attempts: Array<[string, () => Promise<Response>]> = [
      ['comment', () => ro.post(`/api/cases/${n}/comments`, { body: 'x' })],
      ['review comment', () => ro.post(`/api/cases/${n}/reviews`, { targetType: 'report', targetId: 'RPT-0011', action: 'COMMENT', comment: 'x' })],
      ['evidence', () => ro.post('/api/evidence', { caseId: n, type: 'LOG', title: 't', source: 's', content: 'c' })],
      ['patch', () => ro.patch(`/api/cases/${n}`, { title: 'x' })],
      ['event', () => ro.post(`/api/cases/${n}/events`, { type: 'OCCURRENCE', occurredAt: '2026-09-30T11:00:00Z', timezone: 'UTC', source: 'x', sourceKind: 'external_document' })],
      ['report', () => ro.post(`/api/cases/${n}/reports`, { kind: 'EARLY_WARNING' })],
      ['transition', () => ro.post('/api/reports/RPT-0011/transition', { to: 'READY' })],
      ['relation', () => ro.post(`/api/cases/${n}/relations`, { relatedCaseId: ids.seg, relation: 'RELATED_CVE' })],
      ['duplicate', () => ro.post(`/api/cases/${n}/duplicate`)],
      ['lifecycle', () => ro.post(`/api/cases/${n}/lifecycle`, { action: 'archive', reason: 'a long enough reason' })],
      ['determination', () => ro.post(`/api/cases/${n}/determinations`, { productId: 'PRD-SEG', answers: {}, rationale: 'twenty characters at least', confidence: 'HIGH' })],
      ['decision', () => ro.post(`/api/cases/${n}/decisions`, { outcome: 'REPORT', rationale: 'x'.repeat(50), confidence: 'HIGH' })],
      ['vulnerability', () => ro.post('/api/vulnerabilities', {})],
      ['product', () => ro.post('/api/products', {})],
      ['import', () => ro.post('/api/import/preview', { kind: 'products', format: 'csv', content: 'x' })],
      ['settings', () => ro.put('/api/settings/org', {})],
      ['link', () => ro.post('/api/evidence/EV-0051/links', { targetType: 'case', targetId: ids.seg })],
      ['demo reset', () => ro.post('/api/demo/reset')],
    ]
    for (const [label, send] of attempts) {
      const r = await send()
      expect([label, r.status]).toEqual([label, 403])
    }
  })

  it('Legal Reviewer cannot edit, determine, decide, record clock events, generate or move reports', async () => {
    const legal = await h.as('u-legal')
    const n = ids.nginx
    const attempts: Array<[string, () => Promise<Response>]> = [
      ['patch', () => legal.patch(`/api/cases/${n}`, { title: 'x' })],
      ['determination', () => legal.post(`/api/cases/${n}/determinations`, { productId: 'PRD-SEG', answers: {}, rationale: 'twenty characters at least', confidence: 'HIGH' })],
      ['decision', () => legal.post(`/api/cases/${n}/decisions`, { outcome: 'REPORT', rationale: 'x'.repeat(50), confidence: 'HIGH' })],
      ['event', () => legal.post(`/api/cases/${n}/events`, { type: 'OCCURRENCE', occurredAt: '2026-09-30T11:00:00Z', timezone: 'UTC', source: 'x', sourceKind: 'external_document' })],
      ['report', () => legal.post(`/api/cases/${n}/reports`, { kind: 'EARLY_WARNING' })],
      ['transition', () => legal.post('/api/reports/RPT-0011/transition', { to: 'READY' })],
      ['evidence on a case legal is not on', () => legal.post('/api/evidence', { caseId: n, type: 'LOG', title: 't', source: 's', content: 'c' })],
      ['close', () => legal.post(`/api/cases/${n}/lifecycle`, { action: 'close', reason: 'a long enough reason' })],
    ]
    for (const [label, send] of attempts) {
      const r = await send()
      expect([label, r.status]).toEqual([label, 403])
    }
  })

  it('an analyst cannot act on a case they neither own nor collaborate on, on any write route', async () => {
    const priya = await h.as('u-analyst') // curl and jackson belong to u-analyst2
    const lead = await h.as('u-lead')
    const curl = await detail(lead, ids.curl)
    const jackson = await detail(lead, ids.jackson)
    const vnDraft = jackson.bundle.reports.find((r) => r.kind === 'VULNERABILITY_NOTIFICATION' && r.stage === 'DRAFT')!
    const attempts: Array<[string, () => Promise<Response>]> = [
      ['evidence', () => priya.post('/api/evidence', { caseId: ids.curl, type: 'LOG', title: 't', source: 's', content: 'c' })],
      ['patch', () => priya.patch(`/api/cases/${ids.curl}`, { title: 'x' })],
      ['event', () => priya.post(`/api/cases/${ids.curl}/events`, { type: 'OCCURRENCE', occurredAt: '2026-09-30T11:00:00Z', timezone: 'UTC', source: 'x', sourceKind: 'external_document' })],
      ['report', () => priya.post(`/api/cases/${ids.curl}/reports`, { kind: 'EARLY_WARNING' })],
      ['decision', () => priya.post(`/api/cases/${ids.curl}/decisions`, { outcome: 'REPORT', rationale: 'x'.repeat(50), confidence: 'HIGH', divergenceReason: 'x'.repeat(30) })],
      ['relation', () => priya.post(`/api/cases/${ids.curl}/relations`, { relatedCaseId: ids.nginx, relation: 'RELATED_CVE' })],
      ['link', () => priya.post(`/api/evidence/${curl.bundle.evidence[0]!.id}/links`, { targetType: 'case', targetId: ids.curl })],
      ['transition', () => priya.post(`/api/reports/${vnDraft.id}/transition`, { to: 'INTERNAL_REVIEW' })],
    ]
    for (const [label, send] of attempts) {
      const r = await send()
      expect([label, r.status]).toEqual([label, 403])
    }
  })
})

describe('cross-case object references are refused', () => {
  it('evidence cannot be linked to a record in another case', async () => {
    const lead = await h.as('u-lead')
    const busy = await detail(lead, ids.busybox)
    const r = await lead.post('/api/evidence/EV-0051/links', { targetType: 'decision', targetId: busy.bundle.decisions[0]!.id })
    expect(r.status).toBe(422)
  })

  it('clock events, determinations and comments cannot cite another case\'s evidence', async () => {
    const lead = await h.as('u-lead')
    const ng = await detail(lead, ids.nginx)
    const ev = await lead.post(`/api/cases/${ids.nginx}/events`, { type: 'OCCURRENCE', occurredAt: '2026-09-30T11:00:00Z', timezone: 'UTC', source: 'x', sourceKind: 'external_document', evidenceIds: ['EV-0051'] })
    expect(ev.status).toBe(422)
    const det = await lead.post(`/api/cases/${ids.nginx}/determinations`, {
      productId: ng.bundle.products[0]!.id,
      answers: { component_present: { answer: 'YES', evidenceIds: ['EV-0051'] } },
      rationale: 'twenty characters at least',
      confidence: 'HIGH',
    })
    expect(det.status).toBe(422)
    const cm = await lead.post(`/api/cases/${ids.nginx}/comments`, { body: 'x', relatedEvidenceId: 'EV-0051' })
    expect(cm.status).toBe(422)
  })

  it('an event cannot be corrected through a different case id', async () => {
    const mgr = await h.as('u-mgr')
    const seg = await detail(mgr, ids.seg)
    const ea = seg.bundle.events.find((e) => e.type === 'EXPLOITATION_AWARENESS')!
    const r = await mgr.post(`/api/cases/${ids.nginx}/events/${ea.id}/correct`, { occurredAt: '2026-09-30T05:00:00Z', timezone: 'UTC', source: 'x', sourceKind: 'system_of_record', reason: 'Moving another case\'s clock via this case id.' })
    expect(r.status).toBe(404)
  })

  it('a report or decision cannot be reviewed through a case id it does not belong to', async () => {
    const mgr = await h.as('u-mgr')
    const busy = await detail(mgr, ids.busybox)
    const ew = busy.bundle.reports.find((r) => r.kind === 'EARLY_WARNING' && r.stage === 'INTERNAL_REVIEW')!
    expect((await mgr.post(`/api/cases/${ids.nginx}/reviews`, { targetType: 'report', targetId: ew.id, action: 'APPROVE', comment: '' })).status).toBe(404)
    expect((await mgr.post(`/api/cases/${ids.nginx}/reviews`, { targetType: 'decision', targetId: busy.bundle.decisions[0]!.id, action: 'APPROVE', comment: '' })).status).toBe(404)
  })

  it('reports of a closed case cannot be transitioned', async () => {
    const lead = await h.as('u-lead')
    const closed = await detail(lead, ids.sqlite)
    expect(closed.bundle.case.lifecycle).toBe('closed')
    for (const r of closed.bundle.reports) {
      expect((await lead.post(`/api/reports/${r.id}/transition`, { to: 'CLOSED' })).status).toBe(403)
    }
  })
})

describe('approval flow: separation of duties holds where it is checked', () => {
  it('an approval recorded against a decision or determination does not advance a report', async () => {
    const x = await fresh()
    const { busybox } = await caseIds(x)
    const mgr = await x.as('u-mgr')
    const d = await detail(mgr, busybox)
    const ew = d.bundle.reports.find((r) => r.kind === 'EARLY_WARNING' && r.stage === 'INTERNAL_REVIEW')!
    expect((await mgr.post(`/api/cases/${busybox}/reviews`, { targetType: 'decision', targetId: d.bundle.decisions[0]!.id, action: 'APPROVE', comment: '' })).status).toBe(201)
    expect((await mgr.post(`/api/cases/${busybox}/reviews`, { targetType: 'determination', targetId: d.bundle.determinations[0]!.id, action: 'APPROVE', comment: '' })).status).toBe(201)
    expect((await report(mgr, ew.id)).report.stage).toBe('INTERNAL_REVIEW')
  })

  it('one person approving twice does not satisfy a two-role policy; approvals from before a return to draft do not count', async () => {
    const x = await fresh()
    const { busybox } = await caseIds(x)
    const analyst = await x.as('u-analyst')
    const mgr = await x.as('u-mgr')
    const comp = await x.as('u-comp')
    const approve = (c: Client, id: string) => c.post(`/api/cases/${busybox}/reviews`, { targetType: 'report', targetId: id, action: 'APPROVE', comment: 'ok' })
    const { id } = await json<{ id: string }>(await analyst.post(`/api/cases/${busybox}/reports`, { kind: 'VULNERABILITY_NOTIFICATION' }))
    expect((await analyst.post(`/api/reports/${id}/transition`, { to: 'INTERNAL_REVIEW' })).status).toBe(200)
    setNow(x, '2026-09-30T12:01:00Z')
    expect((await json<{ advanced: string | null }>(await approve(mgr, id))).advanced).toBeNull()
    setNow(x, '2026-09-30T12:02:00Z')
    expect((await json<{ advanced: string | null }>(await approve(mgr, id))).advanced).toBeNull() // same role twice
    setNow(x, '2026-09-30T12:03:00Z')
    expect((await json<{ advanced: string }>(await comp.post(`/api/cases/${busybox}/reviews`, { targetType: 'report', targetId: id, action: 'REQUEST_CHANGES', comment: 'Fix the product list.' }))).advanced).toBe('DRAFT')
    setNow(x, '2026-09-30T12:04:00Z')
    await analyst.post(`/api/reports/${id}/transition`, { to: 'INTERNAL_REVIEW' })
    setNow(x, '2026-09-30T12:05:00Z')
    // The Security Manager's approvals predate the return to draft and must not be counted.
    expect((await json<{ advanced: string | null }>(await approve(comp, id))).advanced).toBeNull()
    setNow(x, '2026-09-30T12:06:00Z')
    expect((await json<{ advanced: string }>(await approve(mgr, id))).advanced).toBe('APPROVED')
  })

  it('an approved version cannot be submitted once a newer version exists', async () => {
    const x = await fresh()
    const { busybox } = await caseIds(x)
    const mgr = await x.as('u-mgr')
    const analyst = await x.as('u-analyst')
    const ew = (await detail(mgr, busybox)).bundle.reports.find((r) => r.kind === 'EARLY_WARNING' && r.stage === 'INTERNAL_REVIEW')!
    expect((await json<{ advanced: string }>(await mgr.post(`/api/cases/${busybox}/reviews`, { targetType: 'report', targetId: ew.id, action: 'APPROVE', comment: 'ok' }))).advanced).toBe('APPROVED')
    expect((await mgr.post(`/api/reports/${ew.id}/transition`, { to: 'READY' })).status).toBe(200)
    expect((await analyst.post(`/api/cases/${busybox}/reports`, { kind: 'EARLY_WARNING' })).status).toBe(201)
    const sub = await mgr.post(`/api/reports/${ew.id}/transition`, { to: 'SUBMITTED' })
    expect(await code(sub)).toBe('REPORT_SUPERSEDED')
  })
})

describe('integrity: timestamps and history', () => {
  it('a client cannot set recordedAt, actorId or integrityHash on a clock event', async () => {
    const x = await fresh()
    const { nginx } = await caseIds(x)
    const lead = await x.as('u-lead')
    const r = await lead.post(`/api/cases/${nginx}/events`, { type: 'OCCURRENCE', occurredAt: '2026-09-29T00:00:00Z', timezone: 'UTC', source: 'x', sourceKind: 'external_document', recordedAt: '2020-01-01T00:00:00Z', actorId: 'u-exec', integrityHash: 'f'.repeat(64), supersedesId: 'CE-0001' })
    expect(r.status).toBe(201)
    const { id } = await json<{ id: string }>(r)
    const ev = (await detail(lead, nginx)).bundle.events.find((e) => e.id === id)!
    expect(ev.recordedAt).toBe(NOW.toISOString())
    expect(ev.actorId).toBe('u-lead')
    expect(ev.integrityHash).not.toBe('f'.repeat(64))
  })

  it('future instants are refused, including ones hidden behind an offset, on events, corrections and evidence', async () => {
    const lead = await h.as('u-lead')
    const mgr = await h.as('u-mgr')
    const ea = (await detail(mgr, ids.seg)).bundle.events.find((e) => e.type === 'EXPLOITATION_AWARENESS')!
    const base = { type: 'OCCURRENCE', timezone: 'UTC', source: 'x', sourceKind: 'external_document' }
    expect(await code(await lead.post(`/api/cases/${ids.nginx}/events`, { ...base, occurredAt: '2026-09-30T13:30:00+01:00' }))).toBe('TIMESTAMP_IN_FUTURE') // 12:30Z
    expect(await code(await lead.post(`/api/cases/${ids.nginx}/events`, { ...base, occurredAt: '2026-09-30T12:03:00Z' }))).toBe('TIMESTAMP_IN_FUTURE') // beyond 2 min skew
    expect(await code(await mgr.post(`/api/cases/${ids.seg}/events/${ea.id}/correct`, { occurredAt: '2026-10-01T00:00:00Z', timezone: 'UTC', source: 'x', sourceKind: 'system_of_record', reason: 'Trying to push the deadline out by a day.' }))).toBe('TIMESTAMP_IN_FUTURE')
    expect((await lead.post('/api/evidence', { caseId: ids.nginx, type: 'LOG', title: 't', source: 's', content: 'c', sourceCreatedAt: '2026-10-01T00:00:00Z' })).status).toBe(422)
  })
})

describe('integrity: a transaction that throws midway leaves nothing behind', () => {
  it('a component import that fails after its first insert rolls back the insert and writes no ledger entry', async () => {
    const x = await fresh()
    // Force the PC-id collision deterministically: the new component row is inserted first,
    // then the product_component insert fails on the duplicate id inside the same transaction.
    setSequence(x.deps.db, 'PC', 0)
    const lead = await x.as('u-lead')
    const csv = 'name,purl,ecosystem,supplier,product_id,version,relation\natomiclib,pkg:generic/atomiclib@1.0,C,x,PRD-SEG,1.0,direct\n'
    const p = await json<ImportPreview>(await lead.post('/api/import/preview', { kind: 'components', format: 'csv', content: csv }))
    expect(p.canCommit).toBe(true)
    const commit = await lead.post('/api/import/commit', { token: p.token })
    expect(commit.status).toBe(500)
    const err = await commit.text()
    expect(err).toContain('INTERNAL_ERROR')
    expect(err).not.toMatch(/UNIQUE|product_components|at \w+ \(/) // no internals leaked
    expect(await (await lead.get('/api/components')).text()).not.toContain('atomiclib')
    const ledger = (await json<{ entries: AuditEvent[] }>(await lead.get('/api/ledger'))).entries
    expect(ledger.some((e) => e.eventType === 'IMPORT_COMMITTED')).toBe(false)
    expect((await json<{ result: { ok: boolean } }>(await lead.post('/api/ledger/verify', { anchor: null }))).result.ok).toBe(true)
  })
})

describe('restricted evidence stays redacted on the other read paths', () => {
  it('search, case detail, case export, VEX, ledger, evidence list, preview and download do not disclose it', async () => {
    const ro = await h.as('u-ro')
    const lead = await h.as('u-lead')
    const restricted = (await detail(lead, ids.seg)).bundle.evidence.find((e) => e.classification === 'restricted')!
    const search = await json<{ results: Array<{ kind: string }> }>(await ro.get('/api/search?q=privileged'))
    expect(search.results.filter((r) => r.kind === 'evidence')).toHaveLength(0)
    expect((await json<{ results: unknown[] }>(await ro.get(`/api/search?q=${restricted.sha256.slice(0, 20)}`))).results).toHaveLength(0)
    const bodies = [
      await (await ro.get(`/api/cases/${ids.seg}`)).text(),
      await (await ro.get(`/api/cases/${ids.seg}/export`)).text(),
      await (await ro.get(`/api/cases/${ids.seg}/vex`)).text(),
      await (await ro.get('/api/ledger')).text(),
      await (await ro.get('/api/evidence')).text(),
      await (await ro.get('/api/export/cases?format=json')).text(),
    ]
    for (const b of bodies) {
      expect(b).not.toContain(SEG_RESTRICTED_TITLE)
      expect(b).not.toContain(SEG_RESTRICTED_SOURCE)
      expect(b).not.toContain(SEG_RESTRICTED_FILE)
    }
    const ev = await json<{ preview: string | null; evidence: { fileName: string | null } }>(await ro.get(`/api/evidence/${restricted.id}`))
    expect(ev.preview).toBeNull()
    expect(ev.evidence.fileName).toBeNull()
    expect((await ro.get(`/api/evidence/${restricted.id}/file`)).status).toBe(403)
  })
})

describe('input handling', () => {
  it('Content-Disposition cannot be injected through an evidence file name', async () => {
    const lead = await h.as('u-lead')
    const up = await lead.post('/api/evidence', { caseId: ids.nginx, type: 'LOG', title: 'cd test', source: 's', content: 'x', fileName: 'a";\r\nX-Injected: 1; filename*=UTF-8\'\'evil.html;.txt' })
    expect(up.status).toBe(201)
    const { id } = await json<{ id: string }>(up)
    const file = await lead.get(`/api/evidence/${id}/file`)
    expect(file.headers.get('content-disposition')).toMatch(/^attachment; filename="[A-Za-z0-9._ -]+"$/)
    expect(file.headers.get('x-injected')).toBeNull()
  })

  it('upload type confusion is refused, and what is accepted is served inert', async () => {
    const lead = await h.as('u-lead')
    const send = (content: BlobPart, name: string, type: string) => {
      const form = new FormData()
      for (const [k, v] of Object.entries({ caseId: ids.nginx, type: 'LOG', title: 'upload', source: 'test' })) form.append(k, v)
      form.append('file', new File([content], name, { type }))
      return lead.upload('/api/evidence', form)
    }
    expect((await send('<script>alert(1)</script>', 'x.html', 'text/html')).status).toBe(422)
    expect((await send('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', 'x.svg', 'image/svg+xml')).status).toBe(422)
    expect((await send(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]).buffer, 'x.html', 'image/png')).status).toBe(422)
    expect((await send('%PDF-1.7 <html>', 'x.pdf', 'text/plain')).status).toBe(422)
    const ok = await send('<script>alert(1)</script>', 'payload', 'text/plain')
    expect(ok.status).toBe(201)
    const file = await lead.get(`/api/evidence/${(await json<{ id: string }>(ok)).id}/file?inline=1`)
    expect(file.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(file.headers.get('content-disposition')).toMatch(/^attachment/)
    expect(file.headers.get('x-content-type-options')).toBe('nosniff')
    expect(file.headers.get('content-security-policy')).toContain('sandbox')
  })

  it('oversized bodies are refused before parsing', async () => {
    const lead = await h.as('u-lead')
    expect((await lead.post(`/api/cases/${ids.nginx}/comments`, { body: 'x'.repeat(300 * 1024) })).status).toBe(413)
    const big = await lead.post('/api/evidence', { caseId: ids.nginx, type: 'LOG', title: 't', source: 's', content: 'x'.repeat(1_200_000) })
    expect(big.status).toBe(413)
  })

  it('__proto__ keys in JSON bodies do not pollute prototypes or reach stored records', async () => {
    const x = await fresh()
    const { nginx } = await caseIds(x)
    const { cookie, csrf } = await rawSession(x, 'u-lead')
    const post = (p: string, raw: string) => x.request(p, { method: 'POST', headers: { cookie, origin: ORIGIN, 'x-csrf-token': csrf, 'content-type': 'application/json' }, body: raw })
    const created = await post('/api/cases', '{"title":"proto","vulnerabilityId":"VUL-0012","productIds":["PRD-SEG"],"__proto__":{"polluted":"yes","lifecycle":"closed"},"constructor":{"prototype":{"polluted2":"yes"}}}')
    const lead = await x.as('u-lead')
    const ng = await detail(lead, nginx)
    const det = await post(`/api/cases/${nginx}/determinations`, `{"productId":"${ng.bundle.products[0]!.id}","answers":{"__proto__":{"answer":"YES"}},"rationale":"twenty characters at least","confidence":"HIGH"}`)
    expect(created.status).toBe(201)
    expect([201, 422]).toContain(det.status)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(({} as Record<string, unknown>).polluted2).toBeUndefined()
    const c = await detail(lead, (await json<{ id: string }>(created)).id)
    expect(c.bundle.case.lifecycle).toBe('open')
    expect(JSON.stringify(c.bundle.case)).not.toContain('polluted')
  })

  it('the HTML report export escapes injected markup', async () => {
    const x = await fresh()
    const analyst = await x.as('u-analyst')
    const v = await json<{ id: string }>(await analyst.post('/api/vulnerabilities', { title: 'x', severity: 'HIGH', description: '<img src=x onerror=alert(1)></p><script>alert(2)</script>', affectedVersions: '<1.0', exploitation: 'UNKNOWN', source: 'test', discoveredAt: '2026-09-29T00:00:00Z' }))
    const { id: caseId } = await json<{ id: string }>(await analyst.post('/api/cases', { title: '<b>t</b>', vulnerabilityId: v.id, productIds: ['PRD-SEG'] }))
    const { id } = await json<{ id: string }>(await analyst.post(`/api/cases/${caseId}/reports`, { kind: 'EARLY_WARNING' }))
    const html = await (await analyst.get(`/api/reports/${id}/export?format=html`)).text()
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;img src=x')
    expect(html).toContain("default-src 'none'")
  })
})

describe('session and CSRF', () => {
  it('every state-changing route refuses a missing or foreign CSRF token and a missing Origin', async () => {
    const a = await rawSession(h, 'u-lead')
    const b = await rawSession(h, 'u-mgr')
    const routes: Array<[string, string]> = [
      ['POST', '/api/cases'],
      ['PATCH', `/api/cases/${ids.nginx}`],
      ['POST', `/api/cases/${ids.nginx}/events`],
      ['POST', `/api/cases/${ids.nginx}/decisions`],
      ['POST', `/api/cases/${ids.nginx}/reviews`],
      ['POST', `/api/cases/${ids.nginx}/reviewed`],
      ['POST', `/api/cases/${ids.nginx}/lifecycle`],
      ['POST', '/api/reports/RPT-0011/transition'],
      ['POST', '/api/evidence'],
      ['POST', '/api/evidence/EV-0051/verify'],
      ['POST', '/api/ledger/verify'],
      ['PUT', '/api/settings/org'],
      ['POST', '/api/import/commit'],
      ['POST', '/api/notifications/read-all'],
      ['POST', '/api/session/logout'],
      ['POST', '/api/demo/reset'],
    ]
    for (const [method, p] of routes) {
      const none = await h.request(p, { method, headers: { cookie: a.cookie, origin: ORIGIN, 'content-type': 'application/json' }, body: '{}' })
      expect([p, await code(none)]).toEqual([p, 'CSRF_REJECTED'])
      const foreign = await h.request(p, { method, headers: { cookie: a.cookie, origin: ORIGIN, 'x-csrf-token': b.csrf, 'content-type': 'application/json' }, body: '{}' })
      expect([p, await code(foreign)]).toEqual([p, 'CSRF_REJECTED'])
      const noOrigin = await h.request(p, { method, headers: { cookie: a.cookie, 'x-csrf-token': a.csrf, 'content-type': 'application/json' }, body: '{}' })
      expect([p, await code(noOrigin)]).toEqual([p, 'ORIGIN_REJECTED'])
    }
  })

  it('logout ends the session on the server, and sign-in rotates any session that came in', async () => {
    const a = await rawSession(h, 'u-analyst')
    const out = await h.request('/api/session/logout', { method: 'POST', headers: { cookie: a.cookie, origin: ORIGIN, 'x-csrf-token': a.csrf } })
    expect(out.status).toBe(200)
    expect((await h.request('/api/cases', { headers: { cookie: a.cookie } })).status).toBe(401)

    const b = await rawSession(h, 'u-analyst')
    const again = await h.request('/api/session/persona', { method: 'POST', headers: { cookie: b.cookie, origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ userId: 'u-lead' }) })
    const next = (again.headers.get('set-cookie') ?? '').split(';')[0]!
    expect(next).not.toBe(b.cookie)
    expect((await h.request('/api/cases', { headers: { cookie: b.cookie } })).status).toBe(401)
    // An attacker-chosen token of the right shape is not a session.
    expect((await h.request('/api/cases', { headers: { cookie: `${sessionCookieName(false)}=${'A'.repeat(43)}` } })).status).toBe(401)
  })

  it('production: cookie flags, and the static server refuses path traversal', async () => {
    const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reckoning-prod-'))
    const config: Config = { production: true, port: 8787, appOrigin: ORIGIN, demoMode: true, storageDir, dbPath: ':memory:', evidenceDir: path.join(storageDir, 'evidence'), maxUploadBytes: 1024 * 1024, sessionTtlMs: 8 * 3600_000, sessionIdleMs: 3600_000, rateLimitScale: 100 }
    const db = openDb(':memory:')
    await seedFresh(db, config, NOW)
    const app = createApp({ db, config, now: () => NOW })
    cleanups.push(() => {
      db.close()
      fs.rmSync(storageDir, { recursive: true, force: true })
    })
    const login = await app.request('http://localhost/api/session/persona', { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ userId: 'u-ro' }) })
    const setCookie = login.headers.get('set-cookie') ?? ''
    expect(sessionCookieName(true)).toMatch(/^__Host-/)
    expect(setCookie.startsWith(`${sessionCookieName(true)}=`)).toBe(true)
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/Secure/i)
    expect(setCookie).toMatch(/SameSite=Strict/i)
    for (const p of ['/..%2fpackage.json', '/..%5cpackage.json', '/%2e%2e%2fpackage.json', '/assets/..%2f..%2fpackage.json', '/..%252fpackage.json', '/%2e%2e%5c%2e%2e%5cpackage.json']) {
      const r = await app.request(`http://localhost${p}`)
      // Brand-neutral marker: only package.json (outside dist/) carries these keys.
      const body = await r.text()
      expect([p, body.includes('"devDependencies"') || body.includes('"allowScripts"')]).toEqual([p, false])
    }
  })

  it('the evidence object store refuses keys that are not SHA-256 hex', () => {
    expect(() => objectPath('/tmp/e', '../../etc/passwd')).toThrow()
    expect(() => objectPath('/tmp/e', `${'a'.repeat(62)}/.`)).toThrow()
    expect(() => objectPath('/tmp/e', 'A'.repeat(64))).toThrow()
  })
})

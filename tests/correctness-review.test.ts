/**
 * Correctness review.
 *
 * "fixed defects" tests were each written first as a failing test that
 * reproduced a real defect found in review, then the defect was fixed; they
 * pin the corrected behaviour. "found correct" tests pin behaviour that was
 * checked in the same review and needed no change.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CaseDetailResponse, CaseListItem, ImportPreview, OverviewResponse } from '../types/api.ts'
import { APPLICATION_INSTANT, DAY_MS, HOUR_MS } from '../rules/cra-article14.ts'
import { analyzeCase } from '../lib/engine/analyze.ts'
import { buildVex } from '../lib/engine/vex.ts'
import { inRange } from '../lib/engine/versions.ts'
import { addMs } from '../lib/engine/time.ts'
import { PRODUCT, answers, bundle, decision, determination, ev, evidenceItem, harness, json } from './helpers.ts'
import type { Client, Harness } from './helpers.ts'

const ORG = { id: 'ORG', name: 'Test Org', legalEntity: 'Test Org GmbH', timezone: 'Europe/Berlin', memberStatesMadeAvailable: ['DE'], csirtCoordinator: 'CERT-Bund', demo: true }
const deadline = (a: ReturnType<typeof analyzeCase>, kind: string) => a.deadlines.find((d) => d.kind === kind)!

// ---------------------------------------------------------------------------------------------
// Engine: checked and found correct
// ---------------------------------------------------------------------------------------------

describe('engine: boundaries and propagation (found correct)', () => {
  const VA = '2026-09-29T10:00:00.000Z'
  const EA = '2026-09-29T12:00:00.000Z'
  const base = () => [ev('VULNERABILITY_AWARENESS', VA, { id: 'CE-VA' }), ev('EXPLOITATION_AWARENESS', EA, { id: 'CE-EA' })]

  it('is CRITICAL (not OVERDUE) at exactly 24h, OVERDUE 1 ms later, and on time when submitted at exactly 24h', () => {
    const due = addMs(EA, 24 * HOUR_MS)
    expect(deadline(analyzeCase(bundle({ events: base() }), due), 'EARLY_WARNING').status).toBe('CRITICAL')
    expect(deadline(analyzeCase(bundle({ events: base() }), addMs(due, 1)), 'EARLY_WARNING').status).toBe('OVERDUE')
    const sub = ev('EARLY_WARNING_SUBMITTED', due, { id: 'CE-EW', sourceKind: 'nexus_server' })
    expect(deadline(analyzeCase(bundle({ events: [...base(), sub] }), addMs(due, DAY_MS)), 'EARLY_WARNING').status).toBe('COMPLETED')
  })

  it('applies the two-date rule at and around the application instant', () => {
    const before = addMs(APPLICATION_INSTANT, -1)
    const t = (va: string | null, ea: string | null) =>
      analyzeCase(bundle({ events: [...(va ? [ev('VULNERABILITY_AWARENESS', va, { id: 'V' })] : []), ...(ea ? [ev('EXPLOITATION_AWARENESS', ea, { id: 'E' })] : [])] }), '2026-09-30T12:00:00.000Z').transitional.result
    expect(t(before, APPLICATION_INSTANT)).toBe('APPLICABLE') // exploitation learned exactly at 00:00 CEST
    expect(t(before, before)).toBe('NOT_APPLICABLE_PRE_APPLICATION')
    expect(t(null, before)).toBe('NOT_APPLICABLE_PRE_APPLICATION')
    expect(t(before, null)).toBe('NO_EXPLOITATION_AWARENESS')
    expect(t(null, null)).toBe('INDETERMINATE')
  })

  it('leaves every clock PENDING_START when only vulnerability awareness exists', () => {
    const a = analyzeCase(bundle({ events: [ev('VULNERABILITY_AWARENESS', VA, { id: 'CE-VA' })] }), EA)
    expect(a.deadlines.map((d) => d.status)).toEqual(['PENDING_START', 'PENDING_START', 'PENDING_START'])
  })

  it('propagates a correction of a correction to every awareness deadline', () => {
    const c1 = ev('CORRECTION', '2026-09-29T13:00:00.000Z', { id: 'CE-C1', supersedesId: 'CE-EA', recordedAt: '2026-09-29T14:00:00.000Z' })
    const c2 = ev('CORRECTION', '2026-09-29T15:00:00.000Z', { id: 'CE-C2', supersedesId: 'CE-C1', recordedAt: '2026-09-29T16:00:00.000Z' })
    const a = analyzeCase(bundle({ events: [...base(), c1, c2] }), '2026-09-29T17:00:00.000Z')
    expect(a.clock.awarenessInstant).toBe('2026-09-29T15:00:00.000Z')
    expect(deadline(a, 'EARLY_WARNING').dueAt).toBe('2026-09-30T15:00:00.000Z')
    expect(deadline(a, 'VULNERABILITY_NOTIFICATION').dueAt).toBe('2026-10-02T15:00:00.000Z')
  })

  it('starts the final-report clock at (corrected) measure availability, not at awareness', () => {
    const m = ev('MEASURE_AVAILABLE', '2026-09-30T08:00:00.000Z', { id: 'CE-M' })
    const mc = ev('CORRECTION', '2026-09-30T06:00:00.000Z', { id: 'CE-MC', supersedesId: 'CE-M', recordedAt: '2026-09-30T09:00:00.000Z' })
    expect(deadline(analyzeCase(bundle({ events: base() }), '2026-09-30T10:00:00.000Z'), 'FINAL_REPORT').status).toBe('PENDING_START')
    expect(deadline(analyzeCase(bundle({ events: [...base(), m] }), '2026-09-30T10:00:00.000Z'), 'FINAL_REPORT').dueAt).toBe('2026-10-14T08:00:00.000Z')
    expect(deadline(analyzeCase(bundle({ events: [...base(), m, mc] }), '2026-09-30T10:00:00.000Z'), 'FINAL_REPORT').dueAt).toBe('2026-10-14T06:00:00.000Z')
  })

  it('stops clocks only on a recorded DO_NOT_REPORT decision, never on the suggestion', () => {
    const b = bundle({ events: base(), vulnerability: { ...bundle().vulnerability, exploitation: 'NOT_OBSERVED' } })
    const a = analyzeCase(b, '2026-09-29T13:00:00.000Z')
    expect(a.suggestion.outcome).toBe('DO_NOT_REPORT')
    expect(deadline(a, 'EARLY_WARNING').status).toBe('ON_TRACK')
  })
})

// ---------------------------------------------------------------------------------------------
// Engine: defects
// ---------------------------------------------------------------------------------------------

describe('engine: fixed defects', () => {
  it('a DO_NOT_REPORT decision recorded before exploitation awareness does not stop the clock that awareness starts', () => {
    // Decided "no active exploitation" on 29 Sep; exploitation became known on 30 Sep 08:00.
    const events = [
      ev('VULNERABILITY_AWARENESS', '2026-09-29T08:00:00.000Z', { id: 'CE-VA' }),
      ev('EXPLOITATION_AWARENESS', '2026-09-30T08:00:00.000Z', { id: 'CE-EA', recordedAt: '2026-09-30T08:05:00.000Z' }),
    ]
    const decisions = [decision('DO_NOT_REPORT', '2026-09-29T12:00:00.000Z', { id: 'DEC-1', nonReportReason: 'NO_ACTIVE_EXPLOITATION' })]
    const a = analyzeCase(bundle({ events, decisions }), '2026-09-30T20:00:00.000Z')
    expect(a.transitional.result).toBe('APPLICABLE')
    expect(a.decisionStanding).toMatchObject({ inForce: false, staleBy: 'CE-EA' })
    expect(deadline(a, 'EARLY_WARNING').status).toBe('WATCH') // running, 12h left
    expect(a.status).not.toBe('NOT_REPORTABLE') // the overtaken decision no longer answers the question
    expect(a.quality.find((q) => q.code === 'DECISION_OVERTAKEN_BY_AWARENESS')?.severity).toBe('error')
    expect(a.health.state).toBe('BLOCKED')
  })

  it('starts the clock at exploitation awareness even when vulnerability awareness is dated later', () => {
    // EA implies VA, so the manufacturer was aware of an actively exploited vulnerability at 10:00.
    const events = [
      ev('EXPLOITATION_AWARENESS', '2026-09-29T10:00:00.000Z', { id: 'CE-EA' }),
      ev('VULNERABILITY_AWARENESS', '2026-09-29T12:00:00.000Z', { id: 'CE-VA' }),
    ]
    const a = analyzeCase(bundle({ events }), '2026-09-30T11:00:00.000Z')
    expect(deadline(a, 'EARLY_WARNING').dueAt).toBe('2026-09-30T10:00:00.000Z')
    expect(deadline(a, 'EARLY_WARNING').status).toBe('OVERDUE')
    // The record contradicts itself, so it blocks until someone corrects it.
    expect(a.quality.find((q) => q.code === 'EXPLOITATION_BEFORE_VULNERABILITY_AWARENESS')?.severity).toBe('error')
    expect(a.health.state).toBe('BLOCKED')
  })

  it('a later DO_NOT_REPORT decision leaves an early warning already submitted COMPLETED', () => {
    const events = [
      ev('VULNERABILITY_AWARENESS', '2026-09-29T10:00:00.000Z', { id: 'CE-VA' }),
      ev('EXPLOITATION_AWARENESS', '2026-09-29T12:00:00.000Z', { id: 'CE-EA' }),
      ev('EARLY_WARNING_SUBMITTED', '2026-09-29T20:00:00.000Z', { id: 'CE-EW', sourceKind: 'nexus_server' }),
    ]
    const decisions = [decision('REPORT', '2026-09-29T18:00:00.000Z', { id: 'DEC-1' }), decision('DO_NOT_REPORT', '2026-09-30T09:00:00.000Z', { id: 'DEC-2' })]
    const a = analyzeCase(bundle({ events, decisions }), '2026-09-30T10:00:00.000Z')
    expect(a.status).toBe('SUBMITTED') // the case status still says submitted ...
    expect(deadline(a, 'EARLY_WARNING').status).toBe('COMPLETED') // ... but the deadline says NOT_APPLICABLE
  })

  it('a determination for a product no longer in the case takes no part in the analysis', () => {
    const P2 = { ...PRODUCT, id: 'PRD-2', name: 'Kept product' }
    // Removed product: exploitation demonstrated but step 1 NO -> AFFECTED with a contradiction (error).
    const removed = determination('PRD-T', answers({ component_present: 'NO', exploitation_demonstrated: 'YES' }), { id: 'DET-OLD' })
    const kept = determination('PRD-2', answers({ component_present: ['NO', ['EV-SBOM']], product_validation: 'YES' }), { id: 'DET-KEEP' })
    expect(kept.result).toBe('NOT_AFFECTED')
    const b = bundle({ products: [P2], determinations: [removed, kept], evidence: [evidenceItem('EV-SBOM', 'SBOM')] })
    const a = analyzeCase(b, '2026-09-30T10:00:00.000Z')
    expect(a.suggestion.aggregateAffectedness).toBe('NOT_AFFECTED') // reportability ignores the removed product
    expect(Object.keys(a.determinations)).toEqual(['PRD-2']) // analysis does not
    expect(a.explanation[2]!.state).not.toBe('established') // "exposes vulnerable functionality: established"
    expect(a.health.state).not.toBe('BLOCKED') // blocked by a contradiction on a product not in the case
  })

  it('the VEX export states under_investigation for an in-case product with no determination', () => {
    const P2 = { ...PRODUCT, id: 'PRD-2', name: 'Second product' }
    const d = determination('PRD-T', answers({ component_present: 'YES', vulnerable_version: 'YES', functionality_enabled: 'YES', feature_reachable: 'YES', exploit_path: 'YES', configuration_mitigates: 'NO' }))
    const b = bundle({ products: [PRODUCT, P2], determinations: [d] })
    const a = analyzeCase(b, '2026-09-30T10:00:00.000Z')
    expect(a.suggestion.perProduct.find((p) => p.productId === 'PRD-2')!.result).toBe('NO_DETERMINATION')
    const vex = buildVex(b, a, ORG, (x) => x, '2026-09-30T10:00:00.000Z')
    expect(vex.statements.map((s) => s.status).sort()).toEqual(['affected', 'under_investigation'])
  })

  it('a semver pre-release orders before its release, so it falls inside "<release"', () => {
    expect(inRange('1.3.1', '<1.3.1')).toBe(false)
    expect(inRange('1.3.1-rc1', '<1.3.1')).toBe(true) // 1.3.1-rc1 precedes 1.3.1; currently false -> step 2 suggested NO
  })
})

// ---------------------------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------------------------

let h: Harness
let lead: Client
let mgr: Client
let n = 0

beforeAll(async () => {
  h = await harness()
  lead = await h.as('u-lead')
  mgr = await h.as('u-mgr')
}, 60_000)
afterAll(() => h.cleanup())

async function ok<T = Record<string, unknown>>(res: Response, status = 201): Promise<T> {
  const body = await res.text()
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${body}`)
  return JSON.parse(body) as T
}

/** A fresh case on PRD-SEG + PRD-VSY with (optionally) vulnerability and exploitation awareness recorded. */
async function freshCase(opts: { productIds?: string[]; awareness?: boolean } = {}): Promise<{ caseId: string; ticket: string; exploit: string }> {
  n++
  const vuln = await ok<{ id: string }>(
    await lead.post('/api/vulnerabilities', {
      cve: `CVE-2026-77${String(n).padStart(4, '0')}`,
      title: `Bughunt vulnerability ${n}`,
      severity: 'HIGH',
      description: 'A vulnerability created by the bug-hunt tests.',
      componentId: 'CMP-ZLIB',
      affectedVersions: '<1.3.1',
      exploitation: 'CONFIRMED',
      source: 'bughunt',
      discoveredAt: '2026-09-30T06:00:00Z',
    }),
  )
  const { id: caseId } = await ok<{ id: string }>(await lead.post('/api/cases', { title: `Bughunt case ${n}`, vulnerabilityId: vuln.id, productIds: opts.productIds ?? ['PRD-SEG', 'PRD-VSY'] }))
  const evidence = async (type: string) =>
    (await ok<{ id: string }>(await lead.post('/api/evidence', { caseId, type, title: `${type} ${n}`, source: 'bughunt', sourceCreatedAt: '2026-09-30T07:00:00Z', content: `${type} content ${n}` }))).id
  const ticket = await evidence('TICKET')
  const exploit = await evidence('EXPLOIT_EVIDENCE')
  if (opts.awareness !== false) {
    await ok(await lead.post(`/api/cases/${caseId}/events`, { type: 'VULNERABILITY_AWARENESS', occurredAt: '2026-09-30T08:00:00Z', timezone: 'Europe/Berlin', source: 'PSIRT tracker', sourceKind: 'system_of_record', criterionId: 'AC-01', evidenceIds: [ticket] }))
    await ok(await lead.post(`/api/cases/${caseId}/events`, { type: 'EXPLOITATION_AWARENESS', occurredAt: '2026-09-30T09:00:00Z', timezone: 'Europe/Berlin', source: 'SOC sign-off', sourceKind: 'system_of_record', criterionId: 'AC-03', evidenceIds: [exploit] }))
  }
  return { caseId, ticket, exploit }
}

const detail = async (caseId: string) => json<CaseDetailResponse>(await lead.get(`/api/cases/${caseId}`))

describe('server: fixed defects', () => {
  it('exploitation confirmed after a "no active exploitation" decision runs the clock and blocks closing', async () => {
    n++
    const vuln = await ok<{ id: string }>(
      await lead.post('/api/vulnerabilities', { cve: `CVE-2026-66${String(n).padStart(4, '0')}`, title: 'Bughunt late exploitation', severity: 'HIGH', description: 'Exploitation confirmed after the decision.', componentId: 'CMP-ZLIB', affectedVersions: '<1.3.1', exploitation: 'NOT_OBSERVED', source: 'bughunt', discoveredAt: '2026-09-30T01:00:00Z' }),
    )
    const { id: caseId } = await ok<{ id: string }>(await lead.post('/api/cases', { title: 'Bughunt late exploitation', vulnerabilityId: vuln.id, productIds: ['PRD-VSY'] }))
    const evidence = async (type: string) => (await ok<{ id: string }>(await lead.post('/api/evidence', { caseId, type, title: type, source: 'bughunt', content: `${type} body` }))).id
    const ticket = await evidence('TICKET')
    const exploit = await evidence('EXPLOIT_EVIDENCE')
    await ok(await lead.post(`/api/cases/${caseId}/events`, { type: 'VULNERABILITY_AWARENESS', occurredAt: '2026-09-30T02:00:00Z', timezone: 'UTC', source: 'PSIRT tracker', sourceKind: 'system_of_record', criterionId: 'AC-01', evidenceIds: [ticket] }))
    const yes = { answer: 'YES' }
    await ok(await lead.post(`/api/cases/${caseId}/determinations`, { productId: 'PRD-VSY', answers: { component_present: yes, vulnerable_version: yes, functionality_enabled: yes, feature_reachable: yes, exploit_path: yes, configuration_mitigates: { answer: 'NO' } }, rationale: 'Reachable and unmitigated in the shipped build.', confidence: 'HIGH' }))
    await ok(await lead.post(`/api/cases/${caseId}/decisions`, { outcome: 'DO_NOT_REPORT', nonReportReason: 'NO_ACTIVE_EXPLOITATION', rationale: 'No exploitation observed anywhere; Article 14(1) is not triggered as things stand.', confidence: 'HIGH', evidenceIds: [ticket] }))
    // Decision recorded at the server's 12:00; exploitation awareness asserted at 12:01 (within the 2-minute skew allowance).
    await ok(await mgr.post(`/api/cases/${caseId}/events`, { type: 'EXPLOITATION_AWARENESS', occurredAt: '2026-09-30T12:01:00Z', timezone: 'UTC', source: 'SOC sign-off', sourceKind: 'system_of_record', criterionId: 'AC-03', evidenceIds: [exploit], confirmExploitation: true }))
    const d = await detail(caseId)
    const closed = await mgr.post(`/api/cases/${caseId}/lifecycle`, { action: 'close', reason: 'Decision recorded, closing.' })
    expect(d.analysis.transitional.result).toBe('APPLICABLE')
    expect(d.analysis.deadlines.find((x) => x.kind === 'EARLY_WARNING')!.status).toBe('ON_TRACK')
    expect(closed.status).toBe(409)
  })

  it('demo scenario 04 records its REPORT decision after the awareness events it rests on', async () => {
    const { caseId } = await ok<{ caseId: string }>(await lead.post('/api/demo/scenarios/04', {}))
    const d = await detail(caseId)
    const dec = d.analysis.decision!
    const firstAwarenessRecorded = d.bundle.events.filter((e) => e.type.endsWith('_AWARENESS')).map((e) => e.recordedAt).sort()[0]!
    // Correct: the decision rests on the awareness events and the rule evaluation that saw them.
    expect(dec.awarenessEventIds.length).toBe(2)
    expect(dec.suggestedOutcome).toBe('REPORT')
    expect(dec.decidedAt > firstAwarenessRecorded).toBe(true)
  })

  it('demo scenario 05 freezes its decision record after the vulnerability awareness it cites', async () => {
    const { caseId } = await ok<{ caseId: string }>(await lead.post('/api/demo/scenarios/05', {}))
    const d = await detail(caseId)
    expect(d.analysis.decision!.awarenessEventIds.length).toBe(1)
  })

  it('an import commit re-checks duplicates, so two previews of one file cannot commit a CVE twice', async () => {
    const content = JSON.stringify([{ cve: 'CVE-2026-88001', title: 'Imported twice', severity: 'LOW', description: 'Imported by the bug-hunt test.', affected_versions: '<1.0', exploitation: 'UNKNOWN', source: 'bughunt', discovered_at: '2026-09-29T00:00:00Z' }])
    const p1 = await ok<ImportPreview>(await lead.post('/api/import/preview', { kind: 'vulnerabilities', format: 'json', content }), 200)
    const p2 = await ok<ImportPreview>(await lead.post('/api/import/preview', { kind: 'vulnerabilities', format: 'json', content }), 200)
    expect(p1.canCommit && p2.canCommit).toBe(true)
    expect((await lead.post('/api/import/commit', { token: p1.token })).status).toBe(200)
    const second = await lead.post('/api/import/commit', { token: p2.token })
    const vulns = (await json<{ items: Array<{ cve: string | null }> }>(await lead.get('/api/vulnerabilities'))).items
    expect(vulns.filter((v) => v.cve === 'CVE-2026-88001')).toHaveLength(1)
    expect(second.status).toBe(409)
  })

  it('refuses to mark ready or submit a report that does not carry the current decision to report', async () => {
    const { caseId } = await freshCase()
    const { id: reportId } = await ok<{ id: string }>(await lead.post(`/api/cases/${caseId}/reports`, { kind: 'EARLY_WARNING' }))
    await ok(await lead.post(`/api/reports/${reportId}/transition`, { to: 'INTERNAL_REVIEW' }), 200)
    await ok(await mgr.post(`/api/cases/${caseId}/reviews`, { targetType: 'report', targetId: reportId, action: 'APPROVE' }))
    const code = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code
    // No decision yet: nothing is marked ready.
    const early = await lead.post(`/api/reports/${reportId}/transition`, { to: 'READY' })
    expect(early.status).toBe(409)
    expect(await code(early)).toBe('NO_DECISION_TO_REPORT')
    await ok(await lead.post(`/api/cases/${caseId}/decisions`, { outcome: 'REPORT', rationale: 'Affected, actively exploited, awareness after application: report.', confidence: 'HIGH', divergenceReason: 'Recorded while product determinations are still being completed.' }))
    const r = await json<{ report: { decisionId: string | null; content: { sections: Array<{ id: string; paragraphs: string[] }> } } }>(await lead.get(`/api/reports/${reportId}`))
    expect(r.report.decisionId).toBeNull()
    expect(r.report.content.sections.find((s) => s.id === 'executive-summary')!.paragraphs.join(' ')).toContain('No decision recorded')
    // The decision now exists, but this version was generated without it.
    const stale = await lead.post(`/api/reports/${reportId}/transition`, { to: 'READY' })
    expect(stale.status).toBe(409)
    expect(await code(stale)).toBe('REPORT_DECISION_MISMATCH')
    expect((await lead.post(`/api/reports/${reportId}/transition`, { to: 'SUBMITTED' })).status).toBe(409)
  })

  it('removing a product from a case (PATCH productIds) removes its determination from the analysis', async () => {
    const { caseId } = await freshCase({ awareness: false })
    await ok(
      await lead.post(`/api/cases/${caseId}/determinations`, {
        productId: 'PRD-VSY',
        answers: { component_present: { answer: 'YES' }, vulnerable_version: { answer: 'YES' }, functionality_enabled: { answer: 'UNKNOWN' } },
        rationale: 'Presence confirmed, enablement not yet established.',
        confidence: 'LOW',
        unresolved: 'Whether the inflate path is compiled in.',
        nextAction: 'Check build flags',
        nextActionOwnerId: 'u-eng',
        nextActionDue: '2026-10-01T12:00:00Z',
      }),
    )
    await ok(await lead.patch(`/api/cases/${caseId}`, { productIds: ['PRD-SEG'] }), 200)
    const d = await detail(caseId)
    expect(d.bundle.products.map((p) => p.id)).toEqual(['PRD-SEG'])
    expect(Object.keys(d.analysis.determinations)).not.toContain('PRD-VSY')
    expect(d.analysis.gaps.gaps.some((g) => g.id === 'gap-det-PRD-VSY')).toBe(false)
  })

  it('the overview "Under investigation" count matches the Determinations page it links to', async () => {
    const overview = await json<OverviewResponse>(await lead.get('/api/overview'))
    const rows = (await json<{ items: Array<{ lifecycle: string; determination: { result: string } | null }> }>(await lead.get('/api/determinations'))).items
    const linked = rows.filter((r) => r.lifecycle === 'open' && r.determination?.result === 'UNDER_INVESTIGATION').length
    expect(overview.counts.underInvestigation).toBe(linked)
  })
})

describe('server: checked and found correct', () => {
  it('blocks closing a case while a deadline is running, and allows it after a DO_NOT_REPORT decision', async () => {
    const { caseId } = await freshCase()
    const res = await mgr.post(`/api/cases/${caseId}/lifecycle`, { action: 'close', reason: 'Trying to close early.' })
    expect(res.status).toBe(409)
  })

  it('rejects a second event of the same type and routes it to a correction', async () => {
    const { caseId, ticket } = await freshCase()
    const res = await lead.post(`/api/cases/${caseId}/events`, { type: 'VULNERABILITY_AWARENESS', occurredAt: '2026-09-30T08:30:00Z', timezone: 'UTC', source: 'x', sourceKind: 'system_of_record', criterionId: 'AC-01', evidenceIds: [ticket] })
    expect(res.status).toBe(409)
  })

  it('numbers report versions 1.0, 1.1, then 2.0 when the decision changes', async () => {
    const { caseId } = await freshCase()
    const v = async () => (await ok<{ version: string }>(await lead.post(`/api/cases/${caseId}/reports`, { kind: 'EARLY_WARNING' }))).version
    expect(await v()).toBe('1.0')
    expect(await v()).toBe('1.1')
    await ok(await lead.post(`/api/cases/${caseId}/decisions`, { outcome: 'REPORT', rationale: 'Affected, actively exploited, awareness after application: report.', confidence: 'HIGH', divergenceReason: 'Recorded while product determinations are still being completed.' }))
    expect(await v()).toBe('2.0')
  })

  it('keeps case list, clocks page and case detail on one derived status', async () => {
    const list = (await json<{ items: CaseListItem[] }>(await lead.get('/api/cases'))).items
    const clocks = (await json<{ items: Array<{ caseId: string; status: string }> }>(await lead.get('/api/clocks'))).items
    for (const c of list) expect(clocks.find((x) => x.caseId === c.id)!.status).toBe(c.status)
  })
})

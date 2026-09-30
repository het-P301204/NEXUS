import { describe, expect, it } from 'vitest'
import { analyzeCase } from '../../lib/engine/analyze.ts'
import { buildClock } from '../../lib/engine/clock.ts'
import { answers, bundle, decision, determination, ev, evidenceItem, PRODUCT, VULN } from '../helpers.ts'

const NOW = '2026-09-29T12:00:00.000Z'
const affected = answers({ component_present: ['YES', ['EV-SBOM']], vulnerable_version: 'YES', functionality_enabled: 'YES', feature_reachable: 'YES', exploit_path: 'YES', configuration_mitigates: 'NO' })
const notAffected = answers({ component_present: 'YES', vulnerable_version: 'YES', functionality_enabled: ['NO', ['EV-CFG']], product_validation: 'YES' })

function aware(extra: Parameters<typeof ev>[2] = {}) {
  return [
    ev('DETECTION', '2026-09-29T07:00:00.000Z', { id: 'D', evidenceIds: ['EV-ADV'] }),
    ev('VULNERABILITY_AWARENESS', '2026-09-29T08:00:00.000Z', { id: 'VA', evidenceIds: ['EV-TKT'], criterionId: 'AC-V' }),
    ev('EXPLOITATION_AWARENESS', '2026-09-29T09:00:00.000Z', { id: 'EA', evidenceIds: ['EV-EXP'], criterionId: 'AC-E', ...extra }),
  ]
}
const evidence = [evidenceItem('EV-ADV', 'VENDOR_ADVISORY'), evidenceItem('EV-TKT', 'TICKET'), evidenceItem('EV-EXP', 'EXPLOIT_EVIDENCE'), evidenceItem('EV-SBOM', 'SBOM'), evidenceItem('EV-CFG', 'CONFIGURATION')]

describe('reportability evaluation', () => {
  it('suggests REPORT for an affected, actively exploited, applicable case', () => {
    const a = analyzeCase(bundle({ events: aware(), evidence, determinations: [determination(PRODUCT.id, affected)] }), NOW)
    expect(a.suggestion.outcome).toBe('REPORT')
    expect(a.status).toBe('DETERMINATION_PENDING')
  })

  it('suggests reporting not required when every product is not affected', () => {
    const a = analyzeCase(bundle({ events: aware(), evidence, determinations: [determination(PRODUCT.id, notAffected)] }), NOW)
    expect(a.suggestion.outcome).toBe('DO_NOT_REPORT')
    expect(a.suggestion.nonReportReason).toBe('NOT_AFFECTED')
  })

  it('is PENDING, never "not reportable", while affectedness is under investigation', () => {
    const a = analyzeCase(bundle({ events: aware(), evidence }), NOW)
    expect(a.suggestion.outcome).toBe('PENDING')
    expect(a.suggestion.aggregateAffectedness).toBe('UNDER_INVESTIGATION')
    // and the clock is running regardless
    expect(a.deadlines[0]!.status).toBe('ON_TRACK')
  })

  it('requires reliable evidence of exploitation, not just a CONFIRMED label', () => {
    const a = analyzeCase(bundle({ events: aware(), evidence: evidence.filter((e) => e.type !== 'EXPLOIT_EVIDENCE'), determinations: [determination(PRODUCT.id, affected)] }), NOW)
    // The EA event still carries EV-EXP as a reference, but the item does not exist on the case.
    expect(a.suggestion.exploitationEstablished).toBe(false)
    expect(a.suggestion.outcome).toBe('PENDING')
  })

  it('does not report a vulnerability that is not being exploited', () => {
    const a = analyzeCase(bundle({ vulnerability: { ...VULN, exploitation: 'NOT_OBSERVED' }, events: aware().slice(0, 2), evidence, determinations: [determination(PRODUCT.id, affected)] }), NOW)
    expect(a.suggestion.outcome).toBe('DO_NOT_REPORT')
    expect(a.suggestion.nonReportReason).toBe('NO_ACTIVE_EXPLOITATION')
  })

  it('does not report for a product that is not made available in the EU', () => {
    const a = analyzeCase(bundle({ products: [{ ...PRODUCT, madeAvailableInEu: false }], events: aware(), evidence, determinations: [determination(PRODUCT.id, affected)] }), NOW)
    expect(a.suggestion.nonReportReason).toBe('NOT_MADE_AVAILABLE_IN_EU')
  })

  it('derives case status from the records, not from a stored field', () => {
    expect(analyzeCase(bundle(), NOW).status).toBe('NEW')
    expect(analyzeCase(bundle({ events: aware().slice(0, 1) }), NOW).status).toBe('INVESTIGATING')
    expect(analyzeCase(bundle({ events: aware() }), NOW).status).toBe('AWARENESS_ESTABLISHED')
    const withDecision = analyzeCase(bundle({ events: aware(), decisions: [decision('REPORT', '2026-09-29T10:00:00.000Z')] }), NOW)
    expect(withDecision.status).toBe('REPORTABLE')
    const submitted = analyzeCase(bundle({ events: [...aware(), ev('EARLY_WARNING_SUBMITTED', '2026-09-29T11:00:00.000Z')], decisions: [decision('REPORT', '2026-09-29T10:00:00.000Z')] }), NOW)
    expect(submitted.status).toBe('SUBMITTED')
  })
})

describe('evidence completeness', () => {
  it('counts applicable items and never invents a percentage', () => {
    const a = analyzeCase(bundle({ events: aware(), evidence, determinations: [determination(PRODUCT.id, affected)] }), NOW)
    const c = a.completeness
    expect(c.items.map((i) => i.id)).toEqual(['vulnerability', 'affectedness', 'exploitation', 'awareness', 'rationale', 'deadline_source', 'submission'])
    // submission is not applicable without a decision to report
    expect(c.items.find((i) => i.id === 'submission')!.state).toBe('not_applicable')
    expect(c.applicable).toBe(6)
    expect(c.satisfied).toBe(5) // no decision rationale yet
    expect(c.missing.map((m) => m.id)).toEqual(['rationale'])
  })

  it('marks the deadline source missing when the clock start rests on attestation alone', () => {
    const events = aware({ sourceKind: 'analyst_attestation', evidenceIds: [] })
    const a = analyzeCase(bundle({ events, evidence, determinations: [determination(PRODUCT.id, affected)] }), NOW)
    expect(a.completeness.items.find((i) => i.id === 'deadline_source')!.state).toBe('missing')
  })

  it('requires a submission receipt once the decision is to report', () => {
    const a = analyzeCase(bundle({ events: aware(), evidence, decisions: [decision('REPORT', '2026-09-29T10:00:00.000Z')] }), NOW)
    expect(a.completeness.items.find((i) => i.id === 'submission')!.state).toBe('missing')
  })

  it('reports gaps that block the determination with a next action', () => {
    const a = analyzeCase(bundle({ events: aware().slice(0, 2), evidence: [] }), NOW)
    expect(a.gaps.canFinalize).toBe(false)
    expect(a.gaps.blockingSummary).toBe('Cannot finalize determination.')
    expect(a.gaps.gaps.map((g) => g.label)).toContain('Exploitation evidence')
  })
})

describe('data quality', () => {
  it('flags a decision dated before the awareness it decides on', () => {
    const a = analyzeCase(bundle({ events: aware(), evidence, decisions: [decision('REPORT', '2026-09-29T08:30:00.000Z')] }), NOW)
    expect(a.quality.map((q) => q.code)).toContain('DECISION_BEFORE_AWARENESS')
  })

  it('flags a submission dated before the decision to report, as an error that blocks the case', () => {
    const a = analyzeCase(bundle({ events: [...aware(), ev('EARLY_WARNING_SUBMITTED', '2026-09-29T09:30:00.000Z')], evidence, decisions: [decision('REPORT', '2026-09-29T10:00:00.000Z')] }), NOW)
    const f = a.quality.find((q) => q.code === 'SUBMISSION_BEFORE_DECISION')!
    expect(f.severity).toBe('error')
    expect(a.health.state).toBe('BLOCKED')
  })

  it('flags awareness before detection and exploitation awareness before vulnerability awareness', () => {
    const events = [ev('DETECTION', '2026-09-29T09:30:00.000Z'), ev('VULNERABILITY_AWARENESS', '2026-09-29T09:00:00.000Z', { id: 'VA' }), ev('EXPLOITATION_AWARENESS', '2026-09-29T08:00:00.000Z', { id: 'EA' })]
    const codes = analyzeCase(bundle({ events, evidence }), NOW).quality.map((q) => q.code)
    expect(codes).toContain('AWARENESS_BEFORE_DETECTION')
    expect(codes).toContain('EXPLOITATION_BEFORE_VULNERABILITY_AWARENESS')
  })

  it('flags evidence created after the submission it supports', () => {
    const late = evidenceItem('EV-LATE', 'LOG', { sourceCreatedAt: '2026-09-29T12:00:00.000Z' })
    const events = [...aware({ evidenceIds: ['EV-EXP', 'EV-LATE'] }), ev('EARLY_WARNING_SUBMITTED', '2026-09-29T11:00:00.000Z')]
    const a = analyzeCase(bundle({ events, evidence: [...evidence, late], decisions: [decision('REPORT', '2026-09-29T10:00:00.000Z')] }), '2026-09-29T13:00:00.000Z')
    expect(a.quality.map((q) => q.code)).toContain('EVIDENCE_AFTER_SUBMISSION')
  })

  it('flags an affected product with no component mapping', () => {
    const a = analyzeCase(bundle({ productComponents: [], events: aware(), evidence, determinations: [determination(PRODUCT.id, affected)] }), NOW)
    expect(a.quality.map((q) => q.code)).toContain('AFFECTED_WITHOUT_COMPONENT_MAPPING')
  })

  it('flags confirmed exploitation with no exploitation-awareness event: no clock has been established', () => {
    const a = analyzeCase(bundle({ events: aware().slice(0, 2), evidence }), NOW)
    expect(a.quality.map((q) => q.code)).toContain('CONFIRMED_WITHOUT_AWARENESS')
  })

  it('never modifies the records it checks', () => {
    const b = bundle({ events: aware(), evidence, decisions: [decision('REPORT', '2026-09-29T08:30:00.000Z')] })
    const before = JSON.stringify(b)
    analyzeCase(b, NOW)
    expect(JSON.stringify(b)).toBe(before)
  })
})

describe('clock of record', () => {
  it('keeps the five stages apart and computes the elapsed time between them', () => {
    const events = [ev('OCCURRENCE', '2026-09-29T08:31:22.000Z'), ev('DETECTION', '2026-09-29T09:12:08.000Z'), ev('VULNERABILITY_AWARENESS', '2026-09-29T09:50:00.000Z', { id: 'VA' }), ev('EXPLOITATION_AWARENESS', '2026-09-29T10:04:41.000Z', { id: 'EA' }), ev('DECISION', '2026-09-29T11:18:03.000Z')]
    const c = buildClock(events, { decisionOutcome: 'REPORT' })
    expect(c.stages.map((s) => s.state)).toEqual(['recorded', 'recorded', 'recorded', 'recorded', 'pending'])
    expect(c.stages[1]!.sincePreviousMs).toBe(40 * 60_000 + 46_000)
    expect(c.stages[2]!.sincePreviousMs).toBe(52 * 60_000 + 33_000)
    expect(c.stages[3]!.sincePreviousMs).toBe(73 * 60_000 + 22_000)
    expect(c.activeStageIndex).toBe(4)
  })

  it('marks awareness partial without exploitation awareness, and submission not applicable after a non-report decision', () => {
    const c = buildClock([ev('VULNERABILITY_AWARENESS', '2026-09-29T09:50:00.000Z'), ev('DECISION', '2026-09-29T11:00:00.000Z')], { decisionOutcome: 'DO_NOT_REPORT' })
    expect(c.stages[2]!.state).toBe('partial')
    expect(c.stages[4]!.state).toBe('not_applicable')
  })

  it('does not treat a late-learned occurrence as the stage being waited on', () => {
    const c = buildClock([ev('DETECTION', '2026-09-29T09:12:08.000Z')], { decisionOutcome: null })
    expect(c.stages[0]!.state).toBe('pending')
    expect(c.activeStageIndex).toBe(2)
  })
})

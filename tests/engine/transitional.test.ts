import { describe, expect, it } from 'vitest'
import { evaluateTransitional } from '../../lib/engine/transitional.ts'
import { APPLICATION_INSTANT } from '../../rules/cra-article14.ts'

const APP = APPLICATION_INSTANT // 2026-09-10T22:00:00Z = 11 Sep 2026 00:00 CEST

describe('transitional rule (two independent awareness dates)', () => {
  it('reads the application boundary as 00:00 CEST on 11 September 2026', () => {
    expect(APP).toBe('2026-09-10T22:00:00.000Z')
  })

  it('is not applicable when both the vulnerability and its exploitation were known before application', () => {
    const r = evaluateTransitional('2026-09-02T14:10:00.000Z', '2026-09-06T09:30:00.000Z', APP)
    expect(r.result).toBe('NOT_APPLICABLE_PRE_APPLICATION')
    expect(r.vulnerabilitySide).toBe('pre')
    expect(r.exploitationSide).toBe('pre')
  })

  it('is applicable when the vulnerability was known before but its exploitation only after', () => {
    const r = evaluateTransitional('2026-09-03T13:00:00.000Z', '2026-09-27T10:00:00.000Z', APP)
    expect(r.result).toBe('APPLICABLE')
    expect(r.vulnerabilitySide).toBe('pre')
    expect(r.exploitationSide).toBe('post')
    expect(r.triggerInstant).toBe('2026-09-27T10:00:00.000Z')
  })

  it('is applicable when both are known after application', () => {
    expect(evaluateTransitional('2026-09-20T08:00:00.000Z', '2026-09-21T08:00:00.000Z', APP).result).toBe('APPLICABLE')
  })

  it('has no clock without exploitation awareness, whatever the vulnerability date', () => {
    const r = evaluateTransitional('2026-09-20T08:00:00.000Z', null, APP)
    expect(r.result).toBe('NO_EXPLOITATION_AWARENESS')
    expect(r.triggerInstant).toBeNull()
  })

  it('is indeterminate with no awareness at all', () => {
    expect(evaluateTransitional(null, null, APP).result).toBe('INDETERMINATE')
  })

  it('treats exploitation awareness alone as implying vulnerability awareness', () => {
    const r = evaluateTransitional(null, '2026-09-20T08:00:00.000Z', APP)
    expect(r.result).toBe('APPLICABLE')
    expect(r.triggerInstant).toBe('2026-09-20T08:00:00.000Z')
  })

  it('treats an instant exactly at the boundary as on or after application', () => {
    expect(evaluateTransitional('2026-09-01T00:00:00.000Z', APP, APP).result).toBe('APPLICABLE')
    expect(evaluateTransitional('2026-09-01T00:00:00.000Z', '2026-09-10T21:59:59.000Z', APP).result).toBe('NOT_APPLICABLE_PRE_APPLICATION')
  })

  it('flags a trigger within 24 hours of the boundary for counsel review', () => {
    const near = evaluateTransitional('2026-09-10T20:00:00.000Z', '2026-09-10T23:30:00.000Z', APP)
    expect(near.nearBoundary).toBe(true)
    expect(near.reasoning.join(' ')).toMatch(/Counsel review recommended/)
    expect(evaluateTransitional('2026-09-01T00:00:00.000Z', '2026-09-20T00:00:00.000Z', APP).nearBoundary).toBe(false)
  })

  it('reports the inconsistent ordering of exploitation before vulnerability awareness in its reasoning', () => {
    const r = evaluateTransitional('2026-09-20T00:00:00.000Z', '2026-09-05T00:00:00.000Z', APP)
    expect(r.result).toBe('APPLICABLE')
    expect(r.reasoning.join(' ')).toMatch(/inconsistent/)
  })

  it('exposes its inputs in the rule trace', () => {
    const r = evaluateTransitional('2026-09-03T13:00:00.000Z', '2026-09-27T10:00:00.000Z', APP)
    expect(r.trace.inputs['Vulnerability awareness']).toBe('2026-09-03T13:00:00.000Z')
    expect(r.trace.inputs['Trigger (later of the two)']).toBe('2026-09-27T10:00:00.000Z')
    expect(r.trace.state).toBe('pass')
  })
})

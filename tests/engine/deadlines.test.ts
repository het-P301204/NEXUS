import { describe, expect, it } from 'vitest'
import { buildClock } from '../../lib/engine/clock.ts'
import { computeDeadlines } from '../../lib/engine/deadlines.ts'
import { evaluateTransitional } from '../../lib/engine/transitional.ts'
import { APPLICATION_INSTANT } from '../../rules/cra-article14.ts'
import { ev } from '../helpers.ts'

/** A decision given to the deadline engine directly is taken as in force (approved, current). */
function deadlines(events: Parameters<typeof buildClock>[0], now: string, decision: { id: string; outcome: 'REPORT' | 'DO_NOT_REPORT' } | null = null) {
  const clock = buildClock(events, { decisionOutcome: decision?.outcome ?? null })
  const t = evaluateTransitional(clock.vulnerabilityAwareness?.occurredAt ?? null, clock.exploitationAwareness?.occurredAt ?? null, APPLICATION_INSTANT)
  const standing = { inForce: true, reason: null, staleBy: null }
  const [ew, vn, fr] = computeDeadlines({ clock, transitional: t, decision: decision && { ...decision, standing }, now })
  return { ew: ew!, vn: vn!, fr: fr!, clock }
}

const VA = ev('VULNERABILITY_AWARENESS', '2026-09-29T08:00:00.000Z', { id: 'VA' })
const EA = ev('EXPLOITATION_AWARENESS', '2026-09-29T10:04:41.000Z', { id: 'EA' })

describe('deadline calculation', () => {
  it('computes the 24h and 72h deadlines from the awareness instant', () => {
    const d = deadlines([VA, EA], '2026-09-29T12:00:00.000Z')
    expect(d.ew.dueAt).toBe('2026-09-30T10:04:41.000Z')
    expect(d.vn.dueAt).toBe('2026-10-02T10:04:41.000Z')
    expect(d.ew.start?.eventId).toBe('EA')
  })

  it('starts the clock at exploitation awareness: a vulnerability-awareness record dated later cannot push it back', () => {
    const lateVa = ev('VULNERABILITY_AWARENESS', '2026-09-29T11:00:00.000Z', { id: 'VA2' })
    const d = deadlines([lateVa, EA], '2026-09-29T12:00:00.000Z')
    expect(d.clock.awarenessInstant).toBe('2026-09-29T10:04:41.000Z')
    expect(d.ew.dueAt).toBe('2026-09-30T10:04:41.000Z')
    expect(d.ew.start?.eventId).toBe('EA')
  })

  it('keeps the final-report clock pending until a measure is available, then starts it from that event', () => {
    const before = deadlines([VA, EA], '2026-09-29T12:00:00.000Z')
    expect(before.fr.status).toBe('PENDING_START')
    expect(before.fr.dueAt).toBeNull()
    const measure = ev('MEASURE_AVAILABLE', '2026-10-03T09:00:00.000Z', { id: 'M' })
    const after = deadlines([VA, EA, measure], '2026-10-04T00:00:00.000Z')
    expect(after.fr.dueAt).toBe('2026-10-17T09:00:00.000Z')
    expect(after.fr.start?.eventId).toBe('M')
  })

  it('does not start any clock on vulnerability awareness alone', () => {
    const d = deadlines([VA], '2026-09-29T12:00:00.000Z')
    expect(d.ew.status).toBe('PENDING_START')
    expect(d.ew.dueAt).toBeNull()
  })

  it('blocks the calculation when no awareness has been recorded', () => {
    const d = deadlines([ev('DETECTION', '2026-09-29T07:00:00.000Z')], '2026-09-29T12:00:00.000Z')
    expect(d.ew.status).toBe('BLOCKED')
    expect(d.ew.reason).toMatch(/Awareness timestamp has not been established/)
    expect(d.ew.action?.tab).toBe('clock')
  })

  it('moves attention status through ON_TRACK, WATCH, CRITICAL and OVERDUE', () => {
    expect(deadlines([VA, EA], '2026-09-29T12:00:00.000Z').ew.status).toBe('ON_TRACK')
    expect(deadlines([VA, EA], '2026-09-29T23:00:00.000Z').ew.status).toBe('WATCH')
    expect(deadlines([VA, EA], '2026-09-30T07:00:00.000Z').ew.status).toBe('CRITICAL')
    expect(deadlines([VA, EA], '2026-09-30T10:05:00.000Z').ew.status).toBe('OVERDUE')
  })

  it('records a submission within the deadline as COMPLETED and one after it as COMPLETED_LATE', () => {
    const onTime = deadlines([VA, EA, ev('EARLY_WARNING_SUBMITTED', '2026-09-30T09:00:00.000Z')], '2026-10-01T00:00:00.000Z')
    expect(onTime.ew.status).toBe('COMPLETED')
    const late = deadlines([VA, EA, ev('EARLY_WARNING_SUBMITTED', '2026-09-30T11:00:00.000Z')], '2026-10-01T00:00:00.000Z')
    expect(late.ew.status).toBe('COMPLETED_LATE')
  })

  it('stops every clock when a decision not to report is recorded', () => {
    const d = deadlines([VA, EA], '2026-09-29T12:00:00.000Z', { id: 'DEC-1', outcome: 'DO_NOT_REPORT' })
    expect([d.ew.status, d.vn.status, d.fr.status]).toEqual(['NOT_APPLICABLE', 'NOT_APPLICABLE', 'NOT_APPLICABLE'])
    expect(d.ew.reason).toContain('DEC-1')
  })

  it('keeps running when no decision is recorded, however the evaluation might turn out', () => {
    const d = deadlines([VA, EA], '2026-09-29T12:00:00.000Z', null)
    expect(d.ew.status).toBe('ON_TRACK')
    expect(d.ew.calculation.join(' ')).toMatch(/runs from awareness either way/)
  })

  it('recalculates from a correction while keeping the original event', () => {
    const correction = ev('CORRECTION', '2026-09-29T08:04:41.000Z', { id: 'C1', supersedesId: 'EA', recordedAt: '2026-09-29T13:00:00.000Z' })
    const d = deadlines([VA, EA, correction], '2026-09-29T14:00:00.000Z')
    expect(d.ew.dueAt).toBe('2026-09-30T08:04:41.000Z')
    expect(d.ew.start?.eventId).toBe('C1')
    const effective = d.clock.effective.find((e) => e.type === 'EXPLOITATION_AWARENESS')!
    expect(effective.original.occurredAt).toBe('2026-09-29T10:04:41.000Z')
    expect(effective.corrections.map((c) => c.id)).toEqual(['C1'])
  })

  it('applies chained corrections in recording order', () => {
    const c1 = ev('CORRECTION', '2026-09-29T09:00:00.000Z', { id: 'C1', supersedesId: 'EA', recordedAt: '2026-09-29T13:00:00.000Z' })
    const c2 = ev('CORRECTION', '2026-09-29T09:30:00.000Z', { id: 'C2', supersedesId: 'C1', recordedAt: '2026-09-29T14:00:00.000Z' })
    const d = deadlines([VA, EA, c2, c1], '2026-09-29T15:00:00.000Z')
    expect(d.ew.dueAt).toBe('2026-09-30T09:30:00.000Z')
  })

  it('explains itself: the calculation names the rule, the start event and the arithmetic', () => {
    const d = deadlines([VA, EA], '2026-09-29T12:00:00.000Z')
    const text = d.ew.calculation.join('\n')
    expect(text).toContain('R-14-2-A-EARLY-WARNING')
    expect(text).toContain('Art. 14(2)(a)')
    expect(text).toContain('Deadline = start + 24 hours = 2026-09-30T10:04:41.000Z')
  })

  it('does not apply deadlines when both awareness dates precede application', () => {
    const d = deadlines(
      [ev('VULNERABILITY_AWARENESS', '2026-09-02T14:10:00.000Z'), ev('EXPLOITATION_AWARENESS', '2026-09-06T09:30:00.000Z')],
      '2026-09-30T12:00:00.000Z',
    )
    expect(d.ew.status).toBe('NOT_APPLICABLE')
  })
})

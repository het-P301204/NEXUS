import type { ClockEvent } from '../types/domain.ts'
import { APPLICATION_INSTANT } from '../rules/cra-article14.ts'
import { buildClock } from '../lib/engine/clock.ts'
import { computeDeadlines } from '../lib/engine/deadlines.ts'
import { evaluateTransitional } from '../lib/engine/transitional.ts'
import { emptyAnswers, evaluateAffectedness } from '../lib/engine/affectedness.ts'

/**
 * Known-answer self-test, run on demand by the system-status endpoint.
 *
 * The status panel's "operational" is a claim the server can check, not a
 * constant: these vectors must produce these exact answers, or the engine is
 * reported degraded.
 */

interface Vector {
  name: string
  pass: boolean
}

function event(type: ClockEvent['type'], occurredAt: string, id: string): ClockEvent {
  return {
    id,
    caseId: 'SELFTEST',
    type,
    occurredAt,
    timezone: 'UTC',
    actorId: 'system',
    source: 'self-test',
    sourceKind: 'system_of_record',
    evidenceIds: [],
    criterionId: null,
    responsibleRole: null,
    supersedesId: null,
    correctionReason: null,
    decisionId: null,
    reportId: null,
    note: '',
    recordedAt: occurredAt,
    integrityHash: '',
  }
}

let cached: { at: number; value: ReturnType<typeof run> } | null = null

export function selfTest() {
  if (!cached || Date.now() - cached.at > 60_000) cached = { at: Date.now(), value: run() }
  return cached.value
}

function run() {
  const rules: Vector[] = []
  const deadlines: Vector[] = []

  const pre = evaluateTransitional('2026-09-01T10:00:00.000Z', '2026-09-05T10:00:00.000Z', APPLICATION_INSTANT)
  rules.push({ name: 'both awareness dates before application -> not applicable', pass: pre.result === 'NOT_APPLICABLE_PRE_APPLICATION' })
  const split = evaluateTransitional('2026-09-01T10:00:00.000Z', '2026-09-20T10:00:00.000Z', APPLICATION_INSTANT)
  rules.push({ name: 'vulnerability before, exploitation after -> applicable', pass: split.result === 'APPLICABLE' && split.triggerInstant === '2026-09-20T10:00:00.000Z' })
  const none = evaluateTransitional('2026-09-20T10:00:00.000Z', null, APPLICATION_INSTANT)
  rules.push({ name: 'no exploitation awareness -> no clock', pass: none.result === 'NO_EXPLOITATION_AWARENESS' })

  const unknown = emptyAnswers()
  unknown.component_present = { answer: 'YES', note: '', evidenceIds: [] }
  unknown.vulnerable_version = { answer: 'UNKNOWN', note: '', evidenceIds: [] }
  rules.push({ name: 'unknown version -> under investigation, never not affected', pass: evaluateAffectedness(unknown).result === 'UNDER_INVESTIGATION' })
  const noValidation = emptyAnswers()
  noValidation.component_present = { answer: 'NO', note: '', evidenceIds: ['E'] }
  rules.push({ name: 'not affected without validation -> under investigation', pass: evaluateAffectedness(noValidation).result === 'UNDER_INVESTIGATION' })

  const clock = buildClock(
    [event('VULNERABILITY_AWARENESS', '2026-09-20T08:00:00.000Z', 'A'), event('EXPLOITATION_AWARENESS', '2026-09-20T10:04:41.000Z', 'B')],
    { decisionOutcome: null },
  )
  const t = evaluateTransitional(clock.vulnerabilityAwareness!.occurredAt, clock.exploitationAwareness!.occurredAt, APPLICATION_INSTANT)
  const ds = computeDeadlines({ clock, transitional: t, decision: null, now: '2026-09-20T12:00:00.000Z' })
  deadlines.push({ name: '24h = awareness + 24h', pass: ds[0]!.dueAt === '2026-09-21T10:04:41.000Z' })
  deadlines.push({ name: '72h = awareness + 72h', pass: ds[1]!.dueAt === '2026-09-23T10:04:41.000Z' })
  deadlines.push({ name: '14d pending until measure available', pass: ds[2]!.status === 'PENDING_START' && ds[2]!.dueAt === null })
  const withMeasure = buildClock(
    [
      event('VULNERABILITY_AWARENESS', '2026-09-20T08:00:00.000Z', 'A'),
      event('EXPLOITATION_AWARENESS', '2026-09-20T10:04:41.000Z', 'B'),
      event('MEASURE_AVAILABLE', '2026-09-25T00:00:00.000Z', 'C'),
    ],
    { decisionOutcome: null },
  )
  const ds2 = computeDeadlines({ clock: withMeasure, transitional: t, decision: null, now: '2026-09-26T00:00:00.000Z' })
  deadlines.push({ name: '14d = measure available + 14d', pass: ds2[2]!.dueAt === '2026-10-09T00:00:00.000Z' })
  const inForce = { inForce: true, reason: null, staleBy: null }
  const ds3 = computeDeadlines({ clock, transitional: t, decision: { id: 'D', outcome: 'DO_NOT_REPORT', standing: inForce }, now: '2026-09-20T12:00:00.000Z' })
  deadlines.push({ name: 'an approved non-report decision stops the clock', pass: ds3.every((d) => d.status === 'NOT_APPLICABLE') })

  const summarize = (vs: Vector[]) => {
    const passed = vs.filter((v) => v.pass).length
    return { ok: passed === vs.length, passed, total: vs.length, failed: vs.filter((v) => !v.pass).map((v) => v.name), vectors: vs }
  }
  const r = summarize(rules)
  const d = summarize(deadlines)
  return {
    rules: { ...r, detail: `Known-answer self-test ${r.passed}/${r.total} passed.` },
    deadlines: { ...d, detail: `Known-answer self-test ${d.passed}/${d.total} passed.` },
  }
}

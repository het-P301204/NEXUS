import type { Iso } from '../../types/domain.ts'
import {
  ATTENTION_THRESHOLDS,
  DEADLINE_DURATIONS,
  RULE_IDS,
  RULE_SET,
} from '../../rules/cra-article14.ts'
import type { ClockOfRecord, EffectiveEvent } from './clock.ts'
import type { TransitionalEvaluation } from './transitional.ts'
import { addMs, diffMs, formatDuration, ms } from './time.ts'

/**
 * Deterministic deadline calculation.
 *
 * A deadline is a derived object: a rule, a start event and a duration. It is
 * never stored, so it cannot drift from the event it was computed from. When
 * an awareness timestamp is corrected, every deadline downstream of it moves
 * with it, and the correction stays visible on the record.
 *
 * Only a recorded decision stops a clock. A rule evaluation that suggests
 * "not reportable" does not: until someone records that decision with its
 * rationale, the clock keeps running.
 */

export type DeadlineKind = 'EARLY_WARNING' | 'VULNERABILITY_NOTIFICATION' | 'FINAL_REPORT'

export type DeadlineStatus =
  | 'ON_TRACK'
  | 'WATCH'
  | 'CRITICAL'
  | 'OVERDUE'
  | 'COMPLETED'
  | 'COMPLETED_LATE'
  | 'PENDING_START'
  | 'NOT_APPLICABLE'
  | 'BLOCKED'

export interface DeadlineStart {
  eventId: string
  eventType: string
  label: string
  at: Iso
  source: string
}

export interface Deadline {
  kind: DeadlineKind
  label: string
  shortLabel: string
  ruleId: string
  citation: string
  durationMs: number
  durationLabel: string
  start: DeadlineStart | null
  dueAt: Iso | null
  remainingMs: number | null
  completedAt: Iso | null
  completedByEventId: string | null
  status: DeadlineStatus
  reason: string
  /** Lines for "Why this deadline?" */
  calculation: string[]
  /** For BLOCKED: where the user fixes it. */
  action: { label: string; tab: string } | null
}

const META: Record<DeadlineKind, { label: string; short: string; ruleId: string; citation: string; durationLabel: string }> = {
  EARLY_WARNING: {
    label: 'Early warning',
    short: '24h',
    ruleId: RULE_IDS.earlyWarning,
    citation: 'Art. 14(2)(a)',
    durationLabel: '24 hours',
  },
  VULNERABILITY_NOTIFICATION: {
    label: 'Vulnerability notification',
    short: '72h',
    ruleId: RULE_IDS.notification,
    citation: 'Art. 14(2)(b)',
    durationLabel: '72 hours',
  },
  FINAL_REPORT: {
    label: 'Final report',
    short: '14d',
    ruleId: RULE_IDS.finalReport,
    citation: 'Art. 14(2)(c)',
    durationLabel: '14 days',
  },
}

export const DEADLINE_KINDS: DeadlineKind[] = ['EARLY_WARNING', 'VULNERABILITY_NOTIFICATION', 'FINAL_REPORT']

export interface DeadlineInputs {
  clock: ClockOfRecord
  transitional: TransitionalEvaluation
  /** The current recorded decision, if any, and whether it is in force. */
  decision: { id: string; outcome: 'REPORT' | 'DO_NOT_REPORT'; standing: DecisionStanding } | null
  now: Iso
}

export interface DecisionStanding {
  inForce: boolean
  /** Why a recorded decision is not in force; null when it is. */
  reason: string | null
  /** The awareness event recorded or corrected after the decision, if that is the reason. */
  staleBy: string | null
}

/**
 * Whether a recorded decision is in force. A decision to report always is. A
 * decision NOT to report stops the clocks only when both of these hold:
 *
 *   - its decision record has been approved. Not reporting is the higher-risk
 *     decision, so it does not take effect on the word of the person who
 *     recorded it; until review approves it, the clocks keep running.
 *   - the awareness it was made on still stands. An awareness event recorded
 *     or corrected after the decision -- typically exploitation confirmed
 *     after a "no active exploitation" decision -- reopens the question, and
 *     the clock it starts runs until a new decision is recorded.
 */
export function decisionStanding(
  decision: { id: string; outcome: 'REPORT' | 'DO_NOT_REPORT'; decidedAt: Iso },
  clock: ClockOfRecord,
  decisionRecords: Array<{ decisionId: string | null; stage: string }>,
): DecisionStanding {
  if (decision.outcome === 'REPORT') return { inForce: true, reason: null, staleBy: null }
  const ea = clock.exploitationAwareness
  const later = ea ? [clock.vulnerabilityAwareness, ea].find((e) => e && ms(e.current.recordedAt) > ms(decision.decidedAt)) : undefined
  if (later) {
    return {
      inForce: false,
      reason: `${later.original.id} (${later.type === 'EXPLOITATION_AWARENESS' ? 'exploitation' : 'vulnerability'} awareness) was ${later.corrections.length ? 'corrected' : 'recorded'} after decision ${decision.id}, so that decision no longer covers the awareness on record. The clock runs until a new decision is recorded.`,
      staleBy: later.original.id,
    }
  }
  const approved = decisionRecords.some((r) => r.decisionId === decision.id && (r.stage === 'APPROVED' || r.stage === 'CLOSED'))
  if (!approved) {
    return {
      inForce: false,
      reason: `Decision ${decision.id} (reporting not required) takes effect when its decision record is approved. Until then the clock keeps running.`,
      staleBy: null,
    }
  }
  return { inForce: true, reason: null, staleBy: null }
}

function statusFor(kind: DeadlineKind, remaining: number): DeadlineStatus {
  const t = ATTENTION_THRESHOLDS[kind]
  if (remaining < 0) return 'OVERDUE'
  if (remaining <= t.critical) return 'CRITICAL'
  if (remaining <= t.watch) return 'WATCH'
  return 'ON_TRACK'
}

function completionEvent(kind: DeadlineKind, clock: ClockOfRecord): EffectiveEvent | null {
  if (kind === 'EARLY_WARNING') return clock.earlyWarningSubmitted
  if (kind === 'VULNERABILITY_NOTIFICATION') return clock.notificationSubmitted
  return clock.finalReportSubmitted
}

function base(kind: DeadlineKind): Omit<Deadline, 'status' | 'reason' | 'calculation' | 'action'> {
  const m = META[kind]
  return {
    kind,
    label: m.label,
    shortLabel: m.short,
    ruleId: m.ruleId,
    citation: m.citation,
    durationMs: DEADLINE_DURATIONS[kind],
    durationLabel: m.durationLabel,
    start: null,
    dueAt: null,
    remainingMs: null,
    completedAt: null,
    completedByEventId: null,
  }
}

export function computeDeadlines(input: DeadlineInputs): Deadline[] {
  return DEADLINE_KINDS.map((kind) => computeDeadline(kind, input))
}

export function computeDeadline(kind: DeadlineKind, input: DeadlineInputs): Deadline {
  const { clock, transitional, decision, now } = input
  const b = base(kind)
  const ruleLine = `Rule ${b.ruleId} (${b.citation}), rule set ${RULE_SET.version}.`

  // A decision not to report stops a clock that has not already been met. A
  // submission made before the decision stays on the record as completed.
  if (decision?.outcome === 'DO_NOT_REPORT' && decision.standing.inForce && !completionEvent(kind, clock)) {
    return {
      ...b,
      status: 'NOT_APPLICABLE',
      reason: `Decision ${decision.id} records that reporting is not required.`,
      calculation: [ruleLine, `No deadline: decision ${decision.id} (DO NOT REPORT) is in force.`],
      action: null,
    }
  }
  if (transitional.result === 'NOT_APPLICABLE_PRE_APPLICATION') {
    return {
      ...b,
      status: 'NOT_APPLICABLE',
      reason: 'Both awareness dates precede the Article 14 application date.',
      calculation: [ruleLine, ...transitional.reasoning],
      action: null,
    }
  }
  if (transitional.result === 'INDETERMINATE') {
    return {
      ...b,
      status: 'BLOCKED',
      reason: 'Awareness timestamp has not been established.',
      calculation: [ruleLine, 'Deadline calculation blocked: no awareness event has been recorded.'],
      action: { label: 'Open Clock of Record', tab: 'clock' },
    }
  }
  if (transitional.result === 'NO_EXPLOITATION_AWARENESS' || !clock.awarenessInstant) {
    return {
      ...b,
      status: 'PENDING_START',
      reason: 'Exploitation awareness has not been established, so no Article 14(1) clock is running.',
      calculation: [
        ruleLine,
        'The clock starts when awareness of an actively exploited vulnerability is established.',
        'Vulnerability awareness alone does not start it.',
      ],
      action: { label: 'Open Clock of Record', tab: 'clock' },
    }
  }

  let start: DeadlineStart
  const startLines: string[] = []
  if (kind === 'FINAL_REPORT') {
    const measure = clock.measureAvailable
    if (!measure) {
      return {
        ...b,
        status: 'PENDING_START',
        reason: 'Starts when a corrective or mitigating measure is available.',
        calculation: [
          ruleLine,
          'The final-report clock does not start at awareness.',
          'It starts when a corrective or mitigating measure is available. No such event has been recorded yet.',
        ],
        action: { label: 'Record measure availability', tab: 'clock' },
      }
    }
    start = {
      eventId: measure.current.id,
      eventType: 'MEASURE_AVAILABLE',
      label: 'Corrective or mitigating measure available',
      at: measure.occurredAt,
      source: measure.current.source,
    }
    startLines.push(
      `Start event: ${start.label} -- ${measure.original.id}${measure.corrections.length ? ` (corrected by ${measure.current.id})` : ''}, ${start.at}.`,
      `Timestamp source: ${start.source}.`,
    )
  } else {
    const va = clock.vulnerabilityAwareness
    const ea = clock.exploitationAwareness!
    start = {
      eventId: ea.current.id,
      eventType: ea.type,
      label: 'Awareness established',
      at: clock.awarenessInstant,
      source: ea.current.source,
    }
    startLines.push(
      `Start event: awareness of an actively exploited vulnerability -- ${ea.original.id}${ea.corrections.length ? ` (corrected by ${ea.current.id})` : ''}.`,
      `Awareness instant = exploitation awareness (${ea.occurredAt}). Knowing the vulnerability is actively exploited includes knowing the vulnerability; vulnerability awareness (${va?.occurredAt ?? 'not recorded'}) cannot move the clock later.`,
      `Timestamp source: ${start.source}.`,
    )
  }

  const dueAt = addMs(start.at, b.durationMs)
  const completed = completionEvent(kind, clock)
  const calc = [ruleLine, ...startLines, `Deadline = start + ${b.durationLabel} = ${dueAt}.`]

  if (completed) {
    const late = ms(completed.occurredAt) > ms(dueAt)
    calc.push(
      `Completed by ${completed.original.id} at ${completed.occurredAt}${late ? `, ${formatDuration(diffMs(completed.occurredAt, dueAt))} after the deadline` : ''}.`,
    )
    return {
      ...b,
      start,
      dueAt,
      remainingMs: diffMs(dueAt, now),
      completedAt: completed.occurredAt,
      completedByEventId: completed.original.id,
      status: late ? 'COMPLETED_LATE' : 'COMPLETED',
      reason: late ? 'Submitted after the deadline.' : 'Submitted within the deadline.',
      calculation: calc,
      action: null,
    }
  }

  const remaining = diffMs(dueAt, now)
  const status = statusFor(kind, remaining)
  calc.push(
    remaining >= 0
      ? `Remaining = deadline - now (${now}) = ${formatDuration(remaining)}.`
      : `Overdue by ${formatDuration(-remaining)} as of ${now}.`,
  )
  const notInForce = decision && !decision.standing.inForce ? decision.standing.reason : null
  if (!decision) {
    calc.push('No reportability decision is recorded yet. The clock runs from awareness either way.')
  } else if (notInForce) {
    calc.push(notInForce)
  }
  return {
    ...b,
    start,
    dueAt,
    remainingMs: remaining,
    status,
    reason:
      status === 'OVERDUE'
        ? 'The deadline has passed without a recorded submission.'
        : notInForce
          ? `Running. ${notInForce}`
          : decision
            ? 'Running.'
            : 'Running. Determination pending -- the clock does not wait for it.',
    calculation: calc,
    action: null,
  }
}

/** Statuses in which a deadline is live and demands attention. */
export function isRunning(d: Deadline): boolean {
  return d.status === 'ON_TRACK' || d.status === 'WATCH' || d.status === 'CRITICAL' || d.status === 'OVERDUE'
}

const URGENCY: Record<DeadlineStatus, number> = {
  OVERDUE: 0,
  CRITICAL: 1,
  WATCH: 2,
  ON_TRACK: 3,
  BLOCKED: 4,
  PENDING_START: 5,
  COMPLETED_LATE: 6,
  COMPLETED: 7,
  NOT_APPLICABLE: 8,
}

/** The running deadline due soonest, or null. */
export function nextDeadline(deadlines: Deadline[]): Deadline | null {
  const running = deadlines.filter(isRunning)
  if (running.length === 0) return null
  return running.reduce((best, d) => (ms(d.dueAt!) < ms(best.dueAt!) ? d : best))
}

export function urgencyRank(d: Deadline): number {
  return URGENCY[d.status]
}

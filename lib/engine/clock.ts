import type { ClockEvent, ClockEventType, Iso } from '../../types/domain.ts'
import { diffMs, ms } from './time.ts'

/**
 * The Clock of Record.
 *
 * Five moments that most processes collapse into one:
 *
 *   01 OCCURRENCE  the underlying event happened (first observed exploitation)
 *   02 DETECTION   the organisation first received a signal
 *   03 AWARENESS   an organisation awareness criterion was met
 *   04 DECISION    a reportability decision was recorded
 *   05 SUBMISSION  the early warning was submitted
 *
 * Events are append-only. A correction never edits the event it corrects; it
 * is a new CORRECTION event that points at the original, and the clock uses
 * the latest correction's timestamp while keeping the original visible.
 */

export type RecordedType = Exclude<ClockEventType, 'CORRECTION'>

export interface EffectiveEvent {
  type: RecordedType
  /** The event as first recorded. */
  original: ClockEvent
  /** The record whose timestamp is in force: the original or its latest correction. */
  current: ClockEvent
  occurredAt: Iso
  corrections: ClockEvent[]
}

export type StageId = 'OCCURRENCE' | 'DETECTION' | 'AWARENESS' | 'DECISION' | 'SUBMISSION'

export type StageState = 'recorded' | 'partial' | 'pending' | 'not_applicable'

export interface ClockStage {
  id: StageId
  index: number
  label: string
  state: StageState
  at: Iso | null
  event: EffectiveEvent | null
  /** Elapsed time from the previous stage that has a timestamp. */
  sincePreviousMs: number | null
  previousStageId: StageId | null
  detail: string
}

export interface ClockOfRecord {
  effective: EffectiveEvent[]
  byType: Partial<Record<RecordedType, EffectiveEvent[]>>
  vulnerabilityAwareness: EffectiveEvent | null
  exploitationAwareness: EffectiveEvent | null
  /**
   * Awareness of an actively exploited vulnerability: the exploitation-awareness
   * instant. Knowing the vulnerability is exploited includes knowing the
   * vulnerability, so a vulnerability-awareness record dated later cannot push
   * the clock back.
   */
  awarenessInstant: Iso | null
  stages: ClockStage[]
  /** Index into stages of the first stage that is not yet recorded. */
  activeStageIndex: number | null
  measureAvailable: EffectiveEvent | null
  earlyWarningSubmitted: EffectiveEvent | null
  notificationSubmitted: EffectiveEvent | null
  finalReportSubmitted: EffectiveEvent | null
  corrections: ClockEvent[]
}

const STAGE_LABELS: Record<StageId, string> = {
  OCCURRENCE: 'Occurrence',
  DETECTION: 'Detection',
  AWARENESS: 'Awareness',
  DECISION: 'Decision',
  SUBMISSION: 'Submission',
}

function byRecordedAt(a: ClockEvent, b: ClockEvent): number {
  const d = ms(a.recordedAt) - ms(b.recordedAt)
  return d !== 0 ? d : a.id.localeCompare(b.id)
}

/** Follow a correction's supersedes chain back to the non-correction root. */
function rootOf(event: ClockEvent, index: Map<string, ClockEvent>): ClockEvent | null {
  let cursor: ClockEvent | undefined = event
  const seen = new Set<string>()
  while (cursor && cursor.type === 'CORRECTION') {
    if (seen.has(cursor.id) || !cursor.supersedesId) return null
    seen.add(cursor.id)
    cursor = index.get(cursor.supersedesId)
  }
  return cursor ?? null
}

export function resolveEffectiveEvents(events: ClockEvent[]): EffectiveEvent[] {
  const index = new Map(events.map((e) => [e.id, e]))
  const corrections = new Map<string, ClockEvent[]>()
  for (const e of [...events].sort(byRecordedAt)) {
    if (e.type !== 'CORRECTION') continue
    const root = rootOf(e, index)
    if (!root) continue
    const list = corrections.get(root.id) ?? []
    list.push(e)
    corrections.set(root.id, list)
  }
  const out: EffectiveEvent[] = []
  for (const e of events) {
    if (e.type === 'CORRECTION') continue
    const list = corrections.get(e.id) ?? []
    const current = list.length > 0 ? list[list.length - 1]! : e
    out.push({
      type: e.type,
      original: e,
      current,
      occurredAt: current.occurredAt,
      corrections: list,
    })
  }
  return out.sort((a, b) => ms(a.occurredAt) - ms(b.occurredAt) || a.original.id.localeCompare(b.original.id))
}

function earliest(list: EffectiveEvent[] | undefined): EffectiveEvent | null {
  if (!list || list.length === 0) return null
  return list.reduce((best, e) => (ms(e.occurredAt) < ms(best.occurredAt) ? e : best))
}

function latestRecorded(list: EffectiveEvent[] | undefined): EffectiveEvent | null {
  if (!list || list.length === 0) return null
  return list.reduce((best, e) => (ms(e.original.recordedAt) > ms(best.original.recordedAt) ? e : best))
}

export interface ClockContext {
  /** The recorded decision outcome, if any, for stage applicability. */
  decisionOutcome: 'REPORT' | 'DO_NOT_REPORT' | null
}

export function buildClock(events: ClockEvent[], context: ClockContext): ClockOfRecord {
  const effective = resolveEffectiveEvents(events)
  const byType: Partial<Record<RecordedType, EffectiveEvent[]>> = {}
  for (const e of effective) {
    const list = byType[e.type] ?? []
    list.push(e)
    byType[e.type] = list
  }

  const occurrence = earliest(byType.OCCURRENCE)
  const detection = earliest(byType.DETECTION)
  const va = earliest(byType.VULNERABILITY_AWARENESS)
  const ea = earliest(byType.EXPLOITATION_AWARENESS)
  const decision = latestRecorded(byType.DECISION)
  const firstDecision = earliest(byType.DECISION)
  const ew = earliest(byType.EARLY_WARNING_SUBMITTED)

  // Exploitation awareness implies awareness of the vulnerability, so it is the
  // awareness instant whether or not a separate vulnerability-awareness event
  // exists, and whatever that event says.
  const awarenessInstant = ea ? ea.occurredAt : null

  const stages: ClockStage[] = []

  stages.push({
    id: 'OCCURRENCE',
    index: 1,
    label: STAGE_LABELS.OCCURRENCE,
    state: occurrence ? 'recorded' : 'pending',
    at: occurrence?.occurredAt ?? null,
    event: occurrence,
    sincePreviousMs: null,
    previousStageId: null,
    detail: occurrence
      ? 'Earliest known time of the underlying event.'
      : 'No occurrence time recorded. Occurrence is often learned late, from an advisory or forensics.',
  })

  stages.push({
    id: 'DETECTION',
    index: 2,
    label: STAGE_LABELS.DETECTION,
    state: detection ? 'recorded' : 'pending',
    at: detection?.occurredAt ?? null,
    event: detection,
    sincePreviousMs: null,
    previousStageId: null,
    detail: detection
      ? 'First signal received by the organisation. Detection starts the investigation, not the reporting clock.'
      : 'No detection signal recorded.',
  })

  let awarenessState: StageState = 'pending'
  let awarenessDetail = 'No awareness criterion has been met.'
  let awarenessEvent: EffectiveEvent | null = null
  if (ea) {
    awarenessState = 'recorded'
    awarenessEvent = ea
    awarenessDetail = !va
      ? 'Exploitation awareness recorded without a separate vulnerability-awareness event.'
      : ms(va.occurredAt) > ms(ea.occurredAt)
        ? 'Exploitation awareness is dated before vulnerability awareness. The clock runs from exploitation awareness; the record contradicts itself and needs correcting.'
        : 'Awareness of an actively exploited vulnerability: exploitation awareness, which follows vulnerability awareness.'
  } else if (va) {
    awarenessState = 'partial'
    awarenessEvent = va
    awarenessDetail =
      'Vulnerability awareness established. Exploitation awareness is not established, so no Article 14(1) clock is running.'
  }
  stages.push({
    id: 'AWARENESS',
    index: 3,
    label: STAGE_LABELS.AWARENESS,
    state: awarenessState,
    at: awarenessInstant ?? (awarenessState === 'partial' ? (va?.occurredAt ?? null) : null),
    event: awarenessEvent,
    sincePreviousMs: null,
    previousStageId: null,
    detail: awarenessDetail,
  })

  stages.push({
    id: 'DECISION',
    index: 4,
    label: STAGE_LABELS.DECISION,
    state: decision ? 'recorded' : 'pending',
    at: decision?.occurredAt ?? null,
    event: decision,
    sincePreviousMs: null,
    previousStageId: null,
    detail: decision
      ? firstDecision && firstDecision.original.id !== decision.original.id
        ? 'Current reportability decision. Earlier decisions remain on the record.'
        : 'Reportability decision recorded by NEXUS at the moment it was made.'
      : 'No reportability decision recorded.',
  })

  const submissionNa = context.decisionOutcome === 'DO_NOT_REPORT' && !ew
  stages.push({
    id: 'SUBMISSION',
    index: 5,
    label: STAGE_LABELS.SUBMISSION,
    state: ew ? 'recorded' : submissionNa ? 'not_applicable' : 'pending',
    at: ew?.occurredAt ?? null,
    event: ew,
    sincePreviousMs: null,
    previousStageId: null,
    detail: ew
      ? 'Early warning submitted (simulated submission).'
      : submissionNa
        ? 'Not applicable: the recorded decision is that reporting is not required.'
        : 'Pending.',
  })

  // Elapsed time from the previous stage that carries a timestamp.
  let prev: ClockStage | null = null
  for (const s of stages) {
    if (s.at && prev?.at) {
      s.sincePreviousMs = diffMs(s.at, prev.at)
      s.previousStageId = prev.id
    }
    if (s.at && s.state !== 'not_applicable') prev = s
  }

  // The active stage is the one the case is waiting on: a partial awareness,
  // or the first pending stage after the last recorded one. An occurrence
  // time learned late does not make OCCURRENCE the stage being waited on.
  let lastDone = -1
  stages.forEach((s, i) => {
    if (s.state === 'recorded' || s.state === 'partial') lastDone = i
  })
  const activeIdx =
    lastDone >= 0 && stages[lastDone]!.state === 'partial'
      ? lastDone
      : stages.findIndex((s, i) => i > lastDone && s.state === 'pending')

  return {
    effective,
    byType,
    vulnerabilityAwareness: va,
    exploitationAwareness: ea,
    awarenessInstant,
    stages,
    activeStageIndex: activeIdx === -1 ? null : activeIdx,
    measureAvailable: earliest(byType.MEASURE_AVAILABLE),
    earlyWarningSubmitted: ew,
    notificationSubmitted: earliest(byType.NOTIFICATION_SUBMITTED),
    finalReportSubmitted: earliest(byType.FINAL_REPORT_SUBMITTED),
    corrections: events.filter((e) => e.type === 'CORRECTION'),
  }
}

import { ATTENTION_THRESHOLDS } from '../../rules/cra-article14.ts'
import type { Deadline, DeadlineStatus } from '../engine/deadlines.ts'

/**
 * Deadlines arrive with the status computed at fetch time. Between fetches
 * a CRITICAL threshold can be crossed, so the running statuses are
 * recomputed against the ticking clock with the same thresholds the server
 * uses. Nothing else about the deadline is recomputed here.
 */
export function live(d: Deadline, now: number): Deadline {
  if (!d.dueAt) return d
  if (d.status !== 'ON_TRACK' && d.status !== 'WATCH' && d.status !== 'CRITICAL' && d.status !== 'OVERDUE') return d
  const remainingMs = Date.parse(d.dueAt) - now
  const t = ATTENTION_THRESHOLDS[d.kind]
  const status: DeadlineStatus = remainingMs < 0 ? 'OVERDUE' : remainingMs <= t.critical ? 'CRITICAL' : remainingMs <= t.watch ? 'WATCH' : 'ON_TRACK'
  return { ...d, remainingMs, status }
}

export function isLive(d: Deadline): boolean {
  return d.status === 'ON_TRACK' || d.status === 'WATCH' || d.status === 'CRITICAL' || d.status === 'OVERDUE'
}

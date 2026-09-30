import { useSyncExternalStore } from 'react'

/**
 * One shared ticker for every countdown on screen. Components subscribe to
 * the second, so twenty countdowns cost one interval. The server's "now" is
 * the reference: the offset between it and the browser clock is measured
 * once per response and applied here, so a skewed laptop clock does not
 * misstate a deadline.
 */

let offsetMs = 0
let current = Date.now()
const subs = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

function tick() {
  current = Date.now() + offsetMs
  for (const fn of subs) fn()
}

function subscribe(fn: () => void) {
  subs.add(fn)
  if (!timer) timer = setInterval(tick, 1000)
  return () => {
    subs.delete(fn)
    if (subs.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

export function syncServerTime(serverIso: string): void {
  const server = Date.parse(serverIso)
  if (Number.isNaN(server)) return
  offsetMs = server - Date.now()
  current = Date.now() + offsetMs
}

export function nowMs(): number {
  return Date.now() + offsetMs
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, () => current, () => current)
}

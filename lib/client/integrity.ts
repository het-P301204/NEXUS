import { useEffect, useState } from 'react'
import type { ClockEvent } from '../../types/domain.ts'
import { canonicalJson, webCryptoSha256 } from '../engine/ledger.ts'

/**
 * Recompute each clock event's integrity hash in the browser: SHA-256 over
 * the canonical JSON of the record without its hash field -- the same
 * computation the server made when it wrote the record. A match here is
 * verified by this browser, not asserted by the server.
 */
export type IntegrityState = 'checking' | 'verified' | 'mismatch' | 'unavailable'

export async function eventIntegrity(e: ClockEvent): Promise<boolean> {
  const { integrityHash, ...rest } = e
  return (await webCryptoSha256(canonicalJson(rest))) === integrityHash
}

export function useEventIntegrity(events: ClockEvent[]): Record<string, IntegrityState> {
  const [state, setState] = useState<Record<string, IntegrityState>>({})
  const key = events.map((e) => `${e.id}:${e.integrityHash}`).join('|')
  useEffect(() => {
    let cancelled = false
    if (!globalThis.crypto?.subtle) {
      setState(Object.fromEntries(events.map((e) => [e.id, 'unavailable' as const])))
      return
    }
    void Promise.all(events.map(async (e) => [e.id, (await eventIntegrity(e)) ? 'verified' : 'mismatch'] as const)).then((pairs) => {
      if (!cancelled) setState(Object.fromEntries(pairs))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state
}

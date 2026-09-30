import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { FlaskConical, RotateCcw } from 'lucide-react'
import type { ClockEvent } from '../../types/domain.ts'
import type { CaseBundle } from '../../lib/engine/bundle.ts'
import { analyzeCase } from '../../lib/engine/analyze.ts'
import { formatDuration } from '../../lib/engine/time.ts'
import { displayZone, fromLocalInput, stamp, toLocalInput } from '../../lib/client/format.ts'
import { nowMs } from '../../lib/client/useNow.ts'
import { Button, TextInput, cx } from '../ui/primitives.tsx'
import { DeadlineBadge } from '../ui/status.tsx'

/**
 * The what-if clock simulator. It re-runs the same engine the server runs,
 * in the browser, over a copy of the case's events with hypothetical
 * timestamps substituted. Nothing is sent to the server and nothing is
 * recorded: the case record cannot be changed from here.
 */

type Key = 'VULNERABILITY_AWARENESS' | 'EXPLOITATION_AWARENESS' | 'MEASURE_AVAILABLE'

const LABELS: Record<Key, string> = {
  VULNERABILITY_AWARENESS: 'Vulnerability awareness',
  EXPLOITATION_AWARENESS: 'Exploitation awareness',
  MEASURE_AVAILABLE: 'Measure available',
}

function effectiveTime(events: ClockEvent[], type: Key): string | null {
  const root = events.find((e) => e.type === type)
  if (!root) return null
  const corrections = events.filter((e) => e.type === 'CORRECTION').sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
  let at = root.occurredAt
  let cursor = root.id
  for (const c of corrections) {
    if (c.supersedesId === cursor || c.supersedesId === root.id) {
      at = c.occurredAt
      cursor = c.id
    }
  }
  return at
}

function substitute(events: ClockEvent[], type: Key, at: string | null, caseId: string): ClockEvent[] {
  const root = events.find((e) => e.type === type)
  if (at === null) {
    if (!root) return events
    const drop = new Set([root.id])
    for (const e of events) if (e.type === 'CORRECTION' && e.supersedesId && drop.has(e.supersedesId)) drop.add(e.id)
    return events.filter((e) => !drop.has(e.id))
  }
  const synthetic: ClockEvent = {
    id: `SIM-${type}`,
    caseId,
    type: root ? 'CORRECTION' : type,
    occurredAt: at,
    timezone: 'UTC',
    actorId: 'simulation',
    source: 'What-if simulation',
    sourceKind: 'analyst_attestation',
    evidenceIds: [],
    criterionId: root?.criterionId ?? null,
    responsibleRole: null,
    supersedesId: root ? root.id : null,
    correctionReason: root ? 'simulation' : null,
    decisionId: null,
    reportId: null,
    note: '',
    recordedAt: '9999-12-31T00:00:00.000Z',
    integrityHash: '',
  }
  return [...events, synthetic]
}

export function WhatIf({ bundle }: { bundle: CaseBundle }) {
  const tz = displayZone()
  const keysList: Key[] = ['VULNERABILITY_AWARENESS', 'EXPLOITATION_AWARENESS', 'MEASURE_AVAILABLE']
  const original = useMemo(() => Object.fromEntries(keysList.map((k) => [k, effectiveTime(bundle.events, k)])) as Record<Key, string | null>, [bundle.events]) // eslint-disable-line react-hooks/exhaustive-deps
  const [values, setValues] = useState<Record<Key, string>>(() => Object.fromEntries(keysList.map((k) => [k, original[k] ? toLocalInput(original[k]!, tz) : ''])) as Record<Key, string>)
  const now = new Date(nowMs()).toISOString()

  const actual = useMemo(() => analyzeCase(bundle, now), [bundle, now])
  const simulated = useMemo(() => {
    let events = bundle.events
    for (const k of keysList) {
      const v = values[k] ? fromLocalInput(values[k], tz) : null
      if (v !== original[k]) events = substitute(events, k, v, bundle.case.id)
    }
    return analyzeCase({ ...bundle, events }, now)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, values, now, original])

  const setAt = (k: Key, hour: number) => {
    const today = toLocalInput(now, tz).slice(0, 10)
    setValues((v) => ({ ...v, [k]: `${today}T${String(hour).padStart(2, '0')}:00` }))
  }
  const reset = () => setValues(Object.fromEntries(keysList.map((k) => [k, original[k] ? toLocalInput(original[k]!, tz) : ''])) as Record<Key, string>)
  const changed = keysList.some((k) => (values[k] ? fromLocalInput(values[k], tz) : null) !== original[k])

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex items-start gap-3 rounded-lg border border-dashed border-violet-line bg-violet/[0.044] px-4 py-3">
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-violet" />
        <div>
          <div className="micro text-violet">Simulation: does not modify case record</div>
          <p className="mt-1 text-xs text-ink-2">The engine runs in this browser over a copy of {bundle.case.id}'s events. Nothing is sent or recorded.</p>
        </div>
      </div>

      <div className="space-y-4">
        {keysList.map((k) => (
          <div key={k} className="min-w-0">
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
              <label htmlFor={`whatif-${k}`} className="text-xs font-medium text-ink-2">
                What if {LABELS[k].toLowerCase()} occurred at
              </label>
              <span className="mono text-[11px] text-ink-4">record: {original[k] ? stamp(original[k]!) : 'not recorded'}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <TextInput id={`whatif-${k}`} type="datetime-local" step={1} value={values[k]} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} className="w-auto min-w-[220px] flex-1" />
              {k !== 'MEASURE_AVAILABLE' &&
                [10, 12, 18].map((h) => (
                  <button key={h} type="button" onClick={() => setAt(k, h)} className="mono h-9 rounded-md border border-line-strong px-2.5 text-xs text-ink-2 hover:border-line-bright hover:text-ink">
                    {h}:00
                  </button>
                ))}
              <button type="button" onClick={() => setValues((v) => ({ ...v, [k]: '' }))} className="h-9 rounded-md px-2 text-xs text-ink-3 hover:text-ink">
                clear
              </button>
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <span className="text-xs text-ink-3">Times are in {tz}. Presets set today's date.</span>
          <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={reset} disabled={!changed}>
            Reset to record
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { label: 'Record', a: actual },
          { label: 'Simulation', a: simulated },
        ].map((col) => (
          <div key={col.label} className={cx('rounded-lg border px-4 py-3', col.label === 'Simulation' ? 'border-violet-line' : 'border-line')}>
            <div className={cx('micro', col.label === 'Simulation' && 'text-violet')}>{col.label}</div>
            <div className="mt-1.5 text-sm text-ink">{col.a.transitional.trace.result}</div>
            <div className="mt-0.5 text-xs text-ink-3">Suggested: {col.a.suggestion.outcome.replace(/_/g, ' ').toLowerCase()}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="micro py-2 pr-3 font-normal">Deadline</th>
              <th className="micro py-2 pr-3 font-normal">Record</th>
              <th className="micro py-2 pr-3 font-normal text-violet">Simulation</th>
              <th className="micro py-2 font-normal">Change</th>
            </tr>
          </thead>
          <tbody>
            {actual.deadlines.map((d, i) => {
              const s = simulated.deadlines[i]!
              const delta = d.dueAt && s.dueAt ? Date.parse(s.dueAt) - Date.parse(d.dueAt) : null
              return (
                <motion.tr key={d.kind} layout className="border-b border-line align-top last:border-0">
                  <td className="py-3 pr-3 text-xs text-ink">{d.label}</td>
                  <td className="py-3 pr-3">
                    <div className="mono text-xs text-ink-2">{d.dueAt ? stamp(d.dueAt) : '--'}</div>
                    <div className="mt-1">
                      <DeadlineBadge status={d.status} size="sm" />
                    </div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="mono text-xs text-ink">{s.dueAt ? stamp(s.dueAt) : '--'}</div>
                    <div className="mt-1">
                      <DeadlineBadge status={s.status} size="sm" />
                    </div>
                  </td>
                  <td className="mono py-3 text-xs">
                    {delta === null ? (d.status !== s.status ? <span className="text-amber">state changes</span> : <span className="text-ink-4">--</span>) : delta === 0 ? <span className="text-ink-4">none</span> : <span className={delta < 0 ? 'text-red' : 'text-green'}>{delta < 0 ? '−' : '+'}{formatDuration(Math.abs(delta), { seconds: false })}</span>}
                  </td>
                </motion.tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {simulated.transitional.nearBoundary && <p className="text-xs text-amber">The simulated trigger falls within 24 hours of the 11 September 2026 boundary; its interpretation decides the outcome.</p>}
    </div>
  )
}

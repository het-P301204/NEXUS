import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AlertTriangle, CircleDashed, CircleHelp, CircleSlash, FlaskConical, Timer } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { HOUR_MS, RULE_IDS, RULE_SET } from '../../rules/cra-article14.ts'
import { evaluateTransitional } from '../../lib/engine/transitional.ts'
import type { Applicability, Side, TransitionalEvaluation } from '../../lib/engine/transitional.ts'
import { addMs, formatDuration, ms } from '../../lib/engine/time.ts'
import { fromLocalInput, stamp } from '../../lib/client/format.ts'
import { Button, Field, Panel, TextInput, cx } from '../ui/primitives.tsx'
import { Badge, TONE_TEXT } from '../ui/status.tsx'
import type { Tone } from '../ui/status.tsx'
import { dash } from './RuleList.tsx'

/**
 * A sandbox for the two-date transitional rule. It runs the same engine
 * function that evaluates real cases, on instants typed here, and writes
 * nothing: no case, no clock event, no ledger entry.
 */

const ZONE = 'Europe/Berlin'
const DAY = 24 * HOUR_MS
const SCALE_WINDOW = 14 * DAY
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]

const PRESETS = [
  { id: 'pre', label: 'Both before 11 Sep', va: '2026-09-02T14:10', ea: '2026-09-06T09:30' },
  { id: 'split', label: 'Vulnerability before, exploitation after', va: '2026-09-03T13:00', ea: '2026-09-27T10:00' },
  { id: 'near', label: 'Near the boundary', va: '2026-09-10T20:00', ea: '2026-09-11T01:30' },
] as const

const RESULT: Record<Applicability, { label: string; tone: Tone; icon: LucideIcon; summary: string }> = {
  APPLICABLE: { label: 'Applicable', tone: 'amber', icon: Timer, summary: 'Article 14 obligations attach. The reporting clocks start at the trigger instant.' },
  NOT_APPLICABLE_PRE_APPLICATION: { label: 'Not applicable', tone: 'neutral', icon: CircleSlash, summary: 'Both awareness instants precede the application instant. No Article 14 obligation attaches.' },
  NO_EXPLOITATION_AWARENESS: { label: 'No exploitation awareness', tone: 'blue', icon: CircleDashed, summary: 'No reporting clock exists until exploitation awareness is recorded.' },
  INDETERMINATE: { label: 'Indeterminate', tone: 'dim', icon: CircleHelp, summary: 'No awareness instant has been entered, so applicability cannot be evaluated.' },
}

const SIDE_LABEL: Record<Exclude<Side, 'unknown'>, string> = {
  pre: 'Pre-11 September 2026',
  post: 'Post-11 September 2026',
}

/** An amber warning at the soft tint the tokens define: icon, title and words, never colour alone. */
function Warning({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="note" className="flex min-w-0 items-start gap-2.5 rounded-lg border border-amber-line bg-amber-soft px-4 py-3">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="micro mb-1 text-amber">{title}</div>
        <div className="text-sm text-ink-2">{children}</div>
      </div>
    </div>
  )
}

function relation(at: string, boundary: string): string {
  const d = ms(at) - ms(boundary)
  if (d === 0) return 'Exactly at the boundary'
  return `${formatDuration(Math.abs(d), { seconds: false })} ${d < 0 ? 'before' : 'after'} the boundary`
}

// Boundary scale -------------------------------------------------------------------------

function BoundaryScale({ at, side, boundary }: { at: string | null; side: Side; boundary: string }) {
  const d = at ? ms(at) - ms(boundary) : null
  const pos = d === null ? null : 50 + Math.max(-1, Math.min(1, d / SCALE_WINDOW)) * 46
  const clamped = d !== null && Math.abs(d) > SCALE_WINDOW
  return (
    <div className="mt-4" aria-hidden>
      <div className="relative h-5">
        <div className={cx('absolute inset-x-0 top-1/2 h-px', at ? 'bg-line-strong' : 'border-t border-dashed border-line-strong bg-transparent')} />
        <div className="absolute left-1/2 top-0 h-full w-px bg-ink-3" />
        {pos !== null && (
          <motion.span
            className={cx('absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-[3px] ring-s1', side === 'post' ? 'bg-amber' : 'bg-ink-2')}
            initial={false}
            animate={{ left: `${pos}%` }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          />
        )}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-3">
        <span>{clamped && d !== null && d < 0 ? '≤ −14d' : '−14d'}</span>
        <span>11 Sep 00:00</span>
        <span>{clamped && d !== null && d > 0 ? '≥ +14d' : '+14d'}</span>
      </div>
    </div>
  )
}

function SideColumn({ title, at, side, boundary, empty }: { title: string; at: string | null; side: Side; boundary: string; empty: string }) {
  return (
    <div className="min-w-0">
      <div className="micro">{title}</div>
      <div className="mt-2.5">
        {side === 'unknown' ? (
          <Badge tone="dim" size="sm">
            Not recorded
          </Badge>
        ) : (
          <Badge tone={side === 'post' ? 'amber' : 'neutral'} size="sm">
            {SIDE_LABEL[side]}
          </Badge>
        )}
      </div>
      {at ? (
        <>
          <div className="mono mt-3 text-sm text-ink">{stamp(at, ZONE)}</div>
          <div className="ident mt-0.5 text-[11px] text-ink-3">{at}</div>
        </>
      ) : (
        <p className="mt-3 text-sm text-ink-3">{empty}</p>
      )}
      <BoundaryScale at={at} side={side} boundary={boundary} />
      {at && <p className="mono mt-2 text-xs text-ink-2">{relation(at, boundary)}</p>}
    </div>
  )
}

// Rule trace ------------------------------------------------------------------------------

type StepState = 'pass' | 'fail' | 'pending' | 'info'

interface Step {
  key: string
  label: string
  ruleId?: string
  state: StepState
  word: string
  body: ReactNode
}

const STEP_STYLE: Record<StepState, { ring: string; dot: string; text: string }> = {
  pass: { ring: 'border-green', dot: 'bg-green', text: 'text-green' },
  fail: { ring: 'border-red', dot: 'bg-red', text: 'text-red' },
  pending: { ring: 'border-amber border-dashed', dot: 'bg-transparent', text: 'text-amber' },
  info: { ring: 'border-ink-3', dot: 'bg-ink-3', text: 'text-ink-3' },
}

function TraceFlow({ steps }: { steps: Step[] }) {
  return (
    <ol className="relative min-w-0" aria-label="Rule trace">
      {steps.map((s, i) => {
        const st = STEP_STYLE[s.state]
        return (
          <motion.li
            key={s.key}
            className="relative flex min-w-0 gap-4 pb-6 last:pb-0"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.3, ease: EASE }}
          >
            {i < steps.length - 1 && <span className="absolute bottom-0 left-[7.5px] top-[22px] w-px bg-line-strong" aria-hidden />}
            <span className={cx('relative z-10 mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 bg-s1 transition-colors duration-200', st.ring)} aria-hidden>
              <span className={cx('h-1.5 w-1.5 rounded-full transition-colors duration-200', st.dot)} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-baseline justify-between gap-3">
                <span className="micro text-ink-2">{s.label}</span>
                <span className={cx('micro shrink-0', st.text)}>{s.word}</span>
              </div>
              {s.ruleId && <div className="ident mt-0.5 text-[11px] text-ink-3">{s.ruleId}</div>}
              <div className="mt-1.5 min-w-0 text-sm text-ink-2">{s.body}</div>
            </div>
          </motion.li>
        )
      })}
    </ol>
  )
}

function buildSteps(ev: TransitionalEvaluation): Step[] {
  const boundary = ev.applicationInstant
  const va = ev.vulnerabilityAwareAt
  const ea = ev.exploitationAwareAt
  const trigger = ev.triggerInstant
  const sideText = (s: Side) => (s === 'unknown' ? '' : SIDE_LABEL[s])

  const steps: Step[] = [
    {
      key: 'input',
      label: 'Input',
      state: 'info',
      word: 'Input',
      body: (
        <>
          Two awareness instants, entered as {ZONE} wall-clock time and compared in UTC with <span className="ident text-ink">{boundary}</span>.
        </>
      ),
    },
    {
      key: 'va',
      label: 'Vulnerability awareness',
      state: va ? 'pass' : ea ? 'info' : 'pending',
      word: va ? 'Recorded' : ea ? 'Implied' : 'Missing',
      body: va ? (
        <>
          <span className="mono text-ink">{stamp(va, ZONE)}</span>
          <span className="block text-xs text-ink-3">{sideText(ev.vulnerabilitySide)}</span>
        </>
      ) : ea ? (
        'Not entered. Exploitation awareness implies awareness of the vulnerability, so it is used on its own.'
      ) : (
        'Not entered.'
      ),
    },
    {
      key: 'ea',
      label: 'Exploitation awareness',
      state: ea ? 'pass' : 'pending',
      word: ea ? 'Recorded' : 'Not established',
      body: ea ? (
        <>
          <span className="mono text-ink">{stamp(ea, ZONE)}</span>
          <span className="block text-xs text-ink-3">{sideText(ev.exploitationSide)}</span>
        </>
      ) : (
        'Not established. Article 14(1) concerns actively exploited vulnerabilities, so no reporting clock exists yet.'
      ),
    },
    {
      key: 'eff',
      label: ev.trace.label,
      ruleId: `${ev.trace.ruleId} · rule set ${RULE_SET.version}`,
      state: ev.trace.state,
      word: ev.trace.state === 'pass' ? 'Pass' : ev.trace.state === 'fail' ? 'Fail' : ev.trace.state === 'pending' ? 'Pending' : 'Info',
      body: (
        <>
          {trigger ? (
            <span className="block">
              Trigger <span className="mono text-ink">{stamp(trigger, ZONE)}</span> is {ms(trigger) < ms(boundary) ? 'before' : 'on or after'} the application instant.
            </span>
          ) : (
            <span className="block">No trigger instant to compare.</span>
          )}
          <span className="mt-1 block text-xs text-ink-3">{dash(ev.trace.result)}</span>
          {ev.nearBoundary && (
            <span className="mt-2 flex items-start gap-1.5 text-xs text-amber">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              Within 24 hours of the boundary: counsel review.
            </span>
          )}
        </>
      ),
    },
    {
      key: 'app',
      label: 'Applicability',
      state: ev.result === 'APPLICABLE' ? 'pass' : ev.result === 'NOT_APPLICABLE_PRE_APPLICATION' ? 'fail' : 'pending',
      word: RESULT[ev.result].label,
      body: RESULT[ev.result].summary,
    },
  ]

  if (ev.result === 'APPLICABLE' && trigger) {
    steps.push({
      key: 'deadlines',
      label: 'Deadline calculation',
      ruleId: `${RULE_IDS.earlyWarning} · ${RULE_IDS.notification}`,
      state: 'pass',
      word: 'Computed',
      body: (
        <dl className="mt-1 space-y-2.5">
          <div>
            <dt className="text-xs text-ink-3">
              Early warning = trigger <span className="text-amber/80">+</span> 24h
            </dt>
            <dd className="mono text-sm text-ink">{stamp(addMs(trigger, 24 * HOUR_MS), ZONE)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">
              Notification = trigger <span className="text-amber/80">+</span> 72h
            </dt>
            <dd className="mono text-sm text-ink">{stamp(addMs(trigger, 72 * HOUR_MS), ZONE)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">Final report</dt>
            <dd className="text-xs text-ink-3">Starts when a corrective or mitigating measure is available, then runs 14 days.</dd>
          </div>
        </dl>
      ),
    })
  } else {
    steps.push({
      key: 'deadlines',
      label: 'Deadline calculation',
      ruleId: `${RULE_IDS.earlyWarning} · ${RULE_IDS.notification}`,
      state: ev.result === 'NOT_APPLICABLE_PRE_APPLICATION' ? 'fail' : 'pending',
      word: ev.result === 'NOT_APPLICABLE_PRE_APPLICATION' ? 'None due' : 'Not started',
      body: ev.result === 'NOT_APPLICABLE_PRE_APPLICATION' ? 'No Article 14 deadline is computed for this awareness.' : 'No deadline is computed until exploitation awareness is recorded.',
    })
  }
  return steps
}

// Explorer ---------------------------------------------------------------------------------

export function TransitionalExplorer({ serverVersion }: { serverVersion?: string }) {
  const [va, setVa] = useState<string>(PRESETS[1].va)
  const [ea, setEa] = useState<string>(PRESETS[1].ea)

  const vaIso = va ? fromLocalInput(va, ZONE) : null
  const eaIso = ea ? fromLocalInput(ea, ZONE) : null
  const ev = useMemo(() => evaluateTransitional(vaIso, eaIso, RULE_SET.applicationInstant), [vaIso, eaIso])
  const steps = buildSteps(ev)
  const result = RESULT[ev.result]
  const ResultIcon = result.icon
  const boundary = ev.applicationInstant
  const transitionalRule = RULE_SET.rules.find((r) => r.id === RULE_IDS.transitional)
  const triggerSource =
    ev.triggerInstant === null
      ? null
      : eaIso && vaIso && eaIso === vaIso
        ? 'Both instants are equal'
        : ev.triggerInstant === eaIso
          ? 'Exploitation awareness is the later instant'
          : 'Vulnerability awareness is the later instant'

  return (
    <Panel as="section" className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 pt-5 sm:px-6">
        <div className="min-w-0 max-w-2xl">
          <div className="micro mb-1.5">
            Sandbox · {RULE_IDS.transitional}
            {transitionalRule ? ` v${transitionalRule.version}` : ''}
          </div>
          <h2 className="text-lg font-medium text-ink">Transitional rule explorer</h2>
          <p className="mt-1.5 text-sm text-ink-3">
            Evaluate the two-date rule for any pair of awareness instants. This runs the same engine function that evaluates cases. Nothing entered here is saved, and nothing is written to the ledger.
          </p>
        </div>
        {/* Not a Badge: the label must stay whole at phone width, so it wraps instead of truncating. */}
        <span className="inline-flex max-w-full items-start gap-1.5 rounded-md border border-blue-line bg-blue-soft px-2.5 py-1 font-mono text-[10.5px] uppercase leading-4 tracking-[0.1em] text-blue">
          <FlaskConical className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden strokeWidth={2} />
          <span className="min-w-0">Simulation: does not modify any case</span>
        </span>
      </div>

      {serverVersion && serverVersion !== RULE_SET.version && (
        <div className="px-5 pt-4 sm:px-6">
          <Warning title="Rule-set version differs">
            The server publishes rule set <span className="mono">{serverVersion}</span>; this page evaluates with <span className="mono">{RULE_SET.version}</span>. Reload to evaluate with the published version.
          </Warning>
        </div>
      )}

      <div className="mt-5 flex min-w-0 flex-wrap items-center gap-2 px-5 sm:px-6" role="group" aria-label="Presets">
        <span className="micro mr-1 w-full sm:w-auto">Presets</span>
        {PRESETS.map((p) => {
          const active = va === p.va && ea === p.ea
          return (
            <Button
              key={p.id}
              size="sm"
              variant="secondary"
              aria-pressed={active}
              onClick={() => {
                setVa(p.va)
                setEa(p.ea)
              }}
              className={cx('max-w-full whitespace-normal text-left', active && 'border-amber-line bg-amber-soft text-ink hover:border-amber-line hover:bg-amber-soft')}
            >
              {p.label}
            </Button>
          )
        })}
      </div>

      <div className="mt-6 grid min-w-0 border-t border-line lg:grid-cols-[minmax(0,1fr)_minmax(0,21rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="min-w-0 space-y-7 px-5 py-6 sm:px-6">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <Field label="Vulnerability awareness" hint={`Wall-clock time, ${ZONE}.`}>
              {(id) => <TextInput id={id} type="datetime-local" value={va} onChange={(e) => setVa(e.target.value)} className="mono" />}
            </Field>
            <Field label="Exploitation awareness" hint="Optional. Leave empty if exploitation has not been established.">
              {(id) => (
                <div className="flex min-w-0 gap-2">
                  <TextInput id={id} type="datetime-local" value={ea} onChange={(e) => setEa(e.target.value)} className="mono" />
                  <Button variant="ghost" onClick={() => setEa('')} disabled={!ea} aria-label="Clear exploitation awareness">
                    Clear
                  </Button>
                </div>
              )}
            </Field>
          </div>

          <div className="grid min-w-0 gap-6 border-t border-line pt-6 sm:grid-cols-2 sm:gap-0 sm:divide-x sm:divide-line">
            <div className="min-w-0 sm:pr-6">
              <SideColumn title="Vulnerability awareness" at={vaIso} side={ev.vulnerabilitySide} boundary={boundary} empty="Not entered." />
            </div>
            <div className="min-w-0 border-t border-line pt-6 sm:border-t-0 sm:pl-6 sm:pt-0">
              <SideColumn title="Exploitation awareness" at={eaIso} side={ev.exploitationSide} boundary={boundary} empty="Not established. No reporting clock exists until it is." />
            </div>
          </div>

          <div className="border-t border-line pt-6">
            <div className="micro">Trigger instant · the later of the two</div>
            {ev.triggerInstant ? (
              <div className="mt-2.5 min-w-0">
                <div className="mono text-lg text-ink">{stamp(ev.triggerInstant, ZONE)}</div>
                <div className="ident mt-0.5 text-[11px] text-ink-3">{ev.triggerInstant}</div>
                {triggerSource && <p className="mt-1.5 text-xs text-ink-3">{triggerSource}.</p>}
              </div>
            ) : (
              <p className="mt-2.5 text-sm text-ink-3">No trigger instant. Applicability turns on exploitation awareness, and none has been entered.</p>
            )}
          </div>

          <div className="border-t border-line pt-6" aria-live="polite">
            <div className="micro">Applicability</div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={ev.result} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18, ease: EASE }} className="mt-3 min-w-0">
                <div className={cx('flex min-w-0 items-start gap-3', TONE_TEXT[result.tone])}>
                  <ResultIcon className="mt-1 h-6 w-6 shrink-0 sm:mt-1.5 sm:h-7 sm:w-7" aria-hidden strokeWidth={1.75} />
                  <span className="min-w-0 font-mono text-2xl font-medium uppercase leading-tight tracking-[0.02em] sm:text-3xl">{result.label}</span>
                </div>
                <p className="mt-2 text-sm text-ink-2">{result.summary}</p>
              </motion.div>
            </AnimatePresence>
          </div>

          {ev.nearBoundary && ev.triggerInstant && (
            <Warning title="Near the application boundary">
              The trigger instant is {relation(ev.triggerInstant, boundary).toLowerCase()} at <span className="mono">{stamp(boundary, ZONE)}</span>. How the boundary instant is interpreted changes the outcome. Counsel review recommended.
            </Warning>
          )}

          <div>
            <div className="micro mb-2">Reasoning</div>
            <ol className="border-t border-line">
              {ev.reasoning.map((r, i) => (
                <li key={`${ev.result}-${i}`} className="grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)] gap-x-2 border-b border-line py-2.5 text-sm text-ink-2">
                  <span className="mono pt-px text-[11px] text-ink-3">{String(i + 1).padStart(2, '0')}</span>
                  <span className="min-w-0">{dash(r)}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="min-w-0 border-t border-line bg-s2/40 px-5 py-6 sm:px-6 lg:rounded-br-xl lg:border-l lg:border-t-0">
          <div className="micro mb-5">Rule trace</div>
          <TraceFlow steps={steps} />
        </div>
      </div>
    </Panel>
  )
}

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { CheckCircle2, FlaskConical, Loader2, PencilLine, Plus, Radio, ShieldAlert, XCircle } from 'lucide-react'
import type { ClockEvent, TimestampSourceKind } from '../../../types/domain.ts'
import type { StageId } from '../../../lib/engine/clock.ts'
import { diffMs, formatDuration } from '../../../lib/engine/time.ts'
import { useSession } from '../../../lib/client/session.tsx'
import { useEventIntegrity } from '../../../lib/client/integrity.ts'
import type { IntegrityState } from '../../../lib/client/integrity.ts'
import { stamp } from '../../../lib/client/format.ts'
import { ClockRail } from '../../../components/clock/ClockRail.tsx'
import { DeadlineTrack, WhyDeadline } from '../../../components/clock/Deadlines.tsx'
import { WhatIf } from '../../../components/clock/WhatIf.tsx'
import { Button, Hash, Ident, KeyValue, cx } from '../../../components/ui/primitives.tsx'
import { Badge } from '../../../components/ui/status.tsx'
import { Drawer } from '../../../components/ui/overlay.tsx'
import { BlockedNotice } from '../../../components/ui/feedback.tsx'
import { Chrono } from '../../../components/ui/time.tsx'
import { EvidenceChips, SectionTitle, useCaseCtx } from './shared.tsx'
import { CorrectionDrawer, RecordEventDrawer } from './clockForms.tsx'
import type { RecordableType } from './clockForms.tsx'

const KIND_LABEL: Record<TimestampSourceKind, { label: string; tone: 'green' | 'blue' | 'amber' | 'violet' }> = {
  system_of_record: { label: 'System of record', tone: 'green' },
  external_document: { label: 'External document', tone: 'blue' },
  analyst_attestation: { label: 'Analyst attestation', tone: 'amber' },
  nexus_server: { label: 'NEXUS server', tone: 'violet' },
}

function IntegrityMark({ state }: { state: IntegrityState | undefined }) {
  if (!state || state === 'checking') return <span className="inline-flex items-center gap-1.5 text-xs text-ink-3"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Verifying</span>
  if (state === 'verified') return <span className="inline-flex items-center gap-1.5 text-xs text-green"><CheckCircle2 className="h-3.5 w-3.5" /> Integrity verified in this browser</span>
  if (state === 'unavailable') return <span className="text-xs text-ink-3">Browser verification unavailable</span>
  return <span className="inline-flex items-center gap-1.5 text-xs text-red"><XCircle className="h-3.5 w-3.5" /> Hash mismatch</span>
}

function EventRecord({ e, role, integrity, corrections, onCorrect, decisive }: { e: ClockEvent; role?: string; integrity: Record<string, IntegrityState>; corrections: ClockEvent[]; onCorrect?: (e: ClockEvent) => void; decisive?: boolean }) {
  const { name, data } = useCaseCtx()
  const current = corrections.at(-1) ?? e
  const kind = KIND_LABEL[current.sourceKind]
  const criterion = data.bundle.criteria.find((c) => c.id === e.criterionId)
  const lag = diffMs(e.recordedAt, e.occurredAt)
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {role && <span className="micro">{role}</span>}
          {decisive && <Badge tone="amber" size="sm">Clock start</Badge>}
        </div>
        {onCorrect && e.sourceKind !== 'nexus_server' && (
          <Button size="sm" variant="ghost" icon={<PencilLine className="h-3.5 w-3.5" />} onClick={() => onCorrect(current)}>
            Record correction
          </Button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-3">
        <Chrono iso={current.occurredAt} size="xl" />
        {corrections.length > 0 && (
          <div className="text-xs">
            <div className="micro text-violet">Corrected</div>
            <div className="mono mt-1 text-ink-3 line-through decoration-ink-4">{stamp(e.occurredAt)}</div>
          </div>
        )}
      </div>
      <dl className="mt-6 grid min-w-0 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        <KeyValue label="Event ID" mono>
          {e.id}
          {corrections.length > 0 && <span className="text-violet"> → {current.id}</span>}
        </KeyValue>
        <KeyValue label="Timestamp (UTC)" mono>
          {current.occurredAt.replace('T', ' ').replace('.000Z', 'Z')}
        </KeyValue>
        <KeyValue label="Source timezone" mono>
          {current.timezone}
        </KeyValue>
        <KeyValue label="Actor">{name(current.actorId)}</KeyValue>
        <KeyValue label="Source">
          <span className="block">{current.source}</span>
          <Badge tone={kind.tone} size="sm" className="mt-1.5">
            {kind.label}
          </Badge>
        </KeyValue>
        <KeyValue label="Recorded by NEXUS" mono>
          {stamp(e.recordedAt)}
          <span className={cx('block text-[11px]', lag > 86_400_000 ? 'text-amber' : 'text-ink-3')}>{lag >= 0 ? `${formatDuration(lag, { seconds: false })} after the asserted time` : 'before the asserted time'}</span>
        </KeyValue>
        {criterion && (
          <KeyValue label="Criterion">
            {criterion.id} · {criterion.label}
            <span className="block text-[11px] text-ink-3">Responsible role: {criterion.responsibleRole.replace(/_/g, ' ')}</span>
          </KeyValue>
        )}
        <KeyValue label="Evidence">
          <EvidenceChips ids={[...current.evidenceIds, ...(current === e ? [] : e.evidenceIds)]} />
        </KeyValue>
        <KeyValue label="Integrity">
          <IntegrityMark state={integrity[current.id]} />
          <Hash value={current.integrityHash} className="mt-1" />
        </KeyValue>
      </dl>
      {corrections.length > 0 && (
        <div className="mt-6 rounded-lg border border-violet-line bg-violet/[0.033] px-4 py-3">
          <div className="micro text-violet">Correction history</div>
          <ol className="mt-2 space-y-2">
            {corrections.map((c) => (
              <li key={c.id} className="text-xs text-ink-2">
                <Ident className="text-[11px]">{c.id}</Ident> by {name(c.actorId)}, {stamp(c.recordedAt)}: moved to <span className="mono text-ink">{stamp(c.occurredAt)}</span>
                <p className="mt-1 text-ink-3">{c.correctionReason}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
      {e.note && <p className="mt-4 text-xs text-ink-3">Note: {e.note}</p>}
    </div>
  )
}

export function ClockTab() {
  const { data, writable } = useCaseCtx()
  const { can } = useSession()
  const [params, setParams] = useSearchParams()
  const clock = data.analysis.clock
  const defaultStage: StageId = (clock.stages[clock.activeStageIndex ?? 2]?.id ?? 'AWARENESS') as StageId
  const [stage, setStage] = useState<StageId>(clock.stages.find((s) => s.id === 'AWARENESS')?.event ? 'AWARENESS' : defaultStage)
  const [recordType, setRecordType] = useState<RecordableType | null>(params.get('establish') ? 'EXPLOITATION_AWARENESS' : null)
  const [correcting, setCorrecting] = useState<ClockEvent | null>(null)
  const [simulate, setSimulate] = useState(false)
  const integrity = useEventIntegrity(data.bundle.events)

  useEffect(() => {
    const target = params.get('correct')
    if (target) setCorrecting(data.bundle.events.find((e) => e.id === target) ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selected = clock.stages.find((s) => s.id === stage)!
  const correctionsOf = (id: string) => clock.effective.find((x) => x.original.id === id)?.corrections ?? []
  const canRecord = can('clock.record') && writable
  const canAware = can('awareness.establish') && writable
  const canCorrect = can('clock.correct') && writable
  const onCorrect = canCorrect ? setCorrecting : undefined
  const blocked = data.analysis.deadlines.find((d) => d.status === 'BLOCKED')
  const allEvents = [...data.bundle.events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.recordedAt.localeCompare(b.recordedAt))
  const va = clock.vulnerabilityAwareness
  const ea = clock.exploitationAwareness
  const decisiveId = ea ? (va && va.occurredAt > ea.occurredAt ? va.original.id : ea.original.id) : null

  return (
    <div className="min-w-0 space-y-12">
      <section aria-labelledby="cor-h" className="panel relative overflow-hidden px-5 pb-7 pt-6 sm:px-8">
        <div className="grid-bg pointer-events-none absolute inset-0 opacity-30 [mask-image:linear-gradient(to_bottom,black,transparent_60%)]" />
        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="micro mb-1.5">Clock of Record</div>
              <h2 id="cor-h" className="text-lg font-medium text-ink">
                Occurrence, detection, awareness, decision and submission, kept apart
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" icon={<FlaskConical className="h-3.5 w-3.5" />} onClick={() => setSimulate(true)}>
                What-if simulator
              </Button>
              {canRecord && (
                <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setRecordType('DETECTION')}>
                  Record event
                </Button>
              )}
              {canAware && !(va && ea) && (
                <Button size="sm" variant="primary" icon={<Radio className="h-3.5 w-3.5" />} onClick={() => setRecordType(va ? 'EXPLOITATION_AWARENESS' : 'VULNERABILITY_AWARENESS')}>
                  Establish awareness
                </Button>
              )}
            </div>
          </div>
          <div className="mt-10">
            <ClockRail clock={clock} selected={stage} onSelect={setStage} />
          </div>
        </div>
      </section>

      <AnimatePresence mode="wait">
        <motion.section key={stage} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} aria-label={`${selected.label} event`} className="min-w-0">
          <SectionTitle eyebrow={`${String(selected.index).padStart(2, '0')} · ${selected.label}`} title={selected.detail} />
          {stage === 'AWARENESS' && (va || ea) ? (
            <div className="grid min-w-0 gap-6 lg:grid-cols-2">
              {va ? (
                <div className="panel p-5 sm:p-6">
                  <EventRecord e={va.original} role="Vulnerability awareness" integrity={integrity} corrections={correctionsOf(va.original.id)} onCorrect={onCorrect} decisive={decisiveId === va.original.id} />
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-line-strong p-6 text-sm text-ink-3">No separate vulnerability-awareness event.</div>
              )}
              {ea ? (
                <div className={cx('panel p-5 sm:p-6', decisiveId === ea.original.id && 'border-amber-line')}>
                  <EventRecord e={ea.original} role="Exploitation awareness" integrity={integrity} corrections={correctionsOf(ea.original.id)} onCorrect={onCorrect} decisive={decisiveId === ea.original.id} />
                </div>
              ) : (
                <div className="flex flex-col justify-center rounded-xl border border-dashed border-amber-line p-6">
                  <div className="micro text-amber">Exploitation awareness not established</div>
                  <p className="mt-2 text-sm text-ink-2">No Article 14(1) clock is running. When reliable evidence of exploitation is validated against a criterion, record it here and the 24h and 72h clocks start.</p>
                  {canAware && (
                    <Button size="sm" className="mt-4 self-start" icon={<ShieldAlert className="h-3.5 w-3.5" />} onClick={() => setRecordType('EXPLOITATION_AWARENESS')}>
                      Establish exploitation awareness
                    </Button>
                  )}
                </div>
              )}
            </div>
          ) : selected.event ? (
            <div className="panel p-5 sm:p-6">
              <EventRecord e={selected.event.original} integrity={integrity} corrections={selected.event.corrections} onCorrect={onCorrect} />
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-line-strong p-6">
              <p className="text-sm text-ink-2">{selected.state === 'not_applicable' ? 'Not applicable: the recorded decision is that reporting is not required.' : 'Nothing recorded for this stage yet.'}</p>
              {selected.id === 'DECISION' && <p className="mt-2 text-xs text-ink-3">The DECISION event is witnessed by NEXUS's own clock when a decision is recorded on the Determination tab.</p>}
              {selected.id === 'SUBMISSION' && selected.state === 'pending' && <p className="mt-2 text-xs text-ink-3">The SUBMISSION event is recorded when an early-warning report version is submitted (simulated) from the Report tab.</p>}
              {canRecord && (selected.id === 'OCCURRENCE' || selected.id === 'DETECTION') && (
                <Button size="sm" className="mt-4" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setRecordType(selected.id as RecordableType)}>
                  Record {selected.label.toLowerCase()}
                </Button>
              )}
            </div>
          )}
        </motion.section>
      </AnimatePresence>

      <section aria-labelledby="derived-h" className="min-w-0">
        <SectionTitle eyebrow="Derived obligations" title="Deadlines that follow from these events" id="derived-h" />
        {blocked ? (
          <BlockedNotice
            title="Deadline calculation blocked"
            reason={blocked.reason}
            action={
              canAware ? (
                <Button size="sm" onClick={() => setRecordType('VULNERABILITY_AWARENESS')}>
                  Establish awareness
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="panel p-5 sm:p-6">
              <DeadlineTrack deadlines={data.analysis.deadlines} />
            </div>
            <div className="space-y-5">
              {data.analysis.deadlines.map((d) => (
                <div key={d.kind} className="border-b border-line pb-4 last:border-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-ink">
                      {d.shortLabel} · {d.label}
                    </span>
                    <span className="ident text-[11px] text-ink-4">{d.citation}</span>
                  </div>
                  <div className="mono mt-1 text-xs text-ink-2">{d.dueAt ? `Due ${stamp(d.dueAt)}` : d.reason}</div>
                  <div className="mt-2">
                    <WhyDeadline deadline={d} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {measureMissing(data) && canRecord && (
          <Button size="sm" variant="ghost" className="mt-4" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setRecordType('MEASURE_AVAILABLE')}>
            Record corrective or mitigating measure available
          </Button>
        )}
      </section>

      <section aria-labelledby="log-h" className="min-w-0">
        <SectionTitle eyebrow="Immutable timestamp model" title="Every event on the record" id="log-h" />
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-line bg-s1">
              <tr>
                <th className="micro px-4 py-2.5 font-normal">Event</th>
                <th className="micro px-3 py-2.5 font-normal">Type</th>
                <th className="micro px-3 py-2.5 font-normal">Asserted</th>
                <th className="micro px-3 py-2.5 font-normal">Recorded</th>
                <th className="micro px-3 py-2.5 font-normal">Source</th>
                <th className="micro px-3 py-2.5 font-normal">Integrity hash</th>
              </tr>
            </thead>
            <tbody>
              {allEvents.map((e) => {
                const superseded = data.bundle.events.some((x) => x.type === 'CORRECTION' && x.supersedesId === e.id)
                return (
                  <tr key={e.id} className={cx('row-line align-top', superseded && 'opacity-60')}>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Ident className="whitespace-nowrap text-[12px] [overflow-wrap:normal]">{e.id}</Ident>
                      {e.supersedesId && <div className="mono text-[10.5px] text-violet">supersedes {e.supersedesId}</div>}
                      {superseded && <div className="mono text-[10.5px] text-ink-4">superseded</div>}
                    </td>
                    <td className="px-3 py-3 text-xs text-ink-2">{e.type.replace(/_/g, ' ').toLowerCase()}</td>
                    <td className={cx('mono px-3 py-3 text-xs', superseded ? 'text-ink-3 line-through decoration-ink-4' : 'text-ink')}>{stamp(e.occurredAt)}</td>
                    <td className="mono px-3 py-3 text-xs text-ink-3">{stamp(e.recordedAt)}</td>
                    <td className="px-3 py-3 text-xs text-ink-2">
                      <span className="line-clamp-2">{e.source}</span>
                      <span className="micro text-ink-4">{KIND_LABEL[e.sourceKind].label}</span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        {integrity[e.id] === 'verified' ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green" aria-label="verified" /> : integrity[e.id] === 'mismatch' ? <XCircle className="h-3.5 w-3.5 shrink-0 text-red" aria-label="mismatch" /> : <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-4" />}
                        <Hash value={e.integrityHash} length={10} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 max-w-3xl text-xs text-ink-3">
          Stored per event: event id, case id, event type, asserted timestamp, source timezone, actor, source, evidence references, server recording time and a SHA-256 integrity hash. The table rejects edits and deletions at the database level; a wrong timestamp is corrected by a new event.
        </p>
      </section>

      <RecordEventDrawer
        open={recordType !== null}
        initialType={recordType ?? 'DETECTION'}
        onClose={() => {
          setRecordType(null)
          if (params.get('establish')) setParams({ tab: 'clock' })
        }}
      />
      <CorrectionDrawer
        event={correcting}
        onClose={() => {
          setCorrecting(null)
          if (params.get('correct')) setParams({ tab: 'clock' })
        }}
      />
      <Drawer open={simulate} onClose={() => setSimulate(false)} eyebrow={data.bundle.case.id} title="What-if clock simulator" width="sm:max-w-2xl">
        <WhatIf bundle={data.bundle} />
      </Drawer>
    </div>
  )
}

function measureMissing(data: ReturnType<typeof useCaseCtx>['data']): boolean {
  return !data.bundle.events.some((e) => e.type === 'MEASURE_AVAILABLE') && data.analysis.decision?.outcome !== 'DO_NOT_REPORT'
}

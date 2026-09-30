import { useEffect, useState } from 'react'
import type { ClockEvent, ClockEventType, TimestampSourceKind } from '../../../types/domain.ts'
import { api, ApiFailure } from '../../../lib/client/api.ts'
import { useAction } from '../../../lib/client/queries.ts'
import { displayZone, fromLocalInput, stamp, toLocalInput } from '../../../lib/client/format.ts'
import { nowMs } from '../../../lib/client/useNow.ts'
import { Button, Checkbox, Field, Segmented, Select, TextArea, TextInput } from '../../../components/ui/primitives.tsx'
import { ErrorState, Notice } from '../../../components/ui/feedback.tsx'
import { Drawer, useToast } from '../../../components/ui/overlay.tsx'
import { EvidencePicker } from '../../../components/reasoning/EvidencePicker.tsx'
import { useCaseCtx } from './shared.tsx'

export type RecordableType = 'OCCURRENCE' | 'DETECTION' | 'VULNERABILITY_AWARENESS' | 'EXPLOITATION_AWARENESS' | 'MEASURE_AVAILABLE'

const TYPE_LABEL: Record<RecordableType, string> = {
  OCCURRENCE: 'Occurrence',
  DETECTION: 'Detection',
  VULNERABILITY_AWARENESS: 'Vulnerability awareness',
  EXPLOITATION_AWARENESS: 'Exploitation awareness',
  MEASURE_AVAILABLE: 'Corrective or mitigating measure available',
}

const TYPE_HELP: Record<RecordableType, string> = {
  OCCURRENCE: 'The earliest known time of the underlying event, usually the first observed exploitation. Often learned late, from an advisory or from forensics.',
  DETECTION: 'The first signal the organisation received: a scanner hit, an advisory, an inbound report. Detection starts the investigation, not the clock.',
  VULNERABILITY_AWARENESS: 'The moment an awareness criterion for the vulnerability was met. Recorded once; later changes are corrections.',
  EXPLOITATION_AWARENESS: 'The moment reliable evidence of active exploitation was validated against a criterion. With vulnerability awareness, this starts the 24h and 72h clocks.',
  MEASURE_AVAILABLE: 'When a corrective or mitigating measure became available to users. This starts the 14-day final-report clock.',
}

export const ZONES = ['Europe/Berlin', 'UTC', 'Europe/Amsterdam', 'Europe/Paris', 'Europe/Stockholm', 'Europe/Warsaw', 'Europe/Helsinki', 'Europe/London', 'America/New_York']

export const SOURCE_KINDS: Array<{ value: Exclude<TimestampSourceKind, 'nexus_server'>; label: string }> = [
  { value: 'system_of_record', label: 'System of record' },
  { value: 'external_document', label: 'External document' },
  { value: 'analyst_attestation', label: 'Analyst attestation' },
]

export function RecordEventDrawer({ open, onClose, initialType }: { open: boolean; onClose: () => void; initialType: RecordableType }) {
  const { data } = useCaseCtx()
  const toast = useToast()
  const [type, setType] = useState<RecordableType>(initialType)
  const [local, setLocal] = useState('')
  const [tz, setTz] = useState(displayZone())
  const [source, setSource] = useState('')
  const [kind, setKind] = useState<Exclude<TimestampSourceKind, 'nexus_server'>>('system_of_record')
  const [criterionId, setCriterionId] = useState('')
  const [evidenceIds, setEvidenceIds] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const post = useAction((b: unknown) => api<{ id: string }>(`/api/cases/${data.bundle.case.id}/events`, { body: b }))

  useEffect(() => {
    if (!open) return
    setType(initialType)
    setLocal(toLocalInput(new Date(nowMs()).toISOString(), tz))
    setSource('')
    setKind('system_of_record')
    setCriterionId('')
    setEvidenceIds([])
    setNote('')
    setConfirm(false)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialType])

  const awareness = type === 'VULNERABILITY_AWARENESS' || type === 'EXPLOITATION_AWARENESS'
  const scope = type === 'VULNERABILITY_AWARENESS' ? 'vulnerability' : 'exploitation'
  const criteria = data.bundle.criteria.filter((c) => c.active && c.scope === scope)
  const criterion = criteria.find((c) => c.id === criterionId)
  const iso = local ? fromLocalInput(local, tz) : null
  const future = iso ? Date.parse(iso) > nowMs() + 120_000 : false
  const existing = data.bundle.events.find((e) => e.type === type)
  const needsConfirm = type === 'EXPLOITATION_AWARENESS' && data.bundle.vulnerability.exploitation !== 'CONFIRMED'
  const fields = error instanceof ApiFailure ? (error.body.fields ?? {}) : {}

  const submit = async () => {
    setError(null)
    try {
      const r = await post.mutateAsync({ type, occurredAt: iso, timezone: tz, source, sourceKind: kind, evidenceIds, criterionId: awareness ? criterionId || null : null, note, confirmExploitation: confirm })
      toast({ tone: 'success', title: `${r.id} recorded`, body: awareness ? 'Awareness established. It is now immutable; later changes are corrections.' : `${TYPE_LABEL[type]} is on the Clock of Record.` })
      onClose()
    } catch (e) {
      setError(e)
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow={`${data.bundle.case.id} · Clock of Record`}
      title={awareness ? 'Establish awareness' : 'Record clock event'}
      width="sm:max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} busy={post.isPending} disabled={!iso || future || !source.trim() || (awareness && !criterionId) || (needsConfirm && !confirm) || !!existing}>
            {awareness ? 'Establish awareness' : 'Record event'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Event">
          {(id) => (
            <Select id={id} value={type} onChange={(e) => setType(e.target.value as RecordableType)}>
              {(Object.keys(TYPE_LABEL) as RecordableType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <p className="-mt-2 text-xs text-ink-3">{TYPE_HELP[type]}</p>
        {existing && (
          <Notice tone="amber" title="Already recorded">
            {existing.id} already records this event. Historical timestamps are not re-recorded; use "Record correction" on that event instead.
          </Notice>
        )}
        <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
          <Field label="Asserted time" required error={future ? 'The asserted time is in the future. An event cannot be recorded before it happens.' : fields.occurredAt} hint={iso ? `= ${stamp(iso, 'UTC')}` : undefined}>
            {(id) => <TextInput id={id} type="datetime-local" step={1} value={local} onChange={(e) => setLocal(e.target.value)} invalid={future} />}
          </Field>
          <Field label="Source timezone" hint="The zone the source states the time in">
            {(id) => (
              <Select id={id} value={tz} onChange={(e) => setTz(e.target.value)}>
                {ZONES.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Timestamp source" required hint="Where this time comes from, e.g. PSIRT tracker state change (tracker server clock)" error={fields.source}>
          {(id) => <TextInput id={id} value={source} onChange={(e) => setSource(e.target.value)} maxLength={240} />}
        </Field>
        <div>
          <div className="mb-2 text-xs font-medium text-ink-2">Authority of the source</div>
          <Segmented label="Authority of the source" size="sm" value={kind} onChange={setKind} options={SOURCE_KINDS} />
          <p className="mt-2 text-xs text-ink-3">A system of record outranks a document, which outranks recollection. A clock start that rests on attestation alone is flagged in the evidence checklist.</p>
        </div>
        {awareness && (
          <Field label="Awareness criterion met" required error={fields.criterionId} hint={criterion ? `${criterion.description} Responsible role: ${criterion.responsibleRole.replace(/_/g, ' ')}. Requires evidence of type: ${criterion.requiredEvidenceTypes.map((t) => t.replace(/_/g, ' ').toLowerCase()).join(', ')}.` : 'Criteria are configured in Settings.'}>
            {(id) => (
              <Select id={id} value={criterionId} onChange={(e) => setCriterionId(e.target.value)}>
                <option value="">Select a criterion</option>
                {criteria.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} · {c.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <div>
          <div className="mb-2 text-xs font-medium text-ink-2">Evidence {awareness && <span className="text-amber">*</span>}</div>
          <EvidencePicker evidence={data.bundle.evidence} value={evidenceIds} onChange={setEvidenceIds} />
        </div>
        {needsConfirm && (
          <Notice tone="red" title="Exploitation is not confirmed on the vulnerability record">
            <Checkbox
              checked={confirm}
              onChange={setConfirm}
              label="Set exploitation to CONFIRMED"
              description="Establishing exploitation awareness asserts reliable evidence that a malicious actor exploited the vulnerability (Art. 3(42)). The status change is recorded in the ledger."
            />
          </Notice>
        )}
        <Field label="Note">{(id) => <TextArea id={id} value={note} onChange={(e) => setNote(e.target.value)} rows={2} />}</Field>
        {error !== null && <ErrorState error={error} />}
      </div>
    </Drawer>
  )
}

export function CorrectionDrawer({ event, onClose }: { event: ClockEvent | null; onClose: () => void }) {
  const { data } = useCaseCtx()
  const toast = useToast()
  const [local, setLocal] = useState('')
  const [tz, setTz] = useState(displayZone())
  const [source, setSource] = useState('')
  const [kind, setKind] = useState<Exclude<TimestampSourceKind, 'nexus_server'>>('system_of_record')
  const [reason, setReason] = useState('')
  const [evidenceIds, setEvidenceIds] = useState<string[]>([])
  const [error, setError] = useState<unknown>(null)
  const post = useAction((b: unknown) => api<{ id: string }>(`/api/cases/${data.bundle.case.id}/events/${event?.id}/correct`, { body: b }))
  useEffect(() => {
    if (!event) return
    setLocal(toLocalInput(event.occurredAt, tz))
    setSource(event.source)
    setKind(event.sourceKind === 'nexus_server' ? 'system_of_record' : event.sourceKind)
    setReason('')
    setEvidenceIds([])
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event])
  const iso = local ? fromLocalInput(local, tz) : null
  const typeLabel = (t: ClockEventType) => t.replace(/_/g, ' ').toLowerCase()
  return (
    <Drawer
      open={!!event}
      onClose={onClose}
      eyebrow={`${data.bundle.case.id} · correction`}
      title="Record correction"
      width="sm:max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={post.isPending}
            disabled={!iso || reason.trim().length < 20 || !source.trim()}
            onClick={async () => {
              setError(null)
              try {
                const r = await post.mutateAsync({ occurredAt: iso, timezone: tz, source, sourceKind: kind, reason, evidenceIds })
                toast({ tone: 'success', title: `Correction ${r.id} recorded`, body: 'The original timestamp is preserved. Dependent deadlines were recalculated.' })
                onClose()
              } catch (e) {
                setError(e)
              }
            }}
          >
            Record correction
          </Button>
        </>
      }
    >
      {event && (
        <div className="space-y-5">
          <Notice tone="violet" title="History is not edited">
            This creates a new correction event that supersedes {event.id} ({typeLabel(event.type)}). The original record stays on the Clock of Record and in the ledger, visibly superseded.
          </Notice>
          <div className="rounded-lg border border-line bg-s2 px-4 py-3">
            <div className="micro">Currently recorded</div>
            <div className="mono mt-1 text-sm text-ink line-through decoration-ink-4">{stamp(event.occurredAt)}</div>
            <div className="mt-1 text-xs text-ink-3">{event.source}</div>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
            <Field label="Corrected time" required hint={iso ? `= ${stamp(iso, 'UTC')}` : undefined}>
              {(id) => <TextInput id={id} type="datetime-local" step={1} value={local} onChange={(e) => setLocal(e.target.value)} />}
            </Field>
            <Field label="Source timezone">
              {(id) => (
                <Select id={id} value={tz} onChange={(e) => setTz(e.target.value)}>
                  {ZONES.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Timestamp source" required>
            {(id) => <TextInput id={id} value={source} onChange={(e) => setSource(e.target.value)} />}
          </Field>
          <Segmented label="Authority of the source" size="sm" value={kind} onChange={setKind} options={SOURCE_KINDS} />
          <Field label="Reason for correction" required hint="At least 20 characters. Recorded on the event and in the ledger.">
            {(id) => <TextArea id={id} value={reason} onChange={(e) => setReason(e.target.value)} rows={4} />}
          </Field>
          <div>
            <div className="mb-2 text-xs font-medium text-ink-2">Evidence for the corrected value</div>
            <EvidencePicker evidence={data.bundle.evidence} value={evidenceIds} onChange={setEvidenceIds} />
          </div>
          {error !== null && <ErrorState error={error} />}
        </div>
      )}
    </Drawer>
  )
}

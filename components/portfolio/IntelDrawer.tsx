import { useEffect, useMemo, useState } from 'react'
import { Unplug } from 'lucide-react'
import type { IntelConfidence } from '../../types/domain.ts'
import { api } from '../../lib/client/api.ts'
import { useAction } from '../../lib/client/queries.ts'
import { displayZone, fromLocalInput, zoneAbbr } from '../../lib/client/format.ts'
import { Button, Field, Segmented, Select, TextInput } from '../ui/primitives.tsx'
import { Drawer, useToast } from '../ui/overlay.tsx'
import { ErrorState, Notice } from '../ui/feedback.tsx'
import { fieldErrorsOf, pick } from './shared.tsx'

/**
 * Manual threat-intelligence entry. NEXUS has no live feed: every entry
 * is an analyst's record of what a source reported, attributed to them and
 * written to the ledger. Recording "exploitation observed" here does not
 * change the vulnerability's exploitation status and does not start a clock.
 */
export function IntelDrawer({ vulnerabilityId, label, open, onClose }: { vulnerabilityId: string; label: string; open: boolean; onClose: () => void }) {
  const toast = useToast()
  const [source, setSource] = useState('')
  const [observed, setObserved] = useState<'yes' | 'no'>('no')
  const [firstObserved, setFirstObserved] = useState('')
  const [confidence, setConfidence] = useState<IntelConfidence>('MEDIUM')
  const [indicator, setIndicator] = useState('')
  const [reference, setReference] = useState('')
  const [touched, setTouched] = useState(false)
  const record = useAction((body: unknown) => api<{ id: string }>(`/api/vulnerabilities/${encodeURIComponent(vulnerabilityId)}/intel`, { body }))

  useEffect(() => {
    if (!open) return
    setSource('')
    setObserved('no')
    setFirstObserved('')
    setConfidence('MEDIUM')
    setIndicator('')
    setReference('')
    setTouched(false)
    record.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const client = useMemo(() => {
    const e: Record<string, string> = {}
    if (!source.trim()) e.source = 'Name the source that reported it'
    if (firstObserved) {
      const iso = fromLocalInput(firstObserved)
      if (!iso) e.firstObserved = 'Not a valid date and time'
      else if (Date.parse(iso) > Date.now() + 120_000) e.firstObserved = 'Cannot be in the future'
    }
    if (indicator.length > 300) e.indicator = 'At most 300 characters'
    if (reference.length > 400) e.reference = 'At most 400 characters'
    return e
  }, [source, firstObserved, indicator, reference])
  const server = fieldErrorsOf(record.error)
  const err = (k: string) => (touched ? client[k] : undefined) ?? pick(server, k)

  const submit = async () => {
    setTouched(true)
    if (Object.keys(client).length) return
    try {
      const r = await record.mutateAsync({
        source: source.trim(),
        observedExploitation: observed === 'yes',
        firstObserved: firstObserved ? fromLocalInput(firstObserved) : null,
        confidence,
        indicator: indicator.trim(),
        reference: reference.trim(),
      })
      toast({ tone: 'success', title: 'Threat intelligence recorded', body: `${r.id} recorded against ${label}.` })
      onClose()
    } catch {
      /* shown inline */
    }
  }
  const serverOnly = record.error && Object.keys(server).length === 0

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow={label}
      title="Add threat intelligence"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={record.isPending} onClick={() => void submit()}>
            Record entry
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Notice tone="neutral" icon={Unplug} title="Manual entry: no live intelligence feed is connected">
          You are recording what a source reported, as an analyst. The entry is attributed to you and written to the audit ledger. It does not change the exploitation status and does not start a reporting clock; only an awareness event recorded in a case does.
        </Notice>
        <Field label="Source" required error={err('source')} hint="Who reported it: a CERT bulletin, vendor, partner or internal telemetry">
          {(id) => <TextInput id={id} data-autofocus value={source} onChange={(e) => setSource(e.target.value)} invalid={!!err('source')} maxLength={200} placeholder="Partner CERT bulletin 2026-0930-01" />}
        </Field>
        <div>
          <div className="mb-1.5 text-xs font-medium text-ink-2">Exploitation observed by the source</div>
          <Segmented<'yes' | 'no'>
            label="Exploitation observed"
            value={observed}
            onChange={setObserved}
            options={[
              { value: 'no', label: 'No' },
              { value: 'yes', label: 'Yes', tone: 'red' },
            ]}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First observed" error={err('firstObserved')} hint={`Optional. Local time, ${displayZone()} (${zoneAbbr(new Date().toISOString())})`}>
            {(id) => <TextInput id={id} type="datetime-local" value={firstObserved} onChange={(e) => setFirstObserved(e.target.value)} className="mono" invalid={!!err('firstObserved')} />}
          </Field>
          <Field label="Confidence" error={err('confidence')}>
            {(id) => (
              <Select id={id} value={confidence} onChange={(e) => setConfidence(e.target.value as IntelConfidence)}>
                <option value="HIGH">High: corroborated or from victim telemetry</option>
                <option value="MEDIUM">Medium: credible single source</option>
                <option value="LOW">Low: unverified or indirect</option>
              </Select>
            )}
          </Field>
        </div>
        <Field label="Indicator" error={err('indicator')} hint="Pattern, address range or signature, as reported">
          {(id) => <TextInput id={id} value={indicator} onChange={(e) => setIndicator(e.target.value)} className="mono" invalid={!!err('indicator')} maxLength={300} spellCheck={false} />}
        </Field>
        <Field label="Reference" error={err('reference')} hint="Bulletin id or URL. Stored as text; NEXUS does not fetch it.">
          {(id) => <TextInput id={id} value={reference} onChange={(e) => setReference(e.target.value)} className="mono" invalid={!!err('reference')} maxLength={400} spellCheck={false} />}
        </Field>
        {serverOnly && <ErrorState error={record.error} />}
      </div>
    </Drawer>
  )
}

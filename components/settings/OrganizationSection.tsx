import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Save, Undo2 } from 'lucide-react'
import type { Organization, RoleId } from '../../types/domain.ts'
import { api } from '../../lib/client/api.ts'
import { useAction } from '../../lib/client/queries.ts'
import { useSession } from '../../lib/client/session.tsx'
import { Button, Field, Panel, TextInput, cx } from '../ui/primitives.tsx'
import { Badge } from '../ui/status.tsx'
import { ErrorState } from '../ui/feedback.tsx'
import { useToast } from '../ui/overlay.tsx'
import { EU_MEMBER_STATES, ReadOnlyNote, SectionHeader } from './common.tsx'

/**
 * Organization: the legal identity NEXUS reports on behalf of. The legal
 * entity and Member States appear in every generated report; the timezone
 * sets how instants are displayed (they are stored in UTC).
 */

interface OrgInput {
  name: string
  legalEntity: string
  timezone: string
  memberStatesMadeAvailable: string[]
  csirtCoordinator: string
}

function parseStates(raw: string): string[] {
  const out: string[] = []
  for (const token of raw.split(/[\s,;]+/)) {
    const t = token.trim().toUpperCase()
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

function validTimezone(tz: string): boolean {
  if (!tz.trim()) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export function OrganizationSection({ org, editable, role }: { org: Organization; editable: boolean; role: RoleId | undefined }) {
  return (
    <section aria-label="Organization">
      <SectionHeader
        eyebrow="Legal identity"
        title="Organization"
        description={
          <p>
            The manufacturer NEXUS records decisions for. The legal entity and the Member States where products are made available are written into every generated report. The CSIRT coordinator is named as the recipient of each simulated submission. The timezone controls how instants are displayed; they are always stored in UTC.
          </p>
        }
        action={org.demo ? <Badge tone="neutral">Fictional demo organization</Badge> : undefined}
      />
      {editable ? <OrgForm key={JSON.stringify(org)} org={org} /> : <OrgReadOnly org={org} role={role} />}
    </section>
  )
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1 py-4 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-6">
      <dt className="micro pt-0.5">{label}</dt>
      <dd className="min-w-0 text-sm text-ink">{children}</dd>
    </div>
  )
}

function StateCodes({ codes, invalid = [] }: { codes: string[]; invalid?: string[] }) {
  if (codes.length === 0) return <span className="text-ink-3">None recorded</span>
  return (
    <span className="flex min-w-0 flex-wrap gap-1.5">
      {codes.map((c) => (
        <span key={c} className={cx('inline-flex h-6 items-center rounded-md border px-2 font-mono text-[11.5px]', invalid.includes(c) ? 'border-red-line bg-red-soft text-red' : 'border-line-strong bg-s2 text-ink-2')}>
          {c}
        </span>
      ))}
    </span>
  )
}

function OrgReadOnly({ org, role }: { org: Organization; role: RoleId | undefined }) {
  return (
    <Panel className="px-5 sm:px-6">
      <dl className="divide-y divide-line">
        <Row label="Name">{org.name}</Row>
        <Row label="Legal entity">{org.legalEntity}</Row>
        <Row label="Timezone">
          <span className="ident">{org.timezone}</span>
        </Row>
        <Row label="Member States">
          <StateCodes codes={org.memberStatesMadeAvailable} />
        </Row>
        <Row label="CSIRT coordinator">{org.csirtCoordinator}</Row>
        <Row label="Record id">
          <span className="ident text-ink-2">{org.id}</span>
        </Row>
      </dl>
      <div className="border-t border-line py-4">
        <ReadOnlyNote role={role} />
      </div>
    </Panel>
  )
}

function OrgForm({ org }: { org: Organization }) {
  const toast = useToast()
  const { refresh } = useSession()
  const [name, setName] = useState(org.name)
  const [legalEntity, setLegalEntity] = useState(org.legalEntity)
  const [timezone, setTimezone] = useState(org.timezone)
  const [states, setStates] = useState(org.memberStatesMadeAvailable.join(', '))
  const [csirt, setCsirt] = useState(org.csirtCoordinator)
  const [attempted, setAttempted] = useState(false)

  const save = useAction((body: OrgInput) => api<{ ok: true }>('/api/settings/org', { method: 'PUT', body }))

  const parsed = useMemo(() => parseStates(states), [states])
  const invalidStates = parsed.filter((c) => !/^[A-Z]{2}$/.test(c) || !EU_MEMBER_STATES.includes(c))

  const errors: Partial<Record<keyof OrgInput, string>> = {}
  if (!name.trim()) errors.name = 'Enter the organization name.'
  else if (name.length > 120) errors.name = 'At most 120 characters.'
  if (!legalEntity.trim()) errors.legalEntity = 'Enter the legal entity that reports.'
  else if (legalEntity.length > 160) errors.legalEntity = 'At most 160 characters.'
  if (!validTimezone(timezone) || timezone.length > 64) errors.timezone = 'Use an IANA timezone, for example Europe/Berlin.'
  if (invalidStates.length) errors.memberStatesMadeAvailable = `Not an EU Member State code: ${invalidStates.join(', ')}. Use ISO 3166-1 alpha-2 (Greece is GR).`
  else if (parsed.length > 27) errors.memberStatesMadeAvailable = 'At most 27 Member States.'
  if (!csirt.trim()) errors.csirtCoordinator = 'Name the CSIRT designated as coordinator.'
  else if (csirt.length > 160) errors.csirtCoordinator = 'At most 160 characters.'
  const hasErrors = Object.keys(errors).length > 0

  const dirty =
    name !== org.name ||
    legalEntity !== org.legalEntity ||
    timezone !== org.timezone ||
    parsed.join(',') !== org.memberStatesMadeAvailable.join(',') ||
    csirt !== org.csirtCoordinator

  const show = (k: keyof OrgInput) => (attempted ? errors[k] : undefined)

  const revert = () => {
    setName(org.name)
    setLegalEntity(org.legalEntity)
    setTimezone(org.timezone)
    setStates(org.memberStatesMadeAvailable.join(', '))
    setCsirt(org.csirtCoordinator)
    setAttempted(false)
    save.reset()
  }

  const submit = () => {
    setAttempted(true)
    if (hasErrors) return
    save.mutate(
      { name: name.trim(), legalEntity: legalEntity.trim(), timezone: timezone.trim(), memberStatesMadeAvailable: parsed, csirtCoordinator: csirt.trim() },
      {
        onSuccess: () => {
          toast({ tone: 'success', title: 'Organization settings saved', body: 'Recorded in the audit ledger with the values before and after.' })
          void refresh()
        },
        onError: () => toast({ tone: 'error', title: 'Organization settings not saved', body: 'The server refused the change. The reason is shown on the form.' }),
      },
    )
  }

  return (
    <Panel>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        noValidate
      >
        <div className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
          <Field label="Name" required error={show('name')}>
            {(id) => <TextInput id={id} value={name} onChange={(e) => setName(e.target.value)} invalid={!!show('name')} maxLength={240} autoComplete="organization" />}
          </Field>
          <Field label="Timezone" required error={show('timezone')} hint="IANA name. Controls display only; instants are stored in UTC.">
            {(id) => <TextInput id={id} value={timezone} onChange={(e) => setTimezone(e.target.value)} invalid={!!show('timezone')} className="font-mono" spellCheck={false} maxLength={64} />}
          </Field>
          <Field label="Legal entity" required error={show('legalEntity')} hint="Written into every generated report." className="sm:col-span-2">
            {(id) => <TextInput id={id} value={legalEntity} onChange={(e) => setLegalEntity(e.target.value)} invalid={!!show('legalEntity')} maxLength={320} />}
          </Field>
          <Field
            label="Member States where products are made available"
            required
            error={show('memberStatesMadeAvailable')}
            hint="Comma-separated ISO 3166-1 alpha-2 codes, for example DE, AT, NL."
            className="sm:col-span-2"
          >
            {(id) => (
              <>
                <TextInput id={id} value={states} onChange={(e) => setStates(e.target.value)} invalid={!!show('memberStatesMadeAvailable')} className="font-mono uppercase" spellCheck={false} />
                <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-2">
                  <span className="micro tabular">{parsed.length} of 27</span>
                  <StateCodes codes={parsed} invalid={invalidStates} />
                </div>
              </>
            )}
          </Field>
          <Field label="CSIRT coordinator" required error={show('csirtCoordinator')} hint="Named as a recipient of each simulated submission." className="sm:col-span-2">
            {(id) => <TextInput id={id} value={csirt} onChange={(e) => setCsirt(e.target.value)} invalid={!!show('csirtCoordinator')} maxLength={320} />}
          </Field>
        </div>
        {save.error && (
          <div className="px-5 pb-5 sm:px-6">
            <ErrorState error={save.error} />
          </div>
        )}
        <div className="flex flex-col-reverse gap-3 border-t border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-xs text-ink-3">{dirty ? 'Unsaved changes. Saving writes a SETTINGS_CHANGED entry to the audit ledger.' : 'No unsaved changes.'}</p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={revert} disabled={!dirty || save.isPending}>
              Revert
            </Button>
            <Button type="submit" variant="primary" icon={<Save className="h-3.5 w-3.5" />} busy={save.isPending} disabled={!dirty}>
              Save organization
            </Button>
          </div>
        </div>
      </form>
    </Panel>
  )
}

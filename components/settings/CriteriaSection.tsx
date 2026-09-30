import { useCallback, useState } from 'react'
import { motion } from 'motion/react'
import { AlertTriangle, Bug, Crosshair, Pencil, Plus, Radio } from 'lucide-react'
import type { AwarenessCriterion, AwarenessScope, EvidenceType, RoleId } from '../../types/domain.ts'
import { ROLES, ROLE_ORDER } from '../../lib/rbac.ts'
import { api } from '../../lib/client/api.ts'
import { useAction } from '../../lib/client/queries.ts'
import { titleCase } from '../../lib/client/format.ts'
import { Button, Checkbox, Field, Segmented, Select, TextArea, TextInput, cx } from '../ui/primitives.tsx'
import { Badge } from '../ui/status.tsx'
import { EmptyState, ErrorState, Notice } from '../ui/feedback.tsx'
import { Drawer, useToast } from '../ui/overlay.tsx'
import { CRITERION_EVIDENCE_TYPES, ReadOnlyNote, SectionHeader, Switch } from './common.tsx'

/**
 * Awareness criteria: the organization's written definition of "aware".
 * Awareness is established against one of these, and the event is immutable
 * once recorded, so the criterion text is the thing a regulator will read.
 */

type CriterionInput = Omit<AwarenessCriterion, 'id'>

const MAX_TYPES = 8

const SCOPES: Array<{ scope: AwarenessScope; title: string; icon: typeof Bug; explain: string }> = [
  {
    scope: 'vulnerability',
    title: 'Vulnerability awareness',
    icon: Bug,
    explain: 'The organization knows the vulnerability exists in a shipped product version.',
  },
  {
    scope: 'exploitation',
    title: 'Exploitation awareness',
    icon: Crosshair,
    explain: 'The organization holds reliable evidence that a malicious actor has exploited the vulnerability (Art. 3(42)). The reporting clock runs from this event: knowing the vulnerability is exploited includes knowing the vulnerability.',
  },
]

export function ScopeBadge({ scope }: { scope: AwarenessScope }) {
  return (
    <Badge tone="neutral" size="sm" icon={scope === 'vulnerability' ? Bug : Crosshair}>
      {scope}
    </Badge>
  )
}

export function CriteriaSection({ criteria, editable, role }: { criteria: AwarenessCriterion[]; editable: boolean; role: RoleId | undefined }) {
  const toast = useToast()
  const [editing, setEditing] = useState<AwarenessCriterion | 'new' | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)
  const close = useCallback(() => setEditing(null), [])

  const update = useAction(({ id, body }: { id: string; body: CriterionInput }) => api<{ ok: true }>(`/api/settings/criteria/${encodeURIComponent(id)}`, { method: 'PUT', body }))

  const toggle = (c: AwarenessCriterion, active: boolean) => {
    setToggling(c.id)
    const { id: _id, ...rest } = c
    update.mutate(
      { id: c.id, body: { ...rest, active } },
      {
        onSuccess: () =>
          toast({
            tone: 'success',
            title: `${c.id} ${active ? 'activated' : 'deactivated'}`,
            body: active ? 'It can be selected when establishing awareness.' : 'It can no longer be selected. Awareness already recorded against it is unchanged.',
          }),
        onError: (e) => toast({ tone: 'error', title: `${c.id} not changed`, body: e.message }),
        onSettled: () => setToggling(null),
      },
    )
  }

  let index = 0
  return (
    <section aria-label="Awareness criteria">
      <SectionHeader
        eyebrow="Decisions"
        title="Awareness criteria"
        description={
          <>
            <p>
              Awareness events are recorded against these criteria. Each event names the criterion that was met, who met it and the evidence linked to it, and establishing awareness needs at least one linked evidence item of a listed type. Only active criteria can be selected.
            </p>
            <p>
              Once established, an awareness event is immutable. A correction is a new event that points at the original. Editing a criterion here does not rewrite awareness already recorded, and every edit is written to the audit ledger with its before and after.
            </p>
          </>
        }
        action={
          editable ? (
            <Button variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditing('new')}>
              Add criterion
            </Button>
          ) : undefined
        }
      />
      {!editable && <ReadOnlyNote role={role} className="mb-6" />}

      {criteria.length === 0 ? (
        <EmptyState
          icon={Radio}
          title="No awareness criteria"
          why="Without a criterion, awareness cannot be established, and no reporting clock can start. Define at least one vulnerability and one exploitation criterion."
          action={
            editable ? (
              <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditing('new')}>
                Add criterion
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-10">
          {SCOPES.map((s) => {
            const list = criteria.filter((c) => c.scope === s.scope)
            return (
              <div key={s.scope} className="min-w-0">
                <div className="mb-3 flex min-w-0 items-start gap-3">
                  <s.icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium text-ink">
                      {s.title} <span className="mono ml-1 text-xs font-normal text-ink-3">{list.length}</span>
                    </h3>
                    <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-ink-3">{s.explain}</p>
                  </div>
                </div>
                {list.length === 0 ? (
                  <p className="border-y border-line py-4 text-sm text-ink-3">No {s.scope} criteria. {s.title} cannot be established until one exists.</p>
                ) : (
                  <ul className="border-t border-line">
                    {list.map((c) => {
                      const i = index++
                      return (
                        <motion.li
                          key={c.id}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.04 }}
                          className={cx('grid min-w-0 gap-4 border-b border-line py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-8', !c.active && 'opacity-70')}
                        >
                          <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                              <span className="ident text-[12px] text-ink-3">{c.id}</span>
                              <span className="text-md text-ink">{c.label}</span>
                            </div>
                            <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-ink-2">{c.description}</p>
                            <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 text-xs">
                              <span className="inline-flex items-center gap-2">
                                <span className="micro">Scope</span>
                                <ScopeBadge scope={c.scope} />
                              </span>
                              <span className="inline-flex items-center gap-2">
                                <span className="micro">Confirmed by</span>
                                <span className="text-ink">{ROLES[c.responsibleRole].label}</span>
                              </span>
                            </div>
                            <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="micro mr-1">Required evidence</span>
                              {c.requiredEvidenceTypes.length === 0 ? (
                                <span className="inline-flex items-center gap-1.5 text-xs text-amber">
                                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> None required
                                </span>
                              ) : (
                                c.requiredEvidenceTypes.map((t) => (
                                  <Badge key={t} tone="violet" size="sm">
                                    {titleCase(t)}
                                  </Badge>
                                ))
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:justify-between">
                            {editable ? (
                              <span className="flex items-center gap-2.5">
                                <span className={cx('text-xs', c.active ? 'text-green' : 'text-ink-3')}>{c.active ? 'Active' : 'Inactive'}</span>
                                <Switch checked={c.active} onChange={(v) => toggle(c, v)} label={`${c.active ? 'Deactivate' : 'Activate'} ${c.id} ${c.label}`} busy={toggling === c.id} disabled={toggling !== null && toggling !== c.id} />
                              </span>
                            ) : (
                              <Badge tone={c.active ? 'green' : 'dim'} size="sm">
                                {c.active ? 'Active' : 'Inactive'}
                              </Badge>
                            )}
                            {editable && (
                              <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(c)} aria-label={`Edit ${c.id} ${c.label}`}>
                                Edit
                              </Button>
                            )}
                          </div>
                        </motion.li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Drawer
        open={editing !== null}
        onClose={close}
        eyebrow={editing === 'new' ? 'New awareness criterion' : editing ? `Edit ${editing.id}` : undefined}
        title={editing === 'new' ? 'Add criterion' : editing ? editing.label : 'Criterion'}
      >
        {editing !== null && <CriterionForm key={editing === 'new' ? 'new' : editing.id} criterion={editing === 'new' ? null : editing} onDone={close} />}
      </Drawer>
    </section>
  )
}

function CriterionForm({ criterion, onDone }: { criterion: AwarenessCriterion | null; onDone: () => void }) {
  const toast = useToast()
  const [label, setLabel] = useState(criterion?.label ?? '')
  const [description, setDescription] = useState(criterion?.description ?? '')
  const [scope, setScope] = useState<AwarenessScope>(criterion?.scope ?? 'vulnerability')
  const [responsibleRole, setResponsibleRole] = useState<RoleId>(criterion?.responsibleRole ?? 'psirt_lead')
  const [types, setTypes] = useState<EvidenceType[]>(criterion?.requiredEvidenceTypes ?? [])
  const [active, setActive] = useState(criterion?.active ?? true)
  const [attempted, setAttempted] = useState(false)

  const save = useAction<CriterionInput, { ok?: true; id?: string }>((body) =>
    criterion ? api<{ ok: true }>(`/api/settings/criteria/${encodeURIComponent(criterion.id)}`, { method: 'PUT', body }) : api<{ id: string }>('/api/settings/criteria', { method: 'POST', body }),
  )

  const errors: Partial<Record<'label' | 'description' | 'types', string>> = {}
  if (!label.trim()) errors.label = 'Name the criterion.'
  else if (label.length > 120) errors.label = 'At most 120 characters.'
  if (description.trim().length < 10) errors.description = 'Describe what must be true, in at least 10 characters.'
  else if (description.length > 1000) errors.description = 'At most 1,000 characters.'
  if (types.length > MAX_TYPES) errors.types = `At most ${MAX_TYPES} evidence types.`

  const toggleType = (t: EvidenceType) => setTypes((xs) => (xs.includes(t) ? xs.filter((x) => x !== t) : xs.length >= MAX_TYPES ? xs : [...xs, t]))

  const submit = () => {
    setAttempted(true)
    if (Object.keys(errors).length) return
    save.mutate(
      { label: label.trim(), description: description.trim(), scope, responsibleRole, requiredEvidenceTypes: types, active },
      {
        onSuccess: (res) => {
          const id = criterion?.id ?? res.id ?? 'Criterion'
          toast({ tone: 'success', title: criterion ? `${id} saved` : `${id} added`, body: 'Recorded in the audit ledger as SETTINGS_CHANGED.' })
          onDone()
        },
      },
    )
  }

  return (
    <form
      id="criterion-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="space-y-6"
    >
      <Field label="Label" required error={attempted ? errors.label : undefined}>
        {(id) => <TextInput id={id} data-autofocus value={label} onChange={(e) => setLabel(e.target.value)} invalid={attempted && !!errors.label} maxLength={240} />}
      </Field>

      <div>
        <div className="mb-1.5 text-xs font-medium text-ink-2">Scope</div>
        <Segmented
          label="Scope"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'vulnerability', label: 'Vulnerability awareness' },
            { value: 'exploitation', label: 'Exploitation awareness' },
          ]}
        />
        <p className="mt-1.5 text-xs text-ink-3">{SCOPES.find((s) => s.scope === scope)?.explain}</p>
      </div>

      <Field label="Confirmed by" hint="The role responsible for confirming the criterion is met.">
        {(id) => (
          <Select id={id} value={responsibleRole} onChange={(e) => setResponsibleRole(e.target.value as RoleId)}>
            {ROLE_ORDER.map((r) => (
              <option key={r} value={r}>
                {ROLES[r].label}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field label="Description" required error={attempted ? errors.description : undefined} hint="Write what must be true, as a regulator would read it.">
        {(id) => <TextArea id={id} value={description} onChange={(e) => setDescription(e.target.value)} invalid={attempted && !!errors.description} rows={5} maxLength={2000} />}
      </Field>

      <fieldset className="min-w-0">
        <legend className="mb-1.5 flex w-full items-baseline justify-between gap-2 text-xs font-medium text-ink-2">
          <span>Required evidence types</span>
          <span className="mono font-normal text-ink-3">
            {types.length} / {MAX_TYPES}
          </span>
        </legend>
        <p className="mb-3 text-xs text-ink-3">Establishing awareness needs at least one linked evidence item of one of these types.</p>
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {CRITERION_EVIDENCE_TYPES.map((t) => {
            const on = types.includes(t)
            const full = !on && types.length >= MAX_TYPES
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                disabled={full}
                onClick={() => toggleType(t)}
                className={cx(
                  'inline-flex h-7 items-center rounded-full border px-2.5 font-mono text-[10.5px] uppercase tracking-[0.08em] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40',
                  on ? 'border-violet-line bg-violet-soft text-violet' : 'border-line-strong bg-s2 text-ink-3 hover:border-line-bright hover:text-ink-2',
                )}
              >
                {titleCase(t)}
              </button>
            )
          })}
        </div>
        {types.length === 0 && (
          <Notice tone="amber" icon={AlertTriangle} className="mt-3">
            No evidence type selected. Awareness could then be established on assertion alone, with nothing linked to show what was known.
          </Notice>
        )}
      </fieldset>

      <Checkbox checked={active} onChange={setActive} label="Active" description="Active criteria can be selected when establishing awareness." />

      {save.error && <ErrorState error={save.error} />}

      <div className="sticky bottom-0 -mx-6 -mb-5 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-s1 px-6 py-4">
        <Button type="button" variant="ghost" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" busy={save.isPending}>
          {criterion ? 'Save criterion' : 'Add criterion'}
        </Button>
      </div>
    </form>
  )
}

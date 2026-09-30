import { useState } from 'react'
import { Link } from 'react-router'
import { motion } from 'motion/react'
import { AlertTriangle, ArrowRight, CheckCheck, Clock, FileText, Fingerprint, GitBranch, Info, Link2, MessageSquare, Scale, ShieldQuestion, UserRound, X } from 'lucide-react'
import type { ChangeItem } from '../../../types/api.ts'
import type { CaseRelationType } from '../../../types/domain.ts'
import { api } from '../../../lib/client/api.ts'
import { useAction, useCases } from '../../../lib/client/queries.ts'
import { useSession } from '../../../lib/client/session.tsx'
import { short, stamp } from '../../../lib/client/format.ts'
import { ROLES } from '../../../lib/rbac.ts'
import { Button, Field, Ident, KeyValue, Select, TextArea, TextInput, cx } from '../../../components/ui/primitives.tsx'
import { CaseStatusBadge, HealthBadge } from '../../../components/ui/status.tsx'
import { EmptyState, ErrorState, Notice } from '../../../components/ui/feedback.tsx'
import { Modal, useToast } from '../../../components/ui/overlay.tsx'
import { Relative } from '../../../components/ui/time.tsx'
import { SectionTitle, useCaseCtx } from './shared.tsx'

const CATEGORY_ICON: Record<ChangeItem['category'], typeof Clock> = {
  evidence: Fingerprint,
  status: Scale,
  timestamp: Clock,
  affectedness: ShieldQuestion,
  deadline: AlertTriangle,
  review: UserRound,
  report: FileText,
  other: Info,
}
const CATEGORY_LABEL: Record<ChangeItem['category'], string> = {
  evidence: 'New evidence',
  status: 'Changed status',
  timestamp: 'New timestamp',
  affectedness: 'Changed affectedness',
  deadline: 'New deadline',
  review: 'Review and ownership',
  report: 'New report version',
  other: 'Other',
}

function WhatChanged() {
  const { data, name } = useCaseCtx()
  const toast = useToast()
  const mark = useAction(() => api(`/api/cases/${data.bundle.case.id}/reviewed`, { method: 'POST' }))
  const ch = data.changes
  const items = ch.since ? ch.items : ch.items.slice(-10)
  const grouped = new Map<ChangeItem['category'], ChangeItem[]>()
  for (const i of items) grouped.set(i.category, [...(grouped.get(i.category) ?? []), i])
  return (
    <section aria-labelledby="changed-h" className="panel p-5 sm:p-6">
      <SectionTitle
        eyebrow={ch.since ? `Since your last review · ${short(ch.since)}` : 'You have not reviewed this case'}
        title="What changed since last review?"
        id="changed-h"
        action={
          <Button
            size="sm"
            icon={<CheckCheck className="h-3.5 w-3.5" />}
            busy={mark.isPending}
            disabled={ch.items.length === 0}
            onClick={async () => {
              await mark.mutateAsync(undefined)
              toast({ tone: 'success', title: 'Marked as reviewed', body: 'Future changes are shown from this point.' })
            }}
          >
            Mark as reviewed
          </Button>
        }
      />
      {items.length === 0 ? (
        <p className="text-sm text-ink-3">No changes since your last review.</p>
      ) : (
        <div className="space-y-5">
          {!ch.since && <p className="text-xs text-ink-3">Showing the latest {items.length} of {ch.items.length} ledger entries for this case.</p>}
          {[...grouped.entries()].map(([cat, list]) => {
            const Icon = CATEGORY_ICON[cat]
            return (
              <div key={cat}>
                <div className="micro mb-2 flex items-center gap-2 text-ink-2">
                  <Icon className="h-3.5 w-3.5" /> {CATEGORY_LABEL[cat]} <span className="text-ink-4">{list.length}</span>
                </div>
                <ul className="space-y-1.5 border-l border-line-strong pl-4">
                  {list.map((i) => (
                    <li key={i.seq} className="text-sm">
                      <span className="text-ink">{i.summary}</span>
                      <span className="ml-2 text-xs text-ink-3">
                        {name(i.actorId)} · <Relative iso={i.at} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function Gaps() {
  const { data, setTab } = useCaseCtx()
  const { gaps } = data.analysis
  if (gaps.canFinalize) {
    return (
      <Notice tone="green" icon={CheckCheck} title="No blocking gaps">
        Every item needed to finalize the determination is on the record.
      </Notice>
    )
  }
  return (
    <section aria-labelledby="gaps-h" className="rounded-xl border border-amber-line bg-amber/[0.036] p-5 sm:p-6">
      <div className="micro mb-1.5 text-amber">Evidence gap detection</div>
      <h2 id="gaps-h" className="text-lg font-medium text-ink">
        {gaps.blockingSummary}
      </h2>
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <div>
          <div className="micro mb-2">Missing</div>
          <ul className="space-y-2.5">
            {gaps.gaps.map((g) => (
              <li key={g.id} className="text-sm">
                <div className="text-ink">{g.label}</div>
                <div className="mt-0.5 text-xs text-ink-3">{g.detail}</div>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="micro mb-2">Suggested next actions</div>
          <ul className="space-y-2">
            {gaps.gaps.map((g) => (
              <li key={g.id}>
                <button type="button" onClick={() => setTab(g.tab)} className="group flex items-start gap-2 text-left text-sm text-ink-2 hover:text-ink">
                  <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-amber" />
                  <span>{g.nextAction}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mt-5 text-xs text-ink-3">NEXUS does not resolve a case on its own. These items stay open until someone records the evidence.</p>
    </section>
  )
}

function Quality() {
  const { data, setTab } = useCaseCtx()
  const q = data.analysis.quality
  if (q.length === 0) return null
  return (
    <section aria-labelledby="quality-h">
      <SectionTitle eyebrow="Data quality" title="Data quality warnings" id="quality-h" />
      <ul className="divide-y divide-line rounded-xl border border-line">
        {q.map((f) => (
          <li key={f.id} className="flex gap-3 px-4 py-3.5">
            {f.severity === 'error' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red" /> : f.severity === 'warning' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue" />}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className={cx('micro', f.severity === 'error' ? 'text-red' : f.severity === 'warning' ? 'text-amber' : 'text-blue')}>{f.severity === 'info' ? 'Note' : 'Data quality warning'}</span>
                <span className="text-sm text-ink">{f.title}</span>
              </div>
              <p className="mt-1 text-xs text-ink-2 [overflow-wrap:anywhere]">{f.detail}</p>
            </div>
            <button type="button" onClick={() => setTab(f.tab)} className="shrink-0 self-start text-xs text-ink-3 hover:text-ink">
              Open →
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-3">NEXUS never fixes records silently. Timestamps are corrected through correction events that keep the original.</p>
    </section>
  )
}

function Comments() {
  const { data, name } = useCaseCtx()
  const { can } = useSession()
  const [body, setBody] = useState('')
  const [error, setError] = useState<unknown>(null)
  const post = useAction((b: string) => api(`/api/cases/${data.bundle.case.id}/comments`, { body: { body: b } }))
  const mentions = ['@PSIRT', '@Compliance', '@SecurityLead', '@Legal']
  return (
    <section aria-labelledby="comments-h">
      <SectionTitle eyebrow="Collaboration" title="Comments" id="comments-h" />
      <p className="-mt-2 mb-4 text-xs text-ink-3">Comments are working notes. They are kept apart from the immutable audit ledger and carry no evidentiary weight.</p>
      {data.comments.length === 0 ? (
        <EmptyState compact icon={MessageSquare} title="No comments" why="Use comments to coordinate. Mention a group to notify it." />
      ) : (
        <ol className="space-y-4">
          {data.comments.map((c, i) => (
            <motion.li key={c.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-strong bg-s2 font-mono text-[10px] text-ink-3">
                {name(c.authorId)
                  .split(' ')
                  .map((p) => p[0])
                  .join('')}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm text-ink">{name(c.authorId)}</span>
                  <span className="mono text-[11px] text-ink-3" title={stamp(c.createdAt)}>
                    {short(c.createdAt)}
                  </span>
                  {c.relatedEventId && <Ident dim className="text-[11px]">re {c.relatedEventId}</Ident>}
                  {c.relatedEvidenceId && <Ident dim className="text-[11px]">re {c.relatedEvidenceId}</Ident>}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink-2">
                  {c.body.split(/(@[A-Za-z]+)/g).map((part, k) =>
                    /^@[A-Za-z]+$/.test(part) ? (
                      <span key={k} className="rounded bg-blue-soft px-1 text-blue">
                        {part}
                      </span>
                    ) : (
                      <span key={k}>{part}</span>
                    ),
                  )}
                </p>
              </div>
            </motion.li>
          ))}
        </ol>
      )}
      {can('comment.write') && (
        <form
          className="mt-6"
          onSubmit={async (e) => {
            e.preventDefault()
            setError(null)
            try {
              await post.mutateAsync(body)
              setBody('')
            } catch (err) {
              setError(err)
            }
          }}
        >
          <TextArea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Add a comment. Mention @PSIRT, @Compliance, @SecurityLead or @Legal to notify them." aria-label="Comment" />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {mentions.map((m) => (
                <button key={m} type="button" onClick={() => setBody((b) => `${b}${b && !b.endsWith(' ') ? ' ' : ''}${m} `)} className="mono rounded border border-line-strong px-1.5 py-0.5 text-[11px] text-ink-3 hover:text-ink">
                  {m}
                </button>
              ))}
            </div>
            <Button type="submit" size="sm" disabled={!body.trim()} busy={post.isPending}>
              Comment
            </Button>
          </div>
          {error !== null && <ErrorState error={error} className="mt-3" />}
        </form>
      )}
    </section>
  )
}

function Related() {
  const { data } = useCaseCtx()
  const { can } = useSession()
  const all = useCases()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState('')
  const [relation, setRelation] = useState<CaseRelationType>('RELATED_CVE')
  const [note, setNote] = useState('')
  const [error, setError] = useState<unknown>(null)
  const add = useAction((b: unknown) => api(`/api/cases/${data.bundle.case.id}/relations`, { body: b }))
  const writable = can('case.edit') && data.canWrite
  return (
    <section aria-labelledby="related-h">
      <SectionTitle
        eyebrow="Related cases"
        id="related-h"
        action={
          writable && (
            <Button size="sm" variant="ghost" icon={<Link2 className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>
              Relate
            </Button>
          )
        }
      />
      {data.relations.length === 0 && data.suggestedRelations.length === 0 && <p className="text-xs text-ink-3">No related cases.</p>}
      <ul className="space-y-2.5">
        {data.relations.map((r) => (
          <li key={r.id}>
            <Link to={`/cases/${r.other.id}`} className="group block rounded-lg border border-line px-3 py-2.5 transition-colors hover:border-line-bright hover:bg-s2">
              <div className="flex items-center justify-between gap-2">
                <Ident className="text-[11.5px] group-hover:text-amber">{r.other.id}</Ident>
                <CaseStatusBadge status={r.other.status} size="sm" />
              </div>
              <div className="mt-1 truncate text-xs text-ink-2">{r.other.title}</div>
              <div className="micro mt-1.5 text-ink-4">{r.relation.replace(/_/g, ' ')}</div>
            </Link>
          </li>
        ))}
      </ul>
      {data.suggestedRelations.length > 0 && (
        <div className="mt-4">
          <div className="micro mb-2 flex items-center gap-1.5 text-amber">
            <GitBranch className="h-3 w-3" /> Possible duplicate investigation
          </div>
          <ul className="space-y-2">
            {data.suggestedRelations.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-line-strong px-3 py-2">
                <Link to={`/cases/${s.id}`} className="min-w-0">
                  <Ident className="text-[11.5px]">{s.id}</Ident>
                  <div className="truncate text-xs text-ink-3">{s.reason}</div>
                </Link>
                {writable && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setTarget(s.id)
                      setOpen(true)
                    }}
                  >
                    Relate
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        eyebrow={data.bundle.case.id}
        title="Relate a case"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!target}
              busy={add.isPending}
              onClick={async () => {
                setError(null)
                try {
                  await add.mutateAsync({ relatedCaseId: target, relation, note })
                  toast({ tone: 'success', title: 'Relation recorded' })
                  setOpen(false)
                } catch (e) {
                  setError(e)
                }
              }}
            >
              Relate case
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Case" required>
            {(id) => (
              <Select id={id} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Select a case</option>
                {(all.data ?? []).filter((c) => c.id !== data.bundle.case.id).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} · {c.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Relation">
            {(id) => (
              <Select id={id} value={relation} onChange={(e) => setRelation(e.target.value as CaseRelationType)}>
                <option value="RELATED_CVE">Related CVE</option>
                <option value="RELATED_PRODUCT">Related product</option>
                <option value="RELATED_ADVISORY">Related vendor advisory</option>
                <option value="RELATED_INCIDENT">Related incident</option>
                <option value="RELATED_CORRECTIVE_MEASURE">Related corrective measure</option>
                <option value="DUPLICATE_OF">Duplicate of</option>
              </Select>
            )}
          </Field>
          <Field label="Note">{(id) => <TextInput id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          {error !== null && <ErrorState error={error} />}
        </div>
      </Modal>
    </section>
  )
}

function Team() {
  const { data, name, users } = useCaseCtx()
  const { can } = useSession()
  const toast = useToast()
  const c = data.bundle.case
  const [editing, setEditing] = useState(false)
  const [tags, setTags] = useState(c.tags.join(', '))
  const [collab, setCollab] = useState<string[]>(c.collaboratorIds)
  const save = useAction((b: unknown) => api(`/api/cases/${c.id}`, { method: 'PATCH', body: b }))
  const writable = can('case.edit') && data.canWrite
  return (
    <section aria-labelledby="team-h">
      <SectionTitle
        eyebrow="Team and tags"
        id="team-h"
        action={
          writable && !editing && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )
        }
      />
      <dl className="space-y-3">
        <KeyValue label="Owner">
          {name(c.ownerId)} <span className="text-ink-3">· {ROLES[users.find((u) => u.id === c.ownerId)?.role ?? 'psirt_analyst'].label}</span>
        </KeyValue>
        {!editing ? (
          <>
            <KeyValue label="Collaborators">{c.collaboratorIds.length ? c.collaboratorIds.map(name).join(', ') : <span className="text-ink-3">None</span>}</KeyValue>
            <KeyValue label="Tags">
              {c.tags.length ? (
                <span className="flex flex-wrap gap-1.5">
                  {c.tags.map((t) => (
                    <span key={t} className="mono rounded border border-line-strong px-1.5 py-0.5 text-[11px] text-ink-2">
                      {t}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="text-ink-3">None</span>
              )}
            </KeyValue>
          </>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="micro mb-1.5">Collaborators</div>
              <div className="flex flex-wrap gap-1.5">
                {users
                  .filter((u) => u.id !== c.ownerId && u.role !== 'read_only')
                  .map((u) => {
                    const on = collab.includes(u.id)
                    return (
                      <button key={u.id} type="button" onClick={() => setCollab((xs) => (on ? xs.filter((x) => x !== u.id) : [...xs, u.id]))} className={cx('rounded-md border px-2 py-1 text-xs transition-colors', on ? 'border-amber-line bg-amber-soft text-ink' : 'border-line-strong text-ink-3 hover:text-ink')} aria-pressed={on}>
                        {u.name}
                      </button>
                    )
                  })}
              </div>
            </div>
            <Field label="Tags" hint="Comma separated">
              {(id) => <TextInput id={id} value={tags} onChange={(e) => setTags(e.target.value)} />}
            </Field>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="primary"
                busy={save.isPending}
                onClick={async () => {
                  try {
                    await save.mutateAsync({ collaboratorIds: collab, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) })
                    toast({ tone: 'success', title: 'Case updated' })
                    setEditing(false)
                  } catch (e) {
                    toast({ tone: 'error', title: 'Case not updated', body: e instanceof Error ? e.message : String(e) })
                  }
                }}
              >
                Save
              </Button>
              <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </dl>
    </section>
  )
}

export function OverviewTab() {
  const { data } = useCaseCtx()
  const { bundle, analysis } = data
  const v = bundle.vulnerability
  return (
    <div className="grid min-w-0 gap-12 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-10">
        <section aria-label="Summary" className="min-w-0">
          <div className="micro mb-2">Vulnerability</div>
          <h2 className="text-lg font-medium text-ink">{v.title}</h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-2">{v.description}</p>
          {bundle.case.summary && <p className="mt-3 max-w-3xl text-sm text-ink-3">{bundle.case.summary}</p>}
          <dl className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <KeyValue label="CWE" mono>
              {v.cwe ?? '--'}
            </KeyValue>
            <KeyValue label="Component" mono>
              {bundle.components.find((c) => c.id === v.componentId)?.name ?? '--'}
            </KeyValue>
            <KeyValue label="Affected" mono>
              {v.affectedVersions}
            </KeyValue>
            <KeyValue label="Fixed in" mono>
              {v.fixedVersion ?? '--'}
            </KeyValue>
            <KeyValue label="Exploitability">{v.exploitability || '--'}</KeyValue>
            <KeyValue label="Source">{v.source}</KeyValue>
            <KeyValue label="Discovered" mono>
              {short(v.discoveredAt)}
            </KeyValue>
            <KeyValue label="Vector" mono>
              {v.cvssVector ?? '--'}
            </KeyValue>
          </dl>
          <Link to={`/vulnerabilities/${v.id}`} className="mt-5 inline-flex items-center gap-1.5 text-xs text-ink-2 hover:text-amber">
            Vulnerability record and threat intelligence <ArrowRight className="h-3 w-3" />
          </Link>
        </section>
        <WhatChanged />
        <Gaps />
        <Quality />
        <Comments />
      </div>
      <aside className="min-w-0 space-y-10">
        <section aria-label="Case health">
          <div className="micro mb-2">Case health</div>
          <HealthBadge state={analysis.health.state} />
          <p className="mt-2 text-sm text-ink-2">{analysis.health.reason}</p>
          <p className="mt-2 text-xs text-ink-3">An operational state with a stated reason, not a score.</p>
        </section>
        <Team />
        <Related />
      </aside>
    </div>
  )
}


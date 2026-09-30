import { Fragment, useState } from 'react'
import { motion } from 'motion/react'
import { Check, CircleSlash, Minus, UserCheck, Users } from 'lucide-react'
import type { Permission, RoleId, User } from '../../types/domain.ts'
import { APPROVAL_POLICY, PERMISSIONS, PERMISSION_LABELS, ROLES, ROLE_ORDER, can } from '../../lib/rbac.ts'
import { Field, Panel, Select, Skeleton, cx } from '../ui/primitives.tsx'
import { Badge } from '../ui/status.tsx'
import { EmptyState, ErrorState, Notice } from '../ui/feedback.tsx'
import { SectionHeader } from './common.tsx'

/**
 * Users and Roles. Both read-only: people come from the identity provider,
 * and the permission matrix is code (lib/rbac.ts), enforced by the server on
 * every request. The browser reads the same table only to decide what to show.
 */

// Users -----------------------------------------------------------------------------

export function UsersSection({ users, loading, error, meId }: { users: User[] | undefined; loading: boolean; error: unknown; meId: string | undefined }) {
  return (
    <section aria-label="Users">
      <SectionHeader
        eyebrow="Organization"
        title="Users"
        description={
          <p>
            In production, people are provisioned through the organization&apos;s identity provider, and their role comes from the directory group they belong to. This demo has a fixed set of fictional personas, one per role, so that every permission boundary can be tried. Switch persona from the account menu.
          </p>
        }
        action={users ? <span className="micro tabular">n = {users.length} users</span> : undefined}
      />
      {error ? (
        <ErrorState error={error} />
      ) : loading || !users ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading users">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <EmptyState icon={Users} title="No users" why="No user records were returned. Without users nobody can establish awareness, record a decision or approve a report. Reset the demo data to restore the personas." />
      ) : (
        <Panel className="overflow-hidden">
          <table className="hidden w-full text-left md:table">
            <caption className="sr-only">Users and their roles</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="micro px-6 py-3 font-normal">Person</th>
                <th scope="col" className="micro px-3 py-3 font-normal">Email</th>
                <th scope="col" className="micro px-3 py-3 font-normal">Title</th>
                <th scope="col" className="micro px-3 py-3 font-normal">Role</th>
                <th scope="col" className="micro px-6 py-3 text-right font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="row-line last:border-b-0">
                  <td className="px-6 py-3">
                    <PersonCell user={u} me={u.id === meId} />
                  </td>
                  <td className="max-w-[240px] px-3 py-3">
                    <span className="ident text-[12.5px] text-ink-2">{u.email}</span>
                  </td>
                  <td className="px-3 py-3 text-sm text-ink-2">{u.title}</td>
                  <td className="px-3 py-3 text-sm text-ink">{ROLES[u.role].label}</td>
                  <td className="px-6 py-3 text-right">
                    <ActiveMark active={u.active} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="divide-y divide-line md:hidden">
            {users.map((u) => (
              <li key={u.id} className="min-w-0 px-5 py-4">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <PersonCell user={u} me={u.id === meId} />
                  <ActiveMark active={u.active} />
                </div>
                <dl className="mt-3 grid min-w-0 gap-2 pl-11 text-sm">
                  <div className="min-w-0">
                    <dt className="sr-only">Role</dt>
                    <dd className="text-ink">{ROLES[u.role].label}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="sr-only">Title</dt>
                    <dd className="text-ink-2">{u.title}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="sr-only">Email</dt>
                    <dd className="ident text-[12.5px] text-ink-3">{u.email}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </section>
  )
}

function PersonCell({ user, me }: { user: User; me: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line-strong bg-s2 font-mono text-[11px] text-ink-2" aria-hidden>
        {user.initials}
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm text-ink">{user.name}</span>
          {me && (
            <Badge tone="neutral" size="sm" icon={UserCheck}>
              You
            </Badge>
          )}
        </span>
        <span className="ident block text-[11px] text-ink-3">{user.id}</span>
      </span>
    </span>
  )
}

function ActiveMark({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex items-center gap-1.5 text-xs text-green">
      <Check className="h-3.5 w-3.5" aria-hidden strokeWidth={2.25} /> Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-3">
      <CircleSlash className="h-3.5 w-3.5" aria-hidden /> Inactive
    </span>
  )
}

// Roles ------------------------------------------------------------------------------

const GROUPS: Array<{ label: string; permissions: Permission[] }> = [
  { label: 'Cases', permissions: ['case.create', 'case.edit', 'case.assign', 'case.close', 'case.reopen', 'case.archive'] },
  { label: 'Portfolio and intake', permissions: ['vulnerability.write', 'product.write', 'import.commit'] },
  { label: 'Clock and decisions', permissions: ['awareness.establish', 'clock.record', 'clock.correct', 'determination.record', 'decision.record'] },
  { label: 'Review and reporting', permissions: ['report.generate', 'review.approve', 'submission.advance', 'submission.submit'] },
  { label: 'Evidence', permissions: ['evidence.read', 'evidence.read_restricted', 'evidence.write'] },
  { label: 'Ledger and collaboration', permissions: ['ledger.verify', 'comment.write'] },
  { label: 'Administration', permissions: ['settings.manage', 'demo.control'] },
]

function permissionGroups(): Array<{ label: string; permissions: Permission[] }> {
  const grouped = new Set(GROUPS.flatMap((g) => g.permissions))
  const rest = PERMISSIONS.filter((p) => !grouped.has(p))
  return rest.length ? [...GROUPS, { label: 'Other', permissions: rest }] : GROUPS
}

const REPORT_KINDS: Array<{ kind: string; label: string; basis: string }> = [
  { kind: 'EARLY_WARNING', label: 'Early warning', basis: 'Art. 14(2)(a) · within 24 hours of awareness' },
  { kind: 'VULNERABILITY_NOTIFICATION', label: 'Vulnerability notification', basis: 'Art. 14(2)(b) · within 72 hours of awareness' },
  { kind: 'FINAL_REPORT', label: 'Final report', basis: 'Art. 14(2)(c) · 14 days after a measure is available' },
  { kind: 'DECISION_RECORD', label: 'Decision record', basis: 'A decision not to report' },
]

function Granted({ yes }: { yes: boolean }) {
  return yes ? (
    <>
      <Check className="mx-auto h-4 w-4 text-green" aria-hidden strokeWidth={2.25} />
      <span className="sr-only">Granted</span>
    </>
  ) : (
    <>
      <Minus className="mx-auto h-3.5 w-3.5 text-ink-4" aria-hidden />
      <span className="sr-only">Not granted</span>
    </>
  )
}

export function RolesSection({ myRole }: { myRole: RoleId | undefined }) {
  const groups = permissionGroups()
  const [mobileRole, setMobileRole] = useState<RoleId>(myRole ?? 'psirt_lead')
  const counts = Object.fromEntries(ROLE_ORDER.map((r) => [r, PERMISSIONS.filter((p) => can(r, p)).length])) as Record<RoleId, number>

  return (
    <section aria-label="Roles">
      <SectionHeader
        eyebrow="Organization"
        title="Roles"
        description={
          <p>
            Nine roles, each a fixed set of permissions. The server checks the permission on every request, together with object-level checks such as case ownership; hiding a control in the interface is a courtesy, not the control. The matrix is defined in code and changes only with a release.
          </p>
        }
        action={<span className="micro tabular">{PERMISSIONS.length} permissions · {ROLE_ORDER.length} roles</span>}
      />

      <dl className="mb-10 grid min-w-0 border-t border-line md:grid-cols-2 md:gap-x-10">
        {ROLE_ORDER.map((r) => (
          <div key={r} className="min-w-0 border-b border-line py-3.5">
            <dt className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="text-sm text-ink">
                {ROLES[r].label}
                {r === myRole && <span className="micro ml-2 text-ink-2">Your role</span>}
              </span>
              <span className="mono text-[11px] text-ink-3">
                {counts[r]} / {PERMISSIONS.length}
              </span>
            </dt>
            <dd className="mt-1 text-xs leading-relaxed text-ink-3">{ROLES[r].description}</dd>
          </div>
        ))}
      </dl>

      <div className="micro mb-3">Permission matrix</div>

      {/* Desktop: full matrix */}
      <Panel className="hidden overflow-hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <caption className="sr-only">Permissions granted to each role</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="micro px-5 pb-3 align-bottom font-normal">
                  Permission
                </th>
                {ROLE_ORDER.map((r) => (
                  <th key={r} scope="col" className={cx('w-[52px] px-1 pb-3 pt-4 align-bottom font-normal', r === myRole && 'bg-s2')}>
                    <span className={cx('mx-auto block rotate-180 whitespace-nowrap font-mono text-[10.5px] uppercase tracking-[0.1em] [writing-mode:vertical-rl]', r === myRole ? 'text-ink' : 'text-ink-3')}>
                      {ROLES[r].label}
                    </span>
                    {r === myRole && <span className="sr-only"> (your role)</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.label}>
                  <tr className="border-b border-line">
                    <th scope="colgroup" colSpan={ROLE_ORDER.length + 1} className="micro bg-s2/50 px-5 py-2 font-normal text-ink-2">
                      {g.label}
                    </th>
                  </tr>
                  {g.permissions.map((p) => (
                    <tr key={p} className="row-line">
                      <th scope="row" className="px-5 py-2.5 font-normal">
                        <span className="block text-sm text-ink">{PERMISSION_LABELS[p]}</span>
                        <span className="ident block text-[11px] text-ink-3">{p}</span>
                      </th>
                      {ROLE_ORDER.map((r) => (
                        <td key={r} className={cx('px-1 py-2.5 text-center', r === myRole && 'bg-s2/70')}>
                          <Granted yes={can(r, p)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="micro px-5 py-3 font-normal">
                  Granted
                </th>
                {ROLE_ORDER.map((r) => (
                  <td key={r} className={cx('mono px-1 py-3 text-center text-xs text-ink-2', r === myRole && 'bg-s2')}>
                    {counts[r]}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </Panel>

      {/* Mobile: one role at a time */}
      <div className="md:hidden">
        <Field label="Show permissions for">
          {(id) => (
            <Select id={id} value={mobileRole} onChange={(e) => setMobileRole(e.target.value as RoleId)}>
              {ROLE_ORDER.map((r) => (
                <option key={r} value={r}>
                  {ROLES[r].label}
                  {r === myRole ? ' (your role)' : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <p className="mt-2 text-xs text-ink-3">
          <span className="mono text-ink-2">{counts[mobileRole]}</span> of {PERMISSIONS.length} permissions granted.
        </p>
        <motion.div key={mobileRole} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="mt-4 space-y-5">
          {groups.map((g) => (
            <div key={g.label} className="min-w-0">
              <div className="micro mb-1 text-ink-2">{g.label}</div>
              <ul className="divide-y divide-line border-y border-line">
                {g.permissions.map((p) => {
                  const yes = can(mobileRole, p)
                  return (
                    <li key={p} className="flex min-w-0 items-center justify-between gap-3 py-2.5">
                      <span className="min-w-0">
                        <span className={cx('block text-sm', yes ? 'text-ink' : 'text-ink-3')}>{PERMISSION_LABELS[p]}</span>
                        <span className="ident block text-[11px] text-ink-3">{p}</span>
                      </span>
                      <span className="w-5 shrink-0">
                        <Granted yes={yes} />
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </motion.div>
      </div>

      <div className="mt-12">
        <div className="micro mb-1">Approval policy</div>
        <p className="mb-4 max-w-2xl text-sm text-ink-2">Which roles must approve each report kind. A report moves to Approved as soon as its policy is satisfied, and not before.</p>
        <ol className="border-t border-line">
          {REPORT_KINDS.map(({ kind, label, basis }) => {
            const policy = APPROVAL_POLICY[kind]
            if (!policy) return null
            return (
              <li key={kind} className="grid min-w-0 gap-3 border-b border-line py-4 md:grid-cols-[240px_minmax(0,1fr)] md:gap-8">
                <div className="min-w-0">
                  <div className="text-sm text-ink">{label}</div>
                  <div className="mt-0.5 text-xs text-ink-3">{basis}</div>
                  <div className="ident mt-1 text-[11px] text-ink-3">{kind}</div>
                </div>
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {policy.anyOf.map((set, i) => (
                      <Fragment key={i}>
                        {i > 0 && <span className="micro px-0.5">or</span>}
                        <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
                          {set.map((r, j) => (
                            <Fragment key={r}>
                              {j > 0 && <span className="text-xs text-ink-3">and</span>}
                              <span className="inline-flex h-6 items-center rounded-md border border-line-strong bg-s2 px-2 text-xs text-ink">{ROLES[r].label}</span>
                            </Fragment>
                          ))}
                        </span>
                      </Fragment>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-ink-3">{policy.label}</p>
                </div>
              </li>
            )
          })}
        </ol>
        <Notice tone="neutral" icon={UserCheck} title="Separation of duties" className="mt-5">
          An approval must come from someone other than the person who generated the report and the analyst who recorded the decision. Holding an approving role is not enough: the server refuses a self-approval with <span className="ident text-ink">SEPARATION_OF_DUTIES</span>, whatever the role.
        </Notice>
      </div>
    </section>
  )
}

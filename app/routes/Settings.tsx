import { useSearchParams } from 'react-router'
import { motion } from 'motion/react'
import { AlarmClock, Bell, BookOpen, Building2, Contrast, FlaskConical, Fingerprint, KeyRound, Lock, Radio, ScrollText, ShieldCheck, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useSession } from '../../lib/client/session.tsx'
import { useSettings, useUsers } from '../../lib/client/queries.ts'
import { Field, PageHeader, Select, Skeleton, cx } from '../../components/ui/primitives.tsx'
import { Badge } from '../../components/ui/status.tsx'
import { ErrorState } from '../../components/ui/feedback.tsx'
import { OrganizationSection } from '../../components/settings/OrganizationSection.tsx'
import { RolesSection, UsersSection } from '../../components/settings/AccessSections.tsx'
import { CriteriaSection } from '../../components/settings/CriteriaSection.tsx'
import { EscalationSection } from '../../components/settings/EscalationSection.tsx'
import { AppearanceSection, AuditSection, EvidenceSection, NotificationsSection, RulesSection } from '../../components/settings/PolicySections.tsx'
import { DemoSection } from '../../components/settings/DemoSection.tsx'

/**
 * Settings. One section at a time, chosen by ?section= so a section can be
 * linked to. Every role can read every section; only the Administrator role
 * can change anything, and the server enforces that on each write.
 */

type SectionId = 'organization' | 'users' | 'roles' | 'criteria' | 'rules' | 'notifications' | 'escalation' | 'evidence' | 'audit' | 'appearance' | 'demo'

const SECTIONS: Array<{ id: SectionId; label: string; group: string; icon: LucideIcon }> = [
  { id: 'organization', label: 'Organization', group: 'Organization', icon: Building2 },
  { id: 'users', label: 'Users', group: 'Organization', icon: Users },
  { id: 'roles', label: 'Roles', group: 'Organization', icon: KeyRound },
  { id: 'criteria', label: 'Awareness Criteria', group: 'Decisions', icon: Radio },
  { id: 'rules', label: 'Rules', group: 'Decisions', icon: BookOpen },
  { id: 'notifications', label: 'Notification Policies', group: 'Decisions', icon: Bell },
  { id: 'escalation', label: 'Deadline Escalation', group: 'Decisions', icon: AlarmClock },
  { id: 'evidence', label: 'Evidence Policies', group: 'Record', icon: Fingerprint },
  { id: 'audit', label: 'Audit Settings', group: 'Record', icon: ScrollText },
  { id: 'appearance', label: 'Appearance', group: 'Workspace', icon: Contrast },
  { id: 'demo', label: 'Demo Mode', group: 'Workspace', icon: FlaskConical },
]

const GROUPS = Array.from(new Set(SECTIONS.map((s) => s.group)))

function isSection(v: string | null): v is SectionId {
  return SECTIONS.some((s) => s.id === v)
}

export function Settings() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('section')
  const section: SectionId = isSection(raw) ? raw : 'organization'
  const { session, can, demoMode: sessionDemo } = useSession()
  const settings = useSettings()
  const users = useUsers()
  const editable = can('settings.manage')
  const role = session?.user.role
  const demoMode = settings.data?.demoMode ?? sessionDemo

  const go = (id: SectionId) => {
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        next.set('section', id)
        return next
      },
      { replace: true },
    )
    if (window.scrollY > 200) window.scrollTo({ top: 0 })
  }

  const counts: Partial<Record<SectionId, number>> = {
    users: users.data?.length,
    criteria: settings.data?.criteria.filter((c) => c.active).length,
    escalation: settings.data?.escalation.filter((r) => r.active).length,
  }

  const needsSettings = (body: (s: NonNullable<typeof settings.data>) => ReactNode) =>
    settings.error ? (
      <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
    ) : !settings.data ? (
      <div className="space-y-4" aria-busy="true" aria-label="Loading settings">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-16 max-w-2xl" />
        <Skeleton className="h-64" />
      </div>
    ) : (
      body(settings.data)
    )

  let content: ReactNode
  switch (section) {
    case 'organization':
      content = needsSettings((s) => <OrganizationSection org={s.org} editable={editable} role={role} />)
      break
    case 'users':
      content = <UsersSection users={users.data} loading={users.isLoading} error={users.error} meId={session?.user.id} />
      break
    case 'roles':
      content = <RolesSection myRole={role} />
      break
    case 'criteria':
      content = needsSettings((s) => <CriteriaSection criteria={s.criteria} editable={editable} role={role} />)
      break
    case 'rules':
      content = <RulesSection />
      break
    case 'notifications':
      content = <NotificationsSection />
      break
    case 'escalation':
      content = needsSettings((s) => <EscalationSection rules={s.escalation} editable={editable} role={role} />)
      break
    case 'evidence':
      content = needsSettings((s) => <EvidenceSection policy={s.evidencePolicy} />)
      break
    case 'audit':
      content = <AuditSection />
      break
    case 'appearance':
      content = <AppearanceSection />
      break
    case 'demo':
      content = <DemoSection demoMode={demoMode} />
      break
  }

  return (
    <div className="min-w-0">
      <PageHeader
        eyebrow="Govern"
        title="Settings"
        description="How this organization defines awareness, who may do what, when deadlines escalate, and how evidence and the ledger are protected. Every change made here is written to the audit ledger."
        actions={
          editable ? (
            <Badge tone="green" icon={ShieldCheck}>
              Administrator · can edit
            </Badge>
          ) : (
            <Badge tone="dim" icon={Lock}>
              Read only for your role
            </Badge>
          )
        }
      />

      <div className="grid min-w-0 gap-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12">
        <div className="min-w-0">
          <div className="lg:hidden">
            <Field label="Section">
              {(id) => (
                <Select id={id} value={section} onChange={(e) => isSection(e.target.value) && go(e.target.value)}>
                  {GROUPS.map((g) => (
                    <optgroup key={g} label={g}>
                      {SECTIONS.filter((s) => s.group === g).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <nav aria-label="Settings sections" className="sticky top-20 hidden lg:block">
            {GROUPS.map((g, gi) => (
              <div key={g} className={cx(gi > 0 && 'mt-5')}>
                <div className="micro px-3 pb-1.5 text-ink-4">{g}</div>
                <ul className="flex flex-col gap-0.5">
                  {SECTIONS.filter((s) => s.group === g).map((s) => {
                    const active = s.id === section
                    const count = counts[s.id]
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => go(s.id)}
                          aria-current={active ? 'page' : undefined}
                          className={cx('group relative flex h-9 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition-colors duration-150', active ? 'text-ink' : 'text-ink-3 hover:bg-s2 hover:text-ink-2')}
                        >
                          {active && <motion.span layoutId="settings-nav-active" className="absolute inset-0 rounded-md border border-line-strong bg-s3" transition={{ type: 'spring', stiffness: 520, damping: 42 }} />}
                          {active && <span className="absolute left-0 top-2 h-5 w-[2px] rounded-r bg-amber" aria-hidden />}
                          <s.icon className="relative h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
                          <span className="relative min-w-0 flex-1 truncate">{s.label}</span>
                          {count !== undefined && <span className="mono relative text-[11px] text-ink-3">{count}</span>}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <motion.div key={section} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} className="min-w-0">
          {content}
        </motion.div>
      </div>
    </div>
  )
}

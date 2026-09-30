import { useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, BookOpen, Check, Download, FileCheck2, Lock, ScrollText, ShieldCheck, X } from 'lucide-react'
import type { SettingsResponse } from '../../types/api.ts'
import { ROLES } from '../../lib/rbac.ts'
import { download } from '../../lib/client/api.ts'
import { useRules, useSystemStatus } from '../../lib/client/queries.ts'
import { bytes, stamp } from '../../lib/client/format.ts'
import { setPreferences, usePreferences } from '../../app/preferences.ts'
import { Button, Checkbox, Panel, Skeleton, cx } from '../ui/primitives.tsx'
import { Badge } from '../ui/status.tsx'
import { ErrorState, Notice } from '../ui/feedback.tsx'
import { useToast } from '../ui/overlay.tsx'
import { LEVEL_META, SectionHeader, listPhrase, rolesWith } from './common.tsx'

/** The read-mostly policy sections: rules, notifications, evidence, audit, appearance. */

const linkClass = 'inline-flex h-9 items-center gap-2 rounded-md border border-line-strong bg-s3 px-3.5 text-sm font-medium text-ink transition-colors duration-150 hover:border-line-bright hover:bg-s4'

// Rules ---------------------------------------------------------------------------------

export function RulesSection() {
  const rules = useRules()
  const set = rules.data?.ruleSet
  const test = rules.data?.selfTest
  const testsOk = test ? test.rules.ok && test.deadlines.ok : null
  return (
    <section aria-label="Rules">
      <SectionHeader
        eyebrow="Decisions"
        title="Rules"
        description={
          <p>
            Reportability rules are data in a versioned rule set, not settings. Changing a duration or a condition means publishing a new rule-set version, and every recorded decision keeps the version it was evaluated under. Rules are reviewed on the Rules page; nothing here edits them.
          </p>
        }
        action={
          <Link to="/rules" className={linkClass}>
            <BookOpen className="h-3.5 w-3.5" aria-hidden /> Open rules <ArrowRight className="h-3.5 w-3.5 text-ink-3" aria-hidden />
          </Link>
        }
      />
      {rules.error ? (
        <ErrorState error={rules.error} onRetry={() => void rules.refetch()} />
      ) : !set || !test ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading rule set">
          <Skeleton className="h-20" />
          <Skeleton className="h-48" />
        </div>
      ) : (
        <>
          <dl className="grid min-w-0 grid-cols-2 border-y border-line sm:grid-cols-4">
            {[
              { k: 'Rule set', v: <span className="ident">{set.id}</span> },
              { k: 'Version', v: <span className="ident">{set.version}</span> },
              { k: 'Published', v: <span className="mono text-[12.5px]">{stamp(set.publishedAt)}</span> },
              {
                k: 'Self-test',
                v: (
                  <span className={cx('inline-flex items-center gap-1.5', testsOk ? 'text-green' : 'text-red')}>
                    {testsOk ? <Check className="h-3.5 w-3.5" aria-hidden /> : <X className="h-3.5 w-3.5" aria-hidden />}
                    <span className="mono tabular">
                      {test.rules.passed + test.deadlines.passed}/{test.rules.total + test.deadlines.total}
                    </span>
                    <span className="text-xs">{testsOk ? 'passing' : 'failing'}</span>
                  </span>
                ),
              },
            ].map((x, i) => (
              <div key={x.k} className={cx('min-w-0 px-0 py-4 sm:px-5', i > 0 && 'sm:border-l sm:border-line', i % 2 === 1 && 'border-l border-line pl-4 sm:pl-5', i >= 2 && 'border-t border-line sm:border-t-0')}>
                <dt className="micro mb-1.5">{x.k}</dt>
                <dd className="min-w-0 text-sm text-ink">{x.v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm text-ink-2">{set.title}</p>
          <ul className="mt-5 border-t border-line">
            {set.rules.map((r) => (
              <li key={r.id} className="grid min-w-0 gap-1 border-b border-line py-3 sm:grid-cols-[220px_minmax(0,1fr)_auto] sm:items-baseline sm:gap-6">
                <span className="ident text-[12px] text-ink-3">{r.id}</span>
                <span className="min-w-0">
                  <span className="block text-sm text-ink">{r.title}</span>
                  <span className="block text-xs text-ink-3">{r.citation}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="mono text-xs text-ink-3">v{r.version}</span>
                  <Badge size="sm" tone={r.status === 'ACTIVE' ? 'green' : 'dim'}>
                    {r.status.toLowerCase()}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

// Notification policies ---------------------------------------------------------------------

const EVENTS: Array<{ event: string; when: string; to: string; level: Array<keyof typeof LEVEL_META> }> = [
  { event: 'Awareness established', when: 'Vulnerability or exploitation awareness is recorded against a criterion.', to: 'Case owner, PSIRT Lead, Security Manager', level: ['watch', 'critical'] },
  { event: 'Review required', when: 'A report or a non-report decision record enters internal review.', to: 'The approving roles for that report kind', level: ['watch'] },
  { event: 'Determination recorded', when: 'An affectedness determination changes result for a product.', to: 'Case owner, next-action owner', level: ['info', 'watch'] },
  { event: 'Decision to report', when: 'A reportability decision to report is recorded.', to: 'Case owner, PSIRT Lead', level: ['critical'] },
  { event: 'Report approved', when: 'A report satisfies its approval policy.', to: 'Report generator, case owner', level: ['info'] },
  { event: 'Report returned', when: 'A reviewer rejects a report or requests changes.', to: 'Report generator', level: ['watch'] },
  { event: 'Timestamp corrected', when: 'A clock event is corrected. The original stays on the record.', to: 'Case owner, PSIRT Lead', level: ['watch'] },
  { event: 'Case assigned', when: 'Ownership of a case moves to someone.', to: 'The new owner', level: ['info'] },
  { event: 'Mention', when: 'A comment mentions a role.', to: 'Everyone holding the mentioned role', level: ['info'] },
  { event: 'Ledger verification', when: 'Someone verifies the audit ledger hash chain.', to: 'The person who ran it', level: ['info', 'critical'] },
  { event: 'Deadline escalation', when: 'A running deadline passes an escalation step.', to: 'The step target and the case owner', level: ['info', 'watch', 'critical'] },
]

export function NotificationsSection() {
  return (
    <section aria-label="Notification policies">
      <SectionHeader
        eyebrow="Decisions"
        title="Notification policies"
        description={
          <p>
            NEXUS notifies people when the record changes in a way that needs them. Nobody is notified of their own action. Escalations are computed from the deadline escalation policy each time the notification centre is read.
          </p>
        }
      />
      <Notice tone="blue" title="Delivery" className="mb-6">
        In-product only. Notifications appear in the notification centre in the top bar. The demo sends no email, SMS or chat messages.
      </Notice>
      <div className="hidden grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_200px] gap-6 border-b border-line pb-2.5 md:grid">
        <span className="micro">Event</span>
        <span className="micro">Recipients</span>
        <span className="micro text-right">Level</span>
      </div>
      <ul className="border-t border-line md:border-t-0">
        {EVENTS.map((e) => (
          <li key={e.event} className="grid min-w-0 gap-2 border-b border-line py-3.5 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_200px] md:gap-6">
            <span className="min-w-0">
              <span className="block text-sm text-ink">{e.event}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-ink-3">{e.when}</span>
            </span>
            <span className="text-sm text-ink-2">
              <span className="micro mr-2 md:hidden">To</span>
              {e.to}
            </span>
            <span className="flex flex-wrap gap-1.5 md:justify-end">
              {e.level.map((l) => (
                <Badge key={l} tone={LEVEL_META[l].tone} size="sm">
                  {LEVEL_META[l].label}
                </Badge>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-ink-3">Where two levels are shown, the level depends on the event: exploitation awareness is critical and vulnerability awareness is watch; a failed ledger verification is critical.</p>
    </section>
  )
}

// Evidence policies ---------------------------------------------------------------------------

export function EvidenceSection({ policy }: { policy: SettingsResponse['evidencePolicy'] }) {
  const restricted = rolesWith('evidence.read_restricted').map((r) => ROLES[r].label)
  const steps = [
    { title: 'Content sniffed', body: 'The declared file type is never trusted. The bytes are inspected: PDF, PNG and JPEG by signature, and anything else must decode as UTF-8 text with no NUL bytes.' },
    { title: 'Mismatched type refused', body: 'A file that claims one type and sniffs as another is refused, as is any file that matches none of the allowed types.' },
    { title: 'SHA-256 on the server', body: 'The hash is computed by the server from the stored bytes, never taken from the browser. It can be re-verified from the evidence page at any time.' },
    { title: 'Stored outside the web root', body: 'Files are content-addressed by their hash in a directory that no web server serves.' },
    { title: 'Authorised download only', body: 'A file is served only through the download endpoint, which checks the session and the permission on every request.' },
    { title: 'Restricted classification', body: `Restricted evidence is readable only by ${listPhrase(restricted)}. Other roles see that it exists, redacted.` },
  ]
  return (
    <section aria-label="Evidence policies">
      <SectionHeader
        eyebrow="Record"
        title="Evidence policies"
        description={<p>What an evidence file may be, and what happens to it between upload and the report that cites it. These limits are set in the server configuration.</p>}
      />
      <dl className="mb-8 grid min-w-0 gap-6 border-y border-line py-5 sm:grid-cols-[200px_minmax(0,1fr)]">
        <div className="min-w-0">
          <dt className="micro mb-1.5">Maximum upload</dt>
          <dd className="mono text-2xl text-ink">{bytes(policy.maxUploadBytes)}</dd>
          <dd className="mono mt-0.5 text-[11px] text-ink-3">{policy.maxUploadBytes.toLocaleString('en')} bytes</dd>
        </div>
        <div className="min-w-0">
          <dt className="micro mb-2">Allowed types</dt>
          <dd className="min-w-0">
            <ul className="divide-y divide-line">
              {policy.allowedTypes.map((t) => (
                <li key={t.mime} className="grid min-w-0 gap-1 py-2 first:pt-0 sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)] sm:gap-4">
                  <span className="min-w-0">
                    <span className="block text-sm text-ink">{t.label}</span>
                    <span className="ident block text-[11px] text-ink-3">{t.mime}</span>
                  </span>
                  <span className="flex min-w-0 flex-wrap gap-1.5">
                    {t.extensions.map((x) => (
                      <span key={x} className="inline-flex h-6 items-center rounded-md border border-line-strong bg-s2 px-2 font-mono text-[11px] text-ink-2">
                        {x}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
      <div className="micro mb-3">How every file is handled</div>
      <ol className="border-t border-line">
        {steps.map((s, i) => (
          <li key={s.title} className="grid min-w-0 grid-cols-[36px_minmax(0,1fr)] gap-3 border-b border-line py-3.5 sm:grid-cols-[48px_220px_minmax(0,1fr)] sm:gap-6">
            <span className="mono pt-px text-xs text-ink-3">{String(i + 1).padStart(2, '0')}</span>
            <span className="text-sm text-ink">{s.title}</span>
            <span className="col-start-2 text-sm text-ink-2 sm:col-start-auto">{s.body}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

// Audit settings ---------------------------------------------------------------------------------

export function AuditSection() {
  const toast = useToast()
  const status = useSystemStatus()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const ledger = status.data?.ledger

  const anchor = async () => {
    setBusy(true)
    setError(null)
    try {
      await download('/api/ledger/anchor', 'nexus-ledger-anchor.json')
      toast({ tone: 'success', title: 'Ledger anchor downloaded', body: 'Keep it somewhere NEXUS cannot write to.' })
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Audit settings">
      <SectionHeader
        eyebrow="Record"
        title="Audit settings"
        description={
          <p>
            Every change to the record is written to an append-only ledger. The database refuses updates and deletes on the ledger table, and each entry carries a SHA-256 hash of its content and of the entry before it, so altering any entry breaks every hash after it. Verification names the first entry where history no longer matches itself, and the browser re-verifies the chain independently rather than trusting the server&apos;s answer.
          </p>
        }
        action={
          <Link to="/ledger" className={linkClass}>
            <ScrollText className="h-3.5 w-3.5" aria-hidden /> Open audit ledger <ArrowRight className="h-3.5 w-3.5 text-ink-3" aria-hidden />
          </Link>
        }
      />

      <figure className="mb-8 min-w-0" aria-label="Hash chain and external anchor">
        <div className="flex min-w-0 flex-col items-stretch gap-2 md:flex-row">
          {[
            { k: 'Entry n-1', v: 'hash(n-1)' },
            { k: 'Entry n', v: 'SHA-256(hash(n-1) + entry n)' },
            { k: 'Head', v: 'SHA-256(hash(n) + head entry)' },
          ].map((b, i) => (
            <div key={b.k} className="flex min-w-0 flex-col items-stretch gap-2 md:flex-1 md:flex-row">
              {i > 0 && <ArrowRight className="mx-auto h-3.5 w-3.5 shrink-0 rotate-90 self-center text-ink-4 md:rotate-0" aria-hidden />}
              <div className="min-w-0 flex-1 rounded-lg border border-line-strong bg-s2 px-3.5 py-2.5">
                <div className="micro">{b.k}</div>
                <div className="ident mt-1 text-[11.5px] text-ink-2">{b.v}</div>
              </div>
            </div>
          ))}
          <ArrowRight className="mx-auto h-3.5 w-3.5 shrink-0 rotate-90 self-center text-ink-4 md:rotate-0" aria-hidden />
          <div className="min-w-0 rounded-lg border border-dashed border-green-line px-3.5 py-2.5 md:w-52">
            <div className="micro text-green">Anchor, held outside</div>
            <div className="ident mt-1 text-[11.5px] text-ink-2">head seq + head hash</div>
          </div>
        </div>
        <figcaption className="mt-2 text-xs text-ink-3">Schematic. Each hash covers the entry and the hash before it.</figcaption>
      </figure>

      <Panel className="p-5 sm:p-6">
        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="min-w-0 max-w-2xl">
            <h3 className="text-md font-medium text-ink">Why the anchor matters</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              A hash chain proves that history matches itself. It cannot prove that history was not replaced: an attacker with write access to the database could rewrite an entry and recompute every hash after it, and the rewritten chain would verify. An anchor held outside NEXUS exposes that. It records the head sequence number and hash at a moment in time, and a rewritten ledger cannot reproduce that hash at that sequence number.
            </p>
            <p className="mt-3 text-sm text-ink-3">Download an anchor after each significant decision or submission, and store it in a system NEXUS cannot write to.</p>
          </div>
          <div className="flex flex-col items-start gap-3 lg:items-end">
            <Button variant="primary" icon={<Download className="h-3.5 w-3.5" />} busy={busy} onClick={() => void anchor()}>
              Download ledger anchor
            </Button>
            {ledger && (
              <span className={cx('inline-flex items-center gap-1.5 text-xs', ledger.state === 'verified' ? 'text-green' : ledger.state === 'exception' ? 'text-red' : 'text-amber')}>
                {ledger.state === 'verified' ? <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> : <Lock className="h-3.5 w-3.5" aria-hidden />}
                {ledger.state === 'verified' ? 'Integrity verified' : ledger.state === 'exception' ? 'Integrity exception' : 'Not yet verified'}
                {ledger.at && <span className="mono text-ink-3">· {stamp(ledger.at)}</span>}
              </span>
            )}
          </div>
        </div>
        {error !== null && <ErrorState error={error} className="mt-5" />}
      </Panel>
    </section>
  )
}

// Appearance ---------------------------------------------------------------------------------------

export function AppearanceSection() {
  const prefs = usePreferences()
  const [system] = useState(() => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
      return false
    }
  })
  return (
    <section aria-label="Appearance">
      <SectionHeader eyebrow="Workspace" title="Appearance" description={<p>Preferences for this browser only. They are not part of the record and do not follow you to another device.</p>} />
      <Panel className="p-5 sm:p-6">
        <Checkbox
          checked={prefs.reduceMotion}
          onChange={(v) => setPreferences({ reduceMotion: v })}
          label="Reduce motion"
          description="Turns off entrance animations, sliding indicators and pulsing markers. Countdown clocks keep counting."
        />
        <div className="mt-5 flex min-w-0 items-start gap-2.5 border-t border-line pt-4 text-xs text-ink-3">
          <FileCheck2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <p>
            Your operating system&apos;s reduced-motion setting is honoured as well, whatever this is set to. It currently {system ? 'requests' : 'does not request'} reduced motion.
          </p>
        </div>
      </Panel>
    </section>
  )
}


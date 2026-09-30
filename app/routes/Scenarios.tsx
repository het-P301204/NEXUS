import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { motion } from 'motion/react'
import { ArrowRight, FlaskConical, Lock, Play, PlayCircle } from 'lucide-react'
import type { ScenarioDef } from '../../data/scenarios.ts'
import { useSession } from '../../lib/client/session.tsx'
import { useAction, useScenarios } from '../../lib/client/queries.ts'
import { api } from '../../lib/client/api.ts'
import { ROLES, ROLE_ORDER, can as roleCan } from '../../lib/rbac.ts'
import { Button, PageHeader, Skeleton } from '../../components/ui/primitives.tsx'
import { Badge } from '../../components/ui/status.tsx'
import { EmptyState, ErrorState, Notice } from '../../components/ui/feedback.tsx'
import { useToast } from '../../components/ui/overlay.tsx'

/**
 * DEMO / SIMULATION. The scenario simulator creates fresh fictional cases in
 * a known state, so the reporting clock, affectedness and review workflow can
 * be seen without waiting for real time to pass.
 */

const TAB_LABEL: Record<string, string> = {
  clock: 'Clock of Record',
  products: 'Products and affectedness',
  determination: 'Determination',
  report: 'Reports',
  ledger: 'Audit ledger',
  overview: 'Case overview',
  evidence: 'Evidence',
}

function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

export function Scenarios() {
  const { session, can, demoMode } = useSession()
  const scenarios = useScenarios(demoMode)
  const allowed = can('demo.control')
  const controllers = listPhrase(ROLE_ORDER.filter((r) => roleCan(r, 'demo.control')).map((r) => ROLES[r].label))
  const navigate = useNavigate()
  const toast = useToast()
  const [running, setRunning] = useState<string | null>(null)
  const [failed, setFailed] = useState<{ id: string; error: unknown } | null>(null)

  const run = useAction((id: string) => api<{ caseId: string | null; tab: string }>(`/api/demo/scenarios/${encodeURIComponent(id)}`, { method: 'POST' }))

  const start = (s: ScenarioDef) => {
    setRunning(s.id)
    setFailed(null)
    run.mutate(s.id, {
      onSuccess: (res) => {
        if (res.caseId) {
          toast({ tone: 'success', title: `Scenario ${s.id} created ${res.caseId}`, body: 'Recorded now and marked as demo-sourced in the ledger.' })
          navigate(`/cases/${encodeURIComponent(res.caseId)}?tab=${encodeURIComponent(res.tab)}`)
        } else {
          toast({ tone: 'info', title: `Scenario ${s.id}: ${s.title}`, body: 'Opening the ledger integrity simulation. Nothing was created.' })
          navigate('/ledger?simulate=1')
        }
      },
      onError: (error) => {
        setFailed({ id: s.id, error })
        toast({ tone: 'error', title: `Scenario ${s.id} did not run`, body: error.message })
      },
      onSettled: () => setRunning(null),
    })
  }

  return (
    <div className="min-w-0">
      <PageHeader
        eyebrow="Demo"
        title="Scenario simulator"
        description="Each scenario creates a fresh fictional case, recorded now and marked as demo-sourced in the ledger. Clock events are asserted at backdated times, so the deadline state is the one the scenario is about."
        actions={
          <Badge tone="amber" icon={FlaskConical}>
            Demo / simulation
          </Badge>
        }
      />

      {!demoMode ? (
        <EmptyState
          icon={FlaskConical}
          title="Scenario simulator unavailable"
          why="Demo mode is off on this server, so the simulator is not served. Scenarios exist only on demo deployments, where every record is fictional."
          action={
            <Link to="/settings?section=demo" className="inline-flex items-center gap-1.5 text-sm text-ink hover:text-amber">
              Demo mode settings <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          }
        />
      ) : (
        <>
          {!allowed && (
            <Notice tone="neutral" icon={Lock} title="Scenarios cannot be run with your role" className="mb-8">
              Running a scenario writes new records, so it needs the demo-control permission. {session ? `You are signed in as ${ROLES[session.user.role].label}. ` : ''}Scenarios can be run by {controllers}. Switch persona from the account menu.
            </Notice>
          )}

          {scenarios.error ? (
            <ErrorState error={scenarios.error} onRetry={() => void scenarios.refetch()} />
          ) : !scenarios.data ? (
            <div className="space-y-px" aria-busy="true" aria-label="Loading scenarios">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-28" />
              ))}
            </div>
          ) : scenarios.data.length === 0 ? (
            <EmptyState icon={PlayCircle} title="No scenarios defined" why="The server returned no scenarios. They are defined in data/scenarios.ts; without them the simulator has nothing to run." />
          ) : (
            <ol className="border-t border-line" aria-label="Scenarios">
              {scenarios.data.map((s, i) => {
                const busy = running === s.id
                const error = failed?.id === s.id ? failed.error : null
                return (
                  <motion.li
                    key={s.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="grid min-w-0 grid-cols-[48px_minmax(0,1fr)] gap-x-4 gap-y-4 border-b border-line py-7 sm:grid-cols-[88px_minmax(0,1fr)] md:grid-cols-[112px_minmax(0,1fr)_auto] md:gap-x-8"
                  >
                    <span className="mono text-3xl leading-none text-ink-3 sm:text-4xl" aria-hidden>
                      {s.id.padStart(2, '0')}
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-lg font-medium text-ink">
                        <span className="sr-only">Scenario {s.id}: </span>
                        {s.title}
                      </h2>
                      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-2">{s.summary}</p>
                      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink">
                        <span className="micro mr-2 text-ink-3">What it shows</span>
                        {s.teaches}
                      </p>
                      <p className="mt-3 text-xs text-ink-3">
                        {s.createsCase ? (
                          <>
                            Creates a new case, then opens its <span className="text-ink-2">{TAB_LABEL[s.tab] ?? s.tab}</span> tab.
                          </>
                        ) : (
                          <>Creates nothing. Opens the ledger tamper simulation, which alters a copy of the ledger in memory; the stored ledger is not touched.</>
                        )}
                      </p>
                      {error !== null && <ErrorState error={error} className="mt-4" />}
                    </div>
                    <div className="col-start-2 md:col-start-auto md:self-center">
                      <Button
                        variant="secondary"
                        icon={<Play className="h-3.5 w-3.5" />}
                        busy={busy}
                        disabled={!allowed || (running !== null && !busy)}
                        onClick={() => start(s)}
                        aria-label={`Run scenario ${s.id}: ${s.title}`}
                        className="w-full sm:w-auto"
                      >
                        {busy ? 'Running…' : 'Run scenario'}
                      </Button>
                    </div>
                  </motion.li>
                )
              })}
            </ol>
          )}

          <p className="mt-6 max-w-2xl text-xs leading-relaxed text-ink-3">
            Scenarios add to the shared demo data; they never change or remove existing cases. Scenario vulnerabilities are fictional and use CVE identifiers in the CVE-2026-99xxxx range, which does not exist. To start over, reset the demo data from{' '}
            <Link to="/settings?section=demo" className="text-ink-2 underline decoration-line-bright underline-offset-2 hover:text-ink">
              Settings, Demo mode
            </Link>
            .
          </p>
        </>
      )}
    </div>
  )
}

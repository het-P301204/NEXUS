import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import type { RuleSet } from '../../types/domain.ts'
import { useRules } from '../../lib/client/queries.ts'
import { PageHeader, Skeleton, cx } from '../../components/ui/primitives.tsx'
import { ErrorState } from '../../components/ui/feedback.tsx'
import { Chrono } from '../../components/ui/time.tsx'
import { RuleList, dash } from '../../components/rules/RuleList.tsx'
import { SelfTestPanel } from '../../components/rules/SelfTestPanel.tsx'
import { TransitionalExplorer } from '../../components/rules/TransitionalExplorer.tsx'

/**
 * The rule set, as the engine uses it. Rules are data with versions, the
 * self-test proves the engine still gives the known answers, and the
 * explorer lets anyone try the two-date transitional rule without touching
 * a case.
 */

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]

/** Padding that lines each cell up with the page edge in the 2- and 4-column layouts. */
function cellPad(i: number, count: number): string {
  return cx('py-5 md:px-6 xl:px-6', i % 2 === 0 ? 'md:pl-0' : 'md:pr-0', i === 0 && 'xl:pl-0', i === count - 1 && 'xl:pr-0')
}

function IdentityCell({ i, label, children, note }: { i: number; label: string; children: ReactNode; note?: ReactNode }) {
  return (
    <motion.div className={cx('min-w-0 bg-canvas', cellPad(i, 4))} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04, duration: 0.3, ease: EASE }}>
      <dt className="micro">{label}</dt>
      <dd className="mt-3 min-w-0">{children}</dd>
      {note && <dd className="mt-2 text-xs leading-relaxed text-ink-3">{note}</dd>}
    </motion.div>
  )
}

function Identity({ ruleSet }: { ruleSet: RuleSet }) {
  return (
    <section aria-label="Rule set identity" className="border-y border-line">
      <dl className="grid gap-px bg-line md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.15fr)]">
        <IdentityCell i={0} label="Rule set" note={dash(ruleSet.title)}>
          <span className="ident text-2xl text-ink">{ruleSet.id}</span>
        </IdentityCell>
        <IdentityCell i={1} label="Version" note="Stored with every determination and decision evaluated under it.">
          <span className="ident text-2xl text-ink">{ruleSet.version}</span>
        </IdentityCell>
        <IdentityCell i={2} label="Published" note={<span className="ident">{ruleSet.publishedAt}</span>}>
          <Chrono iso={ruleSet.publishedAt} size="lg" />
        </IdentityCell>
        <IdentityCell i={3} label="Application instant" note={<span className="ident">{ruleSet.applicationInstant}</span>}>
          <Chrono iso={ruleSet.applicationInstant} size="lg" />
        </IdentityCell>
      </dl>
      <div className="grid min-w-0 gap-x-8 gap-y-2 border-t border-line py-4 md:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
        <div className="micro pt-0.5">Instant basis</div>
        <p className="max-w-4xl text-sm leading-relaxed text-ink-2">{dash(ruleSet.applicationInstantBasis)}</p>
      </div>
    </section>
  )
}

function RulesSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading rule set" className="space-y-12">
      <div className="grid gap-px border-y border-line bg-line md:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={cx('space-y-3 bg-canvas', cellPad(i, 4))}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  )
}

export function Rules() {
  const q = useRules()
  const ruleSet = q.data?.ruleSet

  return (
    <div className="min-w-0">
      <PageHeader
        eyebrow="Govern"
        title="Rule set"
        description="Rules are human-readable and versioned. Every recorded decision keeps the rule-set version it was evaluated under, so publishing a new version never rewrites an earlier determination."
      />

      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data || !ruleSet ? (
        <RulesSkeleton />
      ) : (
        <>
          <Identity ruleSet={ruleSet} />

          <motion.section aria-labelledby="rules-h" className="mt-14 min-w-0" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
            <div className="min-w-0">
              <div className="micro mb-1.5">Rules</div>
              <h2 id="rules-h" className="text-lg font-medium text-ink">
                {ruleSet.rules.length} rules in <span className="ident">{ruleSet.version}</span>
              </h2>
              <p className="mt-1 text-sm text-ink-3">Select a rule to read its conditions, outcomes and notes, in the words the engine is documented with.</p>
            </div>
            <div className="mt-5">
              <RuleList rules={ruleSet.rules} />
            </div>
          </motion.section>

          <motion.div className="mt-14 min-w-0" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}>
            <SelfTestPanel selfTest={q.data.selfTest} />
          </motion.div>
        </>
      )}

      <motion.div className="mt-14 min-w-0" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }}>
        <TransitionalExplorer serverVersion={ruleSet?.version} />
      </motion.div>
    </div>
  )
}

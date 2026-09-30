import { CheckCircle2, XCircle } from 'lucide-react'
import type { SelfTest } from '../../lib/client/queries.ts'
import { Panel, cx } from '../ui/primitives.tsx'
import { Badge } from '../ui/status.tsx'

/**
 * Known-answer self-test. Fixed inputs with fixed expected answers, run by
 * the server. "Operational" in the system-status panel is this result, not
 * a constant.
 */

function vectorName(name: string): string {
  return name.replace(/\s->\s/g, ' → ')
}

function Group({ label, scope, group }: { label: string; scope: string; group: SelfTest['rules'] }) {
  return (
    <div className="min-w-0 px-5 py-5 sm:px-6">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-ink">{label}</h3>
          <p className="mt-0.5 text-xs text-ink-3">{scope}</p>
        </div>
        <Badge tone={group.ok ? 'green' : 'red'} icon={group.ok ? CheckCircle2 : XCircle}>
          {group.passed}/{group.total} passed
        </Badge>
      </div>
      <ul className="mt-4 border-t border-line" aria-label={`${label} vectors`}>
        {group.vectors.map((v) => (
          <li key={v.name} className="flex min-w-0 items-start gap-3 border-b border-line py-2.5 last:border-b-0">
            {v.pass ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green" aria-hidden /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red" aria-hidden />}
            <span className="min-w-0 flex-1 font-mono text-[12.5px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">{vectorName(v.name)}</span>
            <span className={cx('micro shrink-0 pt-0.5', v.pass ? 'text-green' : 'text-red')}>{v.pass ? 'Pass' : 'Fail'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function SelfTestPanel({ selfTest }: { selfTest: SelfTest }) {
  return (
    <Panel className="min-w-0" as="section">
      <div className="px-5 pt-5 sm:px-6">
        <div className="micro mb-1.5">Integrity</div>
        <h2 id="selftest-h" className="text-lg font-medium text-ink">
          Known-answer self-test
        </h2>
        <p className="mt-1.5 max-w-3xl text-sm text-ink-3">
          The system-status panel reports the rule and deadline engines as operational only when every one of these vectors returns its known answer on the server.
        </p>
      </div>
      <div className="mt-5 grid min-w-0 border-t border-line md:grid-cols-2 md:divide-x md:divide-line">
        <Group label="Rule engine" scope="Transitional application and product affectedness" group={selfTest.rules} />
        <div className="border-t border-line md:border-t-0">
          <Group label="Deadline engine" scope="Early warning, notification and final-report arithmetic" group={selfTest.deadlines} />
        </div>
      </div>
    </Panel>
  )
}

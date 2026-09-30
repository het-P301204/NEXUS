import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, ArrowRight, Lock } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ApiFailure } from '../../lib/client/api.ts'
import { Button, cx } from './primitives.tsx'

/**
 * Empty and error states. An empty state says what is missing, why it
 * matters and what to do. An error names what was blocked and why, and
 * points at the fix -- never "something went wrong".
 */

export function EmptyState({ icon: Icon, title, why, action, className, compact }: { icon?: LucideIcon; title: string; why: ReactNode; action?: ReactNode; className?: string; compact?: boolean }) {
  return (
    <div className={cx('flex flex-col items-start', compact ? 'py-6' : 'py-14', className)}>
      {Icon && (
        <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg border border-line-strong bg-s2 text-ink-3">
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.6} />
        </div>
      )}
      <div className="micro mb-2 text-ink-2">{title}</div>
      <p className="max-w-md text-sm text-ink-3">{why}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const body =
    error instanceof ApiFailure
      ? error.body
      : { code: 'CLIENT_ERROR', title: 'Page could not be rendered', reason: error instanceof Error ? error.message : 'An unexpected client error occurred.' }
  const denied = body.code === 'PERMISSION_DENIED' || body.code === 'SEPARATION_OF_DUTIES'
  return (
    <div role="alert" className={cx('rounded-xl border border-red-line bg-red/[0.048] px-5 py-4', className)}>
      <div className="flex items-start gap-3">
        {denied ? <Lock className="mt-0.5 h-4 w-4 shrink-0 text-red" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red" />}
        <div className="min-w-0 flex-1">
          <div className="micro text-red">{body.title}</div>
          <p className="mt-1.5 text-sm text-ink">
            <span className="text-ink-3">Reason: </span>
            {body.reason}
          </p>
          {body.fields && Object.keys(body.fields).length > 1 && (
            <ul className="mt-2 space-y-1 text-xs text-ink-2">
              {Object.entries(body.fields).map(([k, v]) => (
                <li key={k}>
                  <span className="ident text-ink-3">{k}</span> {v}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {body.action && (
              <Link to={body.action.href} className="inline-flex items-center gap-1.5 text-xs font-medium text-ink hover:text-amber">
                Action: {body.action.label} <ArrowRight className="h-3 w-3" />
              </Link>
            )}
            {onRetry && (
              <Button size="sm" variant="ghost" onClick={onRetry}>
                Retry
              </Button>
            )}
            {body.requestId && <span className="ident text-[11px] text-ink-4">ref {body.requestId}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

/** For "blocked" states that are not errors, like a deadline that cannot be computed. */
export function BlockedNotice({ title, reason, action }: { title: string; reason: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-red-line px-5 py-4">
      <div className="micro text-red">{title}</div>
      <p className="mt-1.5 text-sm text-ink">
        <span className="text-ink-3">Reason: </span>
        {reason}
      </p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function Notice({ tone = 'neutral', title, children, icon: Icon, className }: { tone?: 'neutral' | 'amber' | 'red' | 'green' | 'blue' | 'violet'; title?: ReactNode; children: ReactNode; icon?: LucideIcon; className?: string }) {
  const tones = {
    neutral: 'border-line-strong bg-s2',
    amber: 'border-amber-line bg-amber/[0.06]',
    red: 'border-red-line bg-red/[0.06]',
    green: 'border-green-line bg-green/[0.055]',
    blue: 'border-blue-line bg-blue/[0.055]',
    violet: 'border-violet-line bg-violet/[0.055]',
  }
  const text = { neutral: 'text-ink-2', amber: 'text-amber', red: 'text-red', green: 'text-green', blue: 'text-blue', violet: 'text-violet' }
  return (
    <div className={cx('rounded-lg border px-4 py-3', tones[tone], className)}>
      <div className="flex items-start gap-2.5">
        {Icon && <Icon className={cx('mt-0.5 h-4 w-4 shrink-0', text[tone])} />}
        <div className="min-w-0 flex-1">
          {title && <div className={cx('micro mb-1', text[tone])}>{title}</div>}
          <div className="text-sm text-ink-2">{children}</div>
        </div>
      </div>
    </div>
  )
}

import { Link } from 'react-router'
import { AlertTriangle, BellOff, CheckCheck, Siren } from 'lucide-react'
import { api } from '../../lib/client/api.ts'
import { useAction, useNotifications } from '../../lib/client/queries.ts'
import { hhmm, relative } from '../../lib/client/format.ts'
import { useNow } from '../../lib/client/useNow.ts'
import { ROLES } from '../../lib/rbac.ts'
import { Dot } from '../../components/ui/status.tsx'
import { cx } from '../../components/ui/primitives.tsx'

/**
 * Notification centre: escalations first (derived live from the escalation
 * policy and running deadlines), then stored notifications. Each one links
 * to the place where the user acts on it.
 */
export function NotificationPanel({ onNavigate }: { onNavigate: () => void }) {
  const q = useNotifications()
  const now = useNow()
  const markRead = useAction((id: string) => api(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }))
  const markAll = useAction(() => api('/api/notifications/read-all', { method: 'POST' }))
  const data = q.data
  const stored = data?.stored ?? []
  const escalations = data?.escalations ?? []
  return (
    <div className="flex max-h-[min(560px,80vh)] flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <div className="text-sm font-medium text-ink">Notifications</div>
          <div className="text-[11px] text-ink-3">Escalation behaviour is simulated. Nothing is sent outside NEXUS.</div>
        </div>
        <button type="button" onClick={() => markAll.mutate(undefined)} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-ink-3 hover:bg-s3 hover:text-ink" disabled={!stored.some((n) => !n.readAt)}>
          <CheckCheck className="h-3.5 w-3.5" /> Mark all read
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {escalations.length > 0 && (
          <div className="border-b border-line">
            <div className="micro px-4 pb-1 pt-3 text-amber">Active escalations</div>
            {escalations.map((e) => (
              <Link key={e.id} to={`/cases/${e.caseId}?tab=clock`} onClick={onNavigate} className="flex gap-3 px-4 py-2.5 transition-colors hover:bg-s3">
                <Siren className={cx('mt-0.5 h-4 w-4 shrink-0', e.level === 'critical' ? 'text-red' : 'text-amber')} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-ink">
                    {e.deadlineLabel} due {hhmm(e.dueAt)} <span className="text-ink-3">· {relative(e.dueAt, now)}</span>
                  </div>
                  <div className="truncate text-[11px] text-ink-3">
                    <span className="ident">{e.caseId}</span> · {e.label} ({e.targetRole === 'owner' ? 'case owner' : ROLES[e.targetRole].label})
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
        {stored.length === 0 && escalations.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <BellOff className="h-5 w-5 text-ink-4" />
            <div className="micro mt-3">No notifications</div>
            <p className="mt-1.5 text-xs text-ink-3">Awareness, review requests and deadline escalations for your role appear here.</p>
          </div>
        ) : (
          stored.map((n) => (
            <Link
              key={n.id}
              to={n.link ?? '/'}
              onClick={() => {
                if (!n.readAt) markRead.mutate(n.id)
                onNavigate()
              }}
              className="flex gap-3 border-b border-line px-4 py-2.5 transition-colors last:border-0 hover:bg-s3"
            >
              <span className="mt-1.5">{n.readAt ? <span className="block h-2 w-2" /> : <Dot tone={n.severity === 'critical' ? 'red' : n.severity === 'watch' ? 'amber' : 'blue'} />}</span>
              <div className="min-w-0 flex-1">
                <div className={cx('text-xs', n.readAt ? 'text-ink-2' : 'text-ink')}>{n.title}</div>
                <div className="mt-0.5 line-clamp-2 text-[11px] text-ink-3">{n.body}</div>
                <div className="mono mt-1 text-[10.5px] text-ink-4">{relative(n.createdAt, now)}</div>
              </div>
              {n.severity === 'critical' && !n.readAt && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red" />}
            </Link>
          ))
        )}
      </div>
    </div>
  )
}

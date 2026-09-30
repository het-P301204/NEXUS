import { useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { NavLink } from 'react-router'
import { motion } from 'motion/react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { GROUP_LABELS, NAV } from '../nav.ts'
import { setPreferences, usePreferences } from '../preferences.ts'
import { useSession } from '../../lib/client/session.tsx'
import { useSystemStatus } from '../../lib/client/queries.ts'
import { ROLES } from '../../lib/rbac.ts'
import { Dot } from '../../components/ui/status.tsx'
import { cx } from '../../components/ui/primitives.tsx'
import { Wordmark } from './Wordmark.tsx'

export function integrityTone(status: ReturnType<typeof useSystemStatus>['data']) {
  if (!status) return { tone: 'dim' as const, label: 'Checking' }
  const bad = status.ledger.state === 'exception' || status.dataIntegrity.state === 'exception' || status.ruleEngine.state !== 'operational' || status.deadlineEngine.state !== 'operational'
  if (bad) return { tone: 'red' as const, label: 'Integrity exception' }
  if (status.ledger.state === 'unverified') return { tone: 'amber' as const, label: 'Ledger unverified' }
  return { tone: 'green' as const, label: 'Integrity verified' }
}

export function NavList({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const refs = useRef<Array<HTMLAnchorElement | null>>([])
  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const next = e.key === 'ArrowDown' ? (i + 1) % NAV.length : (i - 1 + NAV.length) % NAV.length
    refs.current[next]?.focus()
  }
  let lastGroup: string | null = null
  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5">
      {NAV.map((item, i) => {
        const header = item.group !== lastGroup
        lastGroup = item.group
        return (
          <div key={item.to}>
            {header && (
              <div className={cx('micro px-3 pb-1.5 text-ink-4', i === 0 ? 'pt-1' : 'pt-5')} aria-hidden={collapsed}>
                {collapsed ? <span className="block h-px w-4 bg-line-strong" /> : GROUP_LABELS[item.group]}
              </div>
            )}
            <NavLink
              to={item.to}
              end={item.to === '/'}
              ref={(el) => {
                refs.current[i] = el
              }}
              onKeyDown={(e) => onKey(e, i)}
              onClick={onNavigate}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                cx(
                  'group relative flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors duration-150',
                  isActive ? 'text-ink' : 'text-ink-3 hover:bg-s2 hover:text-ink-2',
                  collapsed && 'justify-center px-0',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span layoutId="nav-active" className="absolute inset-0 rounded-md border border-line-strong bg-s3" transition={{ type: 'spring', stiffness: 520, damping: 42 }} />
                  )}
                  {isActive && <span className="absolute left-0 top-2 h-5 w-[2px] rounded-r bg-amber" />}
                  <item.icon className="relative h-4 w-4 shrink-0" strokeWidth={1.75} />
                  {!collapsed && <span className="relative truncate">{item.label}</span>}
                  {collapsed && (
                    <span className="pointer-events-none absolute left-full z-50 ml-3 hidden whitespace-nowrap rounded-md border border-line-strong bg-s3 px-2 py-1 text-xs text-ink shadow-raise group-hover:block group-focus-visible:block">
                      {item.label}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          </div>
        )
      })}
    </nav>
  )
}

export function Sidebar({ onOpenStatus }: { onOpenStatus: () => void }) {
  const { sidebarCollapsed: collapsed } = usePreferences()
  const { session } = useSession()
  const status = useSystemStatus()
  const integrity = integrityTone(status.data)
  return (
    <motion.aside
      className="no-print sticky top-0 z-30 hidden h-screen shrink-0 flex-col border-r border-line bg-s1 lg:flex"
      animate={{ width: collapsed ? 68 : 244 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      aria-label="Sidebar"
    >
      <div className={cx('flex h-14 items-center border-b border-line', collapsed ? 'justify-center' : 'justify-between px-4')}>
        {!collapsed && <Wordmark />}
        <button
          type="button"
          onClick={() => setPreferences({ sidebarCollapsed: !collapsed })}
          className="flex h-8 w-8 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-s3 hover:text-ink"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-4">
        <NavList collapsed={collapsed} />
      </div>
      <div className="border-t border-line p-2.5">
        <button
          type="button"
          onClick={onOpenStatus}
          className={cx('flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-s2', collapsed && 'justify-center px-0')}
          title={collapsed ? integrity.label : undefined}
        >
          <Dot tone={integrity.tone} pulse={integrity.tone === 'red'} />
          {!collapsed && (
            <span className="min-w-0">
              <span className="block text-xs text-ink-2">System integrity</span>
              <span className="mono block truncate text-[10.5px] text-ink-3">{integrity.label}</span>
            </span>
          )}
        </button>
        {!collapsed && session && (
          <dl className="mt-1 space-y-2 px-3 pb-2 pt-2">
            <div className="flex items-baseline justify-between gap-2">
              <dt className="micro">Rule set</dt>
              <dd className="mono text-[11px] text-ink-2">{status.data?.ruleSetVersion ?? '...'}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="micro">Org</dt>
              <dd className="truncate text-[11px] text-ink-2">{session.org.name}</dd>
            </div>
            <div className="flex items-center gap-2.5 pt-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-strong bg-s3 font-mono text-[10.5px] text-ink-2">{session.user.initials}</span>
              <span className="min-w-0">
                <span className="block truncate text-xs text-ink">{session.user.name}</span>
                <span className="block truncate text-[11px] text-ink-3">{ROLES[session.user.role].label}</span>
              </span>
            </div>
          </dl>
        )}
      </div>
    </motion.aside>
  )
}

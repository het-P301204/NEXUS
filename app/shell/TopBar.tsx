import { Link, useMatches, useNavigate } from 'react-router'
import { Bell, Building2, Check, ChevronRight, LogOut, Menu, Search, UserRound } from 'lucide-react'
import { useSession } from '../../lib/client/session.tsx'
import { REPO_URL, STATIC_DEMO } from '../../lib/client/mode.ts'
import { useNotifications, usePersonas, useSystemStatus } from '../../lib/client/queries.ts'
import { ROLES } from '../../lib/rbac.ts'
import { Popover } from '../../components/ui/popover.tsx'
import { Dot } from '../../components/ui/status.tsx'
import { Kbd, cx } from '../../components/ui/primitives.tsx'
import { integrityTone } from './Sidebar.tsx'
import { Wordmark } from './Wordmark.tsx'
import { NotificationPanel } from './Notifications.tsx'

interface Crumb {
  crumb?: string
  parent?: { label: string; to: string }
}

function Breadcrumbs() {
  const matches = useMatches()
  const last = [...matches].reverse().find((m) => (m.handle as Crumb | undefined)?.crumb)
  if (!last) return null
  const h = last.handle as Crumb
  const params = last.params as Record<string, string>
  const leaf = params.id ?? h.crumb
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-sm md:flex">
      <Link to="/" className="shrink-0 text-ink-3 hover:text-ink-2">
        Operations
      </Link>
      {h.parent && (
        <>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-4" />
          <Link to={h.parent.to} className="shrink-0 text-ink-3 hover:text-ink-2">
            {h.parent.label}
          </Link>
        </>
      )}
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-4" />
      <span className={cx('truncate text-ink', params.id && 'ident text-[13px]')} aria-current="page">
        {leaf}
      </span>
    </nav>
  )
}

export function TopBar({ onOpenPalette, onOpenMenu, onOpenStatus }: { onOpenPalette: () => void; onOpenMenu: () => void; onOpenStatus: () => void }) {
  const { session, demoMode, signInAs, signOut } = useSession()
  const notifications = useNotifications()
  const status = useSystemStatus()
  const personas = usePersonas()
  const navigate = useNavigate()
  const integrity = integrityTone(status.data)
  const unread = (notifications.data?.stored.filter((n) => !n.readAt).length ?? 0) + (notifications.data?.escalations.length ?? 0)
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

  return (
    <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-canvas/85 px-4 backdrop-blur-md sm:px-6">
      <button type="button" onClick={onOpenMenu} className="-ml-1 flex h-9 w-9 items-center justify-center rounded-md text-ink-2 hover:bg-s3 lg:hidden" aria-label="Open navigation">
        <Menu className="h-[18px] w-[18px]" />
      </button>
      <div className="lg:hidden">
        <Wordmark compact />
      </div>
      <Breadcrumbs />
      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          onClick={onOpenPalette}
          className="group flex h-9 items-center gap-2.5 rounded-md border border-line-strong bg-s1 px-3 text-sm text-ink-3 transition-colors hover:border-line-bright hover:text-ink-2 sm:w-64"
          aria-label="Search and commands"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="hidden truncate sm:inline">Search cases, CVEs, products…</span>
          <span className="ml-auto hidden items-center gap-1 sm:flex">
            <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>

        <button type="button" onClick={onOpenStatus} className="hidden h-9 items-center gap-2 rounded-md px-2.5 text-xs text-ink-3 transition-colors hover:bg-s2 hover:text-ink-2 md:flex" title="System integrity">
          <Dot tone={integrity.tone} pulse={integrity.tone === 'red'} />
          <span className="hidden xl:inline">{integrity.label}</span>
        </button>

        <Popover
          label="Notifications"
          width="w-[380px]"
          trigger={({ toggle, open }) => (
            <button type="button" onClick={toggle} aria-expanded={open} className="relative flex h-9 w-9 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-s3 hover:text-ink" aria-label={`Notifications, ${unread} unread`}>
              <Bell className="h-4 w-4" />
              {unread > 0 && <span className="mono absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber px-1 text-[9.5px] font-semibold text-canvas">{unread > 9 ? '9+' : unread}</span>}
            </button>
          )}
        >
          {(close) => <NotificationPanel onNavigate={close} />}
        </Popover>

        <Popover
          label="Organisation"
          width="w-72"
          trigger={({ toggle, open }) => (
            <button type="button" onClick={toggle} aria-expanded={open} className="hidden h-9 items-center gap-2 rounded-md px-2.5 text-sm text-ink-2 transition-colors hover:bg-s3 md:flex" aria-label="Organisation">
              <Building2 className="h-4 w-4 text-ink-3" />
              <span className="hidden max-w-[160px] truncate xl:inline">{session?.org.name}</span>
            </button>
          )}
        >
          {() => (
            <div className="p-2">
              <div className="micro px-2 pb-2 pt-1">Organisation</div>
              <div className="flex items-start gap-3 rounded-lg bg-s3 px-3 py-2.5">
                <Check className="mt-0.5 h-4 w-4 text-green" />
                <div className="min-w-0">
                  <div className="text-sm text-ink">{session?.org.name}</div>
                  <div className="mt-0.5 text-xs text-ink-3">{session?.org.legalEntity}</div>
                  <div className="mono mt-1.5 text-[11px] text-ink-3">{session?.org.timezone} · {session?.org.memberStatesMadeAvailable.join(' ')}</div>
                </div>
              </div>
              <p className="px-2 pb-1 pt-3 text-xs text-ink-3">Single-organisation deployment. Each organisation runs its own NEXUS instance and ledger.</p>
            </div>
          )}
        </Popover>

        <Popover
          label="Account"
          width="w-80"
          trigger={({ toggle, open }) => (
            <button type="button" onClick={toggle} aria-expanded={open} className="flex h-9 items-center gap-2 rounded-md pl-1 pr-1.5 transition-colors hover:bg-s3 sm:pr-2.5" aria-label="Account">
              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-line-strong bg-s3 font-mono text-[10.5px] text-ink-2">{session?.user.initials ?? <UserRound className="h-3.5 w-3.5" />}</span>
              <span className="hidden text-left leading-tight 2xl:block">
                <span className="block text-xs text-ink">{session?.user.name}</span>
                <span className="block text-[11px] text-ink-3">{session ? ROLES[session.user.role].label : ''}</span>
              </span>
            </button>
          )}
        >
          {(close) => (
            <div>
              <div className="border-b border-line px-4 py-3">
                <div className="text-sm text-ink">{session?.user.name}</div>
                <div className="text-xs text-ink-3">
                  {session?.user.title} · {session ? ROLES[session.user.role].label : ''}
                </div>
                <div className="ident mt-1 text-[11px] text-ink-4">{session?.user.email}</div>
              </div>
              {STATIC_DEMO && (
                <p className="px-4 py-3 text-[11.5px] leading-relaxed text-ink-3">
                  Static demo: you are viewing the seeded organisation as its PSIRT Lead. Switching persona and signing out need the{' '}
                  <a href={REPO_URL} target="_blank" rel="noreferrer" className="text-ink-2 underline underline-offset-2 hover:text-ink">
                    local server
                  </a>
                  .
                </p>
              )}
              {!STATIC_DEMO && demoMode && personas.data && (
                <div className="max-h-72 overflow-y-auto p-2">
                  <div className="micro px-2 pb-1.5 pt-1">Demo: switch persona</div>
                  {personas.data.personas.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={async () => {
                        close()
                        await signInAs(p.id)
                        navigate(0)
                      }}
                      className={cx('flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-s3', p.id === session?.user.id && 'bg-s3')}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line-strong font-mono text-[9.5px] text-ink-3">{p.initials}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-ink">{p.name}</span>
                        <span className="block truncate text-[11px] text-ink-3">{ROLES[p.role].label}</span>
                      </span>
                      {p.id === session?.user.id && <Check className="h-3.5 w-3.5 text-green" />}
                    </button>
                  ))}
                </div>
              )}
              {!STATIC_DEMO && (
                <div className="border-t border-line p-2">
                  <button
                    type="button"
                    onClick={async () => {
                      close()
                      await signOut()
                      navigate('/signin')
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-ink-2 transition-colors hover:bg-s3 hover:text-ink"
                  >
                    <LogOut className="h-3.5 w-3.5" /> Sign out
                  </button>
                </div>
              )}
            </div>
          )}
        </Popover>
      </div>
    </header>
  )
}

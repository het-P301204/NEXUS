import { useCallback, useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation, NavLink } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { FolderKanban, LayoutDashboard, Menu, ScrollText, Timer } from 'lucide-react'
import { useSession } from '../../lib/client/session.tsx'
import { cx } from '../../components/ui/primitives.tsx'
import { Drawer } from '../../components/ui/overlay.tsx'
import { setPreferences, usePreferences } from '../preferences.ts'
import { Sidebar, NavList } from './Sidebar.tsx'
import { TopBar } from './TopBar.tsx'
import { CommandPalette } from './CommandPalette.tsx'
import { Boot } from './Boot.tsx'
import { SystemStatusDrawer } from './SystemStatusDrawer.tsx'
import { Wordmark } from './Wordmark.tsx'
import { StaticDemoBanner } from './StaticDemoBanner.tsx'
import { STATIC_DEMO } from '../../lib/client/mode.ts'

export const DISCLAIMER =
  'NEXUS provides technical and operational decision support. It does not constitute legal advice or a legal determination of regulatory compliance.'

function MobileBar({ onMenu }: { onMenu: () => void }) {
  const items = [
    { to: '/', label: 'Overview', icon: LayoutDashboard },
    { to: '/cases', label: 'Cases', icon: FolderKanban },
    { to: '/clocks', label: 'Clocks', icon: Timer },
    { to: '/ledger', label: 'Ledger', icon: ScrollText },
  ]
  return (
    <nav aria-label="Primary (mobile)" className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-s1/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => cx('flex h-14 flex-col items-center justify-center gap-1 text-[10.5px]', isActive ? 'text-ink' : 'text-ink-3')}>
          {({ isActive }) => (
            <>
              <i.icon className={cx('h-[18px] w-[18px]', isActive && 'text-amber')} strokeWidth={1.75} />
              {i.label}
            </>
          )}
        </NavLink>
      ))}
      <button type="button" onClick={onMenu} className="flex h-14 flex-col items-center justify-center gap-1 text-[10.5px] text-ink-3">
        <Menu className="h-[18px] w-[18px]" strokeWidth={1.75} />
        More
      </button>
    </nav>
  )
}

export function Shell() {
  const { session, loading } = useSession()
  const prefs = usePreferences()
  const location = useLocation()
  const [palette, setPalette] = useState(false)
  const [menu, setMenu] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    window.scrollTo({ top: 0 })
    setMenu(false)
  }, [location.pathname])

  const closePalette = useCallback(() => setPalette(false), [])
  const closeStatus = useCallback(() => setStatusOpen(false), [])
  const closeMenu = useCallback(() => setMenu(false), [])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas">
        <Wordmark />
      </div>
    )
  }
  if (!session) return <Navigate to="/signin" replace state={{ from: location.pathname + location.search }} />

  return (
    <div className="flex min-h-screen bg-canvas">
      <AnimatePresence>{!prefs.bootSeen && <Boot key="boot" onDone={() => setPreferences({ bootSeen: true })} />}</AnimatePresence>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[90] focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-canvas">
        Skip to content
      </a>
      <Sidebar onOpenStatus={() => setStatusOpen(true)} />
      <div className="flex min-w-0 flex-1 flex-col">
        {STATIC_DEMO && <StaticDemoBanner />}
        <TopBar onOpenPalette={() => setPalette(true)} onOpenMenu={() => setMenu(true)} onOpenStatus={() => setStatusOpen(true)} />
        <main id="main" className="min-w-0 flex-1 px-4 pb-24 pt-6 sm:px-6 sm:pt-8 lg:px-10 lg:pb-12 xl:px-12">
          <div className="mx-auto w-full min-w-0 max-w-page">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="min-w-0"
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
        <footer className="no-print border-t border-line px-4 pb-20 pt-4 sm:px-6 lg:px-10 lg:pb-4 xl:px-12">
          <p className="mx-auto max-w-page text-[11.5px] leading-relaxed text-ink-3">{DISCLAIMER}</p>
        </footer>
      </div>
      <MobileBar onMenu={() => setMenu(true)} />
      <Drawer open={menu} onClose={closeMenu} title="Navigation" eyebrow="NEXUS" width="sm:max-w-xs">
        <NavList collapsed={false} onNavigate={closeMenu} />
      </Drawer>
      <CommandPalette open={palette} onClose={closePalette} />
      <SystemStatusDrawer open={statusOpen} onClose={closeStatus} />
    </div>
  )
}


import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import {
  BookOpen,
  Boxes,
  Bug,
  CornerDownLeft,
  Download,
  FilePlus2,
  Fingerprint,
  FlaskConical,
  FolderPlus,
  History,
  PackagePlus,
  Radio,
  Scale,
  ScrollText,
  Search,
  Settings,
  Siren,
  Timer,
  Upload,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { download } from '../../lib/client/api.ts'
import { useOverview, useSearch } from '../../lib/client/queries.ts'
import { useSession } from '../../lib/client/session.tsx'
import { rememberRecent, usePreferences } from '../preferences.ts'
import { useToast } from '../../components/ui/overlay.tsx'
import { Kbd, cx } from '../../components/ui/primitives.tsx'
import type { Permission } from '../../types/domain.ts'

interface Command {
  id: string
  label: string
  hint?: string
  icon: LucideIcon
  group: 'Contextual' | 'Recent' | 'Commands' | 'Results'
  run: () => void
  permission?: Permission
  keywords?: string
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const navigate = useNavigate()
  const location = useLocation()
  const { can } = useSession()
  const prefs = usePreferences()
  const toast = useToast()
  const overview = useOverview()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const debounced = useDebounced(query, 160)
  const search = useSearch(debounced)

  const caseMatch = /^\/cases\/([^/]+)/.exec(location.pathname)
  const caseId = caseMatch ? decodeURIComponent(caseMatch[1]!) : null
  const activeCase = overview.data?.activeClock?.item.id ?? null

  useEffect(() => {
    if (open) {
      setQuery('')
      setIndex(0)
      setTimeout(() => inputRef.current?.focus(), 20)
    }
  }, [open])

  const go = (href: string, label: string, id: string) => {
    rememberRecent({ id, label, href })
    navigate(href)
    onClose()
  }

  const commands = useMemo<Command[]>(() => {
    const needCase = (label: string, tab: string, extra: string) => () => {
      if (caseId) go(`/cases/${encodeURIComponent(caseId)}?tab=${tab}${extra}`, label, `cmd-${tab}${extra}`)
      else {
        toast({ tone: 'info', title: 'Choose a case', body: `${label} is recorded on a case. Open one from the list.` })
        go('/cases', 'Cases', 'nav-cases')
      }
    }
    const list: Command[] = []
    if (caseId) {
      list.push(
        { id: 'ctx-clock', label: 'Open Clock of Record', hint: caseId, icon: Timer, group: 'Contextual', run: () => go(`/cases/${encodeURIComponent(caseId)}?tab=clock`, `Clock of Record ${caseId}`, `ctx-clock-${caseId}`) },
        { id: 'ctx-why', label: 'Why this decision?', hint: caseId, icon: Scale, group: 'Contextual', run: () => go(`/cases/${encodeURIComponent(caseId)}?tab=rationale`, `Rationale ${caseId}`, `ctx-why-${caseId}`) },
        { id: 'ctx-export', label: 'Export case record (JSON)', hint: caseId, icon: Download, group: 'Contextual', run: () => { onClose(); void download(`/api/cases/${encodeURIComponent(caseId)}/export`, `${caseId}.json`) } },
      )
    }
    list.push(
      { id: 'create-case', label: 'Create case', icon: FolderPlus, group: 'Commands', permission: 'case.create', run: () => go('/cases?new=1', 'Create case', 'create-case') },
      { id: 'add-vuln', label: 'Add vulnerability', icon: Bug, group: 'Commands', permission: 'vulnerability.write', keywords: 'intake cve', run: () => go('/vulnerabilities/new', 'Vulnerability intake', 'add-vuln') },
      { id: 'add-product', label: 'Add product', icon: PackagePlus, group: 'Commands', permission: 'product.write', run: () => go('/products?new=1', 'Add product', 'add-product') },
      { id: 'create-det', label: 'Create determination', icon: Scale, group: 'Commands', permission: 'determination.record', keywords: 'affectedness vex', run: needCase('Create determination', 'products', '&record=1') },
      { id: 'awareness', label: 'Start awareness event', icon: Radio, group: 'Commands', permission: 'awareness.establish', keywords: 'establish clock', run: needCase('Start awareness event', 'clock', '&establish=1') },
      { id: 'active-clock', label: 'Open active clock', hint: activeCase ?? undefined, icon: Timer, group: 'Commands', run: () => (activeCase ? go(`/cases/${encodeURIComponent(activeCase)}?tab=clock`, 'Active clock', 'active-clock') : go('/clocks', 'Clocks', 'nav-clocks')) },
      { id: 'add-evidence', label: 'Add evidence', icon: Fingerprint, group: 'Commands', permission: 'evidence.write', run: needCase('Add evidence', 'evidence', '&add=1') },
      { id: 'search-cve', label: 'Search CVE', icon: Search, group: 'Commands', run: () => { setQuery('CVE-'); inputRef.current?.focus() } },
      { id: 'search-product', label: 'Search product', icon: Boxes, group: 'Commands', run: () => go('/products', 'Products', 'nav-products') },
      { id: 'generate-report', label: 'Generate report', icon: FilePlus2, group: 'Commands', permission: 'report.generate', run: needCase('Generate report', 'report', '&generate=1') },
      { id: 'verify-ledger', label: 'Verify ledger', icon: ScrollText, group: 'Commands', permission: 'ledger.verify', keywords: 'hash chain integrity', run: () => go('/ledger?verify=1', 'Verify ledger', 'verify-ledger') },
      { id: 'rules', label: 'Open rules', icon: BookOpen, group: 'Commands', run: () => go('/rules', 'Rules', 'nav-rules') },
      { id: 'critical', label: 'View critical deadlines', icon: Siren, group: 'Commands', run: () => go('/clocks?filter=critical', 'Critical deadlines', 'critical') },
      { id: 'export-case', label: 'Export case', icon: Download, group: 'Commands', run: caseId ? () => { onClose(); void download(`/api/cases/${encodeURIComponent(caseId)}/export`, `${caseId}.json`) } : () => go('/import', 'Import & export', 'nav-import') },
      { id: 'simulator', label: 'Open clock simulator (what-if)', icon: FlaskConical, group: 'Commands', keywords: 'sandbox simulation', run: () => go('/clocks?simulate=1', 'Clock simulator', 'simulator') },
      { id: 'scenarios', label: 'Scenario simulator', icon: FlaskConical, group: 'Commands', keywords: 'demo', run: () => go('/scenarios', 'Scenario simulator', 'scenarios') },
      { id: 'import', label: 'Import data (CSV, JSON)', icon: Upload, group: 'Commands', permission: 'import.commit', run: () => go('/import', 'Import & export', 'nav-import') },
      { id: 'settings', label: 'Open settings', icon: Settings, group: 'Commands', run: () => go('/settings', 'Settings', 'nav-settings') },
    )
    return list.filter((c) => !c.permission || can(c.permission))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, activeCase, can])

  const q = query.trim().toLowerCase()
  const items = useMemo<Command[]>(() => {
    const out: Command[] = []
    const match = (c: Command) => !q || c.label.toLowerCase().includes(q) || c.keywords?.includes(q) || c.hint?.toLowerCase().includes(q)
    out.push(...commands.filter((c) => c.group === 'Contextual' && match(c)))
    if (!q) {
      for (const r of prefs.recent) out.push({ id: `recent-${r.id}`, label: r.label, hint: r.href, icon: History, group: 'Recent', run: () => go(r.href, r.label, r.id) })
    }
    out.push(...commands.filter((c) => c.group === 'Commands' && match(c)))
    for (const r of search.data ?? []) {
      out.push({ id: `res-${r.kind}-${r.id}`, label: r.label, hint: r.sublabel, icon: r.kind === 'case' ? Scale : r.kind === 'vulnerability' ? Bug : r.kind === 'product' || r.kind === 'component' ? Boxes : Fingerprint, group: 'Results', run: () => go(r.href, r.label, `${r.kind}-${r.id}`) })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commands, q, prefs.recent, search.data])

  useEffect(() => setIndex(0), [q])
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => Math.min(items.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      items[index]?.run()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  let lastGroup = ''
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center px-3 pt-[12vh]">
          <motion.div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }} onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="relative w-full max-w-[640px] overflow-hidden rounded-2xl border border-line-strong bg-s2 shadow-overlay"
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.985 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="h-4 w-4 shrink-0 text-ink-3" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKey}
                placeholder="Type a command, CVE, case, product or evidence id"
                className="h-14 w-full min-w-0 bg-transparent text-md text-ink outline-none placeholder:text-ink-4"
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-list"
                aria-activedescendant={items[index] ? `palette-${items[index]!.id}` : undefined}
              />
              <Kbd>Esc</Kbd>
            </div>
            <div ref={listRef} id="palette-list" role="listbox" className="max-h-[min(420px,60vh)] overflow-y-auto p-2">
              {items.length === 0 && (
                <div className="px-3 py-8 text-center text-sm text-ink-3">{search.isFetching ? 'Searching…' : `No command or record matches "${query}".`}</div>
              )}
              {items.map((c, i) => {
                const header = c.group !== lastGroup
                lastGroup = c.group
                return (
                  <div key={c.id}>
                    {header && <div className="micro px-3 pb-1.5 pt-3">{c.group}</div>}
                    <button
                      id={`palette-${c.id}`}
                      role="option"
                      aria-selected={i === index}
                      data-index={i}
                      type="button"
                      onMouseMove={() => setIndex(i)}
                      onClick={() => c.run()}
                      className={cx('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-100', i === index ? 'bg-s4 text-ink' : 'text-ink-2')}
                    >
                      <c.icon className={cx('h-4 w-4 shrink-0', i === index ? 'text-amber' : 'text-ink-3')} strokeWidth={1.75} />
                      <span className="min-w-0 flex-1 truncate text-sm">{c.label}</span>
                      {c.hint && <span className="ident max-w-[45%] truncate text-[11px] text-ink-3">{c.hint}</span>}
                      {i === index && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-ink-3" />}
                    </button>
                  </div>
                )
              })}
            </div>
            <div className="flex items-center gap-4 border-t border-line px-4 py-2.5 text-[11px] text-ink-3">
              <span className="flex items-center gap-1.5">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> move
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>↵</Kbd> run
              </span>
              <span className="ml-auto">Commands are filtered by your role.</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

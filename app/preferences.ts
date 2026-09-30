import { useSyncExternalStore } from 'react'

/**
 * Per-viewer interface preferences: sidebar collapsed, reduced motion,
 * recent commands. Browser storage only, and only for conveniences; nothing
 * the record depends on lives here. Every access is guarded, because storage
 * can be unavailable (private windows, blocked site data).
 */

export interface Preferences {
  sidebarCollapsed: boolean
  reduceMotion: boolean
  recent: Array<{ id: string; label: string; href: string }>
  bootSeen: boolean
}

const KEY = 'nexus.prefs.v1'
const DEFAULTS: Preferences = { sidebarCollapsed: false, reduceMotion: false, recent: [], bootSeen: false }

function read(): Preferences {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<Preferences>
    return {
      sidebarCollapsed: typeof parsed.sidebarCollapsed === 'boolean' ? parsed.sidebarCollapsed : false,
      reduceMotion: typeof parsed.reduceMotion === 'boolean' ? parsed.reduceMotion : false,
      recent: Array.isArray(parsed.recent) ? parsed.recent.filter((r) => r && typeof r.href === 'string' && r.href.startsWith('/')).slice(0, 6) : [],
      bootSeen: false,
    }
  } catch {
    return DEFAULTS
  }
}

let state: Preferences = read()
let bootSeen = false
const subs = new Set<() => void>()

export function setPreferences(patch: Partial<Preferences>): void {
  if (patch.bootSeen !== undefined) bootSeen = patch.bootSeen
  state = { ...state, ...patch, bootSeen }
  try {
    const { bootSeen: _b, ...persisted } = state
    localStorage.setItem(KEY, JSON.stringify(persisted))
  } catch {
    // storage unavailable: the preference lasts for this page only
  }
  if (typeof document !== 'undefined') document.documentElement.dataset.reduceMotion = String(state.reduceMotion)
  for (const fn of subs) fn()
}

export function rememberRecent(item: { id: string; label: string; href: string }): void {
  setPreferences({ recent: [item, ...state.recent.filter((r) => r.id !== item.id)].slice(0, 6) })
}

if (typeof document !== 'undefined') document.documentElement.dataset.reduceMotion = String(state.reduceMotion)

export function usePreferences(): Preferences {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn)
      return () => subs.delete(fn)
    },
    () => state,
  )
}

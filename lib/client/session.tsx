import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Permission } from '../../types/domain.ts'
import type { SessionResponse } from '../../types/api.ts'
import { api, ApiFailure, onSessionExpired, setCsrfToken } from './api.ts'
import { setDisplayZone } from './format.ts'

interface SessionState {
  session: SessionResponse | null
  loading: boolean
  demoMode: boolean
  can: (p: Permission) => boolean
  refresh: () => Promise<SessionResponse | null>
  signInAs: (userId: string) => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<SessionState | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [demoMode, setDemoMode] = useState(true)
  const qc = useQueryClient()

  const refresh = useCallback(async () => {
    try {
      const r = await api<SessionResponse | { authenticated: false; demoMode: boolean }>('/api/session')
      if (!('user' in r)) {
        setSession(null)
        setCsrfToken(null)
        setDemoMode(r.demoMode)
        return null
      }
      const s = r
      setCsrfToken(s.csrfToken)
      setDisplayZone(s.org.timezone)
      setSession(s)
      setDemoMode(s.demoMode)
      return s
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 401) {
        setSession(null)
        setCsrfToken(null)
      }
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    return onSessionExpired(() => {
      setSession(null)
      setCsrfToken(null)
    })
  }, [refresh])

  const signInAs = useCallback(
    async (userId: string) => {
      await api('/api/session/persona', { body: { userId } })
      qc.clear()
      await refresh()
    },
    [qc, refresh],
  )

  const signOut = useCallback(async () => {
    try {
      await api('/api/session/logout', { method: 'POST' })
    } finally {
      qc.clear()
      setSession(null)
      setCsrfToken(null)
    }
  }, [qc])

  const value = useMemo<SessionState>(
    () => ({
      session,
      loading,
      demoMode,
      can: (p) => !!session?.permissions.includes(p),
      refresh,
      signInAs,
      signOut,
    }),
    [session, loading, demoMode, refresh, signInAs, signOut],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession(): SessionState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSession outside SessionProvider')
  return v
}

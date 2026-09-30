import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { motion } from 'motion/react'
import { ArrowRight, KeyRound } from 'lucide-react'
import { useSession } from '../../lib/client/session.tsx'
import { usePersonas } from '../../lib/client/queries.ts'
import { api } from '../../lib/client/api.ts'
import { ROLES } from '../../lib/rbac.ts'
import { Button, Field, TextInput, cx } from '../../components/ui/primitives.tsx'
import { ErrorState } from '../../components/ui/feedback.tsx'
import { Mark } from '../shell/Wordmark.tsx'
import { DISCLAIMER } from '../shell/Shell.tsx'

/**
 * Sign-in. In demo mode, a persona picker: each fictional user holds one
 * role, which is how RBAC is demonstrated -- sign in as Read Only and every
 * write is refused by the server. Password sign-in is available when an
 * account has a credential (DEMO_PASSWORD at seed time).
 */
export function SignIn() {
  const { session, signInAs, refresh, demoMode } = useSession()
  const personas = usePersonas()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  if (session) return <Navigate to={from} replace />

  const persona = async (id: string) => {
    setBusy(id)
    setError(null)
    try {
      await signInAs(id)
      navigate(from, { replace: true })
    } catch (e) {
      setError(e)
    } finally {
      setBusy(null)
    }
  }

  const login = async () => {
    setBusy('password')
    setError(null)
    try {
      await api('/api/session/login', { body: { email, password } })
      await refresh()
      navigate(from, { replace: true })
    } catch (e) {
      setError(e)
    } finally {
      setBusy(null)
    }
  }

  const list = personas.data?.personas ?? []
  return (
    <div className="relative min-h-screen overflow-hidden bg-canvas">
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_at_30%_20%,black_10%,transparent_65%)]" />
      <div className="relative mx-auto grid min-h-screen max-w-6xl gap-12 px-6 py-12 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:gap-20">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
          <div className="flex items-center gap-3">
            <Mark className="h-7 w-7" />
            <span className="font-mono text-lg font-semibold tracking-[0.32em] text-ink">NEXUS</span>
          </div>
          <h1 className="mt-10 max-w-md text-3xl font-medium text-ink sm:text-4xl">What did we know, and when did we know it?</h1>
          <p className="mt-5 max-w-md text-md text-ink-2">
            Reportability determination and clock of record for EU Cyber Resilience Act Article 14. Occurrence, detection, awareness, decision and submission are kept apart, and each is tied to its evidence.
          </p>
          <p className="mt-8 max-w-md text-xs leading-relaxed text-ink-3">{DISCLAIMER}</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.08, ease: [0.22, 1, 0.36, 1] }} className="panel p-6 sm:p-8">
          {demoMode && (
            <>
              <div className="micro">Demo organisation · {personas.data?.org ?? 'loading'}</div>
              <h2 className="mt-2 text-xl font-medium text-ink">Sign in as a persona</h2>
              <p className="mt-2 text-sm text-ink-3">Every persona is fictional and holds one role. Permissions are enforced by the server, not by this page.</p>
              <ul className="mt-6 grid gap-2 sm:grid-cols-2">
                {list.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => void persona(p.id)}
                      disabled={!!busy}
                      className={cx(
                        'group flex w-full items-center gap-3 rounded-lg border border-line bg-s2 px-3 py-2.5 text-left transition-[background-color,border-color,transform] duration-150 hover:-translate-y-px hover:border-line-bright hover:bg-s3 disabled:opacity-60',
                        p.role === 'psirt_lead' && 'border-amber-line',
                      )}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line-strong bg-s1 font-mono text-[11px] text-ink-2">{p.initials}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink">{p.name}</span>
                        <span className="block truncate text-xs text-ink-3">{ROLES[p.role].label}</span>
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-4 transition-colors group-hover:text-ink-2" />
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-ink-3">Start with Jonas Weber (PSIRT Lead) for the full workflow. Switch personas at any time from the account menu.</p>
              <div className="my-7 h-px bg-line" />
            </>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void login()
            }}
            className="space-y-4"
          >
            <div className="flex items-center gap-2 text-sm text-ink-2">
              <KeyRound className="h-4 w-4 text-ink-3" /> Password sign-in
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Email">{(id) => <TextInput id={id} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
              <Field label="Password">{(id) => <TextInput id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}</Field>
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-ink-3">Demo accounts have no password unless DEMO_PASSWORD was set at seed time.</p>
              <Button type="submit" variant="primary" busy={busy === 'password'}>
                Sign in
              </Button>
            </div>
          </form>
          {error !== null && <ErrorState error={error} className="mt-5" />}
        </motion.div>
      </div>
    </div>
  )
}

import { useCallback, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Database, FlaskConical, PlayCircle, RotateCcw, ShieldAlert } from 'lucide-react'
import { ROLES } from '../../lib/rbac.ts'
import { api } from '../../lib/client/api.ts'
import { useSession } from '../../lib/client/session.tsx'
import { Button, Field, Panel, TextInput } from '../ui/primitives.tsx'
import { Badge } from '../ui/status.tsx'
import { ErrorState, Notice } from '../ui/feedback.tsx'
import { Modal } from '../ui/overlay.tsx'
import { SectionHeader, listPhrase, rolesWith } from './common.tsx'

/**
 * Demo mode: the scenario simulator, sample imports, and the reset path. The
 * server returns 404 for every demo route unless DEMO_MODE=true, so a
 * production deployment has none of this.
 */

const CONFIRM_WORD = 'RESET'

export function DemoSection({ demoMode }: { demoMode: boolean }) {
  const { can, session } = useSession()
  const allowed = can('demo.control')
  const controllers = listPhrase(rolesWith('demo.control').map((r) => ROLES[r].label))
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])

  return (
    <section aria-label="Demo mode">
      <SectionHeader
        eyebrow="Workspace"
        title="Demo mode"
        description={<p>Everything in this demo is fictional: the organization, its people, products, deployments and every vulnerability, which use CVE identifiers in a range that does not exist.</p>}
        action={
          demoMode ? (
            <Badge tone="amber" icon={FlaskConical}>
              Demo mode on
            </Badge>
          ) : (
            <Badge tone="dim">Demo mode off</Badge>
          )
        }
      />

      {!demoMode ? (
        <Notice tone="neutral" title="Demo controls are disabled on this server">
          This server runs with demo mode off. The scenario simulator, the ledger tamper simulation and the reset path are not served, and their routes answer 404. Import and export remain available from{' '}
          <Link to="/import" className="text-ink underline decoration-line-bright underline-offset-2 hover:decoration-ink">
            Import &amp; export
          </Link>
          .
        </Notice>
      ) : (
        <>
          <ul className="mb-10 border-t border-line">
            <li className="grid min-w-0 gap-3 border-b border-line py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-8">
              <div className="flex min-w-0 items-start gap-3">
                <PlayCircle className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
                <div className="min-w-0">
                  <div className="text-sm text-ink">Scenario simulator</div>
                  <p className="mt-0.5 text-sm text-ink-3">Six guided scenarios. Each creates a fresh fictional case, recorded now and marked as demo-sourced in the ledger.</p>
                </div>
              </div>
              <Link to="/scenarios" className="inline-flex h-9 items-center gap-2 justify-self-start rounded-md border border-line-strong bg-s3 px-3.5 text-sm font-medium text-ink transition-colors duration-150 hover:border-line-bright hover:bg-s4">
                Open simulator <ArrowRight className="h-3.5 w-3.5 text-ink-3" aria-hidden />
              </Link>
            </li>
            <li className="grid min-w-0 gap-3 border-b border-line py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-8">
              <div className="flex min-w-0 items-start gap-3">
                <Database className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
                <div className="min-w-0">
                  <div className="text-sm text-ink">Import &amp; export</div>
                  <p className="mt-0.5 text-sm text-ink-3">Validate and import vulnerabilities, products and component mappings, with fictional sample files. Export the case register.</p>
                </div>
              </div>
              <Link to="/import" className="inline-flex h-9 items-center gap-2 justify-self-start rounded-md border border-line-strong bg-s3 px-3.5 text-sm font-medium text-ink transition-colors duration-150 hover:border-line-bright hover:bg-s4">
                Open import &amp; export <ArrowRight className="h-3.5 w-3.5 text-ink-3" aria-hidden />
              </Link>
            </li>
          </ul>

          <Panel className="border-red-line">
            <div className="grid min-w-0 gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <div className="min-w-0 max-w-2xl">
                <div className="micro mb-2 text-red">Danger zone</div>
                <h3 className="text-md font-medium text-ink">Reset demo data</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">
                  Deletes every record on this server, including the audit ledger, and re-seeds the fictional Tessaline Systems demo data. Everyone signed in, you included, is signed out.
                </p>
                {!allowed && (
                  <p className="mt-3 text-xs text-ink-3">
                    Your role{session ? ` (${ROLES[session.user.role].label})` : ''} cannot reset the demo. Reset is available to {controllers}.
                  </p>
                )}
              </div>
              <Button variant="danger" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setOpen(true)} disabled={!allowed}>
                Reset demo data
              </Button>
            </div>
          </Panel>
          <ResetModal open={open} onClose={close} />
        </>
      )}
    </section>
  )
}

function ResetModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  // A ref, so the dialog's close handler keeps one identity while busy changes.
  const busyRef = useRef(false)
  const ready = typed.trim().toUpperCase() === CONFIRM_WORD

  const dismiss = useCallback(() => {
    if (busyRef.current) return
    setTyped('')
    setError(null)
    onClose()
  }, [onClose])

  const reset = async () => {
    if (!ready || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      await api<{ ok: boolean; signInRequired: true }>('/api/demo/reset', { method: 'POST' })
      window.location.assign('/signin')
    } catch (e) {
      busyRef.current = false
      setError(e)
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={dismiss}
      eyebrow="Demo / simulation"
      title="Reset all demo data?"
      footer={
        <>
          <Button variant="ghost" onClick={dismiss} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" icon={<RotateCcw className="h-3.5 w-3.5" />} busy={busy} disabled={!ready} onClick={() => void reset()}>
            Delete everything and re-seed
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Notice tone="red" icon={ShieldAlert} title="This cannot be undone">
          Every record on this server is deleted: cases, vulnerabilities, products, evidence files, determinations, decisions, reports, notifications, sessions and the audit ledger itself. The fictional demo data is then seeded again from scratch.
        </Notice>
        <ul className="space-y-2 text-sm text-ink-2">
          <li>Anyone else using this demo loses their work as well.</li>
          <li>Every session ends. You will be taken to sign-in.</li>
          <li>Download a ledger anchor first if you want evidence of the current state.</li>
        </ul>
        <Field label={`Type ${CONFIRM_WORD} to confirm`}>
          {(id) => (
            <TextInput
              id={id}
              data-autofocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && ready) void reset()
              }}
              autoComplete="off"
              spellCheck={false}
              className="font-mono uppercase tracking-[0.12em]"
              placeholder={CONFIRM_WORD}
            />
          )}
        </Field>
        {error !== null && <ErrorState error={error} />}
      </div>
    </Modal>
  )
}

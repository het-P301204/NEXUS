import { useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { motion } from 'motion/react'
import { Bug, Plus, Radar, X } from 'lucide-react'
import type { ExploitationStatus, Severity } from '../../types/domain.ts'
import { useVulnerabilities } from '../../lib/client/queries.ts'
import type { VulnerabilityListItem } from '../../lib/client/queries.ts'
import { useSession } from '../../lib/client/session.tsx'
import { fullDate } from '../../lib/client/format.ts'
import { Button, PageHeader, Select, Skeleton } from '../../components/ui/primitives.tsx'
import { ExploitationBadge, SeverityMark } from '../../components/ui/status.tsx'
import { EmptyState, ErrorState } from '../../components/ui/feedback.tsx'
import { Count, SEVERITY_ORDER, SearchBox } from '../../components/portfolio/shared.tsx'

/**
 * The vulnerability register. A vulnerability is a fact about a component;
 * what it means for each product is decided in a case. The list therefore
 * links every vulnerability to the cases that decide it.
 */

const EX_ORDER: Record<ExploitationStatus, number> = { CONFIRMED: 0, SUSPECTED: 1, UNKNOWN: 2, NOT_OBSERVED: 3 }

export function Vulnerabilities() {
  const vulns = useVulnerabilities()
  const { can } = useSession()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const severity = (params.get('severity') ?? 'all') as Severity | 'all'
  const exploitation = (params.get('exploitation') ?? 'all') as ExploitationStatus | 'all'

  const update = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (!v || v === 'all') next.delete(k)
    else next.set(k, v)
    setParams(next, { replace: true })
  }
  const clear = () => setParams({}, { replace: true })
  const filtered = !!q || severity !== 'all' || exploitation !== 'all'

  const all = useMemo(() => vulns.data ?? [], [vulns.data])
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return all
      .filter((v) => severity === 'all' || v.severity === severity)
      .filter((v) => exploitation === 'all' || v.exploitation === exploitation)
      .filter((v) => !needle || [v.cve ?? '', v.id, v.title, v.componentName ?? '', v.cwe ?? ''].some((s) => s.toLowerCase().includes(needle)))
      .sort((a, b) => EX_ORDER[a.exploitation] - EX_ORDER[b.exploitation] || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (b.cvssScore ?? -1) - (a.cvssScore ?? -1) || Date.parse(b.discoveredAt) - Date.parse(a.discoveredAt))
  }, [all, q, severity, exploitation])

  return (
    <div className="min-w-0">
      <PageHeader
        eyebrow="Operate"
        title="Vulnerabilities"
        description="Every vulnerability NEXUS is tracking, and the cases that decide what it means for each product."
        actions={
          can('vulnerability.write') ? (
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/vulnerabilities/new')}>
              Add vulnerability
            </Button>
          ) : undefined
        }
      />

      {vulns.isError ? (
        <ErrorState error={vulns.error} onRetry={() => void vulns.refetch()} />
      ) : vulns.isPending ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading vulnerabilities">
          <Skeleton className="h-9 w-full max-w-xl" />
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : all.length === 0 ? (
        <EmptyState
          icon={Bug}
          title="No vulnerabilities recorded"
          why="A case is opened against a vulnerability record. Until one exists, NEXUS has nothing to evaluate for reportability. Add a vulnerability from an advisory, a scanner finding or a researcher report."
          action={
            can('vulnerability.write') ? (
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/vulnerabilities/new')}>
                Add vulnerability
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="mb-5 flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
            <SearchBox value={q} onChange={(e) => update('q', e.target.value)} placeholder="Search CVE, title or component" aria-label="Search vulnerabilities" className="lg:w-96" />
            <div className="grid min-w-0 grid-cols-2 gap-3 sm:flex">
              <Select value={severity} onChange={(e) => update('severity', e.target.value)} aria-label="Severity" className="sm:w-44">
                <option value="all">Any severity</option>
                <option value="CRITICAL">Critical</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </Select>
              <Select value={exploitation} onChange={(e) => update('exploitation', e.target.value)} aria-label="Exploitation status" className="sm:w-52">
                <option value="all">Any exploitation status</option>
                <option value="CONFIRMED">Actively exploited</option>
                <option value="SUSPECTED">Suspected</option>
                <option value="NOT_OBSERVED">Not observed</option>
                <option value="UNKNOWN">Unknown</option>
              </Select>
            </div>
            <div className="flex items-center gap-3 lg:ml-auto">
              <Count shown={items.length} total={all.length} noun="vulnerability" plural="vulnerabilities" />
              {filtered && (
                <button type="button" onClick={clear} className="inline-flex items-center gap-1 text-xs text-ink-2 hover:text-ink">
                  <X className="h-3 w-3" aria-hidden /> Clear filters
                </button>
              )}
            </div>
          </div>

          {items.length === 0 ? (
            <EmptyState
              compact
              icon={Bug}
              title="No vulnerability matches"
              why="Nothing in the register matches every filter. The register itself is not empty: clear a filter to widen the search."
              action={<Button onClick={clear}>Clear filters</Button>}
            />
          ) : (
            <>
              <VulnTable items={items} />
              <VulnList items={items} />
            </>
          )}
          <p className="mt-4 text-xs text-ink-3">Ordered by exploitation status, then severity and CVSS. The exploitation status is a fact about the vulnerability; it does not by itself start a reporting clock.</p>
        </>
      )}
    </div>
  )
}

function CasesCell({ v }: { v: VulnerabilityListItem }) {
  const first = v.cases[0]
  if (!first) return <span className="mono text-xs text-ink-4">0</span>
  return (
    <Link to={`/cases/${first.id}`} className="group inline-flex flex-col items-end" title={v.cases.map((c) => c.id).join(', ')}>
      <span className="mono text-sm text-ink group-hover:text-amber">{v.cases.length}</span>
      <span className="mono whitespace-nowrap text-[10.5px] text-ink-3">{first.id}</span>
    </Link>
  )
}

function VulnTable({ items }: { items: VulnerabilityListItem[] }) {
  return (
    <div className="hidden min-w-0 overflow-hidden rounded-xl border border-line xl:block">
      <table className="w-full table-fixed text-left">
        <thead className="border-b border-line bg-s1">
          <tr>
            <th scope="col" className="micro w-[14%] px-4 py-3 font-normal">CVE</th>
            <th scope="col" className="micro w-[25%] px-3 py-3 font-normal">Vulnerability</th>
            <th scope="col" className="micro w-[10%] px-3 py-3 font-normal">CVSS</th>
            <th scope="col" className="micro w-[17%] px-3 py-3 font-normal">Exploitation</th>
            <th scope="col" className="micro w-[15%] px-3 py-3 font-normal">Affected range</th>
            <th scope="col" className="micro w-[12%] px-3 py-3 text-right font-normal">Cases</th>
            <th scope="col" className="micro w-[7%] px-4 py-3 text-right font-normal">
              <span title="Threat-intelligence entries">Intel</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((v, i) => (
            <motion.tr key={v.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i, 12) * 0.025 }} className="row-line">
              <td className="px-4 py-3.5 align-top">
                <Link to={`/vulnerabilities/${v.id}`} className="ident text-[12.5px] text-ink hover:text-amber">
                  {v.cve ?? v.id}
                </Link>
                <div className="mt-1 text-[11px] text-ink-3">{fullDate(v.discoveredAt)}</div>
              </td>
              <td className="px-3 py-3.5 align-top">
                <Link to={`/vulnerabilities/${v.id}`} className="line-clamp-2 text-sm text-ink hover:text-amber">
                  {v.title}
                </Link>
                <div className="mt-1 flex min-w-0 items-center gap-2 text-[11.5px] text-ink-3">
                  <span className="ident text-[11.5px] text-ink-2">{v.componentName ?? 'No component'}</span>
                  {v.cwe && <span className="ident text-[11px]">{v.cwe}</span>}
                </div>
              </td>
              <td className="px-3 py-3.5 align-top">
                <div className="mono text-sm text-ink">{v.cvssScore !== null ? v.cvssScore.toFixed(1) : '--'}</div>
                <div className="mt-1">
                  <SeverityMark severity={v.severity} />
                </div>
              </td>
              <td className="px-3 py-3.5 align-top">
                <ExploitationBadge status={v.exploitation} size="sm" />
              </td>
              <td className="px-3 py-3.5 align-top">
                <span className="ident text-[12px] text-ink-2">{v.affectedVersions}</span>
              </td>
              <td className="px-3 py-3.5 text-right align-top">
                <CasesCell v={v} />
              </td>
              <td className="px-4 py-3.5 text-right align-top">
                <span className={v.intelCount ? 'mono text-sm text-ink' : 'mono text-sm text-ink-4'}>{v.intelCount}</span>
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function VulnList({ items }: { items: VulnerabilityListItem[] }) {
  return (
    <ul className="divide-y divide-line border-y border-line xl:hidden">
      {items.map((v) => (
        <li key={v.id} className="py-4">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <Link to={`/vulnerabilities/${v.id}`} className="ident text-[12.5px] text-ink">
                {v.cve ?? v.id}
              </Link>
              <Link to={`/vulnerabilities/${v.id}`} className="mt-1 block text-sm text-ink">
                {v.title}
              </Link>
            </div>
            <div className="shrink-0 text-right">
              <div className="mono text-sm text-ink">{v.cvssScore !== null ? v.cvssScore.toFixed(1) : '--'}</div>
              <div className="mt-1">
                <SeverityMark severity={v.severity} />
              </div>
            </div>
          </div>
          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <ExploitationBadge status={v.exploitation} size="sm" />
            <span className="ident text-[12px] text-ink-2">{v.componentName ?? 'No component'}</span>
            <span className="ident text-[12px] text-ink-3">{v.affectedVersions}</span>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-3">
            {v.cases[0] ? (
              <Link to={`/cases/${v.cases[0].id}`} className="hover:text-ink">
                <span className="mono text-ink-2">{v.cases.length}</span> case{v.cases.length === 1 ? '' : 's'} · <span className="ident">{v.cases[0].id}</span>
              </Link>
            ) : (
              <span>No case</span>
            )}
            <span className="inline-flex items-center gap-1">
              <Radar className="h-3 w-3" aria-hidden /> <span className="mono text-ink-2">{v.intelCount}</span> intel
            </span>
            <span>{fullDate(v.discoveredAt)}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}

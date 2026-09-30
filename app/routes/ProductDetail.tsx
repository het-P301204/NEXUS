import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { motion } from 'motion/react'
import { ArrowLeft, ArrowRight, FileX, FolderKanban, MapPin, Network, Package, Plus, ShieldCheck } from 'lucide-react'
import type { ProductListItem } from '../../types/api.ts'
import type { VulnerabilityListItem } from '../../lib/client/queries.ts'
import { useCases, useGraph, useProducts, useVulnerabilities } from '../../lib/client/queries.ts'
import { useSession } from '../../lib/client/session.tsx'
import { fullDate, stamp } from '../../lib/client/format.ts'
import { inRange } from '../../lib/engine/versions.ts'
import { Button, PageHeader, Skeleton, cx } from '../../components/ui/primitives.tsx'
import { AffectednessBadge, Badge, CaseStatusBadge, ExploitationBadge, SeverityMark } from '../../components/ui/status.tsx'
import { EmptyState, ErrorState } from '../../components/ui/feedback.tsx'
import { buildModel } from '../../components/portfolio/graphModel.ts'
import type { GraphModel } from '../../components/portfolio/graphModel.ts'
import { ComponentMappingDrawer, DeploymentDrawer } from '../../components/portfolio/ProductForms.tsx'
import { VersionComparison } from '../../components/portfolio/VersionComparison.tsx'
import { EXPOSURE, LifecycleBadge, NoDeterminationMark, RangeMark, RiskBadge, SBOM, SEVERITY_ORDER, SbomMark, fmtCount, useProduct, useUserName } from '../../components/portfolio/shared.tsx'

/**
 * One product: what it is and where it runs, what its SBOM says it
 * contains, which vulnerabilities reach those component versions, the cases
 * deciding them, and how its components changed against another release.
 */
export function ProductDetail() {
  const { id = '' } = useParams()
  const product = useProduct(id)
  const products = useProducts()
  const vulns = useVulnerabilities()
  const graph = useGraph()
  const cases = useCases()
  const { can } = useSession()
  const userName = useUserName()
  const [mapping, setMapping] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const model = useMemo(() => (graph.data ? buildModel(graph.data) : null), [graph.data])

  if (product.isError) {
    return (
      <div className="min-w-0">
        <BackLink />
        <ErrorState error={product.error} onRetry={() => void product.refetch()} />
      </div>
    )
  }
  if (product.isPending) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading product">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-10 w-96 max-w-full" />
        <Skeleton className="h-20" />
        <Skeleton className="h-72" />
      </div>
    )
  }
  const p = product.data
  const canWrite = can('product.write')
  const sbom = SBOM[p.sbomStatus]

  return (
    <div className="min-w-0">
      <BackLink />
      <PageHeader
        eyebrow={
          <span>
            Product <span className="ident text-ink-3">{p.id}</span>
          </span>
        }
        title={
          <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-3">
            <span>{p.name}</span>
            <span className="mono text-2xl text-ink-2 sm:text-3xl">{p.version}</span>
          </span>
        }
        description={p.description || undefined}
        actions={
          <Link to="/products?view=graph" className="inline-flex h-9 items-center gap-2 rounded-md px-3.5 text-sm text-ink-2 transition-colors hover:bg-s3 hover:text-ink">
            <Network className="h-4 w-4" aria-hidden /> Relationship graph
          </Link>
        }
      />

      <dl className="mb-12 grid min-w-0 grid-cols-2 border-y border-line sm:grid-cols-3 xl:grid-cols-6">
        <Cell label="Reporting state" className="col-span-2 sm:col-span-3 xl:col-span-2">
          <RiskBadge state={p.riskState} reason={p.riskReason} />
          <span className="mt-1.5 block text-xs text-ink-3">{p.riskReason}</span>
        </Cell>
        <Cell label="Lifecycle">
          <LifecycleBadge lifecycle={p.lifecycle} />
        </Cell>
        <Cell label="SBOM">
          <SbomMark status={p.sbomStatus} />
          <span className="mono mt-1 block text-[11px] text-ink-3" title={p.sbomGeneratedAt ? stamp(p.sbomGeneratedAt) : undefined}>
            {p.sbomGeneratedAt ? `Generated ${fullDate(p.sbomGeneratedAt)}` : 'Never generated'}
          </span>
        </Cell>
        <Cell label="Exposure">
          <span className="text-sm text-ink">{EXPOSURE[p.exposure].label}</span>
        </Cell>
        <Cell label="Made available in EU">
          <span className={cx('text-sm', p.madeAvailableInEu ? 'text-ink' : 'text-ink-2')}>{p.madeAvailableInEu ? 'Yes' : 'No'}</span>
          <span className="mt-1 block text-[11px] text-ink-3">{p.madeAvailableInEu ? 'Article 14 can apply' : 'Outside Article 14 scope'}</span>
        </Cell>
        <Cell label="Owner">
          <span className="text-sm text-ink">{userName(p.ownerId)}</span>
        </Cell>
        <Cell label="Environment" className="col-span-2 sm:col-span-2 xl:col-span-2">
          <span className="text-sm text-ink-2">{p.environment}</span>
        </Cell>
        <Cell label="Deployed units">
          <span className="mono text-sm text-ink">{fmtCount(p.deploymentCount)}</span>
          <span className="mt-1 block text-[11px] text-ink-3">
            {p.deployments.length} deployment{p.deployments.length === 1 ? '' : 's'}
          </span>
        </Cell>
        <Cell label="Components">
          <span className="mono text-sm text-ink">{p.components.length}</span>
          <span className="mt-1 block text-[11px] text-ink-3">{p.components.filter((c) => c.relation === 'transitive').length} transitive</span>
        </Cell>
      </dl>

      <div className="space-y-14">
        <section aria-label="Components" className="min-w-0">
          <SectionHead
            title="Components"
            note={`${p.components.length} mapped from the SBOM`}
            action={
              canWrite ? (
                <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setMapping(true)}>
                  Add component mapping
                </Button>
              ) : undefined
            }
          />
          {p.sbomStatus !== 'current' && (
            <p className={cx('mb-4 flex items-start gap-2 text-xs', p.sbomStatus === 'missing' ? 'text-red' : 'text-amber')}>
              <sbom.icon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              {sbom.detail}
            </p>
          )}
          <ComponentsTable product={p} vulns={vulns.data ?? []} />
          {!canWrite && p.components.length === 0 && <p className="mt-3 text-xs text-ink-3">Component mappings are managed by product security engineers and PSIRT leads.</p>}
        </section>

        <div className="grid min-w-0 gap-14 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] xl:gap-12">
          <section aria-label="Vulnerabilities in range" className="min-w-0">
            <SectionHead title="Vulnerabilities in range" note="From SBOM version matching" />
            <p className="mb-4 max-w-2xl text-sm text-ink-3">Each vulnerability here has an affected range that includes a component version this product ships. Whether the product is affected is the determination on the right.</p>
            <AffectedList product={p} model={model} vulns={vulns.data ?? []} />
          </section>
          <section aria-label="Open cases" className="min-w-0">
            <SectionHead title="Open cases" note={`${p.openCases.length}`} />
            {p.openCases.length === 0 ? (
              <EmptyState compact icon={FolderKanban} title="No open case" why={p.affectedCves.length ? 'Vulnerable component versions are in range but no case is open. Until a case records a determination, the product is unassessed, not safe.' : 'No open case includes this product.'} />
            ) : (
              <ul className="divide-y divide-line border-y border-line">
                {p.openCases.map((cid) => {
                  const c = cases.data?.find((x) => x.id === cid)
                  return (
                    <li key={cid}>
                      <Link to={`/cases/${cid}`} className="group block py-3">
                        <div className="flex min-w-0 items-center justify-between gap-3">
                          <span className="ident text-[12px] text-ink-2 group-hover:text-amber">{cid}</span>
                          {c && <CaseStatusBadge status={c.status} size="sm" />}
                        </div>
                        {c && (
                          <div className="mt-1 text-sm text-ink">
                            {c.title}
                            {c.cve && <span className="ident ml-2 text-[11.5px] text-ink-3">{c.cve}</span>}
                          </div>
                        )}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>

        <section aria-label="Deployments" className="min-w-0">
          <SectionHead
            title="Deployments"
            note={`${fmtCount(p.deploymentCount)} units`}
            action={
              canWrite ? (
                <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setDeploying(true)}>
                  Add deployment
                </Button>
              ) : undefined
            }
          />
          {p.deployments.length === 0 ? (
            <EmptyState compact icon={MapPin} title="No deployments recorded" why="Deployments say where units run and how exposed they are. Without them, the scale and reach of a notification cannot be stated." />
          ) : (
            <>
              <div className="hidden min-w-0 overflow-hidden rounded-xl border border-line md:block">
                <table className="w-full table-fixed text-left">
                  <thead className="border-b border-line bg-s1">
                    <tr>
                      <th scope="col" className="micro w-[30%] px-4 py-3 font-normal">Deployment</th>
                      <th scope="col" className="micro w-[16%] px-3 py-3 font-normal">Region</th>
                      <th scope="col" className="micro w-[24%] px-3 py-3 font-normal">Environment</th>
                      <th scope="col" className="micro w-[16%] px-3 py-3 font-normal">Exposure</th>
                      <th scope="col" className="micro w-[14%] px-4 py-3 text-right font-normal">Units</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.deployments.map((d) => (
                      <tr key={d.id} className="table-row">
                        <td className="px-4 py-3 align-top">
                          <div className="text-sm text-ink">{d.name}</div>
                          <div className="ident mt-0.5 text-[11px] text-ink-3">{d.id}</div>
                        </td>
                        <td className="ident px-3 py-3 align-top text-[12.5px] text-ink-2">{d.region}</td>
                        <td className="px-3 py-3 align-top text-xs text-ink-2">{d.environment}</td>
                        <td className="px-3 py-3 align-top text-xs text-ink-2">{EXPOSURE[d.exposure].label}</td>
                        <td className="mono px-4 py-3 text-right align-top text-sm text-ink">{fmtCount(d.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="divide-y divide-line border-y border-line md:hidden">
                {p.deployments.map((d) => (
                  <li key={d.id} className="flex min-w-0 items-start justify-between gap-3 py-3.5">
                    <div className="min-w-0">
                      <div className="text-sm text-ink">{d.name}</div>
                      <div className="mt-1 text-xs text-ink-3">
                        <span className="ident">{d.region}</span> · {d.environment} · {EXPOSURE[d.exposure].label}
                      </div>
                    </div>
                    <span className="mono shrink-0 text-sm text-ink">{fmtCount(d.count)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <div className="border-t border-line pt-10">
          {products.data ? <VersionComparison product={p} products={products.data} /> : products.isError ? <ErrorState error={products.error} /> : <Skeleton className="h-48" />}
        </div>
      </div>

      {canWrite && (
        <>
          <ComponentMappingDrawer product={p} open={mapping} onClose={() => setMapping(false)} />
          <DeploymentDrawer product={p} open={deploying} onClose={() => setDeploying(false)} />
        </>
      )}
    </div>
  )
}

function BackLink() {
  return (
    <Link to="/products" className="mb-5 inline-flex items-center gap-1.5 text-xs text-ink-3 transition-colors hover:text-ink">
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Product portfolio
    </Link>
  )
}

function Cell({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0 border-b border-line py-4 pr-4 xl:border-b-0', className)}>
      <dt className="micro mb-2">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

function SectionHead({ title, note, action }: { title: string; note?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-baseline gap-3">
        <h2 className="text-lg font-medium text-ink">{title}</h2>
        {note && <span className="mono text-xs text-ink-3">{note}</span>}
      </div>
      {action}
    </div>
  )
}

function matchesFor(vulns: VulnerabilityListItem[], componentId: string, version: string) {
  const all = vulns.filter((v) => v.componentId === componentId).map((v) => ({ v, range: inRange(version, v.affectedVersions) }))
  return { hits: all.filter((x) => x.range !== false), outside: all.filter((x) => x.range === false).length }
}

function ComponentsTable({ product, vulns }: { product: ProductListItem; vulns: VulnerabilityListItem[] }) {
  if (product.components.length === 0) {
    return (
      <EmptyState
        compact
        icon={product.sbomStatus === 'missing' ? FileX : Package}
        title={product.sbomStatus === 'missing' ? 'SBOM missing' : 'No components mapped'}
        why={product.sbomStatus === 'missing' ? 'No SBOM is on record for this product, so no vulnerability can be matched to it. An absent SBOM is not evidence that the product contains nothing vulnerable.' : 'No component is mapped into this product. Map components from its SBOM so vulnerabilities can be matched.'}
      />
    )
  }
  const rows = [...product.components].sort((a, b) => {
    const ha = matchesFor(vulns, a.componentId, a.version).hits.length
    const hb = matchesFor(vulns, b.componentId, b.version).hits.length
    return hb - ha || (a.relation === b.relation ? 0 : a.relation === 'direct' ? -1 : 1) || a.component.name.localeCompare(b.component.name)
  })
  const viaName = (viaId: string | null) => (viaId ? (product.components.find((x) => x.id === viaId)?.component.name ?? viaId) : null)
  return (
    <>
      <div className="hidden min-w-0 overflow-hidden rounded-xl border border-line lg:block">
        <table className="w-full table-fixed text-left">
          <thead className="border-b border-line bg-s1">
            <tr>
              <th scope="col" className="micro w-[26%] px-4 py-3 font-normal">Component</th>
              <th scope="col" className="micro w-[14%] px-3 py-3 font-normal">Relation</th>
              <th scope="col" className="micro w-[32%] px-3 py-3 font-normal">Usage</th>
              <th scope="col" className="micro w-[28%] px-4 py-3 font-normal">SBOM matches</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((pc, i) => {
              const m = matchesFor(vulns, pc.componentId, pc.version)
              const via = viaName(pc.viaId)
              return (
                <motion.tr key={pc.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i, 12) * 0.025 }} className="table-row">
                  <td className="px-4 py-3.5 align-top">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="text-sm text-ink">{pc.component.name}</span>
                      <span className="mono text-[12.5px] text-ink-2">{pc.version}</span>
                    </div>
                    <div className="ident mt-0.5 text-[11px] text-ink-3">
                      {pc.component.purl}@{pc.version}
                    </div>
                  </td>
                  <td className="px-3 py-3.5 align-top">
                    <Badge tone={pc.relation === 'direct' ? 'neutral' : 'dim'} size="sm">
                      {pc.relation}
                    </Badge>
                    {pc.relation === 'transitive' && <div className="mt-1.5 text-[11.5px] text-ink-3">{via ? `via ${via}` : 'Parent not recorded'}</div>}
                  </td>
                  <td className="px-3 py-3.5 align-top text-xs leading-relaxed text-ink-2">{pc.usage || <span className="text-ink-3">Not described</span>}</td>
                  <td className="px-4 py-3.5 align-top">
                    <Matches m={m} />
                  </td>
                </motion.tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line border-y border-line lg:hidden">
        {rows.map((pc) => {
          const m = matchesFor(vulns, pc.componentId, pc.version)
          const via = viaName(pc.viaId)
          return (
            <li key={pc.id} className="min-w-0 py-4">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-sm text-ink">{pc.component.name}</span>
                <span className="mono text-[12.5px] text-ink-2">{pc.version}</span>
                <Badge tone={pc.relation === 'direct' ? 'neutral' : 'dim'} size="sm">
                  {pc.relation}
                </Badge>
                {via && <span className="text-[11.5px] text-ink-3">via {via}</span>}
              </div>
              <div className="ident mt-1 text-[11px] text-ink-3">
                {pc.component.purl}@{pc.version}
              </div>
              {pc.usage && <p className="mt-2 text-xs text-ink-2">{pc.usage}</p>}
              <div className="mt-2.5">
                <Matches m={m} />
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}

function Matches({ m }: { m: ReturnType<typeof matchesFor> }) {
  if (m.hits.length === 0) {
    return <span className="text-xs text-ink-3">{m.outside ? `${m.outside} known, outside range` : 'No known vulnerability'}</span>
  }
  return (
    <ul className="space-y-1.5">
      {m.hits.map(({ v, range }) => (
        <li key={v.id} className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <Link to={`/vulnerabilities/${v.id}`} className="ident text-[12px] text-ink hover:text-amber">
            {v.cve ?? v.id}
          </Link>
          <RangeMark value={range} compact />
        </li>
      ))}
      {m.outside > 0 && <li className="text-[11px] text-ink-3">{m.outside} more outside range</li>}
    </ul>
  )
}

function AffectedList({ product, model, vulns }: { product: ProductListItem; model: GraphModel | null; vulns: VulnerabilityListItem[] }) {
  if (product.affectedCves.length === 0) {
    return (
      <EmptyState
        compact
        icon={product.sbomStatus === 'missing' ? FileX : ShieldCheck}
        title={product.sbomStatus === 'missing' ? 'Cannot be matched' : 'No vulnerability in range'}
        why={product.sbomStatus === 'missing' ? 'Without an SBOM, no vulnerability range can be compared with this product. Treat it as unknown until an SBOM is generated.' : 'No recorded vulnerability has an affected range that includes a component version in this SBOM.'}
      />
    )
  }
  const rows = [...product.affectedCves].sort((a, b) => (a.exploitation === 'CONFIRMED' ? 0 : 1) - (b.exploitation === 'CONFIRMED' ? 0 : 1) || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  return (
    <ul className="divide-y divide-line border-y border-line">
      {rows.map((a) => {
        const dets = model ? (model.detsFor.get(`${product.id}|${a.vulnerabilityId}`) ?? []).map((d) => ({ id: d, ...model.det.get(d)! })) : []
        const v = vulns.find((x) => x.id === a.vulnerabilityId)
        const range = v ? inRange(a.version, v.affectedVersions) : true
        return (
          <li key={a.vulnerabilityId} className="grid min-w-0 gap-3 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
                <Link to={`/vulnerabilities/${a.vulnerabilityId}`} className="ident text-[12.5px] text-ink hover:text-amber">
                  {a.cve ?? a.vulnerabilityId}
                </Link>
                <SeverityMark severity={a.severity} showLabel={false} />
                <ExploitationBadge status={a.exploitation} size="sm" />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
                <span className="ident text-[12px] text-ink-2">
                  {a.componentName} {a.version}
                </span>
                {range === null ? <RangeMark value={null} /> : null}
                {v && <span className="line-clamp-1">{v.title}</span>}
              </div>
            </div>
            <div className="flex min-w-0 flex-col items-start gap-1.5 sm:items-end">
              {dets.length ? (
                dets.map((d) => (
                  <Link key={d.id} to={`/cases/${d.caseId}`} className="group flex items-center gap-2">
                    <AffectednessBadge result={d.result} size="sm" />
                    <span className="ident text-[11px] text-ink-3 group-hover:text-ink">{d.caseId}</span>
                    <ArrowRight className="h-3 w-3 text-ink-4" aria-hidden />
                  </Link>
                ))
              ) : (
                <NoDeterminationMark />
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

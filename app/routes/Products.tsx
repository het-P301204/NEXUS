import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { motion } from 'motion/react'
import { AlertTriangle, Boxes, Package, Plus, X } from 'lucide-react'
import type { ComponentListItem, ProductListItem } from '../../types/api.ts'
import { useComponents, useGraph, useProducts, useVulnerabilities } from '../../lib/client/queries.ts'
import { useSession } from '../../lib/client/session.tsx'
import { fullDate } from '../../lib/client/format.ts'
import { Button, PageHeader, Skeleton, cx } from '../../components/ui/primitives.tsx'
import { Tabs } from '../../components/ui/tabs.tsx'
import { EmptyState, ErrorState } from '../../components/ui/feedback.tsx'
import { RelationshipGraph } from '../../components/portfolio/RelationshipGraph.tsx'
import { ExposureMap } from '../../components/portfolio/ExposureMap.tsx'
import { AddProductModal } from '../../components/portfolio/ProductForms.tsx'
import { Count, EXPOSURE, LifecycleBadge, RiskBadge, SbomMark, SearchBox, fmtCount, useUserName } from '../../components/portfolio/shared.tsx'

/**
 * The product portfolio: what Tessaline ships, what each product contains,
 * where it runs, and what state its reporting is in. Four views of the same
 * data, from the table to the relationship graph.
 */

type View = 'portfolio' | 'graph' | 'exposure' | 'components'
const VIEWS: View[] = ['portfolio', 'graph', 'exposure', 'components']

export function Products() {
  const [params, setParams] = useSearchParams()
  const { can } = useSession()
  const products = useProducts()
  const raw = params.get('view') as View | null
  const view: View = raw && VIEWS.includes(raw) ? raw : 'portfolio'
  const adding = params.get('new') === '1' && can('product.write')

  const setView = (v: View) => {
    const next = new URLSearchParams(params)
    if (v === 'portfolio') next.delete('view')
    else next.set('view', v)
    next.delete('q')
    setParams(next, { replace: true })
  }
  const closeAdd = useCallback(() => {
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        next.delete('new')
        return next
      },
      { replace: true },
    )
  }, [setParams])
  const openAdd = () => {
    const next = new URLSearchParams(params)
    next.set('new', '1')
    setParams(next)
  }

  const items = products.data ?? []
  const componentCount = new Set(items.flatMap((p) => p.components.map((c) => c.componentId))).size

  return (
    <div className="min-w-0">
      <PageHeader
        eyebrow="Operate"
        title="Product portfolio"
        description="What each product contains, where it runs, and the state of its reporting. Containing a vulnerable component is where an assessment starts, not where it ends."
        actions={
          can('product.write') ? (
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openAdd}>
              Add product
            </Button>
          ) : undefined
        }
      />
      <Tabs<View>
        label="Portfolio views"
        value={view}
        onChange={setView}
        className="mb-8"
        tabs={[
          { id: 'portfolio', label: 'Portfolio', count: products.data ? items.length : undefined },
          { id: 'graph', label: 'Relationship graph' },
          { id: 'exposure', label: 'Exposure map', alert: items.some((p) => p.riskState === 'clock_running') },
          { id: 'components', label: 'Components', count: products.data ? componentCount : undefined },
        ]}
      />

      {products.isError ? (
        <ErrorState error={products.error} onRetry={() => void products.refetch()} />
      ) : products.isPending ? (
        <ListSkeleton />
      ) : view === 'portfolio' ? (
        <Portfolio items={items} canWrite={can('product.write')} onAdd={openAdd} />
      ) : view === 'graph' ? (
        <GraphView products={items} />
      ) : view === 'exposure' ? (
        <ExposureView products={items} />
      ) : (
        <ComponentsView />
      )}

      <AddProductModal open={adding} onClose={closeAdd} />
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-9 w-full max-w-md" />
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  )
}

function useQueryParam(key: string): [string, (v: string) => void] {
  const [params, setParams] = useSearchParams()
  const value = params.get(key) ?? ''
  const set = (v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(key, v)
    else next.delete(key)
    setParams(next, { replace: true })
  }
  return [value, set]
}

// ---------------------------------------------------------------------------
// Portfolio table
// ---------------------------------------------------------------------------

const RISK_ORDER: Record<ProductListItem['riskState'], number> = { clock_running: 0, affected: 1, investigating: 2, clear: 3 }

function Portfolio({ items, canWrite, onAdd }: { items: ProductListItem[]; canWrite: boolean; onAdd: () => void }) {
  const [q, setQ] = useQueryParam('q')
  const userName = useUserName()
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return items
      .filter((p) => !needle || [p.name, p.id, p.version, ...p.components.map((c) => c.component.name)].some((s) => s.toLowerCase().includes(needle)))
      .sort((a, b) => RISK_ORDER[a.riskState] - RISK_ORDER[b.riskState] || a.name.localeCompare(b.name) || b.version.localeCompare(a.version))
  }, [items, q])
  const matchedComponent = (p: ProductListItem) => {
    const needle = q.trim().toLowerCase()
    if (!needle || p.name.toLowerCase().includes(needle)) return null
    return p.components.find((c) => c.component.name.toLowerCase().includes(needle)) ?? null
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Boxes}
        title="No products in the portfolio"
        why="Reportability is decided per product. Without products and their SBOMs, NEXUS cannot tell which products contain a vulnerable component."
        action={
          canWrite ? (
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={onAdd}>
              Add product
            </Button>
          ) : undefined
        }
      />
    )
  }

  return (
    <section aria-label="Products" className="min-w-0">
      <div className="mb-5 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
        <SearchBox value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product or component" aria-label="Search products or components" className="sm:w-96" />
        <div className="flex items-center gap-3 sm:ml-auto">
          <Count shown={shown.length} total={items.length} noun="product" />
          {q && (
            <button type="button" onClick={() => setQ('')} className="inline-flex items-center gap-1 text-xs text-ink-2 hover:text-ink">
              <X className="h-3 w-3" aria-hidden /> Clear
            </button>
          )}
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState compact icon={Package} title="No product matches" why={`No product name, id or SBOM component contains "${q}".`} action={<Button onClick={() => setQ('')}>Clear search</Button>} />
      ) : (
        <>
          <div className="hidden min-w-0 overflow-hidden rounded-xl border border-line xl:block">
            <table className="w-full table-fixed text-left">
              <thead className="border-b border-line bg-s1">
                <tr>
                  <th scope="col" className="micro w-[21%] px-4 py-3 font-normal">Product</th>
                  <th scope="col" className="micro w-[13%] px-3 py-3 font-normal">Lifecycle</th>
                  <th scope="col" className="micro w-[16%] px-3 py-3 font-normal">Environment</th>
                  <th scope="col" className="micro w-[11%] px-3 py-3 font-normal">SBOM</th>
                  <th scope="col" className="micro w-[9%] px-3 py-3 text-right font-normal">Deployed</th>
                  <th scope="col" className="micro w-[7%] px-3 py-3 text-right font-normal">CVEs</th>
                  <th scope="col" className="micro w-[23%] px-4 py-3 font-normal">Reporting state</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p, i) => {
                  const hit = matchedComponent(p)
                  return (
                    <motion.tr key={p.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i, 12) * 0.03 }} className="table-row group">
                      <td className="px-4 py-3.5 align-top">
                        <Link to={`/products/${p.id}`} className="block min-w-0">
                          <span className="text-sm text-ink group-hover:text-amber">{p.name}</span> <span className="mono text-[12px] text-ink-2">{p.version}</span>
                          <span className="ident mt-0.5 block text-[11px] text-ink-3">{p.id}</span>
                          {hit && (
                            <span className="mt-1 block text-[11px] text-ink-3">
                              contains <span className="ident text-ink-2">{hit.component.name} {hit.version}</span>
                            </span>
                          )}
                        </Link>
                      </td>
                      <td className="px-3 py-3.5 align-top">
                        <LifecycleBadge lifecycle={p.lifecycle} />
                        <div className="mt-1.5 truncate text-[11.5px] text-ink-3" title={`Owner: ${userName(p.ownerId)}`}>
                          {userName(p.ownerId)}
                        </div>
                      </td>
                      <td className="px-3 py-3.5 align-top">
                        <div className="line-clamp-2 text-xs text-ink-2" title={p.environment}>
                          {p.environment}
                        </div>
                        <div className="mt-1 text-[11.5px] text-ink-3">{EXPOSURE[p.exposure].label}</div>
                      </td>
                      <td className="px-3 py-3.5 align-top">
                        <SbomMark status={p.sbomStatus} />
                        {p.sbomGeneratedAt && <div className="mono mt-1 text-[11px] text-ink-3">{fullDate(p.sbomGeneratedAt)}</div>}
                      </td>
                      <td className="px-3 py-3.5 text-right align-top">
                        <span className="mono text-sm text-ink">{fmtCount(p.deploymentCount)}</span>
                        <div className="mt-1 text-[11px] text-ink-3">
                          {p.deployments.length} site{p.deployments.length === 1 ? '' : 's'}
                        </div>
                      </td>
                      <td className="px-3 py-3.5 text-right align-top">
                        <CveCount p={p} />
                      </td>
                      <td className="px-4 py-3.5 align-top">
                        <RiskBadge state={p.riskState} reason={p.riskReason} />
                        <Reason p={p} />
                      </td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <ul className="divide-y divide-line border-y border-line xl:hidden">
            {shown.map((p) => {
              const hit = matchedComponent(p)
              return (
                <li key={p.id}>
                  <Link to={`/products/${p.id}`} className="block min-w-0 py-4">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-sm text-ink">{p.name}</span> <span className="mono text-[12px] text-ink-2">{p.version}</span>
                        <span className="mt-0.5 block text-[11px] text-ink-3">
                          <span className="ident">{p.id}</span> · {userName(p.ownerId)}
                        </span>
                      </div>
                      <LifecycleBadge lifecycle={p.lifecycle} />
                    </div>
                    {hit && (
                      <div className="mt-1 text-[11px] text-ink-3">
                        contains <span className="ident text-ink-2">{hit.component.name} {hit.version}</span>
                      </div>
                    )}
                    <div className="mt-3">
                      <RiskBadge state={p.riskState} reason={p.riskReason} />
                      <Reason p={p} />
                    </div>
                    <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-3">
                      <SbomMark status={p.sbomStatus} />
                      <span>{EXPOSURE[p.exposure].label}</span>
                      <span>
                        <span className="mono text-ink-2">{fmtCount(p.deploymentCount)}</span> deployed
                      </span>
                      {p.sbomStatus === 'missing' && p.components.length === 0 ? (
                        <span>CVE match unknown (no SBOM)</span>
                      ) : (
                        <span>
                          <span className="mono text-ink-2">{p.affectedCves.length}</span> CVE{p.affectedCves.length === 1 ? '' : 's'} in range
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
          <p className="mt-4 text-xs text-ink-3">CVEs counts vulnerabilities whose affected range includes a component version in the product's SBOM, or cannot be compared with it. It is not a count of affected determinations.</p>
        </>
      )}
    </section>
  )
}

function Reason({ p }: { p: ProductListItem }) {
  const unresolved = p.riskState === 'clear' && p.affectedCves.length > 0
  const caseId = /CASE-\d{4}-\d{3,}/.exec(p.riskReason)?.[0]
  if (caseId && p.riskState !== 'clear') {
    const others = p.openCases.filter((c) => c !== caseId).length
    return (
      <span className="mt-1 block text-[11.5px] text-ink-3" title={p.riskReason}>
        <span className="mono text-ink-2">{caseId}</span>
        {others > 0 && ` · ${others} more open case${others === 1 ? '' : 's'}`}
      </span>
    )
  }
  return (
    <span className={cx('mt-1 flex items-start gap-1.5 text-[11.5px]', unresolved ? 'text-amber' : 'text-ink-3')}>
      {unresolved && <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />}
      {p.riskReason}
    </span>
  )
}

/** A product without an SBOM has an unknown CVE count, not zero. */
function CveCount({ p }: { p: ProductListItem }) {
  if (p.sbomStatus === 'missing' && p.components.length === 0) {
    return (
      <span className="mono text-sm text-ink-3" title="SBOM missing: no vulnerability can be matched. Unknown, not zero.">
        n/a
      </span>
    )
  }
  return (
    <span className={cx('mono text-sm', p.affectedCves.length ? 'text-ink' : 'text-ink-4')} title="Vulnerabilities whose affected range includes a component version in this product's SBOM">
      {p.affectedCves.length}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Graph and exposure views
// ---------------------------------------------------------------------------

function GraphView({ products }: { products: ProductListItem[] }) {
  const graph = useGraph()
  const components = useComponents()
  if (graph.isError) return <ErrorState error={graph.error} onRetry={() => void graph.refetch()} />
  if (components.isError) return <ErrorState error={components.error} onRetry={() => void components.refetch()} />
  if (graph.isPending || components.isPending) return <Skeleton className="h-[640px] w-full" />
  if (graph.data.nodes.length === 0) {
    return <EmptyState icon={Boxes} title="Nothing to draw" why="The graph links vulnerabilities to components, product versions, deployments and determinations. Add products and vulnerabilities to see how they relate." />
  }
  return <RelationshipGraph graph={graph.data} products={products} components={components.data} />
}

function ExposureView({ products }: { products: ProductListItem[] }) {
  const graph = useGraph()
  const vulns = useVulnerabilities()
  if (graph.isError) return <ErrorState error={graph.error} onRetry={() => void graph.refetch()} />
  if (vulns.isError) return <ErrorState error={vulns.error} onRetry={() => void vulns.refetch()} />
  if (graph.isPending || vulns.isPending) return <ListSkeleton />
  if (products.length === 0) {
    return <EmptyState icon={Boxes} title="No products in the portfolio" why="The exposure map is drawn from product SBOMs. Add a product and map its components to see which vulnerabilities reach it." />
  }
  return <ExposureMap products={products} vulns={vulns.data} graph={graph.data} />
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function ComponentsView() {
  const components = useComponents()
  const [q, setQ] = useQueryParam('q')
  const all = useMemo(() => components.data ?? [], [components.data])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return all
      .filter((c) => !needle || [c.name, c.purl, c.supplier, c.ecosystem, c.id].some((s) => s.toLowerCase().includes(needle)))
      .sort((a, b) => b.vulnerabilities.length - a.vulnerabilities.length || b.usedBy.length - a.usedBy.length || a.name.localeCompare(b.name))
  }, [all, q])

  if (components.isError) return <ErrorState error={components.error} onRetry={() => void components.refetch()} />
  if (components.isPending) return <ListSkeleton />
  if (all.length === 0) {
    return <EmptyState icon={Package} title="No components recorded" why="Components come from product SBOMs. Map a component into a product from its product page, or import an SBOM." />
  }

  return (
    <section aria-label="Components" className="min-w-0">
      <div className="mb-5 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
        <SearchBox value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, package URL or supplier" aria-label="Search components" className="sm:w-96" />
        <div className="flex items-center gap-3 sm:ml-auto">
          <Count shown={shown.length} total={all.length} noun="component" />
          {q && (
            <button type="button" onClick={() => setQ('')} className="inline-flex items-center gap-1 text-xs text-ink-2 hover:text-ink">
              <X className="h-3 w-3" aria-hidden /> Clear
            </button>
          )}
        </div>
      </div>
      {shown.length === 0 ? (
        <EmptyState compact icon={Package} title="No component matches" why={`No component name, package URL or supplier contains "${q}".`} action={<Button onClick={() => setQ('')}>Clear search</Button>} />
      ) : (
        <>
          <div className="hidden min-w-0 overflow-hidden rounded-xl border border-line lg:block">
            <table className="w-full table-fixed text-left">
              <thead className="border-b border-line bg-s1">
                <tr>
                  <th scope="col" className="micro w-[24%] px-4 py-3 font-normal">Component</th>
                  <th scope="col" className="micro w-[16%] px-3 py-3 font-normal">Supplier</th>
                  <th scope="col" className="micro w-[32%] px-3 py-3 font-normal">Used by</th>
                  <th scope="col" className="micro w-[28%] px-4 py-3 font-normal">Known vulnerabilities</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c, i) => (
                  <motion.tr key={c.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i, 12) * 0.025 }} className="table-row">
                    <td className="px-4 py-3.5 align-top">
                      <div className="text-sm text-ink">{c.name}</div>
                      <div className="ident mt-0.5 text-[11.5px] text-ink-3">{c.purl}</div>
                    </td>
                    <td className="px-3 py-3.5 align-top">
                      <div className="text-xs text-ink-2">{c.supplier}</div>
                      <div className="mt-0.5 text-[11.5px] text-ink-3">{c.ecosystem}</div>
                    </td>
                    <td className="px-3 py-3.5 align-top">
                      <UsedBy c={c} />
                    </td>
                    <td className="px-4 py-3.5 align-top">
                      <KnownVulns c={c} />
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-line border-y border-line lg:hidden">
            {shown.map((c) => (
              <li key={c.id} className="min-w-0 py-4">
                <div className="text-sm text-ink">{c.name}</div>
                <div className="ident mt-0.5 text-[11.5px] text-ink-3">{c.purl}</div>
                <div className="mt-1 text-xs text-ink-3">
                  {c.supplier} · {c.ecosystem}
                </div>
                <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <div className="micro mb-1.5">Used by</div>
                    <UsedBy c={c} />
                  </div>
                  <div className="min-w-0">
                    <div className="micro mb-1.5">Known vulnerabilities</div>
                    <KnownVulns c={c} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function UsedBy({ c }: { c: ComponentListItem }) {
  const [open, setOpen] = useState(false)
  if (c.usedBy.length === 0) return <span className="text-xs text-ink-3">Not in any product SBOM</span>
  const list = open ? c.usedBy : c.usedBy.slice(0, 4)
  return (
    <ul className="space-y-1">
      {list.map((u) => (
        <li key={`${u.productId}-${u.version}`} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <Link to={`/products/${u.productId}`} className="text-xs text-ink hover:text-amber">
            {u.productName}
          </Link>
          <span className="ident text-[11.5px] text-ink-2">{u.version}</span>
          <span className="text-[11px] text-ink-3">{u.relation}</span>
        </li>
      ))}
      {c.usedBy.length > 4 && (
        <li>
          <button type="button" onClick={() => setOpen((o) => !o)} className="text-[11px] text-ink-3 hover:text-ink">
            {open ? 'Show fewer' : `${c.usedBy.length - 4} more`}
          </button>
        </li>
      )}
    </ul>
  )
}

function KnownVulns({ c }: { c: ComponentListItem }) {
  if (c.vulnerabilities.length === 0) return <span className="text-xs text-ink-3">None recorded</span>
  return (
    <ul className="space-y-1.5">
      {c.vulnerabilities.map((v) => (
        <li key={v.id} className="min-w-0">
          <Link to={`/vulnerabilities/${v.id}`} className="ident text-[12px] text-ink hover:text-amber">
            {v.cve ?? v.id}
          </Link>
          <span className="ident ml-2 text-[11px] text-ink-3">{v.affectedVersions}</span>
        </li>
      ))}
    </ul>
  )
}

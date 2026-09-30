import { z } from 'zod'
import type { Hono } from 'hono'
import type { Component, Deployment, Product, ProductComponent, ThreatIntel, Vulnerability } from '../../types/domain.ts'
import type { ComponentListItem, GraphEdge, GraphNode, GraphResponse, ProductListItem, VulnerabilityDetail } from '../../types/api.ts'
import { inRange } from '../../lib/engine/versions.ts'
import { isRunning } from '../../lib/engine/deadlines.ts'
import type { Deps, Env } from '../context.ts'
import { nowIso, requirePermission, requireUser } from '../context.ts'
import { nextId, tx } from '../db.ts'
import { conflict, invalid, notFound } from '../errors.ts'
import { appendAudit } from '../ledger.ts'
import {
  getProduct,
  getVulnerability,
  insertComponent,
  insertDeployment,
  insertProduct,
  insertProductComponent,
  insertThreatIntel,
  insertVulnerability,
  listComponents,
  listDeployments,
  listProductComponents,
  listProducts,
  listThreatIntel,
  listUsers,
  listVulnerabilities,
} from '../repo.ts'
import { allAnalyzed } from '../services.ts'
import { confidence, cve, cwe, exploitation, id, instant, line, parseBody, requiredLine, severity, text } from '../validation.ts'

export const vulnerabilitySchema = z.object({
  cve: cve.nullable().default(null),
  title: requiredLine(200),
  cwe: cwe.nullable().default(null),
  cvssScore: z.number().min(0).max(10).multipleOf(0.1).nullable().default(null),
  cvssVector: line(200)
    .pipe(z.string().regex(/^(CVSS:[34]\.[01]\/[A-Z:/]+)?$/, 'CVSS vectors look like CVSS:3.1/AV:N/AC:L/...'))
    .nullable()
    .default(null),
  severity,
  description: text(6000).pipe(z.string().min(10, 'Describe the vulnerability')),
  componentId: id.nullable().default(null),
  affectedVersions: requiredLine(200),
  fixedVersion: line(60).nullable().default(null),
  exploitability: line(200).default(''),
  exploitation,
  source: requiredLine(200),
  discoveredAt: instant,
  vendorAdvisory: line(400).nullable().default(null),
  threatIntelReference: line(400).nullable().default(null),
})

export const productSchema = z.object({
  id: z.string().regex(/^PRD-[A-Z0-9]{2,12}$/, 'Product ids look like PRD-SEG'),
  name: requiredLine(120),
  version: requiredLine(40),
  lifecycle: z.enum(['active', 'maintenance', 'end_of_support']),
  ownerId: id,
  description: text(2000).default(''),
  sbomStatus: z.enum(['current', 'stale', 'missing']),
  sbomGeneratedAt: instant.nullable().default(null),
  environment: requiredLine(120),
  exposure: z.enum(['internet_facing', 'customer_network', 'internal', 'isolated']),
  madeAvailableInEu: z.boolean(),
})

export const componentSchema = z.object({
  name: requiredLine(120),
  // Package URLs are percent-encoded ASCII by specification, so anything outside
  // printable ASCII (including invisible and bidirectional controls) is refused.
  purl: z.string().max(300).regex(/^pkg:[a-z0-9.+-]+\/[!-~]+$/, 'Package URLs look like pkg:generic/openssl@3.0.9'),
  ecosystem: requiredLine(40),
  supplier: requiredLine(120),
})

function severityFromCvss(score: number): Vulnerability['severity'] {
  return score >= 9 ? 'CRITICAL' : score >= 7 ? 'HIGH' : score >= 4 ? 'MEDIUM' : 'LOW'
}

export function vulnerabilityWarnings(v: z.output<typeof vulnerabilitySchema>): string[] {
  const out: string[] = []
  if (v.cvssScore !== null && severityFromCvss(v.cvssScore) !== v.severity) {
    out.push(`Severity ${v.severity} does not match CVSS ${v.cvssScore.toFixed(1)} (${severityFromCvss(v.cvssScore)}). Kept as entered.`)
  }
  if (inRange('0.0.1', v.affectedVersions) === null) out.push(`Affected range "${v.affectedVersions}" could not be parsed. SBOM suggestions will read UNKNOWN.`)
  if (!v.cve) out.push('No CVE identifier. The vulnerability is tracked by its internal id.')
  return out
}

export function portfolioRoutes(app: Hono<Env>, deps: Deps): void {
  const { db } = deps

  function productItems(): ProductListItem[] {
    const products = listProducts(db)
    const pcs = listProductComponents(db)
    const components = new Map(listComponents(db).map((x) => [x.id, x]))
    const deployments = listDeployments(db)
    const vulns = listVulnerabilities(db)
    const analyzed = allAnalyzed(deps)
    return products.map((p) => {
      const mine = pcs.filter((pc) => pc.productId === p.id)
      const affectedCves: ProductListItem['affectedCves'] = []
      for (const v of vulns) {
        const pc = mine.find((x) => x.componentId === v.componentId)
        if (!pc) continue
        if (inRange(pc.version, v.affectedVersions) === false) continue
        affectedCves.push({ vulnerabilityId: v.id, cve: v.cve, severity: v.severity, exploitation: v.exploitation, componentName: components.get(pc.componentId)?.name ?? pc.componentId, version: pc.version })
      }
      const cases = analyzed.filter(({ bundle }) => bundle.case.lifecycle === 'open' && bundle.case.productIds.includes(p.id))
      const clock = cases.find(({ analysis }) => analysis.deadlines.some(isRunning))
      const affected = cases.find(({ analysis }) => analysis.determinations[p.id]?.result === 'AFFECTED')
      const investigating = cases.find(({ analysis }) => {
        const d = analysis.determinations[p.id]
        return !d || d.result === 'UNDER_INVESTIGATION'
      })
      const deps2 = deployments.filter((d) => d.productId === p.id)
      return {
        ...p,
        components: mine.map((pc) => ({ ...pc, component: components.get(pc.componentId)! })),
        deployments: deps2,
        deploymentCount: deps2.reduce((a, d) => a + d.count, 0),
        affectedCves,
        riskState: clock ? 'clock_running' : affected ? 'affected' : investigating ? 'investigating' : 'clear',
        riskReason: clock
          ? `Reporting clock running on ${clock.bundle.case.id}`
          : affected
            ? `Affected in ${affected.bundle.case.id}`
            : investigating
              ? `Under investigation in ${investigating.bundle.case.id}`
              : affectedCves.length
                ? `${affectedCves.length} vulnerable component version(s), no open case`
                : 'No open cases',
        openCases: cases.map(({ bundle }) => bundle.case.id),
      }
    })
  }

  app.get('/api/products', (c) => {
    requireUser(c)
    return c.json({ items: productItems() })
  })

  app.get('/api/products/:id', (c) => {
    requireUser(c)
    const item = productItems().find((p) => p.id === c.req.param('id'))
    if (!item) throw notFound('Product', c.req.param('id'))
    return c.json({ item })
  })

  app.post('/api/products', async (c) => {
    const user = requirePermission(c, 'product.write')
    const input = await parseBody(c, productSchema)
    if (getProduct(db, input.id)) throw conflict('PRODUCT_EXISTS', 'Product id in use', `${input.id} already exists.`)
    if (!listUsers(db).some((u) => u.id === input.ownerId)) throw notFound('User', input.ownerId)
    const product: Product = input
    tx(db, () => {
      insertProduct(db, product)
      appendAudit(db, { actorId: user.id, actorRole: user.role, eventType: 'PRODUCT_ADDED', objectType: 'product', objectId: product.id, caseId: null, source: 'ui', summary: `${product.name} ${product.version} added`, payload: { productId: product.id }, at: nowIso(deps) })
    })
    return c.json({ id: product.id }, 201)
  })

  app.post('/api/products/:id/components', async (c) => {
    const user = requirePermission(c, 'product.write')
    const product = getProduct(db, c.req.param('id'))
    if (!product) throw notFound('Product', c.req.param('id'))
    const input = await parseBody(
      c,
      z.object({
        componentId: id.nullable().default(null),
        component: componentSchema.nullable().default(null),
        version: requiredLine(60),
        relation: z.enum(['direct', 'transitive']),
        viaId: id.nullable().default(null),
        usage: text(1000).default(''),
      }),
    )
    const components = listComponents(db)
    let component: Component | undefined
    if (input.componentId) component = components.find((x) => x.id === input.componentId)
    if (!component && input.component) component = components.find((x) => x.purl === input.component!.purl)
    if (!component && !input.component) throw invalid('Component required', 'Choose an existing component or describe a new one.')
    const existingPcs = listProductComponents(db)
    if (input.viaId && !existingPcs.some((pc) => pc.id === input.viaId && pc.productId === product.id)) {
      throw invalid('Unknown parent', `${input.viaId} is not a component of ${product.name}.`)
    }
    tx(db, () => {
      if (!component) {
        component = { id: nextId(db, 'CMP'), ...input.component! }
        insertComponent(db, component)
      }
      if (existingPcs.some((pc) => pc.productId === product.id && pc.componentId === component!.id)) {
        throw conflict('MAPPING_EXISTS', 'Component already mapped', `${component.name} is already mapped into ${product.name}.`)
      }
      const pc: ProductComponent = {
        id: nextId(db, 'PC'),
        productId: product.id,
        componentId: component.id,
        version: input.version,
        relation: input.relation,
        viaId: input.viaId,
        usage: input.usage,
      }
      insertProductComponent(db, pc)
      appendAudit(db, {
        actorId: user.id,
        actorRole: user.role,
        eventType: 'COMPONENT_MAPPED',
        objectType: 'product_component',
        objectId: pc.id,
        caseId: null,
        source: 'ui',
        summary: `${component.name} ${pc.version} mapped into ${product.name}`,
        payload: { productId: product.id, componentId: component.id, version: pc.version, relation: pc.relation },
        at: nowIso(deps),
      })
    })
    return c.json({ ok: true }, 201)
  })

  app.post('/api/products/:id/deployments', async (c) => {
    const user = requirePermission(c, 'product.write')
    const product = getProduct(db, c.req.param('id'))
    if (!product) throw notFound('Product', c.req.param('id'))
    const input = await parseBody(
      c,
      z.object({
        name: requiredLine(120),
        region: requiredLine(60),
        count: z.number().int().min(0).max(10_000_000),
        environment: requiredLine(120),
        exposure: z.enum(['internet_facing', 'customer_network', 'internal', 'isolated']),
      }),
    )
    const d: Deployment = { id: nextId(db, 'DEP'), productId: product.id, ...input }
    tx(db, () => {
      insertDeployment(db, d)
      appendAudit(db, { actorId: user.id, actorRole: user.role, eventType: 'DEPLOYMENT_ADDED', objectType: 'deployment', objectId: d.id, caseId: null, source: 'ui', summary: `${d.name} (${d.count}) added to ${product.name}`, payload: { deploymentId: d.id, productId: product.id }, at: nowIso(deps) })
    })
    return c.json({ id: d.id }, 201)
  })

  app.get('/api/components', (c) => {
    requireUser(c)
    const products = new Map(listProducts(db).map((p) => [p.id, p]))
    const pcs = listProductComponents(db)
    const vulns = listVulnerabilities(db)
    const items: ComponentListItem[] = listComponents(db).map((comp) => ({
      ...comp,
      usedBy: pcs
        .filter((pc) => pc.componentId === comp.id)
        .map((pc) => ({ productId: pc.productId, productName: products.get(pc.productId)?.name ?? pc.productId, version: pc.version, relation: pc.relation })),
      vulnerabilities: vulns.filter((v) => v.componentId === comp.id).map((v) => ({ id: v.id, cve: v.cve, affectedVersions: v.affectedVersions })),
    }))
    return c.json({ items })
  })

  // Vulnerabilities ---------------------------------------------------------------
  app.get('/api/vulnerabilities', (c) => {
    requireUser(c)
    const analyzed = allAnalyzed(deps)
    const components = new Map(listComponents(db).map((x) => [x.id, x.name]))
    const items = listVulnerabilities(db).map((v) => ({
      ...v,
      componentName: v.componentId ? (components.get(v.componentId) ?? null) : null,
      cases: analyzed.filter(({ bundle }) => bundle.vulnerability.id === v.id).map(({ bundle, analysis }) => ({ id: bundle.case.id, title: bundle.case.title, status: analysis.status })),
      intelCount: listThreatIntel(db, v.id).length,
    }))
    return c.json({ items })
  })

  app.get('/api/vulnerabilities/:id', (c) => {
    requireUser(c)
    const v = getVulnerability(db, c.req.param('id'))
    if (!v) throw notFound('Vulnerability', c.req.param('id'))
    const products = listProducts(db)
    const pcs = listProductComponents(db)
    const detail: VulnerabilityDetail = {
      ...v,
      intel: listThreatIntel(db, v.id),
      cases: allAnalyzed(deps)
        .filter(({ bundle }) => bundle.vulnerability.id === v.id)
        .map(({ bundle, analysis }) => ({ id: bundle.case.id, title: bundle.case.title, status: analysis.status })),
      componentName: listComponents(db).find((x) => x.id === v.componentId)?.name ?? null,
      exposure: pcs
        .filter((pc) => pc.componentId === v.componentId)
        .map((pc) => ({ productId: pc.productId, productName: products.find((p) => p.id === pc.productId)?.name ?? pc.productId, version: pc.version, inRange: inRange(pc.version, v.affectedVersions) })),
    }
    return c.json({ item: detail })
  })

  app.post('/api/vulnerabilities', async (c) => {
    const user = requirePermission(c, 'vulnerability.write')
    const input = await parseBody(c, vulnerabilitySchema)
    if (input.cve && listVulnerabilities(db).some((v) => v.cve === input.cve)) {
      throw conflict('VULNERABILITY_EXISTS', 'Already recorded', `${input.cve} is already in the vulnerability register.`)
    }
    if (input.componentId && !listComponents(db).some((x) => x.id === input.componentId)) throw notFound('Component', input.componentId)
    if (Date.parse(input.discoveredAt) > deps.now().getTime() + 120_000) throw invalid('Timestamp in the future', 'The discovery timestamp cannot be later than now.')
    const now = nowIso(deps)
    const vuln: Vulnerability = { id: '', ...input, createdAt: now, createdBy: user.id }
    const warnings = vulnerabilityWarnings(input)
    tx(db, () => {
      vuln.id = nextId(db, 'VUL')
      insertVulnerability(db, vuln)
      appendAudit(db, { actorId: user.id, actorRole: user.role, eventType: 'VULNERABILITY_ADDED', objectType: 'vulnerability', objectId: vuln.id, caseId: null, source: 'ui', summary: `${vuln.cve ?? vuln.id} added: ${vuln.title}`, payload: { vulnerabilityId: vuln.id, cve: vuln.cve, severity: vuln.severity, exploitation: vuln.exploitation }, at: now })
    })
    return c.json({ id: vuln.id, warnings }, 201)
  })

  app.post('/api/vulnerabilities/:id/intel', async (c) => {
    const user = requirePermission(c, 'vulnerability.write')
    const v = getVulnerability(db, c.req.param('id'))
    if (!v) throw notFound('Vulnerability', c.req.param('id'))
    const input = await parseBody(
      c,
      z.object({
        source: requiredLine(200),
        observedExploitation: z.boolean(),
        firstObserved: instant.nullable().default(null),
        confidence,
        indicator: line(300).default(''),
        reference: line(400).default(''),
      }),
    )
    const t: ThreatIntel = { id: nextId(db, 'TI'), vulnerabilityId: v.id, ...input, analystId: user.id, recordedAt: nowIso(deps) }
    tx(db, () => {
      insertThreatIntel(db, t)
      appendAudit(db, { actorId: user.id, actorRole: user.role, eventType: 'THREAT_INTEL_RECORDED', objectType: 'threat_intel', objectId: t.id, caseId: null, source: 'ui', summary: `${t.id} ${v.cve ?? v.id}: ${t.observedExploitation ? 'exploitation observed' : 'no exploitation observed'} (${t.source})`, payload: { threatIntelId: t.id, vulnerabilityId: v.id, observedExploitation: t.observedExploitation, confidence: t.confidence }, at: t.recordedAt })
    })
    return c.json({ id: t.id }, 201)
  })

  // Relationship graph --------------------------------------------------------------
  app.get('/api/graph', (c) => {
    requireUser(c)
    const products = listProducts(db)
    const components = listComponents(db)
    const pcs = listProductComponents(db)
    const deployments = listDeployments(db)
    const vulns = listVulnerabilities(db)
    const analyzed = allAnalyzed(deps)
    const nodes: GraphNode[] = []
    const edges: GraphEdge[] = []
    const add = (n: GraphNode) => {
      if (!nodes.some((x) => x.id === n.id)) nodes.push(n)
    }
    for (const v of vulns) {
      add({ id: v.id, kind: 'vulnerability', label: v.cve ?? v.id, sublabel: v.title, state: v.exploitation === 'CONFIRMED' ? 'exploited' : 'neutral', meta: { severity: v.severity, exploitation: v.exploitation, range: v.affectedVersions } })
    }
    for (const comp of components) {
      add({ id: comp.id, kind: 'component', label: comp.name, sublabel: comp.purl, state: 'neutral', meta: { ecosystem: comp.ecosystem, supplier: comp.supplier } })
      for (const v of vulns.filter((x) => x.componentId === comp.id)) edges.push({ from: v.id, to: comp.id, kind: 'affects', highlighted: v.exploitation === 'CONFIRMED' })
    }
    for (const pc of pcs) {
      const comp = components.find((x) => x.id === pc.componentId)!
      const vulnHits = vulns.filter((v) => v.componentId === pc.componentId && inRange(pc.version, v.affectedVersions) === true)
      const verId = `VER:${pc.componentId}@${pc.version}`
      add({ id: verId, kind: 'version', label: `${comp.name} ${pc.version}`, sublabel: vulnHits.length ? `In range of ${vulnHits.map((v) => v.cve ?? v.id).join(', ')}` : 'No known affected range', state: vulnHits.length ? 'under_investigation' : 'neutral', meta: { version: pc.version } })
      if (!edges.some((e) => e.from === comp.id && e.to === verId)) edges.push({ from: comp.id, to: verId, kind: 'version', highlighted: vulnHits.length > 0 })
      edges.push({ from: verId, to: pc.productId, kind: pc.relation, highlighted: vulnHits.length > 0 })
    }
    for (const p of products) {
      const cases = analyzed.filter(({ bundle }) => bundle.case.productIds.includes(p.id) && bundle.case.lifecycle === 'open')
      const clock = cases.some(({ analysis }) => analysis.deadlines.some(isRunning))
      const affected = cases.some(({ analysis }) => analysis.determinations[p.id]?.result === 'AFFECTED')
      add({ id: p.id, kind: 'product', label: p.name, sublabel: `v${p.version}`, state: clock ? 'clock' : affected ? 'affected' : 'neutral', meta: { lifecycle: p.lifecycle, exposure: p.exposure, sbom: p.sbomStatus } })
      for (const d of deployments.filter((x) => x.productId === p.id)) {
        add({ id: d.id, kind: 'deployment', label: d.name, sublabel: `${d.count.toLocaleString('en')} · ${d.region}`, state: 'neutral', meta: { exposure: d.exposure, environment: d.environment } })
        edges.push({ from: p.id, to: d.id, kind: 'deployed', highlighted: false })
      }
    }
    for (const { bundle, analysis } of analyzed) {
      for (const [pid, d] of Object.entries(analysis.determinations)) {
        add({
          id: d.id,
          kind: 'determination',
          label: `${d.id} · ${d.result.replace(/_/g, ' ')}`,
          sublabel: `${bundle.case.id} · ${bundle.vulnerability.cve ?? bundle.vulnerability.id}`,
          state: d.result === 'AFFECTED' ? 'affected' : d.result === 'NOT_AFFECTED' ? 'not_affected' : 'under_investigation',
          meta: { case: bundle.case.id, vex: d.vexStatus, justification: d.vexJustification ?? '' },
        })
        edges.push({ from: pid, to: d.id, kind: 'determined', highlighted: d.result === 'AFFECTED' })
      }
    }
    const body: GraphResponse = { nodes, edges }
    return c.json(body)
  })
}

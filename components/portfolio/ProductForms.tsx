import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router'
import type { Exposure, ProductLifecycle, SbomStatus } from '../../types/domain.ts'
import type { ProductListItem } from '../../types/api.ts'
import { api } from '../../lib/client/api.ts'
import { useAction, useComponents, useUsers } from '../../lib/client/queries.ts'
import { displayZone, fromLocalInput, zoneAbbr } from '../../lib/client/format.ts'
import { Button, Checkbox, Field, Segmented, Select, TextArea, TextInput } from '../ui/primitives.tsx'
import { Drawer, Modal, useToast } from '../ui/overlay.tsx'
import { ErrorState, Notice } from '../ui/feedback.tsx'
import { EXPOSURE, fieldErrorsOf, pick } from './shared.tsx'

/**
 * Portfolio write forms: add a product, map a component into a product,
 * add a deployment. Client checks mirror the server schema so most mistakes
 * are caught before a request; the server's own field messages are still
 * shown next to the field they concern.
 */

const EXPOSURES = Object.keys(EXPOSURE) as Exposure[]

function tzLabel(): string {
  return `${displayZone()} (${zoneAbbr(new Date().toISOString())})`
}

// ---------------------------------------------------------------------------
// Add product
// ---------------------------------------------------------------------------

interface ProductDraft {
  id: string
  name: string
  version: string
  lifecycle: ProductLifecycle
  ownerId: string
  description: string
  sbomStatus: SbomStatus
  sbomGeneratedAt: string
  environment: string
  exposure: Exposure
  madeAvailableInEu: boolean
}

const EMPTY_PRODUCT: ProductDraft = {
  id: 'PRD-',
  name: '',
  version: '',
  lifecycle: 'active',
  ownerId: '',
  description: '',
  sbomStatus: 'current',
  sbomGeneratedAt: '',
  environment: '',
  exposure: 'customer_network',
  madeAvailableInEu: true,
}

export function AddProductModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const users = useUsers()
  const navigate = useNavigate()
  const toast = useToast()
  const [d, setD] = useState<ProductDraft>(EMPTY_PRODUCT)
  const [touched, setTouched] = useState(false)
  const create = useAction((body: unknown) => api<{ id: string }>('/api/products', { body }))
  const set = <K extends keyof ProductDraft>(k: K, v: ProductDraft[K]) => setD((x) => ({ ...x, [k]: v }))

  useEffect(() => {
    if (!open) return
    setD(EMPTY_PRODUCT)
    setTouched(false)
    create.reset()
    // Reset when the modal opens; `create` is stable enough for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const client = useMemo(() => {
    const e: Record<string, string> = {}
    if (!/^PRD-[A-Z0-9]{2,12}$/.test(d.id)) e.id = 'Use PRD- and 2 to 12 capitals or digits'
    if (!d.name.trim()) e.name = 'Required'
    if (!d.version.trim()) e.version = 'Required'
    if (!d.ownerId) e.ownerId = 'Choose an owner'
    if (!d.environment.trim()) e.environment = 'Required'
    if (d.sbomStatus !== 'missing' && d.sbomGeneratedAt && !fromLocalInput(d.sbomGeneratedAt)) e.sbomGeneratedAt = 'Not a valid date and time'
    if (d.sbomStatus !== 'missing' && d.sbomGeneratedAt && Date.parse(fromLocalInput(d.sbomGeneratedAt) ?? '') > Date.now() + 120_000) e.sbomGeneratedAt = 'Cannot be in the future'
    return e
  }, [d])
  const server = fieldErrorsOf(create.error)
  const err = (k: string) => (touched ? client[k] : undefined) ?? pick(server, k)

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    setTouched(true)
    if (Object.keys(client).length) return
    try {
      const r = await create.mutateAsync({
        id: d.id.trim(),
        name: d.name.trim(),
        version: d.version.trim(),
        lifecycle: d.lifecycle,
        ownerId: d.ownerId,
        description: d.description.trim(),
        sbomStatus: d.sbomStatus,
        sbomGeneratedAt: d.sbomStatus === 'missing' || !d.sbomGeneratedAt ? null : fromLocalInput(d.sbomGeneratedAt),
        environment: d.environment.trim(),
        exposure: d.exposure,
        madeAvailableInEu: d.madeAvailableInEu,
      })
      toast({ tone: 'success', title: 'Product added', body: `${d.name} ${d.version} is recorded as ${r.id}.` })
      onClose()
      navigate(`/products/${r.id}`)
    } catch {
      /* shown inline */
    }
  }

  const serverOnly = create.error && Object.keys(server).length === 0
  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Portfolio"
      title="Add product"
      width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={create.isPending} onClick={() => void submit()}>
            Add product
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-6" noValidate>
        <fieldset className="grid gap-4 sm:grid-cols-[1fr_1.4fr_0.8fr]">
          <legend className="micro mb-3">Identity</legend>
          <Field label="Product id" required error={err('id')} hint="PRD- and 2 to 12 capitals or digits">
            {(id) => <TextInput id={id} data-autofocus value={d.id} onChange={(e) => set('id', e.target.value.toUpperCase())} className="mono" invalid={!!err('id')} maxLength={16} />}
          </Field>
          <Field label="Name" required error={err('name')}>
            {(id) => <TextInput id={id} value={d.name} onChange={(e) => set('name', e.target.value)} invalid={!!err('name')} maxLength={120} placeholder="SecureEdge Gateway" />}
          </Field>
          <Field label="Version" required error={err('version')}>
            {(id) => <TextInput id={id} value={d.version} onChange={(e) => set('version', e.target.value)} className="mono" invalid={!!err('version')} maxLength={40} placeholder="4.3.0" />}
          </Field>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="micro mb-3">Ownership and lifecycle</legend>
          <Field label="Owner" required error={err('ownerId')}>
            {(id) => (
              <Select id={id} value={d.ownerId} onChange={(e) => set('ownerId', e.target.value)} invalid={!!err('ownerId')}>
                <option value="">Choose an owner</option>
                {(users.data ?? [])
                  .filter((u) => u.active)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} · {u.title}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field label="Lifecycle" error={err('lifecycle')}>
            {(id) => (
              <Select id={id} value={d.lifecycle} onChange={(e) => set('lifecycle', e.target.value as ProductLifecycle)}>
                <option value="active">Active</option>
                <option value="maintenance">Maintenance</option>
                <option value="end_of_support">End of support</option>
              </Select>
            )}
          </Field>
          <Field label="Description" error={err('description')} className="sm:col-span-2">
            {(id) => <TextArea id={id} value={d.description} onChange={(e) => set('description', e.target.value)} maxLength={2000} rows={3} />}
          </Field>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="micro mb-3">Operating context</legend>
          <Field label="Environment" required error={err('environment')} hint="Where and how it runs">
            {(id) => <TextInput id={id} value={d.environment} onChange={(e) => set('environment', e.target.value)} invalid={!!err('environment')} maxLength={120} placeholder="Edge appliance (ARM64, Linux 6.1)" />}
          </Field>
          <Field label="Exposure" error={err('exposure')}>
            {(id) => (
              <Select id={id} value={d.exposure} onChange={(e) => set('exposure', e.target.value as Exposure)}>
                {EXPOSURES.map((x) => (
                  <option key={x} value={x}>
                    {EXPOSURE[x].label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="sm:col-span-2">
            <Checkbox
              checked={d.madeAvailableInEu}
              onChange={(v) => set('madeAvailableInEu', v)}
              label="Made available on the EU market"
              description="Article 14 obligations attach to products made available in the Union. Recorded as a fact of the product, used by the rule evaluation."
            />
          </div>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="micro mb-3">SBOM</legend>
          <Field label="SBOM status" error={err('sbomStatus')}>
            {(id) => (
              <Select id={id} value={d.sbomStatus} onChange={(e) => set('sbomStatus', e.target.value as SbomStatus)}>
                <option value="current">Current</option>
                <option value="stale">Stale</option>
                <option value="missing">Missing</option>
              </Select>
            )}
          </Field>
          <Field label="SBOM generated" error={err('sbomGeneratedAt')} hint={d.sbomStatus === 'missing' ? 'Not applicable without an SBOM' : `Local time, ${tzLabel()}`}>
            {(id) => <TextInput id={id} type="datetime-local" value={d.sbomStatus === 'missing' ? '' : d.sbomGeneratedAt} disabled={d.sbomStatus === 'missing'} onChange={(e) => set('sbomGeneratedAt', e.target.value)} className="mono" invalid={!!err('sbomGeneratedAt')} />}
          </Field>
        </fieldset>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
      {serverOnly && <ErrorState error={create.error} className="mt-5" />}
      {touched && Object.keys(client).length > 0 && (
        <p className="mt-4 text-xs text-red" role="alert">
          {Object.keys(client).length} field{Object.keys(client).length === 1 ? '' : 's'} need attention before the product can be added.
        </p>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Map a component into a product
// ---------------------------------------------------------------------------

type Source = 'existing' | 'new'

export function ComponentMappingDrawer({ product, open, onClose }: { product: ProductListItem; open: boolean; onClose: () => void }) {
  const components = useComponents()
  const toast = useToast()
  const [source, setSource] = useState<Source>('existing')
  const [componentId, setComponentId] = useState('')
  const [name, setName] = useState('')
  const [purl, setPurl] = useState('pkg:generic/')
  const [ecosystem, setEcosystem] = useState('')
  const [supplier, setSupplier] = useState('')
  const [version, setVersion] = useState('')
  const [relation, setRelation] = useState<'direct' | 'transitive'>('direct')
  const [viaId, setViaId] = useState('')
  const [usage, setUsage] = useState('')
  const [touched, setTouched] = useState(false)
  const map = useAction((body: unknown) => api(`/api/products/${encodeURIComponent(product.id)}/components`, { body }))

  useEffect(() => {
    if (!open) return
    setSource('existing')
    setComponentId('')
    setName('')
    setPurl('pkg:generic/')
    setEcosystem('')
    setSupplier('')
    setVersion('')
    setRelation('direct')
    setViaId('')
    setUsage('')
    setTouched(false)
    map.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const mapped = new Set(product.components.map((pc) => pc.componentId))
  const client = useMemo(() => {
    const e: Record<string, string> = {}
    if (source === 'existing' && !componentId) e.componentId = 'Choose a component'
    if (source === 'new') {
      if (!name.trim()) e.name = 'Required'
      if (!/^pkg:[a-z0-9.+-]+\/[^\s]+$/.test(purl.trim())) e.purl = 'Package URLs look like pkg:generic/openssl'
      if (!ecosystem.trim()) e.ecosystem = 'Required'
      if (!supplier.trim()) e.supplier = 'Required'
    }
    if (!version.trim()) e.version = 'Required'
    if (relation === 'transitive' && product.components.length > 0 && !viaId) e.viaId = 'Choose the component that pulls it in, or "Not recorded"'
    return e
  }, [source, componentId, name, purl, ecosystem, supplier, version, relation, viaId, product.components.length])
  const server = fieldErrorsOf(map.error)
  const err = (k: string, ...alts: string[]) => (touched ? client[k] : undefined) ?? pick(server, k, ...alts)

  const submit = async () => {
    setTouched(true)
    if (Object.keys(client).length) return
    try {
      await map.mutateAsync({
        componentId: source === 'existing' ? componentId : null,
        component: source === 'new' ? { name: name.trim(), purl: purl.trim(), ecosystem: ecosystem.trim(), supplier: supplier.trim() } : null,
        version: version.trim(),
        relation,
        viaId: relation === 'transitive' && viaId && viaId !== 'none' ? viaId : null,
        usage: usage.trim(),
      })
      const label = source === 'existing' ? (components.data?.find((c) => c.id === componentId)?.name ?? componentId) : name
      toast({ tone: 'success', title: 'Component mapped', body: `${label} ${version} mapped into ${product.name} ${product.version}.` })
      onClose()
    } catch {
      /* shown inline */
    }
  }
  const serverOnly = map.error && Object.keys(server).length === 0

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow={`${product.name} ${product.version}`}
      title="Add component mapping"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={map.isPending} onClick={() => void submit()}>
            Map component
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <p className="text-sm text-ink-3">A mapping records that this product ships a component at a specific version. It drives SBOM matching against vulnerability ranges; it does not decide affectedness.</p>
        <section aria-label="Component" className="space-y-4">
          <div className="micro">Component</div>
          <Segmented<Source>
            label="Component source"
            value={source}
            onChange={setSource}
            options={[
              { value: 'existing', label: 'Existing component' },
              { value: 'new', label: 'Define new' },
            ]}
          />
          {source === 'existing' ? (
            <Field label="Component" required error={err('componentId')}>
              {(id) => (
                <Select id={id} value={componentId} onChange={(e) => setComponentId(e.target.value)} invalid={!!err('componentId')}>
                  <option value="">Choose a component</option>
                  {(components.data ?? []).map((c) => (
                    <option key={c.id} value={c.id} disabled={mapped.has(c.id)}>
                      {c.name} · {c.purl}
                      {mapped.has(c.id) ? ' (already mapped)' : ''}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" required error={err('name', 'component.name')}>
                {(id) => <TextInput id={id} value={name} onChange={(e) => setName(e.target.value)} invalid={!!err('name', 'component.name')} maxLength={120} placeholder="openssl" />}
              </Field>
              <Field label="Package URL" required error={err('purl', 'component.purl')} hint="Without the version; the version is recorded below">
                {(id) => <TextInput id={id} value={purl} onChange={(e) => setPurl(e.target.value)} className="mono" invalid={!!err('purl', 'component.purl')} maxLength={300} spellCheck={false} />}
              </Field>
              <Field label="Ecosystem" required error={err('ecosystem', 'component.ecosystem')}>
                {(id) => <TextInput id={id} value={ecosystem} onChange={(e) => setEcosystem(e.target.value)} invalid={!!err('ecosystem', 'component.ecosystem')} maxLength={40} placeholder="C / system" />}
              </Field>
              <Field label="Supplier" required error={err('supplier', 'component.supplier')}>
                {(id) => <TextInput id={id} value={supplier} onChange={(e) => setSupplier(e.target.value)} invalid={!!err('supplier', 'component.supplier')} maxLength={120} placeholder="OpenSSL Project" />}
              </Field>
            </div>
          )}
        </section>

        <section aria-label="Mapping" className="space-y-4">
          <div className="micro">In this product</div>
          <Field label="Version" required error={err('version')} hint="As listed in the SBOM, e.g. 3.0.9 or 1.1.1w">
            {(id) => <TextInput id={id} value={version} onChange={(e) => setVersion(e.target.value)} className="mono" invalid={!!err('version')} maxLength={60} spellCheck={false} />}
          </Field>
          <div>
            <div className="mb-1.5 text-xs font-medium text-ink-2">Dependency relationship</div>
            <Segmented<'direct' | 'transitive'>
              label="Dependency relationship"
              value={relation}
              onChange={setRelation}
              options={[
                { value: 'direct', label: 'Direct' },
                { value: 'transitive', label: 'Transitive' },
              ]}
            />
          </div>
          {relation === 'transitive' && (
            <Field label="Pulled in by" required error={err('viaId')} hint="The component of this product that brings it in">
              {(id) => (
                <Select id={id} value={viaId} onChange={(e) => setViaId(e.target.value)} invalid={!!err('viaId')}>
                  <option value="">Choose a component</option>
                  <option value="none">Not recorded (base image or unknown)</option>
                  {product.components.map((pc) => (
                    <option key={pc.id} value={pc.id}>
                      {pc.component.name} {pc.version}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Usage" error={err('usage')} hint="What the product uses it for. This is the input to the reachability questions in a determination.">
            {(id) => <TextArea id={id} value={usage} onChange={(e) => setUsage(e.target.value)} maxLength={1000} rows={3} placeholder="TLS termination for the management UI; validates peer X.509 certificates." />}
          </Field>
        </section>
        {serverOnly && <ErrorState error={map.error} />}
      </div>
    </Drawer>
  )
}

// ---------------------------------------------------------------------------
// Add deployment
// ---------------------------------------------------------------------------

export function DeploymentDrawer({ product, open, onClose }: { product: ProductListItem; open: boolean; onClose: () => void }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [region, setRegion] = useState('')
  const [count, setCount] = useState('')
  const [environment, setEnvironment] = useState('')
  const [exposure, setExposure] = useState<Exposure>(product.exposure)
  const [touched, setTouched] = useState(false)
  const add = useAction((body: unknown) => api<{ id: string }>(`/api/products/${encodeURIComponent(product.id)}/deployments`, { body }))

  useEffect(() => {
    if (!open) return
    setName('')
    setRegion('')
    setCount('')
    setEnvironment('')
    setExposure(product.exposure)
    setTouched(false)
    add.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const client = useMemo(() => {
    const e: Record<string, string> = {}
    if (!name.trim()) e.name = 'Required'
    if (!region.trim()) e.region = 'Required'
    if (!/^\d+$/.test(count.trim())) e.count = 'A whole number of units'
    else if (Number(count) > 10_000_000) e.count = 'At most 10,000,000'
    if (!environment.trim()) e.environment = 'Required'
    return e
  }, [name, region, count, environment])
  const server = fieldErrorsOf(add.error)
  const err = (k: string) => (touched ? client[k] : undefined) ?? pick(server, k)

  const submit = async () => {
    setTouched(true)
    if (Object.keys(client).length) return
    try {
      const r = await add.mutateAsync({ name: name.trim(), region: region.trim(), count: Number(count), environment: environment.trim(), exposure })
      toast({ tone: 'success', title: 'Deployment added', body: `${name} recorded as ${r.id}.` })
      onClose()
    } catch {
      /* shown inline */
    }
  }
  const serverOnly = add.error && Object.keys(server).length === 0

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow={`${product.name} ${product.version}`}
      title="Add deployment"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={add.isPending} onClick={() => void submit()}>
            Add deployment
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-3">Deployments record where units of this product run. They inform exposure and the scale of a notification; they do not change affectedness.</p>
        <Field label="Name" required error={err('name')}>
          {(id) => <TextInput id={id} data-autofocus value={name} onChange={(e) => setName(e.target.value)} invalid={!!err('name')} maxLength={120} placeholder="EU industrial fleet" />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Region" required error={err('region')} hint="Member states or a region code">
            {(id) => <TextInput id={id} value={region} onChange={(e) => setRegion(e.target.value)} invalid={!!err('region')} maxLength={60} placeholder="DE, AT, NL" />}
          </Field>
          <Field label="Units" required error={err('count')}>
            {(id) => <TextInput id={id} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/[^\d]/g, ''))} className="mono" invalid={!!err('count')} placeholder="0" />}
          </Field>
        </div>
        <Field label="Environment" required error={err('environment')}>
          {(id) => <TextInput id={id} value={environment} onChange={(e) => setEnvironment(e.target.value)} invalid={!!err('environment')} maxLength={120} placeholder="Customer sites" />}
        </Field>
        <Field label="Exposure" error={err('exposure')}>
          {(id) => (
            <Select id={id} value={exposure} onChange={(e) => setExposure(e.target.value as Exposure)}>
              {EXPOSURES.map((x) => (
                <option key={x} value={x}>
                  {EXPOSURE[x].label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {serverOnly && <ErrorState error={add.error} />}
        {!product.madeAvailableInEu && (
          <Notice tone="blue" title="Not made available in the EU">
            This product is recorded as not made available on the EU market. Deployments outside the Union do not change that fact.
          </Notice>
        )}
      </div>
    </Drawer>
  )
}

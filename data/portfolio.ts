import type {
  AwarenessCriterion,
  Component,
  Deployment,
  EscalationRule,
  Organization,
  Product,
  ProductComponent,
  User,
} from '../types/domain.ts'

/**
 * The fictional demo organisation and its portfolio.
 *
 * Everything here is invented: the manufacturer, its people, its products
 * and deployments. Component names are real open-source projects, so the
 * SBOMs read realistically, but every vulnerability in the demo data is
 * fictional and uses a CVE range (CVE-2026-99xxxx) that does not exist.
 */

export const ORG: Organization = {
  id: 'org-tessaline',
  name: 'Tessaline Systems GmbH',
  legalEntity: 'Tessaline Systems GmbH, Munich (fictional demo manufacturer)',
  timezone: 'Europe/Berlin',
  memberStatesMadeAvailable: ['DE', 'AT', 'NL', 'FR', 'PL', 'SE', 'IT', 'ES'],
  csirtCoordinator: 'National CSIRT coordinator (DE)',
  demo: true,
}

export const USERS: User[] = [
  { id: 'u-admin', name: 'Mara Lindqvist', email: 'mara.lindqvist@tessaline.example', role: 'administrator', title: 'Platform Administrator', initials: 'ML', active: true },
  { id: 'u-lead', name: 'Jonas Weber', email: 'jonas.weber@tessaline.example', role: 'psirt_lead', title: 'PSIRT Lead', initials: 'JW', active: true },
  { id: 'u-analyst', name: 'Priya Raman', email: 'priya.raman@tessaline.example', role: 'psirt_analyst', title: 'PSIRT Analyst', initials: 'PR', active: true },
  { id: 'u-analyst2', name: 'Tomás Ferreira', email: 'tomas.ferreira@tessaline.example', role: 'psirt_analyst', title: 'PSIRT Analyst', initials: 'TF', active: true },
  { id: 'u-eng', name: 'Lea Hoffmann', email: 'lea.hoffmann@tessaline.example', role: 'security_engineer', title: 'Product Security Engineer', initials: 'LH', active: true },
  { id: 'u-mgr', name: 'Daniel Okafor', email: 'daniel.okafor@tessaline.example', role: 'security_manager', title: 'Head of Product Security', initials: 'DO', active: true },
  { id: 'u-comp', name: 'Sofia Marchetti', email: 'sofia.marchetti@tessaline.example', role: 'compliance_reviewer', title: 'Regulatory Compliance', initials: 'SM', active: true },
  { id: 'u-legal', name: 'Henrik Aalto', email: 'henrik.aalto@tessaline.example', role: 'legal_reviewer', title: 'Product Counsel', initials: 'HA', active: true },
  { id: 'u-exec', name: 'Claire Dubois', email: 'claire.dubois@tessaline.example', role: 'executive_approver', title: 'Chief Information Security Officer', initials: 'CD', active: true },
  { id: 'u-ro', name: 'Ines Kovač', email: 'ines.kovac@tessaline.example', role: 'read_only', title: 'Internal Audit', initials: 'IK', active: true },
]

export const CRITERIA: AwarenessCriterion[] = [
  {
    id: 'AC-01',
    label: 'PSIRT confirmation',
    description: 'The PSIRT Lead confirms that the vulnerability exists in a shipped Tessaline product version, from the SBOM or a reproduction.',
    scope: 'vulnerability',
    responsibleRole: 'psirt_lead',
    requiredEvidenceTypes: ['TICKET', 'VENDOR_ADVISORY', 'EMAIL'],
    active: true,
  },
  {
    id: 'AC-02',
    label: 'Security-team confirmation',
    description: 'The product security team confirms the finding of an automated scan or an internal report against a shipped product.',
    scope: 'vulnerability',
    responsibleRole: 'security_manager',
    requiredEvidenceTypes: ['TICKET', 'SCANNER_RESULT', 'ANALYST_NOTE'],
    active: true,
  },
  {
    id: 'AC-03',
    label: 'Validated exploitation evidence',
    description: 'The Security Manager validates reliable evidence that a malicious actor has exploited the vulnerability without the system owner\'s permission (Art. 3(42)).',
    scope: 'exploitation',
    responsibleRole: 'security_manager',
    requiredEvidenceTypes: ['EXPLOIT_EVIDENCE', 'THREAT_INTELLIGENCE', 'LOG'],
    active: true,
  },
  {
    id: 'AC-04',
    label: 'Incident-response confirmation',
    description: 'Incident response confirms exploitation in a customer or Tessaline system during an active engagement.',
    scope: 'exploitation',
    responsibleRole: 'psirt_lead',
    requiredEvidenceTypes: ['INCIDENT_RECORD', 'LOG'],
    active: true,
  },
  {
    id: 'AC-05',
    label: 'Designated security authority confirmation',
    description: 'The designated security authority (CISO delegate) confirms exploitation on the basis of external intelligence alone.',
    scope: 'exploitation',
    responsibleRole: 'security_manager',
    requiredEvidenceTypes: ['THREAT_INTELLIGENCE', 'ANALYST_NOTE', 'EMAIL'],
    active: true,
  },
]

export const ESCALATION: EscalationRule[] = [
  { id: 'ESC-1', offsetMinutes: 12 * 60, targetRole: 'owner', level: 'watch', label: 'T-12h: notify case owner', active: true },
  { id: 'ESC-2', offsetMinutes: 6 * 60, targetRole: 'psirt_lead', level: 'watch', label: 'T-6h: notify PSIRT Lead', active: true },
  { id: 'ESC-3', offsetMinutes: 2 * 60, targetRole: 'security_manager', level: 'critical', label: 'T-2h: notify Security Manager', active: true },
  { id: 'ESC-4', offsetMinutes: 0, targetRole: 'executive_approver', level: 'critical', label: 'T-0: critical escalation', active: true },
]

export const COMPONENTS: Component[] = [
  { id: 'CMP-OPENSSL', name: 'openssl', purl: 'pkg:generic/openssl', ecosystem: 'C / system', supplier: 'OpenSSL Project' },
  { id: 'CMP-NGINX', name: 'nginx', purl: 'pkg:generic/nginx', ecosystem: 'C / system', supplier: 'nginx' },
  { id: 'CMP-LIBXML2', name: 'libxml2', purl: 'pkg:generic/libxml2', ecosystem: 'C / system', supplier: 'GNOME Project' },
  { id: 'CMP-BUSYBOX', name: 'busybox', purl: 'pkg:generic/busybox', ecosystem: 'C / embedded', supplier: 'BusyBox' },
  { id: 'CMP-ZLIB', name: 'zlib', purl: 'pkg:generic/zlib', ecosystem: 'C / system', supplier: 'zlib' },
  { id: 'CMP-MOSQUITTO', name: 'mosquitto', purl: 'pkg:generic/eclipse-mosquitto', ecosystem: 'C / system', supplier: 'Eclipse Foundation' },
  { id: 'CMP-CURL', name: 'curl', purl: 'pkg:generic/curl', ecosystem: 'C / system', supplier: 'curl project' },
  { id: 'CMP-SQLITE', name: 'sqlite', purl: 'pkg:generic/sqlite', ecosystem: 'C / system', supplier: 'SQLite' },
  { id: 'CMP-JACKSON', name: 'jackson-databind', purl: 'pkg:maven/com.fasterxml.jackson.core/jackson-databind', ecosystem: 'Maven', supplier: 'FasterXML' },
  { id: 'CMP-SPRINGWEB', name: 'spring-web', purl: 'pkg:maven/org.springframework/spring-web', ecosystem: 'Maven', supplier: 'Spring' },
  { id: 'CMP-PGJDBC', name: 'postgresql-jdbc', purl: 'pkg:maven/org.postgresql/postgresql', ecosystem: 'Maven', supplier: 'PostgreSQL JDBC' },
  { id: 'CMP-LIBARCHIVE', name: 'libarchive', purl: 'pkg:generic/libarchive', ecosystem: 'C / system', supplier: 'libarchive' },
  { id: 'CMP-DROPBEAR', name: 'dropbear', purl: 'pkg:generic/dropbear', ecosystem: 'C / embedded', supplier: 'Dropbear SSH' },
  { id: 'CMP-PROTOBUF', name: 'protobuf', purl: 'pkg:generic/protobuf', ecosystem: 'C++', supplier: 'Protocol Buffers' },
]

export function products(now: number): Product[] {
  const D = 86_400_000
  const iso = (t: number) => new Date(t).toISOString()
  return [
    {
      id: 'PRD-SEG',
      name: 'SecureEdge Gateway',
      version: '4.2.1',
      lifecycle: 'active',
      ownerId: 'u-lead',
      description: 'Industrial edge gateway appliance bridging OT sensor networks to cloud and on-premises management.',
      sbomStatus: 'current',
      sbomGeneratedAt: iso(now - 6 * D),
      environment: 'Edge appliance (ARM64, Linux 6.1)',
      exposure: 'internet_facing',
      madeAvailableInEu: true,
    },
    {
      id: 'PRD-SCA',
      name: 'SecureConnect Agent',
      version: '7.1.0',
      lifecycle: 'active',
      ownerId: 'u-analyst2',
      description: 'Endpoint agent that enrols customer machines into BridgeCloud Console and applies policy.',
      sbomStatus: 'current',
      sbomGeneratedAt: iso(now - 12 * D),
      environment: 'Endpoint agent (Windows, Linux)',
      exposure: 'customer_network',
      madeAvailableInEu: true,
    },
    {
      id: 'PRD-BCC',
      name: 'BridgeCloud Console',
      version: '2026.3',
      lifecycle: 'active',
      ownerId: 'u-eng',
      description: 'Self-hosted management server for gateways and agents, shipped as a container image.',
      sbomStatus: 'current',
      sbomGeneratedAt: iso(now - 9 * D),
      environment: 'Self-hosted management server (container image)',
      exposure: 'customer_network',
      madeAvailableInEu: true,
    },
    {
      id: 'PRD-VSY',
      name: 'VaultSync',
      version: '3.4.2',
      lifecycle: 'active',
      ownerId: 'u-eng',
      description: 'Secure file synchronisation appliance with in-browser archive preview.',
      sbomStatus: 'stale',
      sbomGeneratedAt: iso(now - 48 * D),
      environment: 'File-sync appliance (x86-64)',
      exposure: 'internet_facing',
      madeAvailableInEu: true,
    },
    {
      id: 'PRD-ROC',
      name: 'RemoteOps Controller',
      version: '2.8.0',
      lifecycle: 'maintenance',
      ownerId: 'u-lead',
      description: 'Remote-maintenance controller installed on plant networks for vendor access to OT equipment.',
      sbomStatus: 'current',
      sbomGeneratedAt: iso(now - 20 * D),
      environment: 'OT remote-maintenance controller (ARMv7, embedded Linux)',
      exposure: 'customer_network',
      madeAvailableInEu: true,
    },
    {
      id: 'PRD-SEG3',
      name: 'SecureEdge Gateway',
      version: '3.9.4',
      lifecycle: 'end_of_support',
      ownerId: 'u-lead',
      description: 'Previous-generation gateway. End of support; still deployed at some customers.',
      sbomStatus: 'missing',
      sbomGeneratedAt: null,
      environment: 'Legacy edge appliance (ARMv7)',
      exposure: 'internet_facing',
      madeAvailableInEu: true,
    },
  ]
}

export const PRODUCT_COMPONENTS: ProductComponent[] = [
  // SecureEdge Gateway 4.2.1
  { id: 'PC-0001', productId: 'PRD-SEG', componentId: 'CMP-OPENSSL', version: '3.0.9', relation: 'direct', viaId: null, usage: 'TLS termination for the management UI and the MQTT bridge; validates peer X.509 certificates.' },
  { id: 'PC-0002', productId: 'PRD-SEG', componentId: 'CMP-NGINX', version: '1.24.0', relation: 'direct', viaId: null, usage: 'Reverse proxy in front of the local management interface. HTTP/2 enabled.' },
  { id: 'PC-0003', productId: 'PRD-SEG', componentId: 'CMP-LIBXML2', version: '2.10.3', relation: 'direct', viaId: null, usage: 'config-agent parses signed device configuration bundles with the xmlreader API.' },
  { id: 'PC-0004', productId: 'PRD-SEG', componentId: 'CMP-BUSYBOX', version: '1.36.1', relation: 'direct', viaId: null, usage: 'Base userland. Networking is handled by systemd-networkd.' },
  { id: 'PC-0005', productId: 'PRD-SEG', componentId: 'CMP-ZLIB', version: '1.2.13', relation: 'transitive', viaId: 'PC-0001', usage: 'Compression support pulled in by openssl.' },
  { id: 'PC-0006', productId: 'PRD-SEG', componentId: 'CMP-MOSQUITTO', version: '2.0.15', relation: 'direct', viaId: null, usage: 'Local MQTT broker for the OT sensor bridge, listening on the sensor LAN.' },
  // SecureConnect Agent 7.1.0
  { id: 'PC-0007', productId: 'PRD-SCA', componentId: 'CMP-OPENSSL', version: '3.0.13', relation: 'direct', viaId: null, usage: 'TLS client to BridgeCloud Console; validates the console certificate chain.' },
  { id: 'PC-0008', productId: 'PRD-SCA', componentId: 'CMP-CURL', version: '8.4.0', relation: 'direct', viaId: null, usage: 'Update client. Cookie jar enabled for authenticated update mirrors.' },
  { id: 'PC-0009', productId: 'PRD-SCA', componentId: 'CMP-SQLITE', version: '3.42.0', relation: 'direct', viaId: null, usage: 'Local event queue with FTS5 search over event text.' },
  { id: 'PC-0010', productId: 'PRD-SCA', componentId: 'CMP-PROTOBUF', version: '3.21.12', relation: 'direct', viaId: null, usage: 'Wire format for console messages.' },
  // BridgeCloud Console 2026.3
  { id: 'PC-0011', productId: 'PRD-BCC', componentId: 'CMP-JACKSON', version: '2.15.2', relation: 'direct', viaId: null, usage: 'JSON API deserialisation. Polymorphic typing enabled for plugin configuration.' },
  { id: 'PC-0012', productId: 'PRD-BCC', componentId: 'CMP-SPRINGWEB', version: '6.0.11', relation: 'direct', viaId: null, usage: 'HTTP API layer.' },
  { id: 'PC-0013', productId: 'PRD-BCC', componentId: 'CMP-PGJDBC', version: '42.6.0', relation: 'direct', viaId: null, usage: 'Database driver.' },
  { id: 'PC-0014', productId: 'PRD-BCC', componentId: 'CMP-LIBXML2', version: '2.11.5', relation: 'transitive', viaId: null, usage: 'Present in the container base image; no console process links it.' },
  { id: 'PC-0015', productId: 'PRD-BCC', componentId: 'CMP-OPENSSL', version: '3.0.9', relation: 'transitive', viaId: null, usage: 'Present in the container base image. The console terminates TLS in the JVM, not with OpenSSL.' },
  // VaultSync 3.4.2
  { id: 'PC-0016', productId: 'PRD-VSY', componentId: 'CMP-LIBARCHIVE', version: '3.7.1', relation: 'direct', viaId: null, usage: 'Archive preview and extraction of uploaded files. RAR5 support enabled.' },
  { id: 'PC-0017', productId: 'PRD-VSY', componentId: 'CMP-OPENSSL', version: '3.1.2', relation: 'direct', viaId: null, usage: 'TLS for the sync API.' },
  { id: 'PC-0018', productId: 'PRD-VSY', componentId: 'CMP-ZLIB', version: '1.3', relation: 'direct', viaId: null, usage: 'Compression of sync payloads.' },
  { id: 'PC-0019', productId: 'PRD-VSY', componentId: 'CMP-SQLITE', version: '3.43.1', relation: 'direct', viaId: null, usage: 'Metadata index.' },
  // RemoteOps Controller 2.8.0
  { id: 'PC-0020', productId: 'PRD-ROC', componentId: 'CMP-BUSYBOX', version: '1.35.0', relation: 'direct', viaId: null, usage: 'Base userland. udhcpc DHCP client active on the plant-network interface.' },
  { id: 'PC-0021', productId: 'PRD-ROC', componentId: 'CMP-DROPBEAR', version: '2022.83', relation: 'direct', viaId: null, usage: 'SSH server for vendor maintenance sessions.' },
  { id: 'PC-0022', productId: 'PRD-ROC', componentId: 'CMP-OPENSSL', version: '1.1.1w', relation: 'direct', viaId: null, usage: 'TLS for the maintenance tunnel.' },
  { id: 'PC-0023', productId: 'PRD-ROC', componentId: 'CMP-LIBXML2', version: '2.9.14', relation: 'direct', viaId: null, usage: 'Parses equipment descriptor files. Built without the xmlreader API.' },
  { id: 'PC-0024', productId: 'PRD-ROC', componentId: 'CMP-MOSQUITTO', version: '2.0.15', relation: 'direct', viaId: null, usage: 'Telemetry broker on the plant network.' },
]

export const DEPLOYMENTS: Deployment[] = [
  { id: 'DEP-0001', productId: 'PRD-SEG', name: 'EU industrial fleet', region: 'EU-27', count: 1840, environment: 'Customer sites', exposure: 'internet_facing' },
  { id: 'DEP-0002', productId: 'PRD-SEG', name: 'Pilot customers, Nordics', region: 'SE, FI', count: 212, environment: 'Customer sites', exposure: 'customer_network' },
  { id: 'DEP-0003', productId: 'PRD-SCA', name: 'Enterprise endpoints, EU', region: 'EU-27', count: 22300, environment: 'Customer endpoints', exposure: 'customer_network' },
  { id: 'DEP-0004', productId: 'PRD-SCA', name: 'MSP partner estates', region: 'DE, NL, PL', count: 4100, environment: 'Managed service providers', exposure: 'customer_network' },
  { id: 'DEP-0005', productId: 'PRD-BCC', name: 'Customer on-premises installs', region: 'EU-27', count: 640, environment: 'Customer data centres', exposure: 'customer_network' },
  { id: 'DEP-0006', productId: 'PRD-VSY', name: 'EU enterprise tenants', region: 'EU-27', count: 410, environment: 'Customer DMZ', exposure: 'internet_facing' },
  { id: 'DEP-0007', productId: 'PRD-ROC', name: 'Plant networks, EU', region: 'DE, AT, IT', count: 3120, environment: 'OT plant networks', exposure: 'customer_network' },
  { id: 'DEP-0008', productId: 'PRD-SEG3', name: 'Legacy fleet (end of support)', region: 'DE, FR', count: 380, environment: 'Customer sites', exposure: 'internet_facing' },
]

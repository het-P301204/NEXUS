# Threat model

NEXUS's output is meant to be trusted by people who were not in the room: a reviewer, a
regulator, a court. The system is therefore modelled as a target in its own right. The assets are
**the timestamps**, **the decisions and their reasoning**, **the evidence**, and **the integrity of
the record that ties them together**.

## Assets

| Asset | Why it matters |
| --- | --- |
| Awareness timestamps | They start the 24h and 72h statutory clocks. Moving one moves a legal deadline. |
| Decisions (especially *do not report*) | The highest-risk judgement the tool records. |
| Evidence objects | The basis for every determination; some are privileged (customer communications). |
| Report versions | What would be submitted; their content hash is the reference. |
| The audit ledger | The account of who did what, when. |
| Sessions and roles | Who may establish awareness, record decisions, approve and submit. |

## Trust boundaries

1. **Browser → API.** Everything from the browser is untrusted input: bodies, headers, cookies,
   uploaded files. The UI's permission hiding is not a control.
2. **API → SQLite file.** The application is trusted to write through its own code paths. The file
   itself may be reached by someone else (a backup operator, a compromised host).
3. **API → evidence store.** Content-addressed files on disk, outside any served directory.
4. **Operator → demo controls.** Reset, scenarios and tamper simulation exist only in demo mode.

## Threats and mitigations

| # | Threat | Attack surface | Impact | Mitigation | Residual risk |
| --- | --- | --- | --- | --- | --- |
| T1 | **Timestamp manipulation**: backdating or forward-dating an awareness event to change a deadline | `POST /cases/:id/events`, correction endpoint | A missed deadline is disguised, or an obligation is made to vanish across the 11 Sep boundary | Asserted times in the future are rejected (2-minute skew); every event carries a server `recordedAt` the client cannot set; a lag over 24h is flagged as a retrospective entry; the source and its authority (system of record / document / attestation) are recorded; a clock start resting on attestation alone is flagged in completeness; awareness requires a configured criterion **and** evidence of the criterion's type; only PSIRT Lead and Security Manager may establish awareness | An insider with the right role and fabricated evidence can still assert a false time. NEXUS makes the assertion, its source and its author permanent and visible; it cannot make it true. |
| T2 | **Rewriting history**: editing or deleting a clock event, decision or ledger entry | Application code paths; direct database access | The record no longer shows what was known when | SQLite triggers abort every UPDATE and DELETE on the eleven history tables; corrections are new events that reference the original; derived views (deadlines, status) are recomputed, never stored | See T3 for someone who bypasses the triggers. |
| T3 | **Audit-log manipulation** by someone with write access to the database file | `storage/nexus.sqlite` | A tampered ledger that looks intact | Each entry's SHA-256 covers its content and the previous hash; verification on the server and **independently in the browser** names the first broken link (`hash_mismatch`, `prev_link_mismatch`, `sequence_gap`); `npm run tamper-demo` demonstrates it. The system-wide integrity status reflects the stored chain only; an anchor supplied by a caller is checked for that caller and cannot raise an alarm for everyone | An attacker who rewrites the **whole chain** from the tampered entry onwards produces a consistent chain. Mitigation: the exported **anchor** (head hash at a sequence number) held outside NEXUS. Roadmap: signed anchors in an external transparency log. |
| T4 | **Evidence tampering**: altering a stored file after upload | Evidence store on disk | A determination rests on a document that no longer says what it said | Files are content-addressed by SHA-256; the hash recorded at upload is immutable; the evidence page and the startup integrity check re-hash each object; the browser can re-hash the downloaded bytes | A file-system attacker can delete an object; this is detected as a missing object, not prevented. |
| T5 | **Malicious file upload** (stored XSS, polyglots, oversized files) | `POST /api/evidence` | Script execution in another user's browser, disk exhaustion | Content is sniffed from the bytes (PDF, PNG, JPEG, UTF-8 text only); a declared type that disagrees with the content is refused; extensions must match; filenames are sanitised; per-file size limit and body limits; files are served as `attachment` with `nosniff` and `Content-Security-Policy: sandbox`, from an authorised endpoint only; text previews are rendered as React text, never HTML | A PDF can still carry an exploit for a PDF reader on the downloader's machine; NEXUS does not scan content. |
| T6 | **Unauthorised evidence access** | `GET /api/evidence/:id/file`, list endpoints, search | Disclosure of privileged material (customer communications, incident details) | Every read checks the role; *restricted* evidence is redacted (title, description, source, filename) for roles without `evidence.read_restricted`, and its file download returns 403; search excludes what the user cannot read; frozen report content writes restricted items by id, type and hash only, because every reader of a report sees the same bytes; data-quality findings and evidence chains cite evidence by id | Metadata (id, type, hash, case) of restricted evidence remains visible by design so the record stays complete. |
| T7 | **Privilege escalation**: acting beyond one's role | Every mutating route | An analyst establishes awareness, approves their own report, or submits | Permissions checked on the server per route from `lib/rbac.ts`; approvals count only from reviewers who neither generated the report nor recorded its decision or the decision now in force (separation of duties); approval policies per report kind, and only the roles in a kind's policy may approve, reject or return it; only Security Manager may reopen a case | Administrator can change awareness criteria and escalation policy; those changes are ledgered with before/after values. |
| T8 | **Unauthorised case access (IDOR)** | `/api/cases/:id/*` | An analyst modifies a case they have no part in by guessing its id | Object-level check: PSIRT Analysts and Security Engineers may write only to cases they own or collaborate on; all writes to closed or archived cases are refused, including reviews and comments | Reads are organisation-wide by design (PSIRT tool); a per-case read restriction is not implemented. |
| T9 | **Report manipulation** between approval and submission | Report versions and transitions | The submitted content differs from the approved content | Report versions are immutable rows with a content hash over their canonical JSON; the stage is derived from append-only transitions; only the latest version of a kind may become READY or SUBMITTED; a version may become READY or SUBMITTED only if it carries the case's current decision to report; the simulated receipt records the content hash that was submitted | None within the application. |
| T10 | **CSRF / cross-origin requests** | Any state-changing endpoint | Actions performed with a victim's session | SameSite=Strict cookie; `Origin` must match the application origin; per-session synchroniser token in `X-CSRF-Token`, compared in constant time | None known. |
| T11 | **Session theft or fixation** | Session cookie, database | Account takeover | 32-byte random token, HttpOnly, SameSite=Strict, `__Host-` + Secure in production; the database stores only its SHA-256; absolute (8h) and idle (60 min) expiry; a new session on every sign-in | XSS would still be able to act within the page, which is why the CSP forbids inline script. |
| T12 | **Injection into reports and exports** (Trojan Source, CSV formulas, Markdown table forgery, HTML) | Any free text that reaches a report or export | A report that *reads* differently from what it says; code execution in a spreadsheet | Bidirectional, zero-width and control characters are **stripped** at the validation boundary and again in every exporter; CSV cells beginning `= + - @` are neutralised; Markdown text escapes pipes, emphasis and link syntax and leading block markers, writes `< > &` as entities and collapses newlines; HTML exports escape every value and carry their own restrictive CSP | Tested in `tests/lib/text.test.ts` and the API tests. |
| T13 | **Credential stuffing / brute force** | `POST /api/session/login` | Account takeover | 10 attempts per minute per client; scrypt password hashes; identical response and timing for unknown account and wrong password | The limiter is in-memory and per process. |
| T14 | **Information leakage through errors and logs** | Error responses, server logs | Internal detail disclosed; secrets in logs | Structured errors without stack traces; a request id for correlation; access logs record method, path, status, duration and user only, never bodies, cookies or query strings; ledger payloads carry identifiers and hashes, never evidence content | |
| T15 | **Demo controls in production** | `/api/demo/*`, personas | Data reset or persona sign-in on a real deployment | Every demo route returns 404 unless `DEMO_MODE=true`; the server warns at start-up when demo mode is on in production | Configuration error remains possible; the start-up warning is the only guard. |
| T16 | **Rule-engine drift**: a wrong deadline that nobody notices | Engine code, rule set | Systematically wrong deadlines | Durations are data in a versioned rule set; every decision stores the rule-set version and its full trace; known-answer self-tests run behind the system-status panel, which reports *degraded* if any vector fails; 170 automated tests, including a dedicated correctness review and security review | An error in the *interpretation* of the regulation is not caught by tests. That is what counsel review is for. |
| T17 | **A decision not to report taking effect unreviewed**, or outliving the facts it rested on | `POST /cases/:id/decisions`, case close | An analyst silences a running 24-hour clock and its escalations on their own word; or exploitation confirmed later is never reported | A decision not to report is **in force** only once its decision record is approved by Compliance or Legal, and only while no awareness has been recorded or corrected after it. Until then every clock keeps running and the case cannot be closed; an overtaken decision raises a blocking data-quality error. A deadline already met stays COMPLETED | Approval by a reviewer who colludes with the analyst. The ledger records both identities. |

## Out of scope

- Host and network security of the machine running NEXUS.
- A malicious administrator with shell access (they can do anything; the ledger and anchors make
  it visible after the fact).
- Denial of service beyond simple rate and size limits.
- The security of the (simulated) submission channel.

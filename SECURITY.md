# Security

NEXUS is a portfolio project that treats itself as a security-sensitive application. The
controls, the threats they answer and their limits are documented in
[docs/threat-model.md](docs/threat-model.md).

## Reporting a vulnerability in NEXUS

Please open a private security advisory on the repository rather than a public issue. Include the
affected version (commit), the endpoint or file, and a minimal reproduction. This is a personal
project maintained on a best-effort basis; there is no bug bounty.

## Deployment notes

- Run with `DEMO_MODE=false` anywhere real data is stored. Demo mode enables persona sign-in, the
  scenario simulator, the ledger tamper simulation and the data reset endpoint.
- Serve over HTTPS behind a reverse proxy. In production mode the session cookie is `__Host-` and
  `Secure`, and HSTS is sent.
- Set `APP_ORIGIN` to the exact origin users load the app from; state-changing requests from any
  other origin are refused.
- The rate limiter is in-memory and per process. Put a shared limiter at the proxy for more than one
  instance.
- Back up `storage/` (database and evidence store) together, and export a ledger anchor on a schedule
  to somewhere NEXUS cannot write.
- No secrets are shipped to the browser, and none are required to run the demo. There are no default
  credentials: demo accounts have no password unless `DEMO_PASSWORD` is set when the database is
  first seeded.

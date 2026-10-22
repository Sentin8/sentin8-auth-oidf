# sentin8-auth-oidf

Automated OIDF conformance runs for Sentin8:Auth. Where `sentin8-e2e`
tests the platform's own surfaces, this repo drives the
**OpenID Foundation certification suite** (the local rig at
`https://localhost.emobix.co.uk:8443`) through every profile plan the
platform certifies for - unattended, reproducible, and enforcing the
auth DESIGN §9a.10/§9a.11 campaign rules:

- **No-skip** — a SKIPPED (or FAILED/INTERRUPTED) module fails the run
  (a skip means discovery advertised a capability away).
- **Warning-zero** — a WARNING in a module's log fails the run (every
  warning is a real gap with a root fix, not a note).

## How it drives the suite

The suite's front channel (login) is executed by the running-test page's
client-side automation: when a test goes WAITING it exposes a URL, and
the page runs the plan's `browser` config block against it. This harness
runs the same loop in OUR browser - and the login task drives the
**original Flutter auth-ui** (`/sign-in` + the `sentin8TestSignIn` test
bridge), not the temporary HTML login page (`/oauth/login`).

```
┌─────────────┐  POST /api/plan         ┌──────────────────┐
│ Harness     │ ──────────────────────► │ OIDF suite       │
│ (playwright)│  POST /api/runner       │ (5.3.3, :8443)   │
│             │ ◄────────────────────── │                  │
│             │  exposed authorize URL  │                  │
│     page ◄──┼── goto authorize URL ───┼──► Sentin8:Auth  │
│  automation │  (browser block)        │  Flutter auth-ui │
└─────────────┘                         └──────────────────┘
```

## Layout

| Path | Role |
|---|---|
| `fixtures/env.ts` | Tree-root `.env` loader (SENTIN8_DOMAIN-derived URLs, no hardcoding) |
| `fixtures/suite.ts` | Suite REST client (plan create / runner create / logs) + the standard browser block |
| `fixtures/runner.ts` | Run-one-module loop: WAITING polling → browser task execution → terminal wait → log classification |
| `tests/oidc-basic.spec.ts` | OIDC Core Basic OP (35 modules) — the reference profile suite |
| `tests/fapi2-security.spec.ts` | FAPI 2 Security Profile (PAR + DPoP + JARM) |
| `tests/fapi2-message-signing.spec.ts` | FAPI 2 Message Signing (HTTP signatures + signed introspection) |
| `tests/fapi1-advanced.spec.ts` | FAPI 1 Advanced (mTLS + JAR + PAR) |
| `tests/ciba.spec.ts` | FAPI-CIBA poll + ping |
| `tests/logout.spec.ts` | RP-Initiated + Back-Channel Logout |
| `results/` | Per-module logs + the campaign results JSON (gitignored) |

## Prerequisites (one-time)

```bash
# tree root (sentin8/)
make start               # classical mode for rig runs (SENTIN8_TLS_PQ_MODE)
make conformance-up      # suite stack (mongo + server + nginx)
make conformance-seed    # cert tenant: org/env/user/clients (no SQL)
cd sentin8-auth-oidf
../../pnpm install && pnpm run install-browsers
```

## Running a campaign

```bash
make oidc-basic          # the Basic OP plan (35 modules)
make fapi2 && make fapi1 && make ciba
```

The seeded client credentials are read from
`.tmp/conformance/seed-out.txt` (the seed script's output) or passed via
`OIDF_BASIC_CLIENT_ID` / `OIDF_BASIC_CLIENT_SECRET` /
`OIDF_POST_CLIENT_ID` / `OIDF_POST_CLIENT_SECRET`.

## Results

Every module's full log lands in `results/logs/<module>.json`; the
campaign summary rides the Playwright JSON reporter
(`results/oidf-results.json`). Import these into
`.tmp/conformance/results/` per the auth runbook (§9a.5 step 6).
# sentin8-auth-oidf
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](../../LICENSE)
[![Built with TypeScript](https://img.shields.io/badge/Built%20with-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![Docs](https://img.shields.io/badge/docs/read-3aa757.svg)](https://sentin8.dev/docs/services/auth-oidf)
[![Website](https://img.shields.io/badge/website-sentin8.dev-1a73e8.svg)](https://sentin8.dev)

Automated OIDF conformance runs for Sentin8:Auth. Where `sentin8-e2e`
tests the platform's own surfaces, this repo drives the
**OpenID Foundation certification suite** (the local rig at
`https://localhost.emobix.co.uk:8443`) through every profile plan the
platform certifies for - unattended, reproducible, and enforcing the
auth DESIGN §9a.10/§9a.11 campaign rules:

- **No-skip** - a SKIPPED (or FAILED/INTERRUPTED) module fails the run
  (a skip means discovery advertised a capability away).
- **Warning-zero** - a WARNING in a module's log fails the run (every
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
| `tests/oidc-basic.spec.ts` | OIDC Core Basic OP (35 modules) - the reference profile suite |
| `tests/oidc-config.spec.ts` | OIDC Core Config OP - discovery completeness (the same static seeded clients as Basic) |
| `tests/oidc-dynamic.spec.ts` | OIDC Core Dynamic OP - RFC 7591 DCR + WebFinger (the suite registers its own clients) |
| `tests/fapi2-security.spec.ts` | FAPI 2 Security Profile (PAR + DPoP + JARM) |
| `tests/fapi2-message-signing.spec.ts` | FAPI 2 Message Signing (HTTP signatures + signed introspection) |
| `tests/fapi1-advanced.spec.ts` | FAPI 1 Advanced (mTLS + JAR + PAR) |
| `tests/ciba.spec.ts` | FAPI-CIBA poll + ping |
| `tests/logout.spec.ts` | RP-Initiated + Back-Channel Logout |
| `tests/oid4vci-issuer.spec.ts` | OID4VCI 1.0 Final Issuer - credential endpoint family (private_key_jwt + DPoP, SD-JWT VC; the suite acts as the wallet) |
| `tests/oid4vci-wallet.spec.ts` | OID4VCI 1.0 Final Wallet - credential-offer front channel + authorization-code grant (the suite acts as the wallet against our issuer) |
| `tests/oid4vci-haip.spec.ts` | OID4VCI 1.0 Issuer HAIP - client-attestation auth (`OAuth-Client-Attestation` + `OAuth-Client-Attestation-PoP`) |
| `tests/smoke.spec.ts` | Harness boot check - one module end-to-end through the Flutter auth-ui (not a certification campaign) |
| `results/` | Per-module logs + the campaign results JSON (gitignored) |

## Prerequisites (one-time)

```bash
# tree root (sentin8/) - the rig posture ships from the target itself
# (classical TLS + FAPI ciphers + self-signed client certs; no .env edit)
make start-conformance   # platform fleet in the rig posture
make conformance-up      # suite stack (mongo + server + nginx)
make conformance-seed    # cert tenant: org/env/user/clients (no SQL)
cd sentin8-auth-oidf
../../pnpm install && pnpm run install-browsers
```

## Running a campaign

```bash
make oidc-basic          # the Basic OP plan (35 modules)
make oidc-config         # the Config OP plan (discovery completeness)
make oidc-dynamic        # the Dynamic OP plan (DCR + WebFinger)
make oid4vci-issuer      # the VCI Issuer plan (SD-JWT VC)
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
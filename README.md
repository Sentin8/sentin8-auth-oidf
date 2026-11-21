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
- **Honest evidence** - every screenshot the harness uploads to an
  OIDF upload-placeholder shows a real surface (a page with none gets
  the rendered wallet/error shell, never a blank canvas), skip-class
  log lines fire once per module (repeats flush as `(xN)` counts at
  the terminal check), and a missing harness wire is a hard battery
  violation, not an info (auth DESIGN §9a.2, the rig's honesty
  contract; SKIPFIX-1).

## Certification tests

Certification campaign specs (one per profile plan):

- OIDC Core Basic OP
- OIDC Core Config OP
- OIDC Core Dynamic OP
- OIDC Core Implicit OP
- OIDC Core Hybrid OP
- Form Post OP (the 3-plan form_post profile)
- Session Management + 3rd-Party-Initiated Login + Back-Channel OP
- FAPI 2 Security Profile
- FAPI 2 Message Signing
- FAPI 1 Advanced
- FAPI-CIBA poll + ping
- RP-Initiated + Back-Channel Logout
- OID4VCI 1.0 Final Issuer
- OID4VCI 1.0 Final Wallet
- OID4VCI 1.0 Issuer HAIP
- OID4VP Verifier (HAIP + plain)

Non-campaign spec:

- Smoke (harness boot check)

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

Runner contract (the duplicate-slice rule): a plan may list the SAME
`testModule` more than once under different variant slices (the HAIP
plan's `vci_credential_encryption=plain` + `=encrypted` entries) - the
runner create passes EACH plan entry's OWN `modules[].variant` dict to
`POST /api/runner?variant=<json>` (empty body). A name-keyed variant
map collapses the duplicates to the last entry's slice and the sibling
stays PENDING at the plan gate.

## Layout

| Path | Role |
|---|---|
| `fixtures/env.ts` | Tree-root `.env` loader (SENTIN8_DOMAIN-derived URLs, no hardcoding) |
| `fixtures/suite.ts` | Suite REST client (plan create / runner create / logs) + the standard browser block |
| `fixtures/runner.ts` | Run-one-module loop: WAITING polling → browser task execution → terminal wait → log classification |
| `tests/oidc-basic.spec.ts` | OIDC Core Basic OP (35 modules) - the reference profile suite |
| `tests/oidc-config.spec.ts` | OIDC Core Config OP - discovery completeness (the same static seeded clients as Basic) |
| `tests/oidc-dynamic.spec.ts` | OIDC Core Dynamic OP - RFC 7591 DCR + WebFinger (the suite registers its own clients) |
| `tests/implicit.spec.ts` | OIDC Core Implicit OP - the 2 pinned fragment cells (id_token / id_token token) over cert-imp |
| `tests/hybrid.spec.ts` | OIDC Core Hybrid OP - the 3 pinned fragment cells (code id_token / code token / code id_token token) over cert-hyb |
| `tests/formpost.spec.ts` | Form Post OP - the formpost suite plans (basic + hybrid + implicit response modes) over cert-fp |
| `tests/sessionmgmt.spec.ts` | Session Management + 3rd-Party-Initiated Login + Back-Channel OP trio over cert-sm (the BC module DCRs its own bc-registered client) |
| `tests/fapi2-security.spec.ts` | FAPI 2 Security Profile (PAR + DPoP + JARM) |
| `tests/fapi2-message-signing.spec.ts` | FAPI 2 Message Signing (HTTP signatures + signed introspection) |
| `tests/fapi1-advanced.spec.ts` | FAPI 1 Advanced (mTLS + JAR + PAR) |
| `tests/ciba.spec.ts` | FAPI-CIBA poll + ping |
| `tests/logout.spec.ts` | RP-Initiated + Back-Channel Logout |
| `tests/oid4vci-issuer.spec.ts` | OID4VCI 1.0 Final Issuer - credential endpoint family (private_key_jwt + DPoP, SD-JWT VC; the suite acts as the wallet) |
| `tests/oid4vci-wallet.spec.ts` | OID4VCI 1.0 Final Wallet - credential-offer front channel + authorization-code grant (the suite acts as the wallet against our issuer) |
| `tests/oid4vci-haip.spec.ts` | OID4VCI 1.0 Issuer HAIP - client-attestation auth (`OAuth-Client-Attestation` + `OAuth-Client-Attestation-PoP`) |
| `tests/oid4vp.spec.ts` | OID4VP verifier - the HAIP verifier plan + the plain plan over cert-vp |
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
make implicit           # the Implicit OP plan (2 pinned fragment cells)
make hybrid             # the Hybrid OP plan (3 pinned fragment cells)
make formpost           # the Form Post OP profile (3 plans over cert-fp)
make sessionmgmt        # the Session/3rd-Party/Back-Channel OP trio
make oid4vp             # the OID4VP verifier plans
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

## Suite targets (rig vs hosted, DESIGN 9a.2d)

| Var | Meaning |
|---|---|
| `CONFORMANCE_SUITE_TARGET` | `rig` (default - the local Docker stack at localhost.emobix:8443) or `hosted` (https://www.certification.openid.net) |
| `CONFORMANCE_SUITE_URL` | An explicit suite base (e.g. `https://staging.certification.openid.net`); wins over the target switch |
| `CONFORMANCE_SUITE_TOKEN` | The hosted suite's API bearer token (export wins over `.tmp/conformance/suite-token.env`); absent = the rig's devmode JSESSIONID strategy |
| `CONFORMANCE_SUITE_TOKEN_PERMANENT` | `true` mints a permanent token in the bootstrap (default: temporary, 24h TTL) |

The hosted bootstrap (the ONE interactive step - sign in in the opening
browser window):

```bash
make -C .. conformance-hosted-bootstrap     # group Makefile wrapper
# or: pnpm exec playwright test tests/suite-token-bootstrap.spec.ts
```

## The Category-B skip closures (CLAIMS-B)

Source: `missing-claims.md` - the rig-side harness/registration
material the suite reads from the plan config's client block that the
specs did not pass. The seed already mints most of it (the seed-out
lines); the specs just never consume it.

| # | Missing element | Items | What the spec does |
|---|---|---|---|
| B1 | `client verifier_info` | 544 | The oid4vp-wallet spec's client block passes `verifier_info` (the verifier's human identity the suite injects into the built authorization request - `AddVerifierInfoToAuthorizationEndpointRequest`, OID4VP-1FINAL-5.1). Sourced from the seed-out's `verifier_info(verifier)` line (the seed emits it; auth §9a.30.7's platform shape). |
| B2 | `client jwks` | 450 | The oidc-dynamic spec DCRs its own clients (private_key_jwt per the plan bytecode) - the SUITE generates the keypair itself and the static-client blocks of the plain OIDC families carry no jwks by registration shape. The closure: the spec's `client_registration_static` block gains the seed-minted `jwks` where the plan admits a static registration, so the structural conditions (`RFC7517-1.1/4.5`) run instead of skipping. Where the plan hard-codes dynamic DCR, the skip is the plan's own shape and remains. |
| B3 | `client rical` | 790 | The oid4vp-wallet spec's client block gains the seed-minted `rical_b64(rical)` line (the VERIFIER spec already consumes it; the WALLET spec never did) - `RegisterRical` arms `ValidateRequestObjectX5cChainAgainstRical` for the mDL cells. The single-anchor fallback (`request_object_trust_anchor_pem`) stays for campaigns without a RICAL. |
| B4 | `vical` + `mdoc_revocation_*` | 572 | The mdoc issuer-chain/revocation pipeline needs the config to point at the suite-hosted VICAL/revocation endpoints - the plan config gains them only where the SUITE hosts them for the profile under test (an inventory of the mock-issuer's hosted surfaces per campaign; the seed emits `vical_url(vciatt)` when the family's alias hosts one). |
| B5 | `incoming_request headers x-fapi-*` | 96 | The holder's FAPI-style request headers (auth-date / customer-ip / interaction-id / DPoP) on the calls to the SUITE's mock issuer. The rig's holder path (wallet8-holder intake) carries them where the plan's holder-side module family can validate them; the variant-conditional rows (B5 in the inventory) stay per the holder's posture. |

The emitted seed-out lines ride the same `key=value` convention the
specs already parse (`rical_b64(rical)=...`, `verifier_info(json)=...`,
`vical_url(vciatt)=...`); adding a line is a seed change, consuming it
a spec change - both land together so a spec never reads a line the
seed of the same tree does not write.
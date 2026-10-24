// SPDX-FileCopyrightText: Copyright Logically Magic Inc. <hello@logicallymagic.com>
// SPDX-FileCopyrightText: Copyright Hamid Jahanzad <Hamid@Jahanzad.com>
// SPDX-License-Identifier: Apache-2.0

// tests/oid4vci-haip.spec.ts - OID4VCI 1.0 Issuer HAIP plan
// (oid4vci-1_0-issuer-haip, the client_attestation cell).
//
// The HAIP issuer plan runs the SAME issuer surface as
// oid4vci-issuer.spec.ts with client_attestation-based client
// authentication: the token-endpoint request carries
// `OAuth-Client-Attestation` (typ oauth-client-attestation+jwt, signed
// by the rig's attester key with its x5c chain) +
// `OAuth-Client-Attestation-PoP` (typ oauth-client-attestation-pop+jwt,
// signed by the client's instance key). auth side: DESIGN §9a.19.
//
// Variant axes (suite 5.3.3, VCIIssuerTestPlanHaip): client_auth_type=
// client_attestation x fapi_profile=vci_haip x sender_constrain=dpop x
// fapi_request_method=unsigned. The cert env's security profile must be
// `vci_haip` (the seed's vci_haip case sets allow_client_attestation +
// the trust-anchor PEM + the expected attestation iss).
//
// Campaign rule (auth DESIGN §9a.10/§9a.11): every module terminal, no
// FAILED/SKIPPED/INTERRUPTED, zero warnings.

import { test, expect } from '@playwright/test';
import { SuiteApi, ACCEPTABLE, standardBrowserAutomation, type SuiteTestConfig } from '../fixtures/suite.js';
import { runModule, planResults } from '../fixtures/runner.js';
import { certDiscoveryUrl, certAuthHost, CONFORMANCE_ALIAS, resultsDir, CERT_USER } from '../fixtures/env.js';
import { logStep, stepLog } from '../fixtures/log.js';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { suiteCallback } from '../fixtures/env.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VciClient = any;

const ATTESTATION_ISSUER = 'https://vci-attester.conformance-local';

function seededHaipClients(): { client: VciClient; client2: VciClient; attesterJwks: unknown; anchorPem: string } {
  const seedOut = process.env.OIDF_SEED_OUT
    ?? join(resultsDir(), '..', '..', '..', '.tmp', 'conformance', 'seed-out.txt');
  const fallback = (id: string): VciClient => ({
    client_id: id,
    token_endpoint_auth_method: 'private_key_jwt',
    scope: 'openid profile email offline_access credential:VerifiedPersonCredential credential:VerifiedEmployeeCredential',
    redirect_uri: suiteCallback(),
    hint_type: 'login_hint',
    hint_value: CERT_USER.email,
  });
  if (!existsSync(seedOut)) {
    return { client: fallback(''), client2: fallback(''), attesterJwks: null, anchorPem: '' };
  }
  const text = readFileSync(seedOut, 'utf8');
  // The attester PRIVATE jwks (with `d`) signs BOTH the key-attestation
  // (credential proof) and the CLIENT attestation (OAuth-Client-
  // Attestation header); the x5c chain rides the JWS header and the
  // OP-side trust anchor (the profile's client_attestation_trust_
  // anchor_pem) pins the same leaf.
  const attJwksLine = text.match(/private_jwks\(vciatt\)=(\{.*\})/)?.[1] ?? '';
  const anchorPem = text.match(/attester_pem\(vciatt\)=([\s\S]*?-----END CERTIFICATE-----)/)?.[1] ?? '';
  let attesterJwks: unknown = null;
  try {
    const parsed = attJwksLine ? JSON.parse(attJwksLine) : null;
    attesterJwks = parsed ? { keys: [parsed] } : null;
  } catch {
    attesterJwks = null;
  }
  const cid = text.match(/client_id\(vci\)=([a-f0-9]+)/)?.[1] ?? '';
  const cid2 = text.match(/client_id\(vci2\)=([a-f0-9]+)/)?.[1] ?? '';
  const jwksLine = text.match(/private_jwks\(vci\)=(\{.*\})/)?.[1] ?? '';
  const jwks2Line = text.match(/private_jwks\(vci2\)=(\{.*\})/)?.[1] ?? '';
  const parse = (l: string) => {
    try {
      return l ? { keys: [JSON.parse(l)] } : null;
    } catch {
      return null;
    }
  };
  const mk = (id: string, keys: unknown): VciClient => ({
    client_id: id,
    token_endpoint_auth_method: 'private_key_jwt',
    scope: 'openid profile email offline_access credential:VerifiedPersonCredential credential:VerifiedEmployeeCredential',
    redirect_uri: suiteCallback(),
    hint_type: 'login_hint',
    hint_value: CERT_USER.email,
    ...(keys ? { jwks: keys } : {}),
  });
  return {
    client: mk(cid, parse(jwksLine)),
    client2: mk(cid2 || cid, parse(jwks2Line) ?? parse(jwksLine)),
    attesterJwks,
    anchorPem: anchorPem.trim(),
  };
}

let suiteApi: SuiteApi;
let planId: string;
const seeded = seededHaipClients();
const config: SuiteTestConfig = {
  alias: CONFORMANCE_ALIAS,
  description: 'Sentin8 auth certification run - OID4VCI Issuer HAIP (attestation client auth, zero-warning)',
  server: { discoveryUrl: certDiscoveryUrl() },
  vci: {
    credential_issuer_url: certAuthHost(),
    credential_configuration_id: 'VerifiedPersonCredential',
    // Key-attestation JWKS (the credential-proof attestation family) -
    // nested dot-path + top-level private signer jwks, exactly as the
    // issuer cell wires them.
    key_attestation_jwks: seeded.attesterJwks ?? {},
    // CLIENT attestation (OAuth2-ATCA07): the attester's trust-domain
    // identifier (the profile's client_attestation_issuer must equal
    // this) and the attester PRIVATE jwks the suite signs
    // oauth-client-attestation+jwt with.
    client_attestation_issuer: ATTESTATION_ISSUER,
    client_attester_keys_jwks: seeded.attesterJwks ?? {},
    // The KEY-attestation trust anchor (EnsureKeyAttestationTrustAnchor
    // Configured) - the attester's self-signed leaf PEM, same anchor the
    // profile pins.
    key_attestation_trust_anchor_pem: seeded.anchorPem || '',
  },
  vci_key_attestation_jwks: seeded.attesterJwks ?? {},
  // HAIP trust anchors (EnsureCredentialTrustAnchorConfigured +
  // EnsureStatusListTrustAnchorConfigured read the TOP-LEVEL
  // 'credential' object): both the credential trust anchor and the
  // status-list trust anchor are the rig's attester leaf (the certificate
  // the issuer mints/under signs its key material with in this cell).
  credential: {
    trust_anchor_pem: seeded.anchorPem || '',
    status_list_trust_anchor_pem: seeded.anchorPem || '',
  },
  client: seeded.client,
  client2: seeded.client2,
} as SuiteTestConfig;

const harnessBrowserBlock = standardBrowserAutomation();

test.beforeAll(async () => {
  await SuiteApi.waitAuthReady();
  suiteApi = new SuiteApi();
  logStep(`creating plan: ${config.description}`);
});

test.afterAll(async () => {
  writeFileSync(join(resultsDir(), 'oid4vci-haip-steps.log'), stepLog());
  if (planId) writeFileSync(join(resultsDir(), 'oid4vci-haip-plan.txt'), planId);
});

test('OID4VCI Issuer HAIP - run every module-variant to terminal, zero-warning green', async ({ browser }) => {
  test.setTimeout(1_800_000);
  const onlyList = (process.env.OIDF_MODULES ?? '')
    .split(',').map((x) => x.trim()).filter(Boolean);
  const failures: string[] = [];

  const plan = await suiteApi.createPlan(
    'oid4vci-1_0-issuer-haip-test-plan',
    config,
    // The HAIP plan FIXES client_auth_type=client_attestation,
    // fapi_profile=vci_haip, sender_constrain=dpop and
    // fapi_request_method=unsigned per module (plan-set axes are
    // REJECTED on create with "Variant has been set by user, but test
    // plan already sets this variant"), leaving credential_format
    // USER-SELECTED (create without it 400s). Runner-created modules
    // resolve their OTHER variants server-side from the plan modules
    // (POST /api/runner with an EMPTY body - a JSON body answers 400).
    { credential_format: 'sd_jwt_vc' },
  );
  planId = plan.id;
  logStep(`plan ${planId}: ${plan.modules.length} module-variants`);
  {
    // Per-module variant resolution: the plan leaves SOME axes
    // user-selected per module (e.g. happy-flow needs sender_constrain
    // while metadata-test plan-locks it). GET /api/plan/<id>'s
    // modules[].variant carries the resolved values - pass each
    // module's dict to the runner create (query param, empty body).
    const moduleVariants = new Map<string, Record<string, string>>();
    for (const m of (await suiteApi.getPlan(planId)).modules) {
      moduleVariants.set(m.testModule, (m.variant ?? {}) as Record<string, string>);
    }
    for (const modEntry of (await suiteApi.getPlan(planId)).modules) {
      const m = modEntry;
      if (onlyList.length > 0 && !onlyList.includes(m.testModule)) {
        logStep(`SKIP-ONLY ${m.testModule}`);
        continue;
      }
      if (m.result) {
        logStep(`SKIP ${m.testModule} (already ${m.result})`);
        continue;
      }
      const run = await runModule(suiteApi, browser, planId, m.testModule,
        { ...config, browser: harnessBrowserBlock }, 600_000, moduleVariants.get(m.testModule));
      expect(run.status, `${m.testModule} must finish (not INTERRUPTED)`).toBe('FINISHED');
      expect(run.result, `${m.testModule} must not fail`).not.toMatch(/FAILED|SKIPPED|INTERRUPTED/);
      if (run.warnings.length > 0) {
        failures.push(`${m.testModule}: ${run.warnings.join(' | ')}`);
      }
      const out = join(resultsDir(), 'logs');
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, `oid4vci-haip-${m.testModule}.json`), JSON.stringify(run.log));
    }
  }
  expect(failures, `warning-zero violations:\n${failures.join('\n')}`).toEqual([]);
});

test('plan-level results are all acceptable', async () => {
  test.skip(!!(process.env.OIDF_MODULES ?? '').trim(), 'singles run - plan gate skipped');
  const results = await planResults(suiteApi, planId);
  const bad = [...results.entries()].filter(([, r]) => r && !ACCEPTABLE.has(r));
  expect(bad, 'FAILED/SKIPPED/INTERRUPTED modules').toEqual([]);
});
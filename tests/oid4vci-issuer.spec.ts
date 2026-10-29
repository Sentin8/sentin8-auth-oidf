// SPDX-FileCopyrightText: Copyright Logically Magic Inc. <hello@logicallymagic.com>
// SPDX-FileCopyrightText: Copyright Hamid Jahanzad <Hamid@Jahanzad.com>
// SPDX-License-Identifier: Apache-2.0

// tests/oid4vci-issuer.spec.ts - OID4VCI 1.0 Final Issuer plan (alpha).
//
// The VCI Issuer plan treats sentin8:auth as the credential ISSUER; the
// suite acts as the wallet. sentin8-side surface (auth DESIGN §9a.7):
// /.well-known/openid-credential-issuer (+ the RFC 8414 as-metadata
// alias), POST /oauth/credential, /oauth/deferred_credential,
// /oauth/notifications - over the SD-JWT/kb-JWT and status-list core.
//
// Plan anatomy (suite 5.3.3, VCIIssuerTestPlan): 14 module-variants under
// fapi_profile=vci x client_auth_type=private_key_jwt x
// sender_constrain=dpop x fapi_request_method=unsigned x
// credential_format=sd_jwt_vc; variant axes are plan-fixed, the config
// body carries `vci.credential_issuer_url` = the BARE issuer base (the
// suite appends /.well-known/openid-credential-issuer itself).
//
// Campaign rule (auth DESIGN §9a.10/§9a.11): every module terminal, no
// FAILED/SKIPPED/INTERRUPTED, zero warnings.

import { test, expect } from '@playwright/test';
import { SuiteApi, ACCEPTABLE, standardBrowserAutomation, type SuiteTestConfig, type SuiteClientConfig } from '../fixtures/suite.js';
import { runModule, planResults } from '../fixtures/runner.js';
import {certDiscoveryUrl, certAuthHost, suiteCallback, CONFORMANCE_ALIAS, resultsDir, seedOutPath, certUser } from '../fixtures/env.js';
import { logStep, stepLog } from '../fixtures/log.js';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The VCI happy-flow family runs client_registration=static_client - the
// seeded cert-vci clients (conformance-seed registers them with
// private_key_jwt + credential scopes + their own EC jwks and persists
// the PRIVATE jwks to seed-out; the suite signs the client assertions
// and credential proofs with the handed keys, our OP verifies against
// the registered public jwks - the CIBA seeding pattern).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VciClient = any;
function seededVciClients(): { client: VciClient; client2: VciClient; attesterJwks: unknown } {
  const seedOut = process.env.OIDF_SEED_OUT ?? seedOutPath();
  const fallback = (id: string): VciClient => ({
    client_id: id,
    token_endpoint_auth_method: 'private_key_jwt',
    scope: 'openid profile email offline_access credential:VerifiedPersonCredential credential:VerifiedEmployeeCredential',
    redirect_uri: suiteCallback(),
    hint_type: 'login_hint',
    hint_value: certUser().email,
  });
  if (!existsSync(seedOut)) {
    return { client: fallback(''), client2: fallback(''), attesterJwks: null };
  }
  const text = readFileSync(seedOut, 'utf8');
  // The suite SIGNS the key-attestation with the attester key - the
  // config form carries the PRIVATE jwks (with `d`); the OP-side check
  // verifies the signature against the same embedded header key, so the
  // public-only publication is not needed on the plan config.
  const attJwksLine = text.match(/private_jwks\(vciatt\)=(\{.*\})/)?.[1] ?? '';
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
    hint_value: certUser().email,
    ...(keys ? { jwks: keys } : {}),
  });
  return {
    client: mk(cid, parse(jwksLine)),
    client2: mk(cid2 || cid, parse(jwks2Line) ?? parse(jwksLine)),
    attesterJwks,
  };
}

let suiteApi: SuiteApi;
let planId: string;
const seeded = seededVciClients();
const config: SuiteTestConfig = {
  alias: CONFORMANCE_ALIAS,
 description: 'Sentin8 auth certification run - OID4VCI Issuer ( warning-zero)',
  server: { discoveryUrl: certDiscoveryUrl() },
  vci: {
    credential_issuer_url: certAuthHost(),
    credential_configuration_id: 'VerifiedPersonCredential',
    // The TRUSTED key-attestation JWKS lives NESTED under 'vci':
    // getElementFromObject('config', 'vci.key_attestation_jwks') walks
    // DOT SEGMENTS (Splitter.on('.')), so a flat dot-in-name key is
    // never read. The suite signs key-attestation+jwt with the
    // PRIVATE attester key and the OP verifies against the same
    // embedded header jwk, so the private form is correct here.
    key_attestation_jwks: seeded.attesterJwks ?? {},
  },
  // The attester PRIVATE jwks - the suite's signer (JWKSet.getKeys
  // needs the `d` member to sign key-attestation+jwt) reads the
  // TOP-LEVEL 'vci_key_attestation_jwks'.
  vci_key_attestation_jwks: seeded.attesterJwks ?? {},
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
  writeFileSync(join(resultsDir(), 'oid4vci-issuer-steps.log'), stepLog());
  if (planId) writeFileSync(join(resultsDir(), 'oid4vci-issuer-plan.txt'), planId);
});

test('OID4VCI Issuer - run every module-variant to terminal, zero-warning green', async ({ browser }) => {
  test.setTimeout(1_800_000);
  const onlyList = (process.env.OIDF_MODULES ?? '')
    .split(',').map((x) => x.trim()).filter(Boolean);
  const failures: string[] = [];

  const plan = await suiteApi.createPlan(
    'oid4vci-1_0-issuer-test-plan',
    config,
    {
      client_auth_type: 'private_key_jwt',
      fapi_profile: 'vci',
      sender_constrain: 'dpop',
      fapi_request_method: 'unsigned',
      credential_format: 'sd_jwt_vc',
    },
  );
  planId = plan.id;
  logStep(`plan ${planId}: ${plan.modules.length} module-variants`);
  {
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    for (const m of (await suiteApi.getPlan(planId)).modules) {
      if (onlyList.length > 0 && !onlyList.includes(m.testModule)) {
        logStep(`SKIP-ONLY ${m.testModule}`);
        continue;
      }
      if (m.result) {
        logStep(`SKIP ${m.testModule} (already ${m.result})`);
        continue;
      }
      const run = await runModule(suiteApi, browser, planId, m.testModule,
        { ...config, browser: harnessBrowserBlock });
      expect(run.status, `${m.testModule} must finish (not INTERRUPTED)`).toBe('FINISHED');
      expect(run.result, `${m.testModule} must not fail`).not.toMatch(/FAILED|SKIPPED|INTERRUPTED/);
      if (run.warnings.length > 0) {
        failures.push(`${m.testModule}: ${run.warnings.join(' | ')}`);
      }
      const out = join(resultsDir(), 'logs');
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, `oid4vci-issuer-${m.testModule}.json`), JSON.stringify(run.log));
    }
    await page.close();
  }
  expect(failures, `warning-zero violations:\n${failures.join('\n')}`).toEqual([]);
});

test('plan-level results are all acceptable', async () => {
  test.skip(!!(process.env.OIDF_MODULES ?? '').trim(), 'singles run - plan gate skipped');
  const results = await planResults(suiteApi, planId);
  const bad = [...results.entries()].filter(([, r]) => r && !ACCEPTABLE.has(r));
  expect(bad, 'FAILED/SKIPPED/INTERRUPTED modules').toEqual([]);
});
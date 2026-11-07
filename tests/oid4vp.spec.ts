// SPDX-FileCopyrightText: Copyright Logically Magic Inc. <hello@logicallymagic.com>
// SPDX-FileCopyrightText: Copyright Hamid Jahanzad <Hamid@Jahanzad.com>
// SPDX-License-Identifier: Apache-2.0

// tests/oid4vp.spec.ts - the OID4VP verifier family (auth DESIGN §9a.27).
// The certifiable HAIP plan (vp_profile=haip + client_id_prefix=x509_hash
// + request_method=request_uri_signed) + the plain verifier plan's
// discovery cell.
//
// The suite plays the WALLET: it fetches our signed request object
// (GET /oauth/vp/request/{id}), validates the x509_hash client_id +
// the x5c chain against the pinned trust anchor, mints the vp_token
// (sd-jwt + kb-jwt, suite-hosted status lists), and POSTs the (JWE)
// response to our response_uri. Our verifier answers the OIDC §8.2
// contract (`{"redirect_uri": ...}`).
//
// Campaign rule: every module terminal, no FAILED/SKIPPED/INTERRUPTED
// (§9a.10), zero WARNINGs (§9a.11).

import { test, expect, type Page } from '@playwright/test';
import { SuiteApi, ACCEPTABLE, standardBrowserAutomation, browserAutomationFor, type SuiteTestConfig } from '../fixtures/suite.js';
import { runModule, planResults } from '../fixtures/runner.js';
import { certDiscoveryUrl, certAuthHost, suiteCallback, CONFORMANCE_ALIAS, resultsDir, seedOutPath, certUser } from '../fixtures/env.js';
import { logStep, stepLog } from '../fixtures/log.js';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let suiteApi: SuiteApi;
let page: Page;
const planIds: string[] = [];

const config: SuiteTestConfig = {
  alias: CONFORMANCE_ALIAS,
  description: 'Sentin8 auth certification run - OID4VP verifier',
  server: { discoveryUrl: certDiscoveryUrl() },
};

// The verifier's request-object trust anchor + the wallet credential
// signing key ride the HAIP issuance chain the seed built (the same
// chain the status-list tokens carry). The suite needs:
//   client.request_object_trust_anchor_pem - the env's issuance CA
//   credential.signing_jwk                 - the wallet credential's key
//   credential.signing_jwk.kid + keys      - the sd-jwt mint key
function verifierConfigParts(): Record<string, unknown> {
  const seedOut = process.env.OIDF_SEED_OUT ?? seedOutPath();
  const authHost = certAuthHost();
  const parts: Record<string, unknown> = {};
  if (existsSync(seedOut)) {
    const text = readFileSync(seedOut, 'utf8');
    const leafPemB64 = text.match(/haip_issuer_leaf_der_b64\(haip\)=([A-Za-z0-9+/=]+)/)?.[1];
    const caPem = text.match(/haip_issuer_ca_pem\(haip\)=([\s\S]*?-----END CERTIFICATE-----)/)?.[1];
    if (leafPemB64 && caPem) {
      // The issuance leaf DER (b64) -> PEM for the trust-anchor pin.
      const derPem = `-----BEGIN CERTIFICATE-----${leafPemB64.replace(/(.{64})/g, '$1\n')}-----END CERTIFICATE-----`;
      parts.request_object_trust_anchor_pem = caPem;
      parts.issuance_leaf_pem = derPem;
    }
    const attXy = text.match(/haip_issuer_xy\(haip\)=([\w-]+) ([\w-]+) ([\w-]+)/);
    if (attXy) {
      parts.credential_signing_jwk = {
        kty: 'EC', kid: attXy[1], crv: 'P-256', alg: 'ES256',
        x: attXy[2], y: attXy[3],
      };
    }
  }
  // The verifier drives OUR authorize (the wallet lands on the suite's
  // authorize stand-in? No: the suite CONFIGURES the verifier's
  // authorization endpoint = OUR wallet-authorize's deep link builder).
  parts.verifier_authorization_endpoint = `${authHost}/oauth/authorize`;
  return parts;
}

const harnessBrowserBlock = standardBrowserAutomation();

test.beforeAll(async ({ browser }) => {
  await SuiteApi.waitAuthReady();
  suiteApi = new SuiteApi();
  logStep('creating plans: oid4vp (verifier-haip + plain discovery)');
  const extra = verifierConfigParts();
  const haipVariant = {
    client_id_prefix: 'x509_hash',
    request_method: 'request_uri_signed',
  };
  const haipPlan = await suiteApi.createPlan(
    'oid4vp-1final-verifier-haip-test-plan',
    { ...config, ...extra } as SuiteTestConfig,
    haipVariant,
  );
  planIds.push(haipPlan.id);
  logStep(`haip plan ${haipPlan.id}: ${haipPlan.modules.length} modules`);
  const plainPlan = await suiteApi.createPlan(
    'oid4vp-1final-verifier-test-plan',
    { ...config, ...extra } as SuiteTestConfig,
    { vp_profile: 'plain_vp' },
  );
  planIds.push(plainPlan.id);
  logStep(`plain plan ${plainPlan.id}: ${plainPlan.modules.length} modules`);
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  page = await ctx.newPage();
});

test.afterAll(async () => {
  writeFileSync(join(resultsDir(), 'oid4vp-steps.log'), stepLog());
  if (planIds.length > 0) writeFileSync(join(resultsDir(), 'oid4vp-plans.txt'), planIds.join('\n'));
});

test('OID4VP verifier - run every module to terminal', async ({ browser }) => {
  test.setTimeout(3_600_000);
  const onlyList = (process.env.OIDF_MODULES ?? '')
    .split(',').map((x) => x.trim()).filter(Boolean);
  const failures: string[] = [];
  for (const cellPlanId of planIds) {
    for (const m of (await suiteApi.getPlan(cellPlanId)).modules) {
      if (onlyList.length > 0 && !onlyList.includes(m.testModule)) {
        logStep(`SKIP-ONLY ${m.testModule}`);
        continue;
      }
      if (m.result) {
        logStep(`SKIP ${m.testModule} (already ${m.result})`);
        continue;
      }
      const run = await runModule(suiteApi, browser, cellPlanId, m.testModule,
        { ...config, browser: browserAutomationFor(m.testModule) },
        600_000,
        // The plan's pinned axes ride the runner create (the module
        // instance's cell axis - without it the create 500s "Missing
        // value for required variant parameter").
        (m.variant ?? undefined) as Record<string, string> | undefined);
      expect(run.status, `${m.testModule} must finish (not INTERRUPTED)`).toBe('FINISHED');
      expect(run.result, `${m.testModule} must not fail`).not.toMatch(/FAILED|SKIPPED|INTERRUPTED/);
      if (run.warnings.length > 0) {
        failures.push(`${m.testModule}: ${run.warnings.join(' | ')}`);
      }
      const out = join(resultsDir(), 'logs');
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, `oid4vp-${m.testModule}.json`), JSON.stringify(run.log));
    }
  }
  expect(failures, `warning-zero violations:\n${failures.join('\n')}`).toEqual([]);
});

test('plan-level results are all acceptable', async () => {
  test.skip(!!(process.env.OIDF_MODULES ?? '').trim(), 'singles run - plan gate skipped');
  const failures: string[] = [];
  for (const cellPlanId of planIds) {
    const results = await planResults(suiteApi, cellPlanId);
    const bad = [...results.entries()].filter(([, r]) => r && !ACCEPTABLE.has(r));
    failures.push(...bad.map(([m, r]) => `${m}: ${r}`));
  }
  expect(failures, `plan results failed:\n${failures.join('\n')}`).toEqual([]);
});

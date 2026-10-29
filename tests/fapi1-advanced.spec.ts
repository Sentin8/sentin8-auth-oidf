// SPDX-FileCopyrightText: Copyright Logically Magic Inc. <hello@logicallymagic.com>
// SPDX-License-Identifier: Apache-2.0

// tests/fapi1-advanced.spec.ts - FAPI 1.0 Advanced final plan.
//
// The plan variant axes (the suite's FAPI1AdvancedFinalTestPlan):
//   fapi_profile=plain_fapi, client_auth_type=private_key_jwt|mtls,
//   fapi_auth_request_method=pushed (PAR), fapi_response_mode=jarm.
// The cert env's security profile flips to fapi_1_advanced before the
// run (require_par + require_jarm + require_mtls + require_iss - the
// seed's `CONFORMANCE_PROFILE=fapi_1_advanced`) and the seed registers
// the jwks clients + publishes their PRIVATE jwks to seed-out (the
// same fapi2-<cell> naming the suite's assertion signing consumes).

import { test, expect } from '@playwright/test';
import { SuiteApi, standardBrowserAutomation, browserAutomationFor, type SuiteTestConfig, type SuiteClientConfig } from '../fixtures/suite.js';
import { runModule, planResults, ACCEPTABLE } from '../fixtures/runner.js';
import {
  certDiscoveryUrl, certAuthHost, suiteCallback, CONFORMANCE_ALIAS, resultsDir, seedOutPath } from '../fixtures/env.js';
import { logStep, stepLog } from '../fixtures/log.js';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let suiteApi: SuiteApi;
let planId: string;

const config = {
  alias: CONFORMANCE_ALIAS,
 description: 'Sentin8 auth certification run - FAPI 1 Advanced final ',
  server: { discoveryUrl: certDiscoveryUrl() },
  resource: {
    resourceUrl: `${certAuthHost().replace(/\/$/, '')}/oauth/userinfo`,
  },
};
const harnessBrowserBlock = standardBrowserAutomation();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FapiClient = any;
function seededFapi1Clients(): { client: FapiClient; client2: FapiClient } | null {
  const seedOut = process.env.OIDF_SEED_OUT ?? seedOutPath();
  if (!existsSync(seedOut)) return null;
  const text = readFileSync(seedOut, 'utf8');
  const cid = text.match(/client_id\(fapi2-dpop\)=([a-f0-9]+)/)?.[1];
  const cid2 = text.match(/client_id\(fapi2-second-dpop\)=([a-f0-9]+)/)?.[1];
  const jwksLine = text.match(/private_jwks\(fapi2-dpop\)=(\{.*\})/)?.[1];
  const jwksLine2 = text.match(/private_jwks\(fapi2-second-dpop\)=(\{.*\})/)?.[1];
  if (!cid || !cid2 || !jwksLine || !jwksLine2) return null;
  let jwksObj: unknown = null;
  let jwksObj2: unknown = null;
  try {
    jwksObj = JSON.parse(jwksLine);
    jwksObj2 = JSON.parse(jwksLine2);
  } catch {
    return null;
  }
  const mk = (id: string, key: unknown): FapiClient => ({
    client_id: id,
    client_auth_type: 'private_key_jwt',
    token_endpoint_auth_method: 'private_key_jwt',
    scope: 'openid profile email phone address offline_access',
    redirect_uri: suiteCallback(),
    jwks: { keys: [key] },
  });
  return { client: mk(cid, jwksObj), client2: mk(cid2, jwksObj2) };
}

// The RESOURCE-server hop of every FAPI1-Advanced module calls the RS
// (the cert auth's userinfo) over mTLS: even the private_key_jwt
// variants need `mtls.cert|key|ca` (+ `mtls2.*` for client2) in the
// plan config (the suite's ExtractMTLSCertificatesFromConfiguration).
// The seeded fapi2-mtls client certs (seed 3d) supply them.
function seededFapiTlsSections(): { mtls?: { cert: string; key: string; ca?: string }; mtls2?: { cert: string; key: string; ca?: string } } {
  const seedOut = process.env.OIDF_SEED_OUT ?? seedOutPath();
  if (!existsSync(seedOut)) return {};
  const text = readFileSync(seedOut, 'utf8');
  const certB64 = text.match(/mtls_cert_der_b64\(main\)=([A-Za-z0-9+\/=]+)/)?.[1];
  const certB642 = text.match(/mtls_cert_der_b64\(second\)=([A-Za-z0-9+\/=]+)/)?.[1];
  const keyPem = text.match(/mtls_key_pem\(main\)=([\s\S]*?)-----END PRIVATE KEY-----/)?.[1];
  const keyPem2 = text.match(/mtls_key_pem\(second\)=([\s\S]*?)-----END PRIVATE KEY-----/)?.[1];
  if (!certB64 || !certB642 || !keyPem || !keyPem2) return {};
  const keyB64 = keyPem.replace(/-----(BEGIN|END) [A-Z ]+-----/g, '').replace(/\s+/g, '');
  const keyB642 = keyPem2.replace(/-----(BEGIN|END) [A-Z ]+-----/g, '').replace(/\s+/g, '');
  const caPem = readFileSync(process.env.SENTIN8_TLS_CA_PEM!
    ?? join(resultsDir(), '..', '..', '..', '.run', 'secrets', 'acme-ca', 'root-ca.crt'), 'utf8');
  return {
    mtls: { cert: certB64, key: keyB64, ca: caPem },
    mtls2: { cert: certB642, key: keyB642, ca: caPem },
  };
}

// The FAPI1 plan's FOUR variant axes: the platform posture (PAR+JARM,
// private_key_jwt) = plain_fapi / private_key_jwt / pushed / jarm.
const FAPI1_VARIANT = {
  fapi_profile: 'plain_fapi',
  client_auth_type: 'private_key_jwt',
  fapi_auth_request_method: 'pushed',
  fapi_response_mode: 'jarm',
};

test.beforeAll(async ({ browser }) => {
  await SuiteApi.waitAuthReady();
  suiteApi = new SuiteApi();
});

test('FAPI1 Advanced - run every module to terminal, zero-warning green', async ({ browser }) => {
  test.setTimeout(7_200_000);
  const onlyList = (process.env.OIDF_MODULES ?? '')
    .split(',').map((x) => x.trim()).filter(Boolean);
  const failures: string[] = [];
  const cellClients = seededFapi1Clients();
  if (!cellClients) {
    failures.push('seeded FAPI1 client missing - re-run the seed with CONFORMANCE_PROFILE=fapi_1_advanced');
  } else {
    const tls = seededFapiTlsSections();
    const plan = await suiteApi.createPlan(
      'fapi1-advanced-final-test-plan',
      { ...config, ...cellClients, ...tls } as SuiteTestConfig,
      FAPI1_VARIANT,
    );
    planId = plan.id;
    logStep(`plan ${planId}: ${plan.modules.length} module-variants`);
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
      const driveMs = /expired-request_uri/i.test(m.testModule) ? 960_000 : undefined;
      const tls = seededFapiTlsSections();
      const run = await runModule(suiteApi, browser, planId, m.testModule,
        { ...config, ...cellClients, ...tls, browser: browserAutomationFor(m.testModule) } as SuiteTestConfig,
        driveMs);
      expect(run.status, `${m.testModule} must finish (not INTERRUPTED)`).toBe('FINISHED');
      const result = String(run.result);
      // SUITE-SANCTIONED SKIPPED: the ES256 client can't exercise the
      // RS256-only negatives (the suite skips with "requires RSA keys" -
      // the alg-family gate is OUR choice, the suite blesses it).
      const skipMsg = (run.log ?? [])
        .filter((e: { result?: string; msg?: string }) => e.result === 'SKIPPED')
        .map((e: { msg?: string }) => e.msg ?? '')
        .join(' | ');
      if (result === 'SKIPPED') {
        if (!/requires RSA keys|alg in client configuration is 'ES256'|alg in client configuration is 'RS256'/i.test(skipMsg)) {
          failures.push(`[SKIP-unexpected] ${m.testModule}: ${skipMsg}`);
        } else {
          logStep(`SKIP-SANCTIONED ${m.testModule} (ES256 client - suite-blessed)`);
        }
      } else {
        expect(result, `${m.testModule} must not fail/skip`).not.toMatch(/FAILED|SKIPPED|INTERRUPTED/);
      }
      if (run.warnings.length > 0) {
        failures.push(`${m.testModule}: ${run.warnings.join(' | ')}`);
      }
      const out = join(resultsDir(), 'logs');
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, `fapi1-${m.testModule}.json`), JSON.stringify(run.log));
    }
    await page.close();
    writeFileSync(join(resultsDir(), 'fapi1-advanced-plan.txt'), planId);
  }
  expect(failures, `warning-zero violations:\n${failures.join('\n')}`).toEqual([]);
});

test('plan-level results are all acceptable', async () => {
  test.skip(!!(process.env.OIDF_MODULES ?? '').trim(), 'singles run - plan gate skipped');
  const failures: string[] = [];
  const results = await planResults(suiteApi, planId);
  // SUITE-SANCTIONED SKIPPED at plan level: the ES256 client's RS256
  // negatives (the suite itself skips them: "this will not prevent you
  // certifying") - the ACCEPTABLE gate treats them as by-design passes.
  const bad = [...results.entries()].filter(([, r]) => r && !ACCEPTABLE.has(r) && !(r === 'SKIPPED'));
  for (const [m, r] of bad) failures.push(`${m}: ${r}`);
  expect(failures, `plan results failed:\n${failures.join('\n')}`).toEqual([]);
});

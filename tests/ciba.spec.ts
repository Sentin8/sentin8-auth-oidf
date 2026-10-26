// SPDX-FileCopyrightText: Copyright Logically Magic Inc. <hello@logicallymagic.com>
// SPDX-License-Identifier: Apache-2.0

// tests/ciba.spec.ts - FAPI CIBA ID1 plans (poll + ping).
//
// Variant axes (the suite's FAPICIBAID1TestPlan): fapi_ciba_profile
// (plain_fapi), client_auth_type (private_key_jwt), ciba_mode
// (poll | ping), client_registration (static_client). The seed
// registers cert-ciba with `private_key_jwt` + its own EC jwks under
// the fapi_ciba posture (PAR off, iss on, ES256) and publishes the
// private jwks to seed-out.

import { test, expect } from '@playwright/test';
import { SuiteApi, standardBrowserAutomation, browserAutomationFor, type SuiteTestConfig } from '../fixtures/suite.js';
import { runModule, planResults, ACCEPTABLE } from '../fixtures/runner.js';
import {certDiscoveryUrl, certAuthHost, suiteCallback, suiteCibaNotification, CONFORMANCE_ALIAS, resultsDir, seedOutPath, certUser } from '../fixtures/env.js';
import { logStep, stepLog } from '../fixtures/log.js';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let suiteApi: SuiteApi;
const planIds: string[] = [];

const baseConfig = {
  alias: CONFORMANCE_ALIAS,
  description: 'Sentin8 auth certification run - FAPI CIBA ID1 (OC-13)',
  server: { discoveryUrl: certDiscoveryUrl() },
  resource: {
    resourceUrl: `${certAuthHost().replace(/\/$/, '')}/oauth/userinfo`,
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CibaClient = any;
function seededCibaClients(): { client: CibaClient; client2: CibaClient } | null {
  const seedOut = process.env.OIDF_SEED_OUT ?? seedOutPath();
  if (!existsSync(seedOut)) return null;
  const text = readFileSync(seedOut, 'utf8');
  const cid = text.match(/client_id\(ciba\)=([a-f0-9]+)/)?.[1];
  const cid2 = text.match(/client_id\(ciba2\)=([a-f0-9]+)/)?.[1];
  const jwksLine = text.match(/private_jwks\(ciba\)=(\{.*\})/)?.[1];
  const jwks2Line = text.match(/private_jwks\(ciba2\)=(\{.*\})/)?.[1];
  if (!cid || !jwksLine) return null;
  let jwks: unknown = null;
  let jwks2: unknown = null;
  try {
    jwks = JSON.parse(jwksLine);
    jwks2 = jwks2Line ? JSON.parse(jwks2Line) : jwks;
  } catch {
    return null;
  }
  const mk = (id: string, keys: unknown): CibaClient => ({
    client_id: id,
    client_auth_type: 'private_key_jwt',
    token_endpoint_auth_method: 'private_key_jwt',
    scope: 'openid profile email phone address offline_access',
    redirect_uri: suiteCallback(),
    notification_endpoint: suiteCibaNotification(),
    // CIBA's authentication-device hint: the suite builds the
    // consumption URL from (hint_type, login_hint) - our rig
    // authenticates the certification user by EMAIL.
    hint_type: 'login_hint',
    hint_value: certUser().email,
    jwks: { keys: [keys] },
  });
  // TWO DISTINCT clients: the suite's second-configuration family
  // (signed-by-other-client / bad-iss) requires client2 != client1 -
  // ids AND signing keys.
  return { client: mk(cid, jwks), client2: mk(cid2 ?? cid, jwks2 ?? jwks) };
}

const BASE_VARIANT = {
  fapi_ciba_profile: 'plain_fapi',
  client_auth_type: 'private_key_jwt',
  client_registration: 'static_client',
};
const CELLS = [
  { ...BASE_VARIANT, ciba_mode: 'poll' },
  { ...BASE_VARIANT, ciba_mode: 'ping' },
];


// The RESOURCE-server hop calls the RS over mTLS - every CIBA module
// needs `mtls.cert|key|ca` (+ mtls2) in the plan config (the seeded
// fapi2-mtls client certs, DESIGN 9a.12).
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

test.beforeAll(async ({ browser }) => {
  await SuiteApi.waitAuthReady();
  suiteApi = new SuiteApi();
});

test('FAPI CIBA ID1 - run every module to terminal, zero-warning green', async ({ browser }) => {
  test.setTimeout(7_200_000);
  const onlyList = (process.env.OIDF_MODULES ?? '')
    .split(',').map((x) => x.trim()).filter(Boolean);
  const failures: string[] = [];
  const cellClients = seededCibaClients();
  if (!cellClients) {
    failures.push('seeded CIBA client missing - re-run the seed with CONFORMANCE_PROFILE=fapi_ciba');
  } else {
    for (const v of CELLS) {
      const tls = seededFapiTlsSections();
      const plan = await suiteApi.createPlan(
        'fapi-ciba-id1-test-plan',
        { ...baseConfig, ...cellClients, ...tls } as SuiteTestConfig,
        v,
      );
      planIds.push(plan.id);
      logStep(`VARIANT ciba_mode=${v.ciba_mode} -> plan ${plan.id} (${plan.modules.length} modules)`);
      for (const m of (await suiteApi.getPlan(plan.id)).modules) {
        if (onlyList.length > 0 && !onlyList.includes(m.testModule)) {
          logStep(`SKIP-ONLY ${m.testModule}`);
          continue;
        }
        if (m.result) {
          logStep(`SKIP ${m.testModule} (already ${m.result})`);
          continue;
        }
        const tls = seededFapiTlsSections();
        const run = await runModule(suiteApi, browser, plan.id, m.testModule,
          { ...baseConfig, ...cellClients, ...tls, browser: browserAutomationFor(m.testModule) } as SuiteTestConfig,
          /expired|auth-req-id/i.test(m.testModule) ? 960_000 : undefined);
        expect(run.status, `${m.testModule} must finish (not INTERRUPTED)`).toBe('FINISHED');
        const result = String(run.result);
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
          failures.push(`[${v.ciba_mode}] ${m.testModule}: ${run.warnings.join(' | ')}`);
        }
        const out = join(resultsDir(), 'logs');
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, `ciba-${v.ciba_mode}-${m.testModule}.json`), JSON.stringify(run.log));
      }
      writeFileSync(join(resultsDir(), 'ciba-poll-plan.txt'), planIds.join('\n'));
    }
  }
  expect(failures, `warning-zero violations:\n${failures.join('\n')}`).toEqual([]);
});

test('plan-level results are all acceptable', async () => {
  test.skip(!!(process.env.OIDF_MODULES ?? '').trim(), 'singles run - plan gate skipped');
  const failures: string[] = [];
  for (const planId of planIds) {
    const results = await planResults(suiteApi, planId);
    // The ES256-client RS256 negatives are suite-sanctioned skips.
    const bad = [...results.entries()]
      .filter(([m, r]) => r && !ACCEPTABLE.has(r) && !(r === 'SKIPPED' && /rs256/i.test(m)));
    for (const [m, r] of bad) failures.push(`${m}: ${r}`);
  }
  expect(failures, `plan results failed:\n${failures.join('\n')}`).toEqual([]);
});

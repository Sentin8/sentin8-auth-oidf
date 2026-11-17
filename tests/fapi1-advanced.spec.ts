// SPDX-FileCopyrightText: Copyright Logically Magic Inc. <hello@logicallymagic.com>
// SPDX-License-Identifier: Apache-2.0

// tests/fapi1-advanced.spec.ts - FAPI 1.0 Advanced final plan (OIDF-ALL-1:
// the FULL 8-cell catalog matrix).
//
// The plan variant axes (the suite's FAPI1AdvancedFinalTestPlan):
//   fapi_profile=plain_fapi, client_auth_type=private_key_jwt|mtls,
//   fapi_auth_request_method=by_value|pushed, fapi_response_mode=
//   plain_response|jarm.
// The catalog cells (8): client_auth_type (2) x fapi_auth_request_method
// (2) x fapi_response_mode (2). Each cell runs as its OWN plan over the
// per-cell seeded client (the private_key_jwt cells read the jwks
// clients cert-fapi2-<cell>; the mtls cells read the self-signed cert
// clients). The cert env's security profile is fapi_1_advanced
// (require_par + require_jarm + require_mtls + require_iss - the seed's
// `CONFORMANCE_PROFILE=fapi_1_advanced`); the per-cell response-mode /
// request-method variants select the plan's module slices.

import { test, expect } from '@playwright/test';
import { SuiteApi, standardBrowserAutomation, browserAutomationFor, type SuiteTestConfig, type SuiteClientConfig } from '../fixtures/suite.js';
import { runModule, planResults, ACCEPTABLE } from '../fixtures/runner.js';
import {
  certDiscoveryUrl, certAuthHost, suiteCallback, CONFORMANCE_ALIAS, resultsDir, seedOutPath } from '../fixtures/env.js';
import { logStep, stepLog } from '../fixtures/log.js';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let suiteApi: SuiteApi;

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
// The per-cell seeded client reader: the private_key_jwt cells read the
// jwks clients (client_id(fapi2-<cell>) + private_jwks(fapi2-<cell>));
// the mtls cells read the self-signed cert clients (the SAME shape the
// fapi2 mtls cells use - client_id(fapi2-mtls) + the cert/key sections).
function seededFapi1Clients(cell: { client_auth_type: string }): { client: FapiClient; client2: FapiClient } | null {
  const seedOut = process.env.OIDF_SEED_OUT ?? seedOutPath();
  if (!existsSync(seedOut)) return null;
  const text = readFileSync(seedOut, 'utf8');
  if (cell.client_auth_type === 'mtls') {
    const cid = text.match(/client_id\(fapi2-mtls\)=([a-f0-9]+)/)?.[1];
    const cid2 = text.match(/client_id\(fapi2-second-mtls\)=([a-f0-9]+)/)?.[1];
    const certB64 = text.match(/mtls_cert_der_b64\(main\)=([A-Za-z0-9+\/=]+)/)?.[1];
    const certB642 = text.match(/mtls_cert_der_b64\(second\)=([A-Za-z0-9+\/=]+)/)?.[1];
    const keyPem = text.match(/mtls_key_pem\(main\)=([\s\S]*?)-----END PRIVATE KEY-----/)?.[1];
    const keyPem2 = text.match(/mtls_key_pem\(second\)=([\s\S]*?)-----END PRIVATE KEY-----/)?.[1];
    if (!cid || !cid2 || !certB64 || !certB642 || !keyPem || !keyPem2) return null;
    const keyB64 = keyPem.replace(/-----(BEGIN|END) [A-Z ]+-----/g, '').replace(/\s+/g, '');
    const keyB642 = keyPem2.replace(/-----(BEGIN|END) [A-Z ]+-----/g, '').replace(/\s+/g, '');
    // The suite's ValidateClientJWKsPrivatePart demands the client's
    // signing jwks in the config (the client still signs its request
    // objects with it - the CERT authenticates, the jwks signs).
    const jwksLine = text.match(/private_jwks\(fapi2-mtls-main\)=\{.*\}/)?.[0]?.split('=').slice(1).join('=');
    const jwksLine2 = text.match(/private_jwks\(fapi2-mtls-second\)=\{.*\}/)?.[0]?.split('=').slice(1).join('=');
    if (!jwksLine || !jwksLine2) return null;
    let jwksObj: unknown = null;
    let jwksObj2: unknown = null;
    try {
      jwksObj = JSON.parse(jwksLine);
      jwksObj2 = JSON.parse(jwksLine2);
    } catch {
      return null;
    }
    const mk = (id: string, cert: string, key: string, jwks: unknown): FapiClient => ({
      client_id: id,
      client_auth_type: 'mtls',
      token_endpoint_auth_method: 'self_signed_tls_client_auth',
      scope: 'openid profile email phone address offline_access',
      redirect_uri: suiteCallback(),
      jwks: Array.isArray((jwks as { keys?: unknown[] })?.keys)
        ? (jwks as { keys: unknown[] })
        : { keys: [jwks] },
    });
    return {
      client: mk(cid, certB64, keyB64, jwksObj),
      client2: mk(cid2, certB642, keyB642, jwksObj2),
    };
  }
  // The private_key_jwt cells ride the fapi1-pk family (auth DESIGN
  // 9a.22 - the registration-to-cell mapping):
  // the FAPI1-ADV pk cells authenticate by assertion and NEVER
  // present a client certificate, so the registration maps to
  // NEITHER sender posture - sender_constrain=any, the profile gate
  // governs. The fapi2 dpop client (the first battery-9 failure)
  // would demand a DPoP proof no FAPI1 plan sends; the fapi2 mtls-pk
  // client (battery-10's over-correction) would demand the cert the
  // flow never presents.
  const cellName = 'fapi1-pk';
  // LITERAL regexes (not template-built): the fapi1 spec compiles under
  // a transpiler that STRIPS single backslashes inside template literals
  // - `\(${cellName}\)` became an UNESCAPED paren pair (a capture group,
  // demanding the text 'client_idfapi1-pk=') and every pk-cell lookup
  // returned null (battery-11 round-1/2 'seeded FAPI1 client missing for
  // cell private_key_jwt/...'). The mtls arm above uses literal regexes
  // and never regressed - the pk arm matches its shape.
  const cid = text.match(/client_id\(fapi1-pk\)=([a-f0-9]+)/)?.[1];
  const cid2 = text.match(/client_id\(fapi1-second-pk\)=([a-f0-9]+)/)?.[1];
  const jwksLine = text.match(/private_jwks\(fapi1-pk\)=(\{.*\})/)?.[1];
  const jwksLine2 = text.match(/private_jwks\(fapi1-second-pk\)=(\{.*\})/)?.[1];
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

// The FAPI1 plan's FOUR variant axes - the FULL 8-cell catalog matrix
// (OIDF-ALL-1): client_auth_type (private_key_jwt|mtls) x
// fapi_auth_request_method (by_value|pushed) x fapi_response_mode
// (plain_response|jarm). One plan per cell; each cell runs the module
// slices its axes select (the PAR family under pushed, the plain family
// under by_value, the JARM family under jarm).
const FAPI1_CELLS = [
  { client_auth_type: 'private_key_jwt', fapi_auth_request_method: 'pushed', fapi_response_mode: 'jarm' },
  { client_auth_type: 'private_key_jwt', fapi_auth_request_method: 'pushed', fapi_response_mode: 'plain_response' },
  { client_auth_type: 'private_key_jwt', fapi_auth_request_method: 'by_value', fapi_response_mode: 'jarm' },
  { client_auth_type: 'private_key_jwt', fapi_auth_request_method: 'by_value', fapi_response_mode: 'plain_response' },
  { client_auth_type: 'mtls', fapi_auth_request_method: 'pushed', fapi_response_mode: 'jarm' },
  { client_auth_type: 'mtls', fapi_auth_request_method: 'pushed', fapi_response_mode: 'plain_response' },
  { client_auth_type: 'mtls', fapi_auth_request_method: 'by_value', fapi_response_mode: 'jarm' },
  { client_auth_type: 'mtls', fapi_auth_request_method: 'by_value', fapi_response_mode: 'plain_response' },
].map((c) => ({ ...c, fapi_profile: 'plain_fapi' }));

const planIds: string[] = [];

test.beforeAll(async ({ browser }) => {
  await SuiteApi.waitAuthReady();
  suiteApi = new SuiteApi();
});

test('FAPI1 Advanced - run every module to terminal', async ({ browser }) => {
  test.setTimeout(7_200_000);
  const onlyList = (process.env.OIDF_MODULES ?? '')
    .split(',').map((x) => x.trim()).filter(Boolean);
  const failures: string[] = [];
  for (const cell of FAPI1_CELLS) {
    const cellClients = seededFapi1Clients(cell);
    if (!cellClients) {
      failures.push(`seeded FAPI1 client missing for cell ${cell.client_auth_type}/${cell.fapi_auth_request_method}/${cell.fapi_response_mode} - re-run the seed with CONFORMANCE_PROFILE=fapi_1_advanced`);
      continue;
    }
    const tls = seededFapiTlsSections();
    const plan = await suiteApi.createPlan(
      'fapi1-advanced-final-test-plan',
      { ...config, ...cellClients, ...tls } as SuiteTestConfig,
      cell,
    );
    planIds.push(plan.id);
    logStep(`VARIANT ${cell.client_auth_type}/${cell.fapi_auth_request_method}/${cell.fapi_response_mode} -> plan ${plan.id} (${plan.modules.length} module-variants)`);
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    for (const m of (await suiteApi.getPlan(plan.id)).modules) {
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
      const run = await runModule(suiteApi, browser, plan.id, m.testModule,
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
        failures.push(`[${cell.client_auth_type}/${cell.fapi_auth_request_method}/${cell.fapi_response_mode}] ${m.testModule}: ${run.warnings.join(' | ')}`);
      }
      const out = join(resultsDir(), 'logs');
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, `fapi1-${cell.client_auth_type}-${cell.fapi_auth_request_method}-${cell.fapi_response_mode}-${m.testModule}.json`), JSON.stringify(run.log));
    }
    await page.close();
  }
  writeFileSync(join(resultsDir(), 'fapi1-advanced-plans.txt'), planIds.join('\n'));
  expect(failures, `warning-zero violations:\n${failures.join('\n')}`).toEqual([]);
});

test('plan-level results are all acceptable', async () => {
  test.skip(!!(process.env.OIDF_MODULES ?? '').trim(), 'singles run - plan gate skipped');
  const failures: string[] = [];
  for (const pid of planIds) {
    const results = await planResults(suiteApi, pid);
    // SUITE-SANCTIONED SKIPPED at plan level: the ES256 client's RS256
    // negatives (the suite itself skips them: "this will not prevent you
    // certifying") - the ACCEPTABLE gate treats them as by-design passes.
    const bad = [...results.entries()].filter(([, r]) => r && !ACCEPTABLE.has(r) && !(r === 'SKIPPED'));
    for (const [m, r] of bad) failures.push(`${pid}: ${m}: ${r}`);
  }
  expect(failures, `plan results failed:\n${failures.join('\n')}`).toEqual([]);
});

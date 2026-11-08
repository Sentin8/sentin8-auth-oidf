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
import { certDiscoveryUrl, certAuthHost, suiteCallback, CONFORMANCE_ALIAS, SUITE_BASE, resultsDir, seedOutPath, certUser } from '../fixtures/env.js';
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
// chain the status-list tokens carry). The suite reads them NESTED:
//   client.request_object_trust_anchor_pem - the env's issuance CA
//     (the request object's x5c chain validates against this anchor;
//     RegisterClientRequestObjectTrustAnchor + the HAIP plan's
//     request-object signature conditions)
//   credential.signing_jwk - the WALLET's PRIVATE mint key (the suite
//     plays the wallet - CreateSdJwtKbCredential SIGNS the credential
//     with it; a public-only key cannot sign). The key is generated
//     fresh per campaign; the matching PUBLIC key is registered in the
//     verifier's eudi_wallet connection (trusted_issuers) via the admin
//     API before the plans run - the verifier accepts presentations
//     from exactly the wallet the suite drives.
async function verifierConfigParts(): Promise<{ client: Record<string, unknown>; credential: Record<string, unknown> }> {
  const seedOut = process.env.OIDF_SEED_OUT ?? seedOutPath();
  const client: Record<string, unknown> = {};
  const credential: Record<string, unknown> = {};
  if (existsSync(seedOut)) {
    const text = readFileSync(seedOut, 'utf8');
    const caPem = text.match(/haip_issuer_ca_pem\(haip\)=([\s\S]*?-----END CERTIFICATE-----)/)?.[1];
    if (caPem) {
      client.request_object_trust_anchor_pem = caPem;
    }
  }
  // The wallet's fresh keypair: the private half goes to the suite
  // (credential.signing_jwk - the SD-JWT mint key); the public half is
  // registered as the verifier's trusted issuer (the connection's
  // trusted_issuers JWKS - the verifier's vp_response verifies the
  // credential signature against exactly this key).
  const wallet = await generateWalletKey();
  credential.signing_jwk = wallet.privateJwk;
  await registerTrustedWallet(wallet.publicJwk);
  return { client, credential };
}

/** A fresh P-256 keypair as JWKs (private for the suite's wallet,
 * public for the verifier's trusted-issuer set). */
async function generateWalletKey(): Promise<{ privateJwk: Record<string, unknown>; publicJwk: Record<string, unknown> }> {
  const { generateKeyPairSync } = await import('node:crypto');
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
  const priv = privateKey.export({ format: 'jwk' }) as Record<string, unknown>;
  const kid = `wallet-${Date.now()}`;
  const alg = { alg: 'ES256', kid };
  return {
    privateJwk: { ...priv, ...alg, use: 'sig' },
    publicJwk: { ...pub, ...alg, use: 'sig' },
  };
}

/** Register the wallet's public key in the verifier env's eudi_wallet
 * connection (trusted_issuers) - the cert user's own admin grant drives
 * the platform's admin API via the RFC 8628 device flow (the same path
 * the rotate-keys operator action uses; the sign-in session alone
 * cannot reach the admin endpoints - they require a Bearer JWT with an
 * admin scope). */
async function registerTrustedWallet(publicJwk: Record<string, unknown>): Promise<void> {
  const { certUser } = await import('../fixtures/env.js');
  const user = certUser();
  const base = certAuthHost();
  const envId = process.env.CONFORMANCE_ENV_ID ?? '';
  const envQuery = envId ? `?target_env_id=${envId}` : '';
  try {
    // (1) The session for the device approval (the cert user's cookie).
    const signIn = await fetch(`${base}/v1/sign-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: user.password }),
    });
    if (!signIn.ok) throw new Error(`sign-in failed: HTTP ${signIn.status}`);
    const sess = (await signIn.json()) as { token?: string };
    // (2) The device code (the CLI's registered public client).
    const devResp = await fetch(`${base}/oauth/device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: deviceClientId(),
        scope: 'sentin8:auth:admin:write',
        audience: 'sentin8',
      }),
    });
    if (!devResp.ok) throw new Error(`device authorization failed: HTTP ${devResp.status}`);
    const dev = (await devResp.json()) as { device_code: string; user_code: string; interval?: number };
    // (3) Approve as the cert user (their auth:admin role carries the
    // scope the device grant asks for).
    const verify = await fetch(`${base}/device/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.token ?? ''}` },
      body: JSON.stringify({ user_code: dev.user_code, action: 'approve' }),
    });
    if (!verify.ok) throw new Error(`device approval failed: HTTP ${verify.status}`);
    // (4) Poll for the admin JWT.
    const tokenUrl = `${base}/oauth/token`;
    const deadline = Date.now() + 90_000;
    let bearer = '';
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, dev.interval ? dev.interval * 1000 : 5_000));
      const tok = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: dev.device_code,
          client_id: deviceClientId(),
        }),
      });
      if (tok.ok) {
        const j = (await tok.json()) as { access_token?: string };
        bearer = j.access_token ?? '';
        break;
      }
    }
    if (!bearer) throw new Error('device-flow token exchange did not complete');
    // (5) The connection's trusted-issuer refresh (the wallet issuer
    // entry: issuer = the suite's TEST-INSTANCE base (the credential's
    // `iss` - CreateSdJwtKbCredential mints it there; jwks = the fresh
    // public key).
    const trustEntry = {
      issuer: `${SUITE_BASE}/test/a/${CONFORMANCE_ALIAS}`,
      jwks: { keys: [publicJwk] },
    };
    const list = await fetch(`${base}/v1/admin/enterprise-connections${envQuery}`, {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    const conns = list.ok ? ((await list.json()) as Array<{ id: string; strategy: string }>) : [];
    const conn = conns.find((c) => c.strategy === 'eudi_wallet');
    if (!conn) throw new Error('no eudi_wallet connection found - run the seed');
    const update = await fetch(`${base}/v1/admin/enterprise-connections/${conn.id}${envQuery}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
      body: JSON.stringify({
        name: 'eudi-wallet-conformance',
        strategy: 'eudi_wallet',
        config: {
          trusted_issuers: [JSON.stringify(trustEntry)],
          // The suite's PID credential carries no acr claim - the
          // verifier accepts the suite's own assurance choice.
          min_level_of_assurance: 'low',
        },
      }),
    });
    logStep(`  trusted-wallet registration: HTTP ${update.status}`);
  } catch (e) {
    logStep(`  trusted-wallet registration FAILED: ${(e as Error).message.slice(0, 140)} - the verifier may reject the wallet credentials`);
  }
}

/** The CLI's registered device-flow public client id (the seed's
 * registered client set). */
function deviceClientId(): string {
  const seedOut = process.env.OIDF_SEED_OUT ?? seedOutPath();
  try {
    const text = readFileSync(seedOut, 'utf8');
    return text.match(/client_id\(device\)=([\w-]+)/)?.[1] ?? '';
  } catch {
    return '';
  }
}

const harnessBrowserBlock = standardBrowserAutomation();

test.beforeAll(async ({ browser }) => {
  await SuiteApi.waitAuthReady();
  suiteApi = new SuiteApi();
  logStep('creating plans: oid4vp (verifier-haip + plain discovery)');
  const extra = await verifierConfigParts();
  // The suite reads the trust anchor + the credential mint key NESTED
  // under the client/credential config sections - merge them into the
  // base config (not a top-level spread, which would leave them at
  // the root where no condition reads them).
  const planConfig: SuiteTestConfig = {
    ...config,
    client: { ...config.client, ...extra.client },
    credential: { ...extra.credential },
  };
  // The HAIP plan PINS its own axes on the module entries
  // (client_id_prefix=x509_hash, request_method=request_uri_signed,
  // vp_profile=haip - the plan's own module-variant matrix); a
  // user-set value on a pinned axis 400s ("Variant ... already sets
  // this variant"). The create carries ONLY the free axes:
  // credential_format (the HAIP spec's own contract) + the OID4VP
  // response_mode (direct_post - the 8.2 response delivery).
  const haipPlan = await suiteApi.createPlan(
    'oid4vp-1final-verifier-haip-test-plan',
    planConfig,
    { credential_format: 'sd_jwt_vc', response_mode: 'direct_post.jwt' },
  );
  planIds.push(haipPlan.id);
  logStep(`haip plan ${haipPlan.id}: ${haipPlan.modules.length} modules`);
  // The PLAIN verifier plan: no pinned axes - the create carries the
  // full free set (the plan name is the ALPHA plain profile; our
  // verifier serves the same surfaces as the HAIP cells).
  const plainPlan = await suiteApi.createPlan(
    'oid4vp-1final-verifier-test-plan',
    planConfig,
    {
      vp_profile: 'plain_vp',
      credential_format: 'sd_jwt_vc',
      response_mode: 'direct_post.jwt',
      client_id_prefix: 'x509_hash',
      request_method: 'request_uri_signed',
    },
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

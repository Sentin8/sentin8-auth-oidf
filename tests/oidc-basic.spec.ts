// SPDX-FileCopyrightText: Copyright Logically Magic Inc. <hello@logicallymagic.com>
// SPDX-FileCopyrightText: Copyright Hamid Jahanzad <Hamid@Jahanzad.com>
// SPDX-License-Identifier: Apache-2.0

// tests/oidc-basic.spec.ts - OIDC Core: Basic OP - the certification plan.
//
// Creates the plan (static clients + the Flutter-auth-ui browser block),
// runs all 35 modules in order, and enforces the campaign rule:
//   - every module terminal (FINISHED) - no INTERRUPTED
//   - result PASSED/WARNING/REVIEW - no FAILED/SKIPPED (§9a.10 no-skip)
//   - ZERO WARNINGs inside every module's log (§9a.11 warning-zero)
//
// The per-module WARNING list is asserted empty module-by-module so the
// failing point names the exact server behavior that still warns.

import { test, expect, type Page } from '@playwright/test';
import { chromium } from '@playwright/test';
import { SuiteApi, ACCEPTABLE, standardBrowserAutomation, type SuiteTestConfig, type SuiteClientConfig } from '../fixtures/suite.js';
import { runModule, planResults } from '../fixtures/runner.js';
import { certDiscoveryUrl, suiteCallback, CONFORMANCE_ALIAS, CERT_USER, certAuthHost, resultsDir } from '../fixtures/env.js';
import { logStep, stepLog } from '../fixtures/log.js';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let suiteApi: SuiteApi;
let page: Page;
let planId: string;
const config: SuiteTestConfig = {
  alias: CONFORMANCE_ALIAS,
  description: 'Sentin8 auth certification run - OIDC Core Basic (OC-12 warning-zero)',
  server: { discoveryUrl: certDiscoveryUrl() },
  client: (JSON.parse(process.env.OIDF_CLIENT_BASIC ?? 'null') ?? {
    client_id: process.env.OIDF_BASIC_CLIENT_ID ?? '',
    client_secret: process.env.OIDF_BASIC_CLIENT_SECRET ?? '',
    scope: 'openid profile email phone address offline_access',
    redirect_uri: suiteCallback(),
    token_endpoint_auth_method: 'client_secret_basic',
  }) as SuiteClientConfig,
  client2: (JSON.parse(process.env.OIDF_CLIENT_POST ?? 'null') ??
    postClient()) as SuiteClientConfig,
  // The client_secret_post VARIANT module reads this key (the
  // client2 twin - one registered client serving both auth methods is
  // allowed, but the suite wants the dedicated key present).
  client_secret_post: (JSON.parse(process.env.OIDF_CLIENT_POST ?? 'null') ??
    postClient()) as SuiteClientConfig,
};

/** The client2/client_secret_post shape (both ride the same registration). */
function postClient(): SuiteClientConfig {
  return {
    client_id: process.env.OIDF_POST_CLIENT_ID ?? '',
    client_secret: process.env.OIDF_POST_CLIENT_SECRET ?? '',
    scope: 'openid profile email phone address offline_access',
    redirect_uri: suiteCallback(),
    token_endpoint_auth_method: 'client_secret_post',
  };
}
// The browser block is HARNESS-LOCAL (runModule drives exposed URLs in
// our page; the suite's server-side WebRunner must not see it).
const harnessBrowserBlock = standardBrowserAutomation();

// The seeded client credentials come from the seed run
// (.tmp/conformance/cert-user.env printed ids + the platform store); the
// operator exports OIDF_* or the file the seed writes is read here.
function loadSeededClients(): void {
  const seedOut = process.env.OIDF_SEED_OUT
    ?? join(resultsDir(), '..', '..', '..', '.tmp', 'conformance', 'seed-out.txt');
  if (!existsSync(seedOut)) return;
  const text = readFileSync(seedOut, 'utf8');
  const get = (k: string) => text.match(new RegExp(`${k}=([a-f0-9]+)`))?.[1];
  const basicId = get('client_id\\(basic\\)');
  const basicSecret = get('client_secret\\(basic\\)');
  const postId = get('client_id\\(post\\)');
  const postSecret = get('client_secret\\(post\\)');
  if (basicId && basicSecret && !config.client?.client_id) {
    config.client = { ...config.client, client_id: basicId, client_secret: basicSecret };
  }
  if (postId && postSecret) {
    const shared = { client_id: postId, client_secret: postSecret };
    const c2 = config.client2 as SuiteClientConfig | undefined;
    if (c2 && !c2.client_id) {
      config.client2 = { ...c2, ...shared };
    }
    if (!config.client_secret_post?.client_id) {
      config.client_secret_post = {
        scope: 'openid profile email phone address offline_access',
        redirect_uri: suiteCallback(),
        token_endpoint_auth_method: 'client_secret_post',
        ...(config.client_secret_post as SuiteClientConfig | undefined),
        ...shared,
      } as SuiteClientConfig;
    }
  }
}

test.beforeAll(async ({ browser }) => {
  loadSeededClients();
  expect(config.client?.client_id, 'seeded basic client id (OIDF_* vars or seed-out.txt)').toBeTruthy();
  expect(config.client2?.client_id, 'seeded post client id').toBeTruthy();
  await SuiteApi.waitAuthReady();
  suiteApi = new SuiteApi();
  logStep(`creating plan: ${config.description}`);
  const plan = await suiteApi.createPlan(
    'oidcc-basic-certification-test-plan',
    config,
    { server_metadata: 'discovery', client_registration: 'static_client' },
  );
  planId = plan.id;
  logStep(`plan ${planId}: ${plan.modules.length} modules`);

  // The browser context the front channel runs in (the cert tenant's
  // login happens through the ORIGINAL Flutter auth-ui).
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  page = await ctx.newPage();
});

test.afterAll(async ({ browser }) => {
  writeFileSync(join(resultsDir(), 'oidc-basic-steps.log'), stepLog());
  if (planId) writeFileSync(join(resultsDir(), 'oidc-basic-plan.txt'), planId);
});

test('OIDC Core Basic OP - run every module to terminal, zero-warning green', async ({ browser }) => {
  test.setTimeout(1_800_000);
  const onlyList = (process.env.OIDF_MODULES ?? '')
    .split(',').map((x) => x.trim()).filter(Boolean);
  const failures: string[] = [];
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
    // §9a.10 - no FAILED / INTERRUPTED / SKIPPED per module.
    expect(run.status, `${m.testModule} must finish (not INTERRUPTED)`).toBe('FINISHED');
    expect(run.result, `${m.testModule} must not fail`).not.toMatch(/FAILED|SKIPPED|INTERRUPTED/);
    // §9a.11 - zero warnings inside the module's log.
    if (run.warnings.length > 0) {
      failures.push(`${m.testModule}: ${run.warnings.join(' | ')}`);
    }
    // Preserve the log for the export step.
    const out = join(resultsDir(), 'logs');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, `${m.testModule}.json`), JSON.stringify(run.log));
  }
  expect(failures, `warning-zero violations:\n${failures.join('\n')}`).toEqual([]);
});

test('plan-level results are all acceptable', async () => {
  test.skip(!!(process.env.OIDF_MODULES ?? '').trim(), 'singles run - plan gate skipped');
  const results = await planResults(suiteApi, planId);
  const bad = [...results.entries()].filter(([, r]) => r && !ACCEPTABLE.has(r));
  expect(bad, 'FAILED/SKIPPED/INTERRUPTED modules').toEqual([]);
});
// SPDX-FileCopyrightText: Copyright Logically Magic Inc. <hello@logicallymagic.com>
// SPDX-License-Identifier: Apache-2.0

// tests/logout.spec.ts - OIDC RP-Initiated + Back-Channel Logout - the
// certification plan (OC-13 profile families; auth DESIGN S9a.5).
//
// The standard posture re-seed serves this plan (plain OIDC Core; the
// logout modules exercise end_session_endpoint + post_logout redirect +
// the back-channel logout token). Same campaign rule as the Basic spec:
//   - every module terminal (FINISHED) - no INTERRUPTED
//   - result PASSED/WARNING/REVIEW - no FAILED/SKIPPED (S9a.10)
//   - ZERO WARNINGs inside every module's log (S9a.11)

import { test, expect, type Page } from '@playwright/test';
import { SuiteApi, ACCEPTABLE, standardBrowserAutomation, browserAutomationFor, type SuiteTestConfig, type SuiteClientConfig } from '../fixtures/suite.js';
import { runModule, planResults } from '../fixtures/runner.js';
import { certDiscoveryUrl, suiteCallback, CONFORMANCE_ALIAS, certAuthHost, resultsDir, seedOutPath } from '../fixtures/env.js';
import { logStep, stepLog } from '../fixtures/log.js';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let suiteApi: SuiteApi;
let page: Page;
let planId: string;
const planIds: string[] = [];

const config: SuiteTestConfig = {
  alias: CONFORMANCE_ALIAS,
  description: 'Sentin8 auth certification run - OIDC Logout (OC-13 zero-warning)',
  server: { discoveryUrl: certDiscoveryUrl() },
};

// The seeded basic client (the logout modules ride the RP's client).
function loadSeededClients(): void {
  const seedOut = process.env.OIDF_SEED_OUT ?? seedOutPath();
  if (!existsSync(seedOut)) return;
  const text = readFileSync(seedOut, 'utf8');
  const get = (k: string) => text.match(new RegExp(`${k}=([a-f0-9]+)`))?.[1];
  const basicId = get('client_id\\(basic\\)');
  const basicSecret = get('client_secret\\(basic\\)');
  const postId = get('client_id\\(post\\)');
  const postSecret = get('client_secret\\(post\\)');
  // The suite's post-logout landing: its own
  // /test/a/<alias>/post_logout_redirect route (the
  // CreatePostLogoutRedirectUri condition builds
  // `{base_url}/post_logout_redirect` - the client registers it).
  const postLogout = `${suiteCallback().replace(/\/callback$/, '')}/post_logout_redirect`;
  if (basicId && basicSecret && !config.client?.client_id) {
    config.client = {
      client_id: basicId,
      client_secret: basicSecret,
      scope: 'openid profile email phone address offline_access',
      redirect_uri: suiteCallback(),
      post_logout_redirect_uris: [postLogout],
      token_endpoint_auth_method: 'client_secret_basic',
    };
  }
  if (postId && postSecret && !config.client2?.client_id) {
    config.client2 = {
      client_id: postId,
      client_secret: postSecret,
      scope: 'openid profile email phone address offline_access',
      redirect_uri: suiteCallback(),
      post_logout_redirect_uris: [postLogout],
      token_endpoint_auth_method: 'client_secret_post',
    } as SuiteClientConfig;
  }
}

const harnessBrowserBlock = standardBrowserAutomation();

test.beforeAll(async ({ browser }) => {
  loadSeededClients();
  expect(config.client?.client_id, 'seeded basic client id (OIDF_* vars or seed-out.txt)').toBeTruthy();
  expect(config.client2?.client_id, 'seeded post client id').toBeTruthy();
  await SuiteApi.waitAuthReady();
  suiteApi = new SuiteApi();
  logStep('creating plan: logout');
  // The logout plan runs a variant CELL per response_type (code /
  // id_token); each cell = one plan (the same shape as the FAPI2 spec).
  for (const respType of ['code', 'id_token']) {
    const plan = await suiteApi.createPlan(
      'oidcc-rp-initiated-logout-certification-test-plan',
      config,
      // The logout plan PINS server_metadata itself (a user-set variant
      // 400s); response_type + client_registration ride here.
      { response_type: respType, client_registration: 'static_client' },
    );
    planId = plan.id;
    planIds.push(plan.id);
    logStep(`[response_type=${respType}] plan ${plan.id}: ${plan.modules.length} modules`);
  }
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  page = await ctx.newPage();
});

test.afterAll(async () => {
  writeFileSync(join(resultsDir(), 'logout-steps.log'), stepLog());
  if (planIds.length > 0) writeFileSync(join(resultsDir(), 'logout-plans.txt'), planIds.join('\n'));
});

test('OIDC Logout - run every module to terminal, zero-warning green', async ({ browser }) => {
  test.setTimeout(1_800_000);
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
      { ...config, browser: browserAutomationFor(m.testModule) });
    // S9a.10 - no FAILED / INTERRUPTED / SKIPPED per module.
    expect(run.status, `${m.testModule} must finish (not INTERRUPTED)`).toBe('FINISHED');
    expect(run.result, `${m.testModule} must not fail`).not.toMatch(/FAILED|SKIPPED|INTERRUPTED/);
    // S9a.11 - zero warnings inside the module's log.
    if (run.warnings.length > 0) {
      failures.push(`${m.testModule}: ${run.warnings.join(' | ')}`);
    }
    const out = join(resultsDir(), 'logs');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, `${m.testModule}.json`), JSON.stringify(run.log));
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
  expect(failures, 'FAILED/SKIPPED/INTERRUPTED modules').toEqual([]);
});
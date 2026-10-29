// SPDX-FileCopyrightText: Copyright Logically Magic Inc. <hello@logicallymagic.com>
// SPDX-FileCopyrightText: Copyright Hamid Jahanzad <Hamid@Jahanzad.com>
// SPDX-License-Identifier: Apache-2.0

// tests/oidc-config.spec.ts - OIDC Core: Config OP - the certification plan.
//
// The Config plan (oidcc-config-certification-test-plan) is the
// discovery-completeness family: ONE variant axis pair (server=discovery,
// client_registration=static_client) - the same two seeded static clients
// the Basic plan uses (client_secret_basic + client_secret_post).
//
// Campaign rule (auth DESIGN §9a.10/§9a.11): every module terminal, no
// FAILED/SKIPPED/INTERRUPTED, zero warnings.

import { test, expect, type Page } from '@playwright/test';
import { SuiteApi, ACCEPTABLE, standardBrowserAutomation, type SuiteTestConfig,
  type SuiteClientConfig } from '../fixtures/suite.js';
import { runModule, planResults } from '../fixtures/runner.js';
import { certDiscoveryUrl, suiteCallback, CONFORMANCE_ALIAS, certAuthHost, resultsDir, seedOutPath } from '../fixtures/env.js';
import { logStep, stepLog } from '../fixtures/log.js';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let suiteApi: SuiteApi;
let page: Page;
let planId: string;
const config: SuiteTestConfig = {
  alias: CONFORMANCE_ALIAS,
 description: 'Sentin8 auth certification run - OIDC Core Config ( warning-zero)',
  server: { discoveryUrl: certDiscoveryUrl() },
  client: (JSON.parse(process.env.OIDF_CLIENT_BASIC ?? 'null') ?? {
    client_id: process.env.OIDF_BASIC_CLIENT_ID ?? '',
    client_secret: process.env.OIDF_BASIC_CLIENT_SECRET ?? '',
    scope: 'openid profile email phone address offline_access',
    redirect_uri: suiteCallback(),
    token_endpoint_auth_method: 'client_secret_basic',
  }) as SuiteClientConfig,
  client2: (JSON.parse(process.env.OIDF_CLIENT_POST ?? 'null') ?? {
    client_id: process.env.OIDF_POST_CLIENT_ID ?? '',
    client_secret: process.env.OIDF_POST_CLIENT_SECRET ?? '',
    scope: 'openid profile email phone address offline_access',
    redirect_uri: suiteCallback(),
    token_endpoint_auth_method: 'client_secret_post',
  }) as SuiteClientConfig,
};
const harnessBrowserBlock = standardBrowserAutomation();

function loadSeededClients(): void {
  const seedOut = process.env.OIDF_SEED_OUT ?? seedOutPath();
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
  if (postId && postSecret && !config.client2?.client_id) {
    config.client2 = { ...config.client2, client_id: postId, client_secret: postSecret };
  }
}

test.beforeAll(async ({ browser }) => {
  loadSeededClients();
  expect(config.client?.client_id, 'seeded basic client id').toBeTruthy();
  expect(config.client2?.client_id, 'seeded post client id').toBeTruthy();
  await SuiteApi.waitAuthReady();
  suiteApi = new SuiteApi();
  logStep(`creating plan: ${config.description}`);
  // The plan HARD-CODES its variant tuple (discovery + static_client) -
  // the createPlan variant param must stay EMPTY (the suite rejects a
  // user-selected variant the plan already fixes).
  const plan = await suiteApi.createPlan(
    'oidcc-config-certification-test-plan',
    config,
    {},
  );
  planId = plan.id;
  logStep(`plan ${planId}: ${plan.modules.length} modules`);

  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  page = await ctx.newPage();
});

test.afterAll(async () => {
  writeFileSync(join(resultsDir(), 'oidc-config-steps.log'), stepLog());
  if (planId) writeFileSync(join(resultsDir(), 'oidc-config-plan.txt'), planId);
});

test('OIDC Core Config OP - run every module to terminal, zero-warning green', async ({ browser }) => {
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
    expect(run.status, `${m.testModule} must finish (not INTERRUPTED)`).toBe('FINISHED');
    expect(run.result, `${m.testModule} must not fail`).not.toMatch(/FAILED|SKIPPED|INTERRUPTED/);
    if (run.warnings.length > 0) {
      failures.push(`${m.testModule}: ${run.warnings.join(' | ')}`);
    }
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
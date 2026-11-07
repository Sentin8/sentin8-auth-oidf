// SPDX-FileCopyrightText: Copyright Logically Magic Inc. <hello@logicallymagic.com>
// SPDX-FileCopyrightText: Copyright Hamid Jahanzad <Hamid@Jahanzad.com>
// SPDX-License-Identifier: Apache-2.0

// tests/sessionmgmt.spec.ts - the Session-OP trio (auth DESIGN §9a.26):
// the THREE small certifiable plans over the logout stack -
//   oidcc-session-management-certification-test-plan (Session OP)
//   oidcc-3rdparty-init-login-certification-test-plan (3rd Party-Init OP)
//   oidcc-backchannel-rp-initiated-logout-certification-test-plan (Back-Channel OP)
//
// Campaign rule: every module terminal, no FAILED/SKIPPED/INTERRUPTED
// (§9a.10), zero WARNINGs (§9a.11).

import { test, expect, type Page } from '@playwright/test';
import { SuiteApi, ACCEPTABLE, standardBrowserAutomation, browserAutomationFor, type SuiteTestConfig } from '../fixtures/suite.js';
import { runModule, planResults } from '../fixtures/runner.js';
import { certDiscoveryUrl, suiteCallback, suiteCibaNotification, CONFORMANCE_ALIAS, resultsDir, seedOutPath } from '../fixtures/env.js';
import { logStep, stepLog } from '../fixtures/log.js';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let suiteApi: SuiteApi;
let page: Page;
const planIds: string[] = [];

const config: SuiteTestConfig = {
  alias: CONFORMANCE_ALIAS,
  description: 'Sentin8 auth certification run - Session/3rdparty/Backchannel OP (zero-warning)',
  server: { discoveryUrl: certDiscoveryUrl() },
};

// The suite's post-logout + backchannel landing paths (the same
// suite-hosted routes the logout spec registers).
function suiteLogoutRoutes(): { postLogout: string; backchannelLogout: string } {
  const base = suiteCallback().replace(/\/callback$/, '');
  return {
    postLogout: `${base}/post_logout_redirect`,
    backchannelLogout: `${base}/backchannel_logout`,
  };
}

function loadSeededClients(): void {
  const seedOut = process.env.OIDF_SEED_OUT ?? seedOutPath();
  if (!existsSync(seedOut)) return;
  const text = readFileSync(seedOut, 'utf8');
  const get = (k: string) => text.match(new RegExp(`${k}=([a-f0-9]+)`))?.[1];
  const basicId = get('client_id\\(basic\\)');
  const basicSecret = get('client_secret\\(basic\\)');
  const routes = suiteLogoutRoutes();
  if (basicId && basicSecret && !config.client?.client_id) {
    config.client = {
      client_id: basicId,
      client_secret: basicSecret,
      scope: 'openid profile email phone address offline_access',
      redirect_uri: suiteCallback(),
      post_logout_redirect_uris: [routes.postLogout],
      backchannel_logout_uri: routes.backchannelLogout,
      token_endpoint_auth_method: 'client_secret_basic',
    };
  }
}

const harnessBrowserBlock = standardBrowserAutomation();

test.beforeAll(async ({ browser }) => {
  loadSeededClients();
  expect(config.client?.client_id, 'seeded basic client id').toBeTruthy();
  await SuiteApi.waitAuthReady();
  suiteApi = new SuiteApi();
  logStep('creating plans: session-management + 3rdparty-init-login + backchannel-rp-initiated-logout');
  const baseVariant = { server_metadata: 'discovery', client_registration: 'static_client' };
  const plans = [
    ['oidcc-session-management-certification-test-plan', baseVariant],
    ['oidcc-3rdparty-init-login-certification-test-plan', { server_metadata: 'discovery', client_registration: 'dynamic_client' }],
    ['oidcc-backchannel-rp-initiated-logout-certification-test-plan', baseVariant],
  ] as const;
  for (const [planName, variant] of plans) {
    const plan = await suiteApi.createPlan(planName, config, variant);
    planIds.push(plan.id);
    logStep(`plan ${planName} -> ${plan.id}: ${plan.modules.length} modules`);
  }
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  page = await ctx.newPage();
});

test.afterAll(async () => {
  writeFileSync(join(resultsDir(), 'sessionmgmt-steps.log'), stepLog());
  if (planIds.length > 0) writeFileSync(join(resultsDir(), 'sessionmgmt-plans.txt'), planIds.join('\n'));
});

test('Session + 3rdparty + Backchannel OP - run every module to terminal, zero-warning green', async ({ browser }) => {
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
        { ...config, browser: browserAutomationFor(m.testModule) });
      expect(run.status, `${m.testModule} must finish (not INTERRUPTED)`).toBe('FINISHED');
      expect(run.result, `${m.testModule} must not fail`).not.toMatch(/FAILED|SKIPPED|INTERRUPTED/);
      if (run.warnings.length > 0) {
        failures.push(`${m.testModule}: ${run.warnings.join(' | ')}`);
      }
      const out = join(resultsDir(), 'logs');
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, `sessionmgmt-${m.testModule}.json`), JSON.stringify(run.log));
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

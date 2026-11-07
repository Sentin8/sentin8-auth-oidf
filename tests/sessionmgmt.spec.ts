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
import { certDiscoveryUrl, suiteCallback, CONFORMANCE_ALIAS, resultsDir, seedOutPath } from '../fixtures/env.js';
import { logStep, stepLog } from '../fixtures/log.js';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let suiteApi: SuiteApi;
let page: Page;
const planIds: string[] = [];

const config: SuiteTestConfig = {
  alias: CONFORMANCE_ALIAS,
  description: 'Sentin8 auth certification run - Session/3rdparty/Backchannel OP',
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
  // The plans PIN server_metadata on their discovery entries - passing
  // it ALSO 400s ("Variant ... already sets this variant"). Only the
  // UNPINNED axes ride the create (client_registration for the
  // session static cells; the 3rdparty plan pins dynamic_client
  // registration on its modules - the create carries ONLY the free
  // axis (response_type): the suite matches the variant EXACTLY at
  // module level; a user-set value on a pinned axis rejects).
  const baseVariant = { response_type: 'code', client_registration: 'static_client' };
  // The Back-Channel OP module registers ITS OWN client (dynamic):
  // the suite's DCR request carries backchannel_logout_uri +
  // backchannel_logout_session_required:true (OIDC Back-Channel
  // Logout 1.0 §2.2 - the RP metadata surface the plan certifies).
  // The fanout target therefore reaches the OP through the STANDARD
  // registration surface, exactly as a real RP would register - the
  // plan's config `client` object is only consumed by the SUITE (its
  // own bc receiver) and never reaches the OP (GetStaticClientConfiguration
  // reads it verbatim), so a static client here would leave the OP
  // with no bc target to POST to (the module stalls WAITING for the
  // back-channel request). The session_clients binding (auth DESIGN
  // 9a.26) keeps the SM run's fanout empty: the SM module's client is
  // not bc-registered, so a stray POST can never reach it.
  const bcVariant = { response_type: 'code', client_registration: 'dynamic_client' };
  const plans = [
    ['oidcc-session-management-certification-test-plan', baseVariant],
    // The 3rd-party plan's modules pin client_registration=dynamic_client
    // + the base OIDC axes' response_type requirement rides the 3p
    // module too (it extends the shared base).
    ['oidcc-3rdparty-init-login-certification-test-plan', { response_type: 'code' }],
    ['oidcc-backchannel-rp-initiated-logout-certification-test-plan', bcVariant],
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

test('Session + 3rdparty + Backchannel OP - run every module to terminal', async ({ browser }) => {
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

// SPDX-FileCopyrightText: Copyright Logically Magic Inc. <hello@logicallymagic.com>
// SPDX-FileCopyrightText: Copyright Hamid Jahanzad <Hamid@Jahanzad.com>
// SPDX-License-Identifier: Apache-2.0

// tests/formpost.spec.ts - the OIDF `Form Post OP` profile (auth DESIGN
// §9a.25): the THREE formpost suite plans (basic/hybrid/implicit re-lists
// with response_mode=form_post) driven over the cert-fp env.
//
// The OP's authorize response is the §9a.25 one-time HTML form (the
// OP-hosted `/oauth/form-post/{ref}` continuation page); the callback
// receives an HTTP POST with NO parameters in the URL.
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
  description: 'Sentin8 auth certification run - Form Post OP',
  server: { discoveryUrl: certDiscoveryUrl() },
};

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
    config.client = {
      client_id: basicId,
      client_secret: basicSecret,
      scope: 'openid profile email phone address offline_access',
      redirect_uri: suiteCallback(),
      token_endpoint_auth_method: 'client_secret_basic',
    };
  }
  if (postId && postSecret && !config.client2?.client_id) {
    config.client2 = {
      client_id: postId,
      client_secret: postSecret,
      scope: 'openid profile email phone address offline_access',
      redirect_uri: suiteCallback(),
      token_endpoint_auth_method: 'client_secret_post',
    } as SuiteTestConfig['client2'];
  }
}

const harnessBrowserBlock = standardBrowserAutomation();

test.beforeAll(async ({ browser }) => {
  loadSeededClients();
  expect(config.client?.client_id, 'seeded basic client id').toBeTruthy();
  expect(config.client2?.client_id, 'seeded post client id').toBeTruthy();
  await SuiteApi.waitAuthReady();
  suiteApi = new SuiteApi();
  logStep('creating plans: formpost (basic + hybrid + implicit)');
  const baseVariant = { client_registration: 'static_client' };
  // The THREE plans (the Form Post OP profile covers all three).
  const basicPlan = await suiteApi.createPlan(
    'oidcc-formpost-basic-certification-test-plan',
    config,
    baseVariant,
  );
  planIds.push(basicPlan.id);
  logStep(`basic plan ${basicPlan.id}: ${basicPlan.modules.length} modules`);
  const hybridPlan = await suiteApi.createPlan(
    'oidcc-formpost-hybrid-certification-test-plan',
    config,
    baseVariant,
  );
  planIds.push(hybridPlan.id);
  logStep(`hybrid plan ${hybridPlan.id}: ${hybridPlan.modules.length} modules`);
  const implicitPlan = await suiteApi.createPlan(
    'oidcc-formpost-implicit-certification-test-plan',
    config,
    baseVariant,
  );
  planIds.push(implicitPlan.id);
  logStep(`implicit plan ${implicitPlan.id}: ${implicitPlan.modules.length} modules`);
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  page = await ctx.newPage();
});

test.afterAll(async () => {
  writeFileSync(join(resultsDir(), 'formpost-steps.log'), stepLog());
  if (planIds.length > 0) writeFileSync(join(resultsDir(), 'formpost-plans.txt'), planIds.join('\n'));
});

test('Form Post OP - run every module to terminal', async ({ browser }) => {
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
        // The plan's pinned axes ride the runner create (the response_mode
        // cell axis selects the module instance - without it the create
        // 500s "Missing value for required variant parameter").
        (m.variant ?? undefined) as Record<string, string> | undefined);
      expect(run.status, `${m.testModule} must finish (not INTERRUPTED)`).toBe('FINISHED');
      expect(run.result, `${m.testModule} must not fail`).not.toMatch(/FAILED|SKIPPED|INTERRUPTED/);
      if (run.warnings.length > 0) {
        failures.push(`${m.testModule}: ${run.warnings.join(' | ')}`);
      }
      const out = join(resultsDir(), 'logs');
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, `formpost-${m.testModule}.json`), JSON.stringify(run.log));
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

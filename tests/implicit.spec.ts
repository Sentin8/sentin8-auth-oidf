// SPDX-FileCopyrightText: Copyright Logically Magic Inc. <hello@logicallymagic.com>
// SPDX-FileCopyrightText: Copyright Hamid Jahanzad <Hamid@Jahanzad.com>
// SPDX-License-Identifier: Apache-2.0

// tests/implicit.spec.ts - OIDC Core: Implicit - the certification plan
// (profile family; auth DESIGN §9a.25).
//
// Two pinned cells (response_type=id_token | id_token token): every
// module terminal - no FAILED/SKIPPED/INTERRUPTED (§9a.10), zero
// WARNINGs inside every module's log (§9a.11).
//
// The OP side is the §9a.13 fragment cells (nonce mandatory for the
// id_token-bearing types; at_hash rides every id_token; the fragment
// error channel mirrors the success channel). The suite's browser
// driver extracts location.hash and POSTs it to the suite's
// implicit_submit path - the OP only performs the standard 302.

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
  description: 'Sentin8 auth certification run - OIDC Implicit',
  server: { discoveryUrl: certDiscoveryUrl() },
};

// The seeded basic client (client_secret_basic - the plan's hard pin;
// the implicit cells never use the secret at the browser side, the
// metadata carries it for the config contract).
function loadSeededClients(): void {
  const seedOut = process.env.OIDF_SEED_OUT ?? seedOutPath();
  if (!existsSync(seedOut)) return;
  const text = readFileSync(seedOut, 'utf8');
  const get = (k: string) => text.match(new RegExp(`${k}=([a-f0-9]+)`))?.[1];
  const basicId = get('client_id\\(basic\\)');
  const basicSecret = get('client_secret\\(basic\\)');
  if (basicId && basicSecret && !config.client?.client_id) {
    config.client = {
      client_id: basicId,
      client_secret: basicSecret,
      scope: 'openid profile email phone address',
      redirect_uri: suiteCallback(),
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
  logStep('creating plans: implicit');
  // The implicit plan PINS response_type (its two cells: id_token /
  // id_token token), client_auth_type (client_secret_basic) AND
  // response_mode (default) on its module entries - the suite expands
  // the two pinned cells automatically and 400s on any user-set value
  // for a pinned axis ("Variant ... already sets this variant"). The
  // create carries ONLY the free axes: server_metadata (the module's
  // discovery resolution) + client_registration.
  const plan = await suiteApi.createPlan(
    'oidcc-implicit-certification-test-plan',
    config,
    { server_metadata: 'discovery', client_registration: 'static_client' },
  );
  planIds.push(plan.id);
  logStep(`plan ${plan.id}: ${plan.modules.length} module-variants`);
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  page = await ctx.newPage();
});

test.afterAll(async () => {
  writeFileSync(join(resultsDir(), 'implicit-steps.log'), stepLog());
  if (planIds.length > 0) writeFileSync(join(resultsDir(), 'implicit-plans.txt'), planIds.join('\n'));
});

test('OIDC Implicit - run every module to terminal', async ({ browser }) => {
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
        // The plan's pinned axes ride the runner create (the SAME
        // module name exists in BOTH cells - response_type selects the
        // cell; without it the create 500s "Missing value for required
        // variant parameter: response_type").
        m.variant ?? undefined);
      expect(run.status, `${m.testModule} must finish (not INTERRUPTED)`).toBe('FINISHED');
      expect(run.result, `${m.testModule} must not fail`).not.toMatch(/FAILED|SKIPPED|INTERRUPTED/);
      if (run.warnings.length > 0) {
        failures.push(`${m.testModule}: ${run.warnings.join(' | ')}`);
      }
      const out = join(resultsDir(), 'logs');
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, `implicit-${m.testModule}.json`), JSON.stringify(run.log));
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

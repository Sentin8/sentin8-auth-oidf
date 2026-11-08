// SPDX-FileCopyrightText: Copyright Logically Magic Inc. <hello@logicallymagic.com>
// SPDX-FileCopyrightText: Copyright Hamid Jahanzad <Hamid@Jahanzad.com>
// SPDX-License-Identifier: Apache-2.0

// tests/hybrid.spec.ts - OIDC Core: Hybrid - the certification plan
// (profile family; auth DESIGN §9a.25).
//
// Three pinned response-type entries (code id_token | code token |
// code id_token token): every module terminal - no FAILED/SKIPPED/
// INTERRUPTED (§9a.10), zero WARNINGs inside every module's log
// (§9a.11).
//
// The OP side is the §9a.13 fragment cells PLUS the token endpoint's
// code exchange: fragment id_tokens carry c_hash (the code binding)
// and at_hash only when an access token rides the fragment; auth-code
// single-use rejects the reuse with invalid_grant (the burned-code
// cascade §9a.11); the fragment error channel mirrors the success
// channel (the nonce-mandatory gate rides it too).

import { test, expect, type Page } from '@playwright/test';
import { SuiteApi, ACCEPTABLE, standardBrowserAutomation, browserAutomationFor,
  type SuiteClientConfig, type SuiteTestConfig } from '../fixtures/suite.js';
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
  description: 'Sentin8 auth certification run - OIDC Hybrid',
  server: { discoveryUrl: certDiscoveryUrl() },
};

// The seeded basic + post clients (the plan's pinned client_auth_type
// cells: client_secret_basic on every entry + one client_secret_post
// module).
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
      scope: 'openid profile email phone address',
      redirect_uri: suiteCallback(),
      token_endpoint_auth_method: 'client_secret_basic',
    };
  }
  if (postId && postSecret && !config.client2?.client_id) {
    config.client2 = {
      client_id: postId,
      client_secret: postSecret,
      scope: 'openid profile email phone address',
      redirect_uri: suiteCallback(),
      token_endpoint_auth_method: 'client_secret_post',
    } as SuiteClientConfig;
    // The client_secret_post VARIANT module reads this dedicated key
    // (the client2 twin - the basic spec's own contract; the suite
    // wants the key present even though the registration is shared).
    config.client_secret_post = {
      client_id: postId,
      client_secret: postSecret,
      scope: 'openid profile email phone address',
      redirect_uri: suiteCallback(),
      token_endpoint_auth_method: 'client_secret_post',
    } as SuiteClientConfig;
  }
}

const harnessBrowserBlock = standardBrowserAutomation();

test.beforeAll(async ({ browser }) => {
  loadSeededClients();
  expect(config.client?.client_id, 'seeded basic client id').toBeTruthy();
  expect(config.client2?.client_id, 'seeded post client id').toBeTruthy();
  await SuiteApi.waitAuthReady();
  suiteApi = new SuiteApi();
  logStep('creating plans: hybrid');
  // The hybrid plan PINS response_type (its three cells), client_auth_type
  // and response_mode on its module entries - the create carries ONLY
  // the free axes: server_metadata + client_registration. The plan
  // expands the three pinned cells automatically.
  const plan = await suiteApi.createPlan(
    'oidcc-hybrid-certification-test-plan',
    config,
    { server_metadata: 'discovery', client_registration: 'static_client' },
  );
  planIds.push(plan.id);
  logStep(`plan ${plan.id}: ${plan.modules.length} module-variants`);
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  page = await ctx.newPage();
});

test.afterAll(async () => {
  writeFileSync(join(resultsDir(), 'hybrid-steps.log'), stepLog());
  if (planIds.length > 0) writeFileSync(join(resultsDir(), 'hybrid-plans.txt'), planIds.join('\n'));
});

test('OIDC Hybrid - run every module to terminal', async ({ browser }) => {
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
        // module name exists in THREE cells - response_type selects
        // the cell; without it the create 500s "Missing value for
        // required variant parameter: response_type").
        m.variant ?? undefined);
      expect(run.status, `${m.testModule} must finish (not INTERRUPTED)`).toBe('FINISHED');
      expect(run.result, `${m.testModule} must not fail`).not.toMatch(/FAILED|SKIPPED|INTERRUPTED/);
      if (run.warnings.length > 0) {
        failures.push(`${m.testModule}: ${run.warnings.join(' | ')}`);
      }
      const out = join(resultsDir(), 'logs');
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, `hybrid-${m.testModule}.json`), JSON.stringify(run.log));
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

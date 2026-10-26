// SPDX-FileCopyrightText: Copyright Logically Magic Inc. <hello@logicallymagic.com>
// SPDX-License-Identifier: Apache-2.0

// tests/smoke.spec.ts - ONE module end-to-end (the harness boot check):
// plan creation + a single oidcc-server run through the Flutter auth-ui.
// NOT part of a certification campaign - a fast gate that the wiring
// (fleet up, suite up, seed in, SPA built) is live before a full run.

import { test, expect } from '@playwright/test';
import { SuiteApi, standardBrowserAutomation, type SuiteTestConfig } from '../fixtures/suite.js';
import { runModule } from '../fixtures/runner.js';
import { certDiscoveryUrl, suiteCallback, CONFORMANCE_ALIAS, resultsDir, seedOutPath } from '../fixtures/env.js';
import { logStep, stepLog } from '../fixtures/log.js';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let suiteApi: SuiteApi;
let planId: string;

function loadSeededClients(): { basic: string; basicSecret: string; post: string; postSecret: string } {
  const seedOut = process.env.OIDF_SEED_OUT ?? seedOutPath();
  if (!existsSync(seedOut)) throw new Error(`no seed-out at ${seedOut} - run make conformance-seed`);
  const text = readFileSync(seedOut, 'utf8');
  const get = (k: string) => text.match(new RegExp(`${k}=([a-f0-9]+)`))?.[1];
  return {
    basic: get('client_id\\(basic\\)') ?? '',
    basicSecret: get('client_secret\\(basic\\)') ?? '',
    post: get('client_id\\(post\\)') ?? '',
    postSecret: get('client_secret\\(post\\)') ?? '',
  };
}

test('smoke: oidcc-server completes through the Flutter auth-ui', async ({ browser }) => {
  test.setTimeout(240_000);
  const c = loadSeededClients();
  expect(c.basic, 'seeded basic client').toBeTruthy();

  const config: SuiteTestConfig = {
    alias: CONFORMANCE_ALIAS,
    description: 'Sentin8 smoke run (harness wiring check)',
    server: { discoveryUrl: certDiscoveryUrl() },
    client: {
      client_id: c.basic,
      client_secret: c.basicSecret,
      scope: 'openid profile email phone address offline_access',
      redirect_uri: suiteCallback(),
      token_endpoint_auth_method: 'client_secret_basic',
    },
    client2: {
      client_id: c.post,
      client_secret: c.postSecret,
      scope: 'openid profile email phone address offline_access',
      redirect_uri: suiteCallback(),
      token_endpoint_auth_method: 'client_secret_post',
    },
  };
  // The browser block is HARNESS-LOCAL (never sent to the suite - the
  // server's WebRunner would try to execute `callBridge` and fail):
  // runModule() matches exposed URLs against it and drives our page.
  const harnessBrowserBlock = standardBrowserAutomation();

  await SuiteApi.waitAuthReady();
  suiteApi = new SuiteApi();
  const plan = await suiteApi.createPlan(
    'oidcc-basic-certification-test-plan',
    config,
    { server_metadata: 'discovery', client_registration: 'static_client' },
  );
  planId = plan.id;
  logStep(`smoke plan ${planId}`);

  const page = await browser.newPage({ ignoreHTTPSErrors: true });
  const run = await runModule(suiteApi, browser, planId, 'oidcc-server',
    { ...config, browser: harnessBrowserBlock }, 150_000);
  await page.close();

  logStep(`smoke result: ${run.result} (${run.status}) warnings=${run.warnings.length}`);
  expect(['FINISHED']).toContain(run.status ?? '');
  expect(['PASSED', 'WARNING', 'REVIEW', 'FINISHED']).toContain(run.result ?? run.status ?? '');
}, );
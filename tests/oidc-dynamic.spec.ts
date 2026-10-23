// SPDX-FileCopyrightText: Copyright Logically Magic Inc. <hello@logicallymagic.com>
// SPDX-FileCopyrightText: Copyright Hamid Jahanzad <Hamid@Jahanzad.com>
// SPDX-License-Identifier: Apache-2.0

// tests/oidc-dynamic.spec.ts - OIDC Core: Dynamic OP - the certification plan.
//
// The Dynamic plan (oidcc-dynamic-certification-test-plan) exercises
// RFC 7591 dynamic client registration: the SUITE registers its own
// client(s) at /oauth/register at module runtime, then drives the
// standard code flow. The plan's module-variant axes (from the suite
// bytecode): server=discovery x client_registration=dynamic_client x
// client_auth_type=private_key_jwt x response_mode=default.
//
// The OP-side prerequisite (auth DESIGN §9a.3 Dynamic OP row): anonymous
// DCR is OPEN for interactive clients (auth-code flows) on the cert
// tenant - the registered client needs redirect_uris pointing at the
// suite callback, which the suite supplies in its registration request.
//
// Campaign rule (auth DESIGN §9a.10/§9a.11): every module terminal, no
// FAILED/SKIPPED/INTERRUPTED, zero warnings.

import { test, expect } from '@playwright/test';
import { SuiteApi, ACCEPTABLE, standardBrowserAutomation, type SuiteTestConfig } from '../fixtures/suite.js';
import { runModule, planResults } from '../fixtures/runner.js';
import { certDiscoveryUrl, CONFORMANCE_ALIAS, resultsDir } from '../fixtures/env.js';
import { logStep, stepLog } from '../fixtures/log.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

let suiteApi: SuiteApi;
let planId: string;
const config: SuiteTestConfig = {
  alias: CONFORMANCE_ALIAS,
  description: 'Sentin8 auth certification run - OIDC Core Dynamic (OC-13 warning-zero)',
  server: { discoveryUrl: certDiscoveryUrl() },
} as SuiteTestConfig;

const harnessBrowserBlock = standardBrowserAutomation();

test.beforeAll(async () => {
  await SuiteApi.waitAuthReady();
  suiteApi = new SuiteApi();
  logStep(`creating plan: ${config.description}`);
});

test.afterAll(async () => {
  writeFileSync(join(resultsDir(), 'oidc-dynamic-steps.log'), stepLog());
  if (planId) writeFileSync(join(resultsDir(), 'oidc-dynamic-plan.txt'), planId);
});

test('OIDC Core Dynamic OP - run every module-variant to terminal, zero-warning green', async ({ browser }) => {
  test.setTimeout(1_800_000);
  const onlyList = (process.env.OIDF_MODULES ?? '')
    .split(',').map((x) => x.trim()).filter(Boolean);
  const failures: string[] = [];

  // The plan's module groups each carry a FIXED variant tuple (the
  // suite bytecode hard-codes them: DCR+private_key_jwt for the flow
  // family, dynamic_client-only for discovery verification, defaults
  // for the rotation/request-uri families). The user variant MUST stay
  // empty - the suite rejects any override.
  const plan = await suiteApi.createPlan(
    'oidcc-dynamic-certification-test-plan',
    config,
    // response_type is USER-selectable on this plan (every flow module
    // requires it); the code flow is the platform's (and the RFC 7591
    // family's) only supported response type.
    { response_type: 'code' },
  );
  planId = plan.id;
  logStep(`plan ${planId}: ${plan.modules.length} module-variants`);
  {
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
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
      // STRICT warning-zero. The one-time "unregister-on-alias-claim"
      // sanction is gone: the 404-unregister warning class was an OP
      // defect - the live auth DB was missing the
      // auth_oauth_clients_delete_policy RLS policy, so the suite's RFC
      // 7592 cleanup deleted 0 rows and every module's post-flow
      // unregister warned (run18: 12 WARNING). The policy is reconciled
      // with sql/init.sql; DELETE /oauth/register/{id} now answers 204
      // (run19: PASSED=16, REVIEW=7, WARNING=0). If this class ever
      // reappears it is a REAL defect and must fail this gate.
      expect(run.status, `${m.testModule} must finish (not INTERRUPTED)`).toBe('FINISHED');
      expect(run.result, `${m.testModule} must not fail`).not.toMatch(/FAILED|SKIPPED|INTERRUPTED/);
      if (run.warnings.length > 0) {
        failures.push(`${m.testModule}: ${run.warnings.join(' | ')}`);
      }
      const out = join(resultsDir(), 'logs');
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, `oidc-dynamic-${m.testModule}.json`), JSON.stringify(run.log));
    }
    await page.close();
  }
  expect(failures, `warning-zero violations:\n${failures.join('\n')}`).toEqual([]);
});

test('plan-level results are all acceptable', async () => {
  test.skip(!!(process.env.OIDF_MODULES ?? '').trim(), 'singles run - plan gate skipped');
  const results = await planResults(suiteApi, planId);
  const bad = [...results.entries()].filter(([, r]) => r && !ACCEPTABLE.has(r));
  expect(bad, 'FAILED/SKIPPED/INTERRUPTED modules').toEqual([]);
});
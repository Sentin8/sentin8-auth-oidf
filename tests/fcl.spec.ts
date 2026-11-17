// SPDX-FileCopyrightText: Copyright Logically Magic Inc. <hello@logicallymagic.com>
// SPDX-FileCopyrightText: Copyright Hamid Jahanzad <Hamid@Jahanzad.com>
// SPDX-License-Identifier: Apache-2.0.

// tests/fcl.spec.ts - the OIDC Front-Channel Logout OP family
// (oidcc-frontchannel-rp-initiated-logout-certification-test-plan,
// auth DESIGN §9a.28).
//
// The cert env (cert-fcl) runs the plain OIDC posture; the seeded client
// (cert-fcl) registers frontchannel_logout_uri (the suite callback path
// /frontchannel-logout - the OP's logout-done page embeds the iframe
// there with iss + sid) + frontchannel_logout_session_required (the
// iframe call must carry sid).
//
// The plan's modules: discovery verification (the frontchannel flags),
// the FCL happy flow (the logout lands the iframes), the
// session-required negative, and the bad-logout-uri registration
// negative (a URI with a query string rejects).
//
// Campaign rules: every module terminal (no FAILED/SKIPPED/INTERRUPTED),
// zero WARNINGs (§9a.10/§9a.11).

import { test, expect } from '@playwright/test';
import { SuiteApi, ACCEPTABLE, standardBrowserAutomation, browserAutomationFor, type SuiteTestConfig } from '../fixtures/suite.js';
import { runModule, planResults } from '../fixtures/runner.js';
import {
  certDiscoveryUrl, certAuthHost, suiteCallback, CONFORMANCE_ALIAS, resultsDir, seedOutPath, suiteFrontchannelLogout,
} from '../fixtures/env.js';
import { logStep, stepLog } from '../fixtures/log.js';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let suiteApi: SuiteApi;
let planId: string;

const config: SuiteTestConfig = {
  alias: CONFORMANCE_ALIAS,
  description: 'Sentin8 auth certification run - Front-Channel Logout OP',
  server: { discoveryUrl: certDiscoveryUrl() },
};

const harnessBrowserBlock = standardBrowserAutomation();

// The seeded FCL client: client_secret_basic + the registered
// frontchannel_logout_uri + the session-required demand. The seed-out
// carries the id + secret.
function seededFclClient(): { client_id: string; client_secret: string } | null {
  const seedOut = process.env.OIDF_SEED_OUT ?? seedOutPath();
  if (!existsSync(seedOut)) return null;
  const text = readFileSync(seedOut, 'utf8');
  const cid = text.match(/client_id\(fcl\)=([a-f0-9]+)/)?.[1];
  const secret = text.match(/client_secret\(fcl\)=([^\s]+)/)?.[1];
  if (!cid || !secret) return null;
  return { client_id: cid, client_secret: secret };
}

test.beforeAll(async () => {
  await SuiteApi.waitAuthReady();
  suiteApi = new SuiteApi();
  logStep(`creating plan: ${config.description}`);
});

test.afterAll(async () => {
  writeFileSync(join(resultsDir(), 'fcl-steps.log'), stepLog());
  if (planId) writeFileSync(join(resultsDir(), 'fcl-plan.txt'), planId);
});

test('Front-Channel Logout OP - run every module to terminal', async ({ browser }) => {
  test.setTimeout(1_800_000);
  const onlyList = (process.env.OIDF_MODULES ?? '')
    .split(',').map((x) => x.trim()).filter(Boolean);
  const failures: string[] = [];
  const fclClient = seededFclClient();
  if (!fclClient) {
    failures.push('seeded FCL client missing - re-run the seed with CONFORMANCE_PROFILE=fcl');
  } else {
    const plan = await suiteApi.createPlan(
      'oidcc-frontchannel-rp-initiated-logout-certification-test-plan',
      {
        ...config,
        client: {
          client_id: fclClient.client_id,
          client_secret: fclClient.client_secret,
          client_auth_type: 'client_secret_basic',
          token_endpoint_auth_method: 'client_secret_basic',
          scope: 'openid profile email',
          redirect_uri: suiteCallback(),
          frontchannel_logout_uri: suiteFrontchannelLogout(),
          frontchannel_logout_session_required: true,
        },
        client2: {
          client_id: fclClient.client_id,
          client_secret: fclClient.client_secret,
          client_auth_type: 'client_secret_basic',
          token_endpoint_auth_method: 'client_secret_basic',
          scope: 'openid profile email',
          redirect_uri: suiteCallback(),
          frontchannel_logout_uri: suiteFrontchannelLogout(),
          frontchannel_logout_session_required: true,
        },
      },
      // The plan's variant axes: the suite requires client_registration
      // (static_client - the seeded cert-fcl client) + response_type (the
      // code flow) at plan create; the OTHER axes resolve server-side
      // from the plan's modules - the per-entry dict rides the runner
      // create (the duplicate contract).
      { client_registration: 'static_client', response_type: 'code' },
    );
    planId = plan.id;
    logStep(`plan ${planId}: ${plan.modules.length} module-variants`);
    {
      const page = await browser.newPage({ ignoreHTTPSErrors: true });
      for (const modEntry of (await suiteApi.getPlan(planId)).modules) {
        const m = modEntry;
        const ownVariant = (m.variant ?? {}) as Record<string, string>;
        if (onlyList.length > 0 && !onlyList.includes(m.testModule)) {
          logStep(`SKIP-ONLY ${m.testModule}`);
          continue;
        }
        if (m.result) {
          logStep(`SKIP ${m.testModule} (already ${m.result})`);
          continue;
        }
        const run = await runModule(suiteApi, browser, planId, m.testModule,
          { ...config, browser: browserAutomationFor(m.testModule) },
          /frontchannel/i.test(m.testModule) ? 600_000 : undefined,
          ownVariant);
        // Export the module log BEFORE the assertions - a FAILED module
        // still exports its log (the diagnosis surface; the run-1
        // FAILED run left no log to read).
        {
          const out = join(resultsDir(), 'logs');
          mkdirSync(out, { recursive: true });
          writeFileSync(join(out, `fcl-${m.testModule}.json`), JSON.stringify(run.log));
        }
        expect(run.status, `${m.testModule} must finish (not INTERRUPTED)`).toBe('FINISHED');
        expect(run.result, `${m.testModule} must not fail/skip`).not.toMatch(/FAILED|SKIPPED|INTERRUPTED/);
        if (run.warnings.length > 0) {
          failures.push(`${m.testModule}: ${run.warnings.join(' | ')}`);
        }
      }
      await page.close();
    }
  }
  expect(failures, `warning-zero violations:\n${failures.join('\n')}`).toEqual([]);
});

test('plan-level results are all acceptable', async () => {
  test.skip(!!(process.env.OIDF_MODULES ?? '').trim(), 'singles run - plan gate skipped');
  const results = await planResults(suiteApi, planId);
  const bad = [...results.entries()].filter(([, r]) => r && !ACCEPTABLE.has(r));
  expect(bad, 'FAILED/SKIPPED/INTERRUPTED modules').toEqual([]);
});

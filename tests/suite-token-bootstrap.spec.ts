// SPDX-FileCopyrightText: Copyright Logically Magic Inc. <hello@logicallymagic.com>
// SPDX-FileCopyrightText: Copyright Hamid Jahanzad <Hamid@Jahanzad.com>
// SPDX-License-Identifier: Apache-2.0

// tests/suite-token-bootstrap.spec.ts - the HOSTED-suite token bootstrap
// (auth DESIGN 9a.2d item 3): the ONE interactive step of the hosted
// target. The OIDF production instance requires a real Google/GitLab
// sign-in (no devmode dummy user), and its /api/** chain is an OAuth2
// resource server: calls ride an opaque API bearer token minted through
// POST /api/token under a signed-in session.
//
// Flow:
//   1. open the suite in the browser (headed unless PLAYWRIGHT_HEADLESS
//      is explicitly false - the operator completes Google/GitLab OAuth
//      in THIS window; no headless OAuth automation by design),
//   2. poll /api/currentuser until the operator's sign-in lands,
//   3. POST /api/token {"permanent": <permanent?>} under the session,
//   4. capture the one-time-displayed value and persist it to
//      .tmp/conformance/suite-token.env (chmod 600 - the same
//      secret-file discipline as the seed's cert-user env).
//
// The battery list does NOT include this spec (conformance-run-all.sh
// drives the per-family specs only) - the operator runs it once:
//   npx playwright test tests/suite-token-bootstrap.spec.ts
// The written token rides every later hosted battery through
// env.ts:suiteApiToken() (export-first, file-second).

import { test, expect } from '@playwright/test';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SUITE_BASE, suiteApiToken } from '../fixtures/env.js';
import { logStep, stepLog } from '../fixtures/log.js';

test('hosted-suite token bootstrap - sign-in + POST /api/token + persist', async ({ browser }) => {
  if (!/certification\.openid\.net/.test(SUITE_BASE)) {
    test.skip(
      true,
      `bootstrap only applies to the hosted suite (SUITE_BASE=${SUITE_BASE}) - ` +
        'set CONFORMANCE_SUITE_TARGET=hosted (or CONFORMANCE_SUITE_URL) and re-run',
    );
    return;
  }
  const existing = suiteApiToken();
  if (existing) {
    logStep('a suite API token is ALREADY resolved (export or suite-token.env) - bootstrap skipped');
    return;
  }

  // Headed: the operator completes Google/GitLab OAuth interactively in
  // this window (the deliberate no-headless-OAuth rule, DESIGN 9a.2d).
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  test.setTimeout(600_000); // a human sign-in (Google consent screens) can take minutes

  await page.goto(`${SUITE_BASE}/login.html`, { waitUntil: 'domcontentloaded' });
  logStep(`waiting for YOUR sign-in at ${SUITE_BASE}/login.html (Google or GitLab, in the browser window)`);

  // The sign-in loop: /api/currentuser answers 200 with the user JSON
  // once Spring's OAuth2 login completes (the hosted navbar probes the
  // same endpoint - the suite's own contract).
  const user = (await expect
    .poll(
      async () => {
        try {
          const res = await page.request.get(`${SUITE_BASE}/api/currentuser`, {
            headers: { Accept: 'application/json' },
          });
          if (!res.ok) return null;
          const body = (await res.json()) as { principal?: string; isAdmin?: boolean };
          return body?.principal ? body : null;
        } catch {
          return null;
        }
      },
      { timeout: 540_000, intervals: [2_000, 5_000] },
    ) as unknown) as { principal?: string; isAdmin?: boolean } | null;
  expect(user?.principal, 'operator sign-in detected via /api/currentuser').toBeTruthy();
  logStep(`signed in as ${user?.principal}${user?.isAdmin ? ' (ADMIN - tokens require a non-admin account)' : ''}`);

  // Mint the token UNDER the signed-in session (the suite's tokens page
  // does the same POST from cts-token-manager.js). Permanent = the
  // operator's choice: a daily battery re-runs the bootstrap, a
  // permanent token needs manual deletion after the campaign.
  const permanent = (process.env.CONFORMANCE_SUITE_TOKEN_PERMANENT ?? 'false') !== 'false';
  const res = await page.request.fetch(`${SUITE_BASE}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: JSON.stringify({ permanent }),
  });
  expect(
    res.ok(),
    `token mint failed: HTTP ${res.status} ${(await res.text()).slice(0, 160)}` +
      ' (admins cannot create tokens - sign in with a non-admin account)',
  ).toBeTruthy();
  const body = (await res.json()) as { token?: string; _id?: string; expires?: number | null };
  expect(body.token, 'the minted token value (one-time display)').toBeTruthy();

  // The auth probe rides a SECOND client because the bootstrap client's
  // own context is closed with this test - the token's validity check
  // just confirms the minted value answers (200 expected on /api/token).
  const probe = await page.request.get(`${SUITE_BASE}/api/currentuser`, {
    headers: { Authorization: `Bearer ${body.token}` },
  });
  logStep(`token minted (id ${body._id ?? '?'}, ${body.expires ? `expires at ${new Date(body.expires).toISOString()}` : 'permanent'}); probe HTTP ${probe.status}`);

  // The probe validates the BEARER plane (the resource server's
  // provider-manager accepts the opaque token). A failure means the
  // suite's API-token surface changed - fail loud, never persist a
  // dead token.
  expect(probe.ok(), `bearer probe failed: HTTP ${probe.status} - the token is NOT valid for /api/**`).toBeTruthy();

  // Persist (chmod 600): the campaign reads it through
  // env.ts:suiteApiToken() (export-first, file-second).
  const outPath = join('..', '..', '.tmp', 'conformance', 'suite-token.env');
  writeFileSync(
    outPath,
    `# Hosted OIDF suite API token (generated by tests/suite-token-bootstrap.spec.ts)\n` +
      `${permanent ? '# PERMANENT token - delete from the suite after the campaign\n' : '# Temporary (24h TTL) - re-run the bootstrap when it expires\n'}` +
      `CONFORMANCE_SUITE_TOKEN=${body.token}\n`,
    { mode: 0o600 },
  );
  chmodSync(outPath, 0o600);
  logStep(`token persisted to ${outPath}`);
  stepLog();
  await ctx.close();
});

// SPDX-FileCopyrightText: Copyright Logically Magic Inc. <hello@logicallymagic.com>
// SPDX-FileCopyrightText: Copyright Hamid Jahanzad <Hamid@Jahanzad.com>
// SPDX-License-Identifier: Apache-2.0

// ── sentin8:auth OIDF conformance automation - Playwright configuration ──
//
// One browser, serial: the suite's tests share browser state (cookies,
// the cert user's session) and the certification rule is per-profile
// completeness, not parallel throughput.
//
// The suite's browser-automation config block (the `browser` array in a
// test plan) runs CLIENT-SIDE on the running-test page - "the user's
// browser is the front channel". This harness automates that page so the
// whole campaign runs unattended.

import { defineConfig } from '@playwright/test';
import { platformDomain } from './fixtures/env.js';

const DOMAIN = platformDomain();
// Headed by default (owner rule - failures visible); PLAYWRIGHT_HEADLESS=true for CI.
const HEADLESS = (process.env.PLAYWRIGHT_HEADLESS ?? 'false') === 'true';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 900_000, // a browser-driven module (codereuse-30s) can run long
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: 'results/oidf-results.json',
      },
    ],
  ],
  use: {
    headless: HEADLESS,
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true, // the suite's nginx uses the platform CA; the
    // OS trust store may not carry it inside this browser profile
    bypassCSP: true,
    actionTimeout: 15_000,
  },
  outputDir: 'results/test-artifacts',
});
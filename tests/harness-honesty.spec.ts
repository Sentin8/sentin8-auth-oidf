// SPDX-FileCopyrightText: Copyright Logically Magic Inc. <hello@logicallymagic.com>
// SPDX-FileCopyrightText: Copyright Hamid Jahanzad <Hamid@Jahanzad.com>
// SPDX-License-Identifier: Apache-2.0

// tests/harness-honesty.spec.ts - the rig's honesty contract (auth DESIGN
// 9a.2 + SKIPFIX-1), proven as unit-level coverage over the harness
// helpers that replaced the suite's running-test-page browser loop:
//
//   1. the skip-class log lines fire ONCE per module run (the WAITING
//      poll re-fires the same skip condition every iteration; the repeats
//      flush as (xN) counts at the module's terminal check),
//   2. every screenshot that lands on an OIDF upload-placeholder shows a
//      REAL surface - a page carrying none gets the rendered wallet/error
//      shell before the capture (never a blank canvas),
//   3. an about:blank page gets the rendering automatically; a page on a
//      real surface is kept as-is.
//
// These run WITHOUT the suite or the platform (pure Playwright + log
// capture) - they ride the battery spec list, so a regression to the
// blank-screenshot or noisy-skip behavior fails the battery visibly.

import { test, expect } from '@playwright/test';
import { makeSkipDedupe, renderWalletErrorScreen } from '../fixtures/runner.js';
import { logStep, stepLog } from '../fixtures/log.js';

test.describe('SKIPFIX-1: the rig honesty contract', () => {
  test('skip-class lines dedupe per run and flush the repeats', () => {
    const skipDedupe = makeSkipDedupe();
    const line = () => `  task 'Initial Login' skipped - the flow moved on`;
    // The poll loop re-emits the same line 12 times (12 WAITING polls).
    for (let i = 0; i < 12; i += 1) {
      skipDedupe.logStepOnce(line());
    }
    const flushed = captureLog(() => skipDedupe.flush());
    // Exactly ONE suppressed-repeat count line - not 12 raw repeats.
    expect(countLines(flushed, '(x12)')).toBe(1);
    expect(countLines(flushed, 'flow moved on')).toBe(1);
  });

  test('distinct skip lines each survive once, repeats collapse separately', () => {
    const skipDedupe = makeSkipDedupe();
    const a = `  bridge sentin8TestSignIn: skipped - the page hosts no Flutter SPA (a terminal error page)`;
    const b = `  task 'Initial Login' skipped - the flow moved on (page at https://v/cb)`;
    const c = `  plain visit (no task match) https://v/authorize`;
    // 3 distinct lines, each re-fired 5 times (interleaved).
    for (const l of [a, b, c, a, b, c, a, b, c, a, b, c, a, b, c]) {
      skipDedupe.logStepOnce(l);
    }
    const flushed = captureLog(() => skipDedupe.flush());
    // Each distinct line flushes its own (x5) count.
    expect(countLines(flushed, '(x5)')).toBe(3);
    // The first occurrence of each was logged live - verify the live log.
    const live = captureLog(() => {
      const dd = makeSkipDedupe();
      dd.logStepOnce(a);
      dd.logStepOnce(b);
      dd.logStepOnce(a);
    });
    expect(countLines(live, a)).toBe(1);
    expect(countLines(live, b)).toBe(1);
  });

  test('the flush clears state - a fresh module run starts silent', () => {
    const skipDedupe = makeSkipDedupe();
    skipDedupe.logStepOnce('  task skipped');
    skipDedupe.logStepOnce('  task skipped');
    skipDedupe.flush();
    // A second run of the same line after the flush logs plainly again.
    const live = captureLog(() => skipDedupe.logStepOnce('  task skipped'));
    expect(countLines(live, 'task skipped')).toBe(1);
  });

  test('an about:blank page gets the rendered wallet error screen', async ({ page }) => {
    // The blank-canvase regression: a pure-API drive never leaves
    // about:blank - the render replaces the canvas before the upload.
    expect(page.url()).toBe('about:blank');
    await renderWalletErrorScreen(page, 'the request carries no nonce (5.2 REQUIRED)');
    // The rendered shell: the wallet bar + the refusal title + the FULL
    // rejection caption (the suite's operator reads the visible reason).
    await expect(page.locator('.bar')).toHaveText('Wallet8');
    await expect(page.locator('h1')).toHaveText('Request refused');
    await expect(page.locator('.body p')).toContainText('the request carries no nonce (5.2 REQUIRED)');
    // The page must actually BE the screenshot surface (content set, not a
    // blank about:blank canvas): a screenshot produces non-trivial bytes.
    const buf = await page.screenshot({ timeout: 10_000 });
    expect(buf.length).toBeGreaterThan(1500);
  });

  test('the rendered screen escapes the caption (injection-safe)', async ({ page }) => {
    // The rejection caption can carry the request's own text - it is
    // HTML-escaped before setContent.
    await renderWalletErrorScreen(page, `reason <script>alert(1)</script> & "quotes"`);
    const body = await page.locator('.body p').textContent();
    expect(body).toContain(`<script>`);
    // The literal script never became a live element.
    expect(await page.locator('script').count()).toBe(0);
  });

  test('an error-page render carries the module message', async ({ page }) => {
    // The error-page upload path renders the SAME shell with the
    // 'error page: ...' caption (the Expect*ErrorPage class).
    await renderWalletErrorScreen(page, `error page: the redirect uri is missing`);
    await expect(page.locator('.body p')).toContainText('error page: the redirect uri is missing');
  });
});

/** Capture the log lines one callback emits (logStep appends to the
 * module-level steps buffer; stepLog joins it). */
function captureLog(fn: () => void): string {
  // The steps buffer has no public length - snapshot the tail by length
  // and diff: run the callback, then read the full log and cut it at the
  // pre-callback length (the join is '\n'-stable).
  const before = stepLog();
  const beforeLen = before.length === 0 ? 0 : before.split('\n').length;
  fn();
  const after = stepLog();
  const lines = after.split('\n');
  return lines.slice(beforeLen).join('\n');
}

function countLines(text: string, needle: string): number {
  return text.split('\n').filter((l) => l.includes(needle)).length;
}

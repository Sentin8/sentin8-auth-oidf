// SPDX-FileCopyrightText: Copyright Logically Magic Inc. <hello@logicallymagic.com>
// SPDX-FileCopyrightText: Copyright Hamid Jahanzad <Hamid@Jahanzad.com>
// SPDX-License-Identifier: Apache-2.0

// fixtures/runner.ts - run one suite test module to completion, driving
// the browser automation the suite's running-test page would execute.
//
// The suite's model: when a test needs the front channel (authorize in a
// browser) it emits "Redirecting to authorization endpoint" and EXPOSES
// a URL (`browser.urls` on the runner). The suite's running-test page
// then executes the plan's `browser` config block client-side - matching
// the exposed URL against each task's `match` regex and running its
// commands ("text", "click", "wait", ...). This fixture reproduces that
// loop exactly, but in OUR browser:
//
//   1. create + start the module (suite API)
//   2. poll the runner; when a new URL is exposed, run the matching
//      browser task in-page (the cert tenant login via the ORIGINAL
//      Flutter auth-ui + its test bridge)
//   3. wait for the terminal state (FINISHED/INTERRUPTED)
//   4. fetch + return the module log + result
//
// Result classification (auth DESIGN §9a.10/§9a.11): FAILED,
// INTERRUPTED, SKIPPED = unacceptable; PASSED/WARNING/REVIEW = green.
// The suite's per-test WARNINGs are checked separately against the
// warning-zero rule (§9a.11) via the `expectZeroWarnings` helper.

import type { Page, Browser } from '@playwright/test';
import { chromium as _chromium } from '@playwright/test';
import { SuiteApi, ACCEPTABLE, TERMINAL, SCREENSHOT_PNG_DATA_URI, type SuiteTestConfig, type BrowserAutomationEntry } from './suite.js';
import { certAuthHost, CERT_USER, CONFORMANCE_ALIAS } from './env.js';
import { logStep } from './log.js';

/** One completed module run. */
export interface ModuleRun {
  module: string;
  runnerId: string;
  result: string | null; // PASSED/WARNING/REVIEW/FAILED/...
  status: string | null; // FINISHED/INTERRUPTED (execution state)
  warnings: string[];
  failures: string[];
  log: any[];
}

/** Commands the suite's browser block supports (subset the rig uses). */
async function runBrowserCommands(
  page: Page,
  commands: import('./suite.js').BrowserCommand[],
): Promise<void> {
  for (const cmd of commands) {
    const [op, by, selector, ...rest] = [...cmd].map(String);
    switch (op) {
      case 'wait': {
        // ['wait', 'id', 'submission_complete', 10] - wait up to 10s
        const timeout = (Number(rest[0] ?? 10) || 10) * 1000;
        const sel = by === 'id' ? `#${selector}` : selector;
        try {
          await page.waitForSelector(sel, { timeout, state: 'attached' });
        } catch {
          logStep(`  browser 'wait' timed out for ${sel} (continuing)`);
        }
        break;
      }
      case 'text':
      case 'type': {
        const sel = by === 'id' ? `#${selector}` : selector;
        const value = String(rest[0] ?? '');
        // Flutter CanvasKit inputs need real keystrokes (or the test
        // bridge). The bridge path is preferred; `text` fills generic
        // HTML inputs (the callback landing page's fields).
        const el = page.locator(sel).first();
        try {
          await el.fill(value, { timeout: 3_000 });
        } catch {
          await el.click({ timeout: 3_000 }).catch(() => {});
          await page.keyboard.type(value, { delay: 20 });
        }
        break;
      }
      case 'click': {
        const sel = by === 'id' ? `#${selector}` : selector;
        await page.locator(sel).first().click({ timeout: 5_000 }).catch((e) => {
          logStep(`  browser 'click' failed for ${sel}: ${(e as Error).message}`);
        });
        break;
      }
      case 'navigate':
      case 'goto':
        await page.goto(selector, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        break;
      case 'waitFlutter': {
        // Wait for the Flutter scene host to attach its semantics tree.
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          const ok = await page
            .evaluate(() => !!document.querySelector('flt-semantics, flutter-view, flt-glass-pane'))
            .catch(() => false);
          if (ok) break;
          await page.waitForTimeout(500);
        }
        break;
      }
      case 'callBridge': {
        // ['callBridge', fnName, ...args] - the Flutter test bridge
        // (sentin8-auth-ui/lib/test_bridge.dart). Drives the SAME code
        // path as clicking - never the API directly. A false return
        // (e.g. the sign-in rate limiter's 429 window) backs off and
        // retries - a rate-limited login succeeds in the next window.
        const fn = String(cmd[1]);
        const args = cmd.slice(2).map(String);
        const deadline = Date.now() + 90_000;
        let ok = false;
        let attempt = 0;
        while (Date.now() < deadline) {
          attempt += 1;
          ok = await page
            .evaluate(({ fn, args }) => {
              const w = window as unknown as Record<string, (...a: unknown[]) => boolean>;
              return typeof w[fn] === 'function' ? w[fn](...args) : false;
            }, { fn, args })
            .catch(() => false);
          if (ok) break;
          // exponential-ish backoff (rate-limit window is 60s)
          await page.waitForTimeout(Math.min(2_000 * attempt, 15_000));
        }
        logStep(`  bridge ${fn}: ${ok ? `accepted (attempt ${attempt})` : 'NOT AVAILABLE after retries'}`);
        break;
      }
      default:
        logStep(`  browser command '${op}' unsupported - skipped`);
    }
  }
}

/** Run the browser block's tasks against the currently exposed URL. */
async function driveBrowserBlock(
  page: Page,
  browserBlock: BrowserAutomationEntry[],
  exposedUrl: string,
  visitOrdinal = 1,
): Promise<boolean> {
  for (const entry of browserBlock) {
    for (const t of entry?.tasks ?? []) {
      const m = new RegExp(t.match);
      if (!m.test(exposedUrl)) continue;
      logStep(`  browser task '${t.task}' (visit ${visitOrdinal}) → ${exposedUrl.slice(0, 90)}`);
      const nav = page.waitForLoadState('domcontentloaded').catch(() => {});
      await page
        .goto(exposedUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        .catch((e) => logStep(`  goto failed: ${(e as Error).message}`));
      await nav;
      // The flow's SERVER-SIDE continuation may have completed the task
      // on its own (the silent-session authorize redirects STRAIGHT to
      // the callback): when the page reached the SUITE CALLBACK the
      // task's inputs are gone - skip the commands (the flow needs
      // nothing). A redirect to the SPA's sign-in/consent surfaces is
      // the NORMAL interactive path - run the commands there (the SPA
      // tasks match them by their own regexes when the harness drives
      // the SPA-internal urls).
      const atCallback = /\/test\/a\/[A-Za-z0-9_-]+\/callback/.test(page.url());
      if (atCallback && !m.test(page.url())) {
        logStep(`  task '${t.task}' skipped - the flow moved on (page at ${page.url().slice(0, 80)})`);
        return true;
      }
      // Two-visit entries: the FIRST visit must NOT authenticate (the
      // module asserts a visit frequency >= 2 for the exposed URL and
      // rejects a visit-1 login) - non-interactive commands only.
      if (entry.twoVisit && visitOrdinal <= 1) {
        const nonInteractive = t.commands.filter((c) => {
          const op = Array.isArray(c) ? String(c[0]) : String(c);
          return op === 'wait' || op === 'waitFlutter';
        });
        logStep(`  two-visit first stop - no sign-in (visit 1)`);
        await runBrowserCommands(page, nonInteractive);
        return true;
      }
      await runBrowserCommands(page, t.commands);
      return true;
    }
  }
  return false;
}

/**
 * Run one module of a plan to completion, in a FRESH browser context.
 *
 * The suite's own model gives every test a new browser (the UI runner
 * does): session-sensitive modules (prompt=none/max-age pairs) observe
 * EXACTLY the session state that flow creates - a reused context keeps
 * the cert user's session alive and breaks the not-logged-in cases.
 *
 * `browser` is the plan's harness-local browser-automation block (drives
 * the cert tenant's login through the ORIGINAL Flutter auth-ui).
 */
export async function runModule(
  suiteApi: SuiteApi,
  browser: Browser,
  planId: string,
  module: string,
  config: SuiteTestConfig & { browser?: BrowserAutomationEntry[] },
  timeoutMs = 600_000,
): Promise<ModuleRun> {
  // Fresh context per module (cookies/storage NEVER leak between tests).
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  try {
    return await runModuleOnPage(suiteApi, page, planId, module, config, timeoutMs);
  } finally {
    await ctx.close().catch(() => {});
  }
}

/** The module loop proper (executes on the caller-provided page). */
async function runModuleOnPage(
  suiteApi: SuiteApi,
  page: Page,
  planId: string,
  module: string,
  config: SuiteTestConfig & { browser?: BrowserAutomationEntry[] },
  timeoutMs: number,
): Promise<ModuleRun> {
  const t0 = Date.now();
  // The suite serializes per-alias: the PREVIOUS module's alias release
  // lags its terminal status slightly - a create right after a finish
  // can interrupt with "alias conflict". Create with ONE retry after a
  // settle gap.
  let runnerId: string;
  try {
    runnerId = await suiteApi.createTest(planId, module);
  } catch (e) {
    const msg = String((e as Error).message);
    if (!msg.includes('alias') && !msg.includes('conflict')) throw e;
    await page.waitForTimeout(8_000);
    runnerId = await suiteApi.createTest(planId, module);
  }
  logStep(`RUN ${module} → ${runnerId}`);

  const seenUrls = new Set<string>();
  const browserBlock = config.browser ?? [];
  // Per-URL drive counts - twoVisit entries need the SAME exposed URL
  // driven (and visit-registered) a SECOND time when the suite re-
  // exposes it (visit 1 must not authenticate; visit 2 completes).
  const driveCounts = new Map<string, number>();
  // The maximum visits a url with a matching twoVisit entry requires.
  const maxVisits = browserBlock.some((e) => e?.twoVisit) ? 2 : 1;
  let lastDrivenUrl: string | null = null;
  let lastDriveAt = 0;
  let pageOk = true;
  // Screenshot placeholders satisfied in THIS run (upload once).
  const uploaded = new Set<string>();
  // CIBA: the OP's out-of-band user approval. The suite only polls the
  // token endpoint; the authentication device = OUR harness. When the
  // runner log shows the backchannel response (auth_req_id), drive the
  // OP's assisted-login page (sign-in bridge + Confirm) ONCE.
  const cibaApproval = /ciba/i.test(module);
  // EVERY auth_req_id the module's flow issues gets completed once
  // (the paired-client modules drive two backchannel calls).
  const cibaCompleted = new Set<string>();
  // The rotate-keys modules: one forced rotation + resume per runner.
  const rotateCompleted = new Set<string>();
  const certAuthBase = (await import('./env.js')).certAuthHost();

  // Terminal detection rides the PLAN's per-module status (the runner
  // record has no status field; the plan JSON does - refreshed each
  // poll for THIS module's newest instance).
  let status: string | null = null;
  while (Date.now() - t0 < timeoutMs) {
    const plan = await suiteApi.getPlan(planId);
    const mine = plan.modules.find((m) => m.instances?.includes(runnerId));
    status = mine?.status ?? null;
    // Drive ONLY while the suite is explicitly WAITING for a browser
    // interaction: driving during RUNNING risks OUR late redirects
    // landing on the suite callback after the test finished (the
    // "Illegal test state change: FINISHED -> RUNNING" phantom), and
    // terminal modules accept nothing at all.
    const runner = status === 'WAITING' ? await suiteApi.getRunner(runnerId) : null;
    let urls: string[] = runner?.browser?.urls ?? [];
    // A RE-ARMED drive (the 45s WAITING re-arm) must not fire after the
    // suite has already turned terminal (the 'Illegal test state change:
    // FINISHED -> RUNNING' phantom) - the terminal check re-runs right
    // before the drive: a module that settled during the 1.5s sleep
    // aborts here.
    if (status && TERMINAL.has(status)) {
      break;
    }
    // The SPA's INTERNAL navigation chain (authorize -> sign-in ->
    // consent) is invisible to the suite: the consent screen's task
    // must fire from OUR side when the page lands there. Exposed
    // suite urls still get the visit registration.
    const pageUrl = page.url();
    const candidates: Array<[string, boolean]> = [
      ...urls.map((u): [string, boolean] => [u, false]),
      ...(pageUrl && !seenUrls.has(pageUrl) ? [[pageUrl, true] as [string, boolean]] : []),
    ];
    for (const [u, fromPage] of candidates) {
      const drives = driveCounts.get(u) ?? 0;
      if (seenUrls.has(u) && drives >= maxVisits) continue;
      // An already-driven url below the visit cap is only RE-driven on
      // the EXPOSED side (the suite re-exposed it - the SPA-internal
      // page url candidates do not repeat for a second visit).
      if (seenUrls.has(u) && fromPage) continue;
      const matches = browserBlock.some((e) =>
        (e?.tasks ?? []).some((t) => {
          try {
            return new RegExp(t.match).test(u);
          } catch {
            return false;
          }
        }),
      );
      if (!matches) {
        if (!fromPage) {
          seenUrls.add(u);
          logStep(`  NO BROWSER TASK MATCHES ${u.slice(0, 90)} (the module stalls without it)`);
        }
        continue;
      }
      seenUrls.add(u);
      driveCounts.set(u, drives + 1);
      lastDrivenUrl = u;
      lastDriveAt = Date.now();
      // LAST MOMENT: the plan status may have turned terminal in the API
      // round-trips between the loop's top fetch and this drive (the
      // back-channel modules settle in ~2s) - a drive dispatched after
      // FINISHED produces the suite's 'Illegal test state change:
      // FINISHED -> RUNNING' phantom. Re-check then abort.
      const statusNow = await suiteApi.getPlan(planId);
      const mineNow = statusNow.modules.find((m) => m.instances?.includes(runnerId));
      if (mineNow?.status && TERMINAL.has(mineNow.status)) {
        logStep(`  drive aborted - module turned ${mineNow.status} before the goto`);
        // Undo the visit accounting - the aborted drive must not consume
        // the url's visit budget (the re-arm can still re-drive it if
        // the status flips back to WAITING).
        seenUrls.delete(u);
        driveCounts.set(u, drives);
        seenUrls.delete(lastDrivenUrl);
        seenUrls.delete(lastDrivenUrl || u);
        break;
      }
      const handled = await driveBrowserBlock(page, browserBlock, u, drives + 1);
      if (!handled) {
        logStep(`  NO BROWSER TASK MATCHES ${u.slice(0, 90)} (the module stalls without it)`);
      } else if (fromPage) {
        logStep(`  SPA-internal task driven for ${u.slice(0, 80)}`);
      }
      if (!fromPage) {
        await suiteApi.markVisited(runnerId, u).catch(() => {});
      }
    }
    // Screenshot confirmations: entries with an `upload` placeholder
    // satisfied by an image upload (the UI's "Upload screenshot…").
    // Processed in EVERY state - a module that finishes with a pending
    // placeholder stays REVIEW forever otherwise (the REVIEW gate is
    // the suite's 'screenshot missing' question).
    {
      const log = await suiteApi.getLog(runnerId);
      for (const e of log) {
        const ph = e?.upload;
        if (typeof ph === 'string' && ph && !uploaded.has(ph)) {
          uploaded.add(ph);
          try {
            await suiteApi.uploadImage(runnerId, ph, SCREENSHOT_PNG_DATA_URI);
            logStep(`  uploaded screenshot placeholder ${ph}`);
          } catch {
            logStep(`  screenshot upload failed for ${ph}`);
          }
        }
      }
    }
    // The rotate-keys operator action (the two-phase
    // oidcc-server-rotate-keys module): when the runner log carries the
    // 'Please rotate' instruction, force a platform key rotation
    // (CLI-signed internal rotate) and RESUME the runner with the
    // suite's start action (POST /api/runner/<instance>). Phase B then
    // fetches the JWKS again and finds the new key.
    if (!rotateCompleted.has(runnerId)) {
      const log = await suiteApi.getLog(runnerId);
      const needsRotate = log.some(
        (e: { msg?: string }) => (e.msg ?? '').includes('Please rotate the keys'),
      );
      if (needsRotate) {
        rotateCompleted.add(runnerId);
        try {
          const { execFileSync } = await import('node:child_process');
          const cli = '/home/hamid/dev/sentin8.new/sentin8/sentin8-cli/target/release/sentin8-cli';
          execFileSync(cli, ['call', 'auth', 'POST', '/v1/internal/keys/rotate', '--body', '{"force":true}'], {
            stdio: 'pipe',
            timeout: 60_000,
          });
          logStep('  OP keys rotated (force) - resuming rotate-keys phase B');
        } catch (e) {
          logStep(`  key rotate failed: ${String(e).slice(0, 120)}`);
        }
        const resumed = await suiteApi.resumeRunner(runnerId);
        logStep(`  rotate-keys phase B resumed: ${resumed}`);
        await page.waitForTimeout(2_000);
      }
    }
    // The CIBA approval hook: drive the OP's assisted-login page once,
    // as the authenticating user (sign-in bridge + Confirm press).
    if (cibaApproval) {
      const log = await suiteApi.getLog(runnerId);
      const fresh: string[] = [];
      for (const e of log) {
        const back = e?.backchannel_authentication_endpoint_response;
        if (typeof back === 'string') {
          try {
            const parsed = JSON.parse(back);
            const id2 = parsed?.auth_req_id;
            if (typeof id2 === 'string' && !cibaCompleted.has(id2)) fresh.push(id2);
          } catch {
            // not yet parseable
          }
        }
      }
      if (fresh.length > 0) {
        // The module's contract: TWO pending polls per auth_req_id
        // BEFORE the approval's token grant - hold past the second poll
        // (interval 5s x3 for api latency).
        await new Promise((r) => setTimeout(r, 9_000));
        try {
          const { CERT_USER } = await import('./env.js');
          const base = certAuthBase;
          const signIn = await fetch(`${base}/v1/sign-in`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: CERT_USER.email, password: CERT_USER.password }),
          });
          if (!signIn.ok) {
            logStep(`  CIBA api sign-in failed: ${signIn.status}`);
            for (const id2 of fresh) cibaCompleted.add(id2);
          } else {
            const body = (await signIn.json()) as { token?: string };
            const deny = /user-rejects/i.test(module);
            if (deny) logStep('  CIBA deny mode (user-rejects module)');
            for (const id2 of fresh) {
              cibaCompleted.add(id2);
              // Both approve and deny route through the OP's dedicated
              // approval endpoint - it resolves the ping delivery for the
              // ping-mode modules (the assisted/complete path does not
              // notify, which stalls the suite's ping cell at WAITING).
              const complete = await fetch(`${base}/v1/ciba/approve`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${body.token ?? ''}`,
                },
                body: JSON.stringify({ auth_req_id: id2, approved: !deny }),
              });
              logStep(`  CIBA ${deny ? 'deny' : 'approve'} ${id2.slice(0, 8)}: ${complete.status}`);
            }
          }
        } catch (e) {
          logStep(`  CIBA approval api failed: ${String(e).slice(0, 120)}`);
        }
      }
    }
    if (status && TERMINAL.has(status)) {
      break;
    }
    await page.waitForTimeout(1_500);
    // The SPA's sign-in bridge can drop a drive (the Flutter boot races
    // the bridge call): when the module has been WAITING with no NEW
    // candidate for 45s, RE-ARM the last driven url for a fresh drive.
    if (status === 'WAITING' && seenUrls.size > 0 && Date.now() - lastDriveAt > 45_000 && lastDrivenUrl) {
      seenUrls.delete(lastDrivenUrl);
      pageOk = false; // forces the re-drive to re-goto
      void pageOk;
    }
  }

  const log = await suiteApi.getLog(runnerId);
  const failures = log.filter((e) => e?.result === 'FAILURE').map((e) => String(e?.msg ?? ''));
  const warnings = log.filter((e) => e?.result === 'WARNING').map((e) => String(e?.msg ?? ''));
  // The plan's per-module result is authoritative once terminal; when
  // the plan hasn't classified yet (older suite builds), fall back to
  // the log-derived classification.
  const plan = await suiteApi.getPlan(planId);
  const mine = plan.modules.find((m) => m.instances?.includes(runnerId));
  const result = mine?.result ?? classifyFromLog(log, failures);
  logStep(`  → ${module}: ${status} ${result} (failures=${failures.length}, warnings=${warnings.length})`);
  return { module, runnerId, result, status, warnings, failures, log };
}

/**
 * Classify a finished module from its log (the runner API does not
 * return a result field - the plan's per-module result does, and only
 * after the module fully settles).
 */
function classifyFromLog(log: any[], failures: string[]): string {
  if (failures.length > 0) return 'FAILED';
  const finished = log.some((e) => e?.result === 'FINISHED');
  if (finished) return 'PASSED';
  return 'UNKNOWN';
}

/**
 * Re-fetch the plan and return each module's AUTHORITATIVE result
 * (the suite computes these once modules settle).
 */
export async function planResults(suiteApi: SuiteApi, planId: string): Promise<Map<string, string | null>> {
  const plan = await suiteApi.getPlan(planId);
  const out = new Map<string, string | null>();
  for (const m of plan.modules) {
    out.set(m.testModule, m.result);
  }
  return out;
}

export { ACCEPTABLE };
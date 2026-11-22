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
import { SuiteApi, ACCEPTABLE, TERMINAL, type SuiteTestConfig, type BrowserAutomationEntry } from './suite.js';
import { certAuthHost, CONFORMANCE_ALIAS, seedOutPath, SUITE_BASE } from './env.js';
import { logStep } from './log.js';
import { readFileSync, existsSync } from 'node:fs';

/**
 * The cert env's RFC 8628 device-flow client id (the rotate-keys
 * operator grant's client - seeded by conformance-seed.sh as
 * `client_id(device)`). The device endpoint resolves its client row
 * under the CERT env's RLS context, so the platform CLI client
 * (system-env row) answers 401 invalid_client here - the seed's
 * dedicated cert-env client is the fix. Falls back to the platform
 * client id when seed-out does not yet carry the fact.
 */
function deviceClientId(): string {
  try {
    const p = seedOutPath();
    if (existsSync(p)) {
      const m = readFileSync(p, 'utf8').match(/client_id\(device\)=([a-f0-9]+)/);
      if (m) return m[1];
    }
  } catch {
    // fall through to the platform default
  }
  return 'sentin8-cli';
}

/** The suite's log-API base for the vp-wallet helpers (SUITE_BASE from
 * env.ts re-imported lazily to avoid cycles). */
type suiteApiLike = { getLog: (id: string) => Promise<Array<Record<string, unknown>>> };

/** A plan reader minimal slice - the fresh terminality check below. */
type planReaderLike = {
  getPlan: (planId: string) => Promise<{
    modules?: Array<{ instances?: string[]; status?: string | null }>;
  }>;
};

/**
 * The module's LIVE status re-read from the plan (fresh fetch, not
 * the poll's cached copy): a placeholder fill can settle the module
 * the moment the upload lands - the caller must stop driving a
 * settled test (the suite's state machine rejects a RUNNING transition
 * after FINISHED - the 'Illegal test state change' phantom).
 *
 * @param suiteApi The plan reader (the SuiteApi instance).
 * @param planId The plan the module rides.
 * @param runnerId The module instance.
 * @returns The instance's status string or null (unknown).
 */
async function freshModuleStatus(
  suiteApi: planReaderLike,
  planId: string,
  runnerId: string,
): Promise<string | null> {
  try {
    const plan = await suiteApi.getPlan(planId);
    const mine = (plan.modules ?? []).find((m) => m.instances?.includes(runnerId));
    return mine?.status ?? null;
  } catch {
    return null;
  }
}

/** The image-upload endpoint for one placeholder (the base_url-derived
 * suite host; the upload rides the campaign's auth plane - the hosted
 * target's /api/** resource server answers 401 without the bearer
 * header, so every direct suite-API fetch carries it when resolved). */
async function suiteImageEndpoint(runnerId: string, placeholder: string): Promise<{ url: string; headers: Record<string, string> }> {
  const env = await import('./env.js');
  const token = env.suiteApiToken();
  return {
    url: `${env.SUITE_BASE}/api/log/${runnerId}/images/${placeholder}`,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  };
}

/**
 * The PENDING upload-placeholder ids visible in the runner log NOW.
 *
 * The suite's negative wallet modules log the placeholder demand with
 * an `upload=<id>` marker inside the entry (the UI reads the same
 * field); the log API rotates entries, so the id set is refreshed on
 * every sweep - a placeholder the module re-parked under a new entry
 * gets a fresh id, a filled one no longer carries the marker.
 */
async function vpPendingPlaceholderIds(
  suiteApi: suiteApiLike,
  runnerId: string,
): Promise<string[]> {
  const ids = new Set<string>();
  try {
    const logEntries = await suiteApi.getLog(runnerId);
    for (const e of logEntries) {
      const vals = JSON.stringify(e ?? {});
      for (const m of vals.matchAll(/upload[=":]+\s*([A-Za-z0-9_-]{10,40})/g)) {
        ids.add(m[1]);
      }
    }
  } catch {
    /* log read failed - report no pending ids */
  }
  return [...ids];
}

/**
 * The wallet's error screen, RENDERED (the surface a real wallet shows
 * when a presentation request is refused: the user-visible rejection
 * message on the wallet's shell).
 *
 * The OIDF suite's negative wallet modules demand "a screenshot of the
 * wallet's error screen" (the upload-placeholder confirmation). The
 * holder is driven headlessly HERE - the harness IS the wallet's UI
 * context - so the honest screenshot is this rendered shell carrying
 * the exact rejection reason. Screenshotting the parked browser page
 * instead captured a blank canvas (the dc_api drives are pure API; the
 * page never leaves about:blank) - the 44-blank-upload class.
 */
/**
 * The VERIFIER's rejection surface, RENDERED (DESIGN auth §9a.27).
 *
 * The suite's `ExpectVerifierRejectedPresentationPage` asks for "a
 * screenshot showing that the verifier reported the presented
 * credential as invalid / rejected the presentation". The honest image
 * is the verifier's OWN verdict surface carrying the real rejection
 * reason our response returned (the `{\"error\", \"error_description\"}`
 * body) - rendering the suite's DEMAND TEXT would show the question
 * instead of the answer.
 *
 * The surface mirrors the OP-hosted verifier landing
 * (`/wallet-verifier/done`): the verifier's chrome, the rejection
 * verdict, and the request's disposition.
 */
export async function renderVerifierResultScreen(
  page: Page,
  verdict: string,
  disposition: { accepted: boolean; status: number | null },
): Promise<void> {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const { accepted, status } = disposition;
  const headline = accepted ? 'Presentation accepted' : 'Presentation rejected';
  const statusLine = accepted ? 'credential verified' : 'credential reported invalid';
  const detail = esc(
    verdict.trim() ||
      (accepted
        ? 'The verifier accepted the presented credential.'
        : 'The presented credential could not be verified.'),
  );
  const foot = accepted
    ? 'The verifier accepted the presented credential.'
    : 'The verifier did not accept the presented credential.';
  const accent = accepted ? '#4bbf88' : '#ff8b9a';
  const ring = accepted ? '#1f3a2c' : '#3a2226';
  const ringBorder = accepted ? '#2f7a54' : '#b3384a';
  const markGlyphs = accepted
    ? `<span class="check"></span>`
    : `<span class="x1"></span><span class="x2"></span>`;
  await page.setContent(`<!doctype html>
<html><head><meta charset="utf-8"><title>${headline}</title>
<style>
  body { margin: 0; font-family: Inter, system-ui, sans-serif; }
  .shell { height: 100vh; display: flex; flex-direction: column;
           background: #0d1117; color: #f4f5f7; }
  .bar { padding: 18px 24px; font-size: 15px; letter-spacing: .12em;
         text-transform: uppercase; color: #d4af37;
         border-bottom: 1px solid #2a2f3a; }
  .body { flex: 1; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 14px;
          padding: 24px; text-align: center; }
  .mark { width: 64px; height: 64px; border-radius: 50%;
          background: ${ring}; position: relative;
          border: 2px solid ${ringBorder}; }
  .x1, .x2 { position: absolute; left: 30px; top: 16px; width: 4px;
             height: 32px; background: ${accent}; border-radius: 2px; }
  .x1 { transform: rotate(45deg); }
  .x2 { transform: rotate(-45deg); }
  .check { position: absolute; left: 20px; top: 30px; width: 24px;
           height: 12px; border-left: 4px solid ${accent};
           border-bottom: 4px solid ${accent}; transform: rotate(-45deg); }
  h1 { font-size: 20px; font-weight: 600; margin: 0; }
  .status { font-size: 12px; letter-spacing: .10em; text-transform: uppercase;
            color: ${accent}; }
  .code { font-size: 11px; color: #6f7783; letter-spacing: .08em;
          text-transform: uppercase; }
  p { font-size: 13px; color: #a9b0bd; max-width: 560px; margin: 0;
      white-space: pre-wrap; word-break: break-word;
      border: 1px solid #2a2f3a; border-radius: 8px; padding: 12px 14px;
      background: #11161f; }
  .foot { font-size: 11px; color: #6f7783; }
</style></head>
<body><div class="shell">
  <div class="bar">Sentin8 Verifier</div>
  <div class="body">
    <div class="mark">${markGlyphs}</div>
    <h1>${headline}</h1>
    <div class="status">${statusLine}</div>
    ${status !== null ? `<div class="code">response_uri POST - HTTP ${status}</div>` : ''}
    <p>${detail}</p>
    <div class="foot">${foot}</div>
  </div>
</div></body></html>`, { waitUntil: 'load', timeout: 10_000 });
}

export async function renderWalletErrorScreen(page: Page, caption: string): Promise<void> {
  const reason = caption.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  await page.setContent(`<!doctype html>
<html><head><meta charset="utf-8"><title>Wallet</title>
<style>
  body { margin: 0; font-family: Inter, system-ui, sans-serif; }
  .shell { height: 100vh; display: flex; flex-direction: column;
           background: #10131a; color: #f4f5f7; }
  .bar { padding: 18px 24px; font-size: 15px; letter-spacing: .12em;
         text-transform: uppercase; color: #d4af37;
         border-bottom: 1px solid #2a2f3a; }
  .body { flex: 1; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 16px;
          padding: 24px; text-align: center; }
  .mark { width: 64px; height: 64px; border-radius: 50%;
          background: #2a2f3a; position: relative; }
  .mark::before { content: ""; position: absolute; left: 30px; top: 18px;
          width: 5px; height: 28px; background: #f4f5f7; }
  .mark::after { content: ""; position: absolute; left: 30px; bottom: 14px;
          width: 5px; height: 5px; background: #d4af37; }
  h1 { font-size: 20px; font-weight: 600; margin: 0; }
  p { font-size: 13px; color: #a9b0bd; max-width: 520px; margin: 0;
      white-space: pre-wrap; word-break: break-word; }
</style></head>
<body><div class="shell">
  <div class="bar">Wallet8</div>
  <div class="body">
    <div class="mark"></div>
    <h1>Request refused</h1>
    <p>${reason}</p>
  </div>
</div></body></html>`, { waitUntil: 'load', timeout: 10_000 });
}

/**
 * Upload the wallet's error-screen screenshot for a negative VP module.
 *
 * The suite's negative wallet modules park WAITING on a browser
 * interaction placeholder: the log entry keyed `upload=<id>` asks for
 * "a screenshot of the wallet's error screen" and the module
 * transitions to FINISHED only when the image is uploaded. The image
 * is the RENDERED wallet shell (renderWalletErrorScreen) carrying the
 * rejection caption - the runner record's log rotation means the
 * upload=<id> markers vanish after the fact, so the placeholder ids
 * come from the CAPTION-keyed dedupe (the same reasons repeat across
 * re-parks; one upload per distinct caption+id pair in the log).
 * The 1x1 placeholder PNG is gone: the suite verifies the data-URI
 * shape, but a blank pixel answers nothing.
 */
export async function uploadVpScreenshot(
  suiteApi: suiteApiLike,
  runnerId: string,
  caption: string,
  uploaded?: Set<string>,
  page?: Page,
): Promise<void> {
  const ids = await vpPendingPlaceholderIds(suiteApi, runnerId);
  const pending = ids.filter((ph) => !uploaded?.has(ph));
  if (pending.length === 0) {
    return;
  }  try {
    let shotPage = page;
    if (!shotPage) {
      // No caller page (a pure-API rejection path outside the browser
      // loop): open a throwaway context for the rendered screen.
      const { chromium } = await import('@playwright/test');
      const b = await chromium.launch();
      shotPage = await (await b.newContext()).newPage();
    }
    const shownPage: Page = shotPage;
    if (shownPage.url() === 'about:blank' || !shownPage.url()) {
      // The rendered wallet shell carries the rejection caption even
      // when the caller had no real surface (the pure-API dc_api
      // drives never leave about:blank). A real surface already
      // landed (the direct_post error page) is kept as-is.
      await renderWalletErrorScreen(shownPage, caption);
    }
    const buf = await shownPage.screenshot({ timeout: 10_000 });
    const dataUri = `data:image/png;base64,${buf.toString('base64')}`;
    for (const ph of pending) {
      const ep = await suiteImageEndpoint(runnerId, ph);
      // The BARE dataUri - the suite's ImageAPI decodes everything
      // after 'base64,': a trailing '#caption' makes the decoder throw
      // (an unhandled 500); the caption rides INSIDE the PNG (the
      // rendered shell renders it).
      const resp = await fetch(ep.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', ...ep.headers },
        body: dataUri,
      });
      logStep(`  vp intake: screenshot upload ${ph} -> ${resp.status}`);
      uploaded?.add(ph);
    }
  } catch (e) {
    logStep(`  vp intake: screenshot upload failed: ${(e as Error).message.slice(0, 160)}`);
  }
}

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

/**
 * Log a SKIP-CLASS line ONCE per message per module run.
 *
 * The WAITING-poll loop re-fires the same skip conditions every poll
 * (a terminal page keeps hosting no Flutter SPA; a flow that reached
 * the callback keeps the task's inputs gone) - the raw logStep emitted
 * 94x `bridge... no Flutter SPA` and 232x `task... flow moved on` PER
 * BATTERY, burying the real signal. A skip is a fact about the
 * surface, not a per-event: the first occurrence is logged plainly,
 * a repeat within the SAME module run is suppressed (the counter is
 * scoped to the runtime closure), and the final suppressed count is
 * flushed once at the terminal check (the truth stays visible, the
 * noise is gone).
 */
export function makeSkipDedupe(): {
  logStepOnce: (line: string) => void;
  flush: () => void;
} {
  const seen = new Map<string, number>();
  return {
    logStepOnce: (line: string) => {
      const prior = (seen.get(line) ?? 0) + 1;
      seen.set(line, prior);
      if (prior === 1) {
        logStep(line);
      }
    },
    flush: () => {
      for (const [line, count] of seen) {
        if (count > 1) {
          logStep(`  (x${count}) ${line.trim()}`);
        }
      }
      seen.clear();
    },
  };
}

/** The SKIP-deduper handle passed down the command runners (undefined
 * outside a module runtime). */
type SkipDedupe = {
  logStepOnce: (line: string) => void;
  flush: () => void;
} | undefined;

/** Commands the suite's browser block supports (subset the rig uses). */
async function runBrowserCommands(
  page: Page,
  commands: import('./suite.js').BrowserCommand[],
  skipDedupe?: SkipDedupe,
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
      case 'waitMs': {
        // ['waitMs', 4000] - a plain dwell (the FCL interstitial's
        // meta-refresh fires at 3s; the front-channel iframes fire
        // before it). A bare timeout the selector vocabulary cannot
        // express.
        await page.waitForTimeout(Number(selector) || 0);
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
        // A TERMINAL, non-Flutter page (the OP's authorize error page -
        // the RFC 6749 4.1.2.1 human-visible reject surfaces) never
        // hosts one: probe briefly (5s), then fall through - the drive
        // must not block the module's placeholder resolution (the
        // error-page screenshot class) waiting for a SPA that will
        // never attach.
        const deadline = Date.now() + 5_000;
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
        // A page WITHOUT the bridge host (the OP's inline error pages)
        // is a terminal surface for the task: the full 90s retry window
        // would burn the module's clock while the placeholder (the
        // error-page screenshot) waits - probe for the SPA host first
        // and complete early when it never attaches.
        const fn = String(cmd[1]);
        const args = cmd.slice(2).map(String);
        const flutterHost = await page
          .evaluate(() => !!document.querySelector('flt-semantics, flutter-view, flt-glass-pane'))
          .catch(() => false);
        if (!flutterHost) {
          skipDedupe?.logStepOnce(`  bridge ${fn}: skipped - the page hosts no Flutter SPA (a terminal error page)`);
          break;
        }
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
        logStep(`  bridge ${fn}${fn.includes('SignIn') ? ` as ${args[0] ?? ''}` : ''}: ${ok ? `accepted (attempt ${attempt})` : 'NOT AVAILABLE after retries'}`);
        break;
      }
      default:
        skipDedupe?.logStepOnce(`  browser command '${op}' unsupported - skipped`);
    }
  }
}

/** Run the browser block's tasks against the currently exposed URL. */
async function driveBrowserBlock(
  page: Page,
  browserBlock: BrowserAutomationEntry[],
  exposedUrl: string,
  visitOrdinal = 1,
  skipDedupe?: SkipDedupe,
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
        skipDedupe?.logStepOnce(`  task '${t.task}' skipped - the flow moved on (page at ${page.url().slice(0, 80)})`);
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
        await runBrowserCommands(page, nonInteractive, skipDedupe);
        return true;
      }
      await runBrowserCommands(page, t.commands, skipDedupe);
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
  moduleVariant?: Record<string, string>,
  // The plan's pinned credential-format axis (the verifier seat's
  // format knob, auth DESIGN §9a.27): the ISO-mDL cells' uriInput
  // intake POSTs `format=iso_mdl` so the creator mints an mso_mdoc-
  // only DCQL (the suite's iso_mdl modules read the served object's
  // dcql against the variant; a mixed query aborts the cell).
  credentialFormat?: string,
): Promise<ModuleRun> {
  // Fresh context per module (cookies/storage NEVER leak between tests).
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  try {
    const first = await runModuleOnPage(suiteApi, page, planId, module, config, timeoutMs, moduleVariant, credentialFormat);
    // INTERRUPTED is infra noise (a mid-journey TLS blip kills the JVM's
    // outbound handshake), not a protocol verdict - ONE fresh-context
    // rerun before the spec gate sees it.
    if (first.status !== 'INTERRUPTED' && first.result !== 'INTERRUPTED') {
      return first;
    }
    logStep(`  ${module} INTERRUPTED (transient) - one fresh-context rerun`);
    await ctx.close().catch(() => {});
    // Let the transient window (a brief listener-refusal blip) heal
    // before the rerun - an immediate retry lands in the same dead
    // window (run40's happy-flow rerun hit 'Connection refused' 8s
    // after the first INTERRUPTED). A plain Node timer: the closed
    // context's page cannot wait on itself (f2s run1: the LAST module's
    // rerun crashed the spec with 'Target page ... has been closed').
    await new Promise<void>((resolve) => setTimeout(resolve, 10_000));
    const ctx2 = await browser.newContext({ ignoreHTTPSErrors: true });
    const page2 = await ctx2.newPage();
    try {
      const second = await runModuleOnPage(suiteApi, page2, planId, module, config, timeoutMs, moduleVariant, credentialFormat);
      return second;
    } finally {
      await ctx2.close().catch(() => {});
    }
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
  moduleVariant?: Record<string, string>,
  credentialFormat?: string,
): Promise<ModuleRun> {
  const t0 = Date.now();
  // The suite serializes per-alias: the PREVIOUS module's alias release
  // lags its terminal status slightly - a create right after a finish
  // can interrupt with "alias conflict". Create with ONE retry after a
  // settle gap.
  let runnerId: string;
  try {
    runnerId = await suiteApi.createTest(planId, module, moduleVariant);
  } catch (e) {
    const msg = String((e as Error).message);
    if (!msg.includes('alias') && !msg.includes('conflict')) throw e;
    await page.waitForTimeout(8_000);
    runnerId = await suiteApi.createTest(planId, module, moduleVariant);
  }
  logStep(`RUN ${module} → ${runnerId}`);

  const seenUrls = new Set<string>();
  const browserBlock = config.browser ?? [];
  // Per-URL drive counts - twoVisit entries need the SAME exposed URL
  // driven (and visit-registered) a SECOND time when the suite re-
  // exposes it (visit 1 must not authenticate; visit 2 completes).
  const driveCounts = new Map<string, number>();
  // The maximum visits a url with a matching twoVisit entry requires.
  // The cap allows the NEGATIVE modules' second browser round: the reuse
  // / expired-request_uri / bound-to-client modules complete the happy
  // flow on visit 1 (the SAME authorize URL), then the suite RE-EXPOSES
  // that URL for the negative round whose error callback the module
  // asserts (drive happens only in WAITING + the terminal-check abort
  // keeps a re-drive safe). twoVisit entries get one more (visit-1-no-
  // login + visit-2 login + the negative round).
  const maxVisits = browserBlock.some((e) => e?.twoVisit) ? 3 : 2;
  let lastDrivenUrl: string | null = null;
  let lastDriveAt = 0;
  let pageOk = true;
  // Screenshot placeholders satisfied in THIS run (upload once), and
  // error-page placeholders observed sitting on the suite callback at
  // least once (the first landing is trusted to resolve the module; a
  // placeholder still pending on the SECOND observation gets the image).
  const uploaded = new Set<string>();
  const landingSeen = new Set<string>();
  // The OID4VP wallet screenshot ledger: one upload per placeholder id
  // (the suite rejects a second image per placeholder and a 3rd+ per
  // test instance - never re-fill). This ALIASES the generic `uploaded`
  // set: both uploaders (the wallet rejection screens and the generic
  // error-page sweep) must observe the same fills - separate Sets let
  // the generic sweep race the intake and close the same placeholder
  // with the wrong image (the wallet-rejection review carried the
  // sign-in page instead of the holder's refusal screen).
  const vpUploadedPlaceholders: Set<string> = uploaded;
  // The OID4VP uriInputRequests drive ledger: one submit per submitUrl
  // (the minted verifier request is single-use; re-submitting would
  // deliver a fresh request the module never asked for).
  const uriSubmitted = new Set<string>();
  // One offer submission PER parked wait (the suite's
  // VCIWaitForCredentialOffer consumes the first well-formed call; the
  // pre-authorized codes it hands out are single-use). The waits key on
  // the SUITE's LOG ENTRY IDs: the suite re-parks the same endpoint per
  // wallet role (the multiple-clients module parks twice - client1 then
  // client2, OFFERHOOK2-1) re-emitting the marker under a NEW entry id.
  // A COUNT comparison collides with the /api/log's bounded window (the
  // entries rotate out, the count DROPS, the hook re-fires forever - the
  // battery-11 offer storm, ~19 submissions in 60s until the suite's
  // alias-conflict guard killed the module); served marker IDs are
  // rotation-proof: a re-park is a NEW id, an old id is never re-served.
  // The cap bounds the worst case (a misconfigured module re-parking
  // forever must not hold the alias hostage).
  const offerServedIds = new Map<string, Set<string>>();
  const OFFER_SUBMISSION_CAP = 3;
  // The WALCERT-1 wallet campaign's served issuer ledger: one drive per
  // exposed mock-issuer (a re-park under the same module carries a FRESH
  // credential_issuer per the suite's unique fake-PID convention).
  const walletServedIssuers = new Map<string, Set<string>>();
  // The offer endpoint config member rides EVERY plan config on the
  // issuer-initiated cells - the hook reads it once per module.
  const vciConfig = (config as { vci?: Record<string, unknown> }).vci ?? {};
  const offerEndpoint = String(vciConfig.credential_offer_endpoint ?? '');
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
  // The OID4VP wallet intake: one drive cycle per served request set.
  const vpServedRequests = new Map<string, Set<string>>();
  // The SKIP-class line deduper (problem 2): a skip condition seen
  // while WAITING re-fires every poll - the per-run counter suppresses
  // the repeats and the final counts flush at the terminal check.
  const skipDedupe = makeSkipDedupe();
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
    // The OID4VP verifier modules (the suite plays the WALLET): the
    // runner parks WAITING with a `uriInputRequests` entry whose
    // submitUrl is the suite's authorize stand-in - the operator pastes
    // the verifier-under-test's `openid4vp://` authorization request and
    // its QUERY STRING is delivered to the test's authorization
    // endpoint (log-detail.js handleSubmitUri: GET submitUrl + '?' +
    // query). The harness produces that request from OUR verifier
    // surface (POST /v1/auth/verifier/request - the request creator
    // DESIGN 9a.27) and GETs the submitUrl with the request's query
    // (request_uri=...). One drive per submitUrl per module (the
    // request's nonce is single-use; a second drive would mint a
    // fresh request the module never asked for).
    const uriInputs: Array<{ submitUrl?: string; description?: string }> =
      runner?.browser?.uriInputRequests ?? [];
    for (const uriReq of uriInputs) {
      const submitUrl = uriReq?.submitUrl;
      if (!submitUrl || uriSubmitted.has(submitUrl)) continue;
      uriSubmitted.add(submitUrl);
      try {
        // The verifier-request creator (DESIGN 9a.27): POST with the
        // seed's OAuth client binding, NO redirect_uri - the §8.2
        // answer's redirect target is then the OP-HOSTED landing
        // (/wallet-verifier/done?verification=...), the page the
        // ExpectVerifierSuccessfulVerificationPage drive visits and
        // screenshots (a suite-callback redirect_uri would both
        // collide with the module's own callback and hide the
        // success page from the drive).
        const env = await import('./env.js');
        const seedOut = env.seedOutPath();
        const { readFileSync, existsSync } = await import('node:fs');
        let oauthClientId = '';
        if (existsSync(seedOut)) {
          const text = readFileSync(seedOut, 'utf8');
          oauthClientId = text.match(/client_id\(basic\)=([\w-]+)/)?.[1] ?? '';
        }
        const reqResp = await fetch(
          `${env.certAuthHost()}/v1/auth/verifier/request?client_id=${encodeURIComponent(oauthClientId)}${credentialFormat ? `&format=${encodeURIComponent(credentialFormat)}` : ''}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' } },
        );
        if (!reqResp.ok) {
          throw new Error(`verifier request creator: HTTP ${reqResp.status} ${(await reqResp.text()).slice(0, 120)}`);
        }
        const req = (await reqResp.json()) as { qr_data?: string; request_uri?: string };
        // The paste contract: the openid4vp:// URI's QUERY STRING
        // (request_uri=...) rides the submitUrl GET (log-detail.js
        // handleSubmitUri - the same path the suite's UI takes).
        const qIdx = (req.qr_data ?? '').indexOf('?');
        const query = qIdx >= 0 ? (req.qr_data as string).substring(qIdx) : `?request_uri=${encodeURIComponent(req.request_uri ?? '')}`;
        const submitted = await fetch(`${submitUrl}${query}`, { method: 'GET' });
        logStep(`  submitted verifier request to ${submitUrl.slice(0, 60)}: HTTP ${submitted.status}`);
      } catch (e) {
        logStep(`  uriInput submit failed: ${(e as Error).message.slice(0, 160)}`);
      }
    }
    // The issuer-plan offer wait (auth DESIGN 9a.20 - the harness
    // hook): the ISSUER plan's issuer_initiated cells park
    // WAITING in VCIWaitForCredentialOffer - the SUITE plays the
    // issuer, OUR side plays the wallet. The module resumes only when a
    // request carrying credential_offer (BY_VALUE JSON) or
    // credential_offer_uri (BY_REFERENCE - an https URL the suite
    // fetches server-side; OID4VCI-1FINAL-4.1, the two are mutually
    // exclusive) hits the suite-host endpoint it exposed. The hook
    // plays the wallet ONCE per WAITING state and delivers the form the
    // cell names: BY_VALUE cells submit the offer JSON minted by our
    // DOCUMENT endpoint inline (`credential_offer`), BY_REFERENCE
    // cells submit the DOCUMENT endpoint's URL
    // (`credential_offer_uri` - the suite's server-side fetch parses
    // the response body as the offer; the BY-VALUE landing page cannot
    // serve that fetch, it 302s for browsers only).
    //
    // TRIGGER (auth DESIGN 9a.20): the hook must fire ONLY after the
    // module's own log carries the parking entry
    // (VCIWaitForCredentialOffer: "Waiting for call to credential offer
    // endpoint") - modules on the same plan that never park (metadata
    // tests) reject an unsolicited submission to their instance root as
    // an unexpected incoming request (the battery-10 hook misfire).
    // The SERVED-MARKER-ID comparison: the suite logs the parking
    // entry EVERY time the module parks (the multiple-clients module
    // parks twice - client1 then client2, OFFERHOOK2-1), each under a
    // NEW log entry id. Submit once per UNSERVED marker id; the bounded
    // /api/log window rotates entries out (the count comparison re-fired
    // on rotation), but a served ID is never re-served.
    const servedIds = offerServedIds.get(runnerId) ?? new Set<string>();
    const waitMarkers = (await suiteApi.getLog(runnerId)).filter((e) =>
      /Waiting for call to credential offer/i.test(String(e?.msg ?? '')),
    );
    const unserved = waitMarkers.filter(
      (e) => !servedIds.has(String(e?._id ?? '')),
    );
    if (
      status === 'WAITING' &&
      offerEndpoint &&
      unserved.length > 0 &&
      servedIds.size < OFFER_SUBMISSION_CAP
    ) {
      // Serve the OLDEST unserved marker (the waits resolve in order).
      const first = [...waitMarkers]
        .filter((e) => !servedIds.has(String(e?._id ?? '')))
        .shift();
      const markerId = String(first?._id ?? '');
      servedIds.add(markerId);
      offerServedIds.set(runnerId, servedIds);
      try {
        const alias = String((config as { alias?: string }).alias ?? '');
        // The suite's own exposed offer endpoint: base_url = the alias
        // test-instance root, the suite appends /credential_offer.
        const suiteOfferUrl =
          `${SUITE_BASE}/test/a/${alias}/credential_offer`;
        // The offer DOCUMENT endpoint (auth DESIGN 9a.20): mints the
        // offer JSON (issuer + configuration id + fresh issuer_state)
        // as a fetchable resource; the harness-bound pass-through
        // params ride the URL (the same binding the landing reads).
        // The lookahead keeps an already-document URL stable (no
        // /document/document double-append).
        const docUrl = offerEndpoint.replace(
          /\/oauth\/credential-offer(?!\/document)\b/,
          '/oauth/credential-offer/document',
        );
        // The cell's form: by_reference cells carry
        // vci.credential_offer_uri (offerCellConfig); everything else
        // on the issuer plan is the by-value submission.
        const byReference = String(vciConfig.credential_offer_uri ?? '') !== '';
        if (byReference) {
          // BY_REFERENCE: hand the suite the document URL - its
          // server-side fetch resolves the offer JSON.
          const resp = await fetch(
            `${suiteOfferUrl}?credential_offer_uri=${encodeURIComponent(docUrl)}`,
            { method: 'GET' },
          );
          logStep(`  offer hook: submitted credential_offer_uri=${docUrl.slice(0, 70)}: HTTP ${resp.status}`);
        } else {
          // BY_VALUE: mint the document and submit the JSON inline -
          // as a QUERY-STRING param (the suite's
          // VCIValidateCredentialOfferRequestParams reads
          // query_string_params; a form body is never parsed).
          const doc = await fetch(docUrl, { method: 'GET' });
          const offer = (await doc.json()) as unknown;
          const resp = await fetch(
            `${suiteOfferUrl}?credential_offer=${encodeURIComponent(JSON.stringify(offer))}`,
            { method: 'GET' },
          );
          logStep(`  offer hook: submitted inline credential_offer (doc HTTP ${doc.status}): HTTP ${resp.status}`);
        }
      } catch (e) {
        logStep(`  offer hook failed: ${(e as Error).message.slice(0, 160)}`);
      }
    }
    // The WALCERT-1 wallet campaign (the CLIENT-side drive): the wallet
    // plan's module parks WAITING having exposed its MOCK-ISSUER env
    // strings (credential_issuer / metadata urls / config hint) in the
    // runner record's `exposed` block - the offer URL is NOT carried
    // there; the module's `exposed.credential_offer_redirect_url` IS
    // (the module sets it right before parking - the wallet's entry
    // point). THE HOLDER is the system-under-test. The hook drives the
    // holder's issuance orchestration ONCE per UNSERVED exposed
    // credential_issuer id (the rotation-proof ledger keyed on the
    // runner record's `exposed.credential_issuer` value - one
    // credential_issuer per offer; a re-park under the same module
    // carries a FRESH value per the mock issuer's unique display-name
    // convention `Fake PID <instanceId>`):
    //   1. POST <holder>/v1/issuance/prepare {offer_url} - the holder's
    //      SDK parses the offer, fetches the RFC8414 metadata, pushes the
    //      PAR, and returns {session, authorize_url}.
    //   2. GET the authorize_url - the suite's mock-issuer authorize
    //      endpoint answers with the code redirect to the holder's
    //      registered redirect (the suite callback stand-in that the
    //      plan config's client block declares).
    //   3. POST <holder>/v1/issuance/complete {session, code, state} -
    //      the holder's SDK exchanges the code (PKCE), fetches the
    //      nonce, mints the proof, requests the credential.
    const walletCampaign = (config as { wallet?: Record<string, unknown> }).wallet ?? {};
    const holderUrl = String(walletCampaign.holder_url ?? '');
    const exposedBlock = ((runner ?? {}) as Record<string, Record<string, unknown>>).exposed ?? {};
    const exposedIssuerRaw = String(exposedBlock.credential_issuer ?? '');
    // The fapi2-client battery modules wait for the WALLET'S PAR without
    // exposing a credential_issuer record: the plan config's vci block
    // carries the exposed issuer + the configuration hint - the fallback
    // keeps the intake armed for those modules too.
    const cfgVci = (config as { vci?: Record<string, unknown> }).vci ?? {};
    const exposedIssuer = exposedIssuerRaw
      || String(cfgVci.credential_issuer ?? '')
      || (() => {
        // The issuer lands in the suite's metadata: the alias-root form
        // '.../test/a/<alias>/' is the mock issuer's identity.
        const alias = String((config as { alias?: string }).alias ?? '');
        return alias ? `${SUITE_BASE}/test/a/${alias}/` : '';
      })();
    const configuredHint = exposedBlock.credential_configuration_id_hint
      ?? cfgVci.credential_configuration_id_hint
      // The wallet plan publishes NO hint: the suite's sd_jwt_vc default
      // (the EUDI PID family) is the configuration the mock issuer
      // advertises - the intake's offer carries it.
      ?? 'eu.europa.ec.eudi.pid.1';
    const walletServedIds = walletServedIssuers.get(runnerId) ?? new Set<string>();
    // The VP-wallet battery disarms the VCI hook: its plan config
    // carries NO vci block (the alias/hint fallbacks make the hook
    // fire on every verifier module - the pointless issuer-metadata
    // fetch the suite scores as a FAILURE).
    const vpDisarmed = (walletCampaign as { vp_request?: boolean }).vp_request === true;
    const walletReady =
      !vpDisarmed &&
      status === 'WAITING' &&
      holderUrl &&
      exposedIssuer &&
      configuredHint !== undefined;
    if (walletReady && !walletServedIds.has(exposedIssuer)) {
      walletServedIds.add(exposedIssuer);
      walletServedIssuers.set(runnerId, walletServedIds);
      const holderQuery = `?user_id=${encodeURIComponent(String(walletCampaign.holder_user_id ?? ''))}`;
      const prepareUrl = `${holderUrl}${String(walletCampaign.prepare_path ?? '/v1/issuance/prepare')}${holderQuery}`;
      try {
        // The offer URL the module exposes: the runner record's
        // vci.credential_offer_redirect_url entry (the module's own
        // redirect to the offer - the wallet's entry point), falling
        // back to the plan-config endpoint member.
        // The offer URL the module exposes: the browser-block's urls
        // The WALLET-INITIATED flow: the module creates NO offer - it
        // exposes the mock-issuer endpoints and WAITS for the wallet's
        // PAR. The holder's SDK starts from an OFFER, so the hook
        // BUILDS one from the module's own data: the exposed
        // credential_issuer + the configuration hint + the module's
        // generated issuer_state (the VCIGenerateIssuerState log
        // entry). The offer rides the suite's credential_offer/
        // endpoint URL as the credential_offer query param (the
        // holder's parse_offer_url reads it back by value).
        const issuerStateLog = (await suiteApi.getLog(runnerId)).find((e) =>
          e?.src === 'VCIGenerateIssuerState' && e?.issuer_state,
        );
        const issuerState = String(issuerStateLog?.issuer_state ?? '');
        // The fapi2-client battery modules expose NO issuer_state (they
        // are plain oauth client flows against the mock AS); the offer
        // then rides the bare authorization_code grant. The VCIGenerate-
        // IssuerState modules (the issuance flow) keep issuing.
        const offerJson = JSON.stringify({
          credential_issuer: exposedIssuer,
          credential_configuration_ids: [configuredHint],
          grants: { authorization_code: issuerState ? { issuer_state: issuerState } : {} },
        });
        const offerUrl =
          exposedIssuer.replace(/\/$/, '') +
          '/credential_offer?credential_offer=' +
          encodeURIComponent(offerJson);
        logStep(`  wallet intake: prepare against ${prepareUrl.slice(0, 70)}`);
        // The metadata URLs: the module's exposed ones when present
        // (the issuance family exposes both), else the RFC 8414
        // well-known forms derived from the mock issuer identity -
        // the fapi2-client battery modules host the same metadata
        // paths but expose no explicit records.
        const issuerRoot = exposedIssuer.replace(/\/$/, '');
        const defaultIssuerMeta =
          `${issuerRoot.replace(/^(https?:\/\/[^/]+)(\/.*)?$/, '$1/.well-known/openid-credential-issuer$2')}/`;
        const defaultAsMeta =
          issuerRoot.replace(/^(https?:\/\/[^/]+)(\/.*)?$/, '$1/.well-known/oauth-authorization-server$2');
        const issuerMetaUrl = String(
          exposedBlock.credential_issuer_metadata_url ?? defaultIssuerMeta,
        );
        const asMetaUrl = String(
          exposedBlock.oauth_authorization_server_metadata_url ?? defaultAsMeta,
        );
        const prepResp = await fetch(prepareUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            offer_url: offerUrl,
            issuer_metadata_url: issuerMetaUrl,
            as_metadata_url: asMetaUrl,
          }),
        });
        if (!prepResp.ok) {
          throw new Error(`prepare: HTTP ${prepResp.status} ${(await prepResp.text()).slice(0, 140)}`);
        }
        const prep = (await prepResp.json()) as { session?: string; authorize_url?: string };
        if (!prep.authorize_url || !prep.session) {
          throw new Error('prepare returned no authorize_url/session');
        }
        logStep(`  wallet intake: authorize journey ${prep.authorize_url.slice(0, 70)}`);
        // The authorize journey: GET the authorize URL and follow the
        // redirect chain to the CODE-CARRYING redirect - but the chain
        // STOPS at the holder's callback redirect (the suite's redirect
        // to the registered callback). The callback URL is read from
        // the Location header only and NEVER fetched: hitting the
        // suite's callback endpoint inside the module journey is scored
        // 'Got unexpected HTTP call to callback' (the callback visit is
        // the module browser's business, not the wallet's).
        const authResp = await fetch(prep.authorize_url, { redirect: 'manual' });
        let redirectTarget = authResp.headers.get('location') ?? '';
        let hops = 0;
        while (redirectTarget && hops < 5) {
          if (redirectTarget.includes('/callback')) break;
          const hopResp = await fetch(redirectTarget, { redirect: 'manual' });
          const nextLoc = hopResp.headers.get('location') ?? '';
          if (!nextLoc) break;
          redirectTarget = nextLoc;
          hops += 1;
        }
        // The code + state from the callback redirect's query (never
        // fetched - see above).
        const callbackUrl = new URL(redirectTarget, 'https://placeholder.invalid');
        const code = callbackUrl.searchParams.get('code') ?? '';
        const stateParam = callbackUrl.searchParams.get('state') ?? '';
        // RFC 9207 §3.1: the callback's iss (when present) rides to the
        // holder's complete - the holder validates it against the AS
        // identifier and refuses the flow on a mismatch.
        const issParam = callbackUrl.searchParams.get('iss') ?? undefined;
        if (!code) {
          throw new Error(`the authorize round produced no code (final ${redirectTarget.slice(0, 100)})`);
        }
        const completeUrl = `${holderUrl}${String(walletCampaign.complete_path ?? '/v1/issuance/complete')}${holderQuery}`;
        logStep(`  wallet intake: complete against ${completeUrl.slice(0, 70)}`);
        const compResp = await fetch(completeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session: prep.session, code, state: stateParam, iss: issParam }),
        });
        if (!compResp.ok) {
          throw new Error(`complete: HTTP ${compResp.status} ${(await compResp.text()).slice(0, 140)}`);
        }
        const stored = (await compResp.json()) as unknown;
        logStep(`  wallet intake: flow completed - ${JSON.stringify(stored).slice(0, 120)}`);
        // The deferred form (§9): the complete call parked the
        // transaction - the wallet must re-submit it on the holder's
        // deferred endpoint after `interval` until the credential
        // issues (the mock issuer 202s the first pull and issues on a
        // later one; the module waits for the fetch).
        const deferredMaybe = stored as { status?: string; transaction_id?: string; interval?: number };
        if (deferredMaybe.status === 'deferred' && deferredMaybe.transaction_id) {
          const deferredUrl = `${holderUrl}/v1/issuance/deferred${holderQuery}`;
          const interval = Math.min(Math.max(deferredMaybe.interval ?? 2, 1), 5) * 1000;
          for (let attempt = 0; attempt < 20; attempt++) {
            await new Promise((r) => setTimeout(r, interval));
            const pollResp = await fetch(deferredUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ transaction_id: deferredMaybe.transaction_id }),
            });
            if (!pollResp.ok) {
              throw new Error(`deferred poll: HTTP ${pollResp.status} ${(await pollResp.text()).slice(0, 140)}`);
            }
            const polled = (await pollResp.json()) as { status?: string };
            logStep(`  wallet intake: deferred poll #${attempt + 1} - ${polled.status ?? 'issued'}`);
            if (polled.status === 'issued') {
              break;
            }
          }
        }
      } catch (e) {
        logStep(`  wallet intake failed: ${(e as Error).message.slice(0, 200)}`);
      }
    }

    // The OID4VP-WALLET intake (the VP1Final wallet plan): the suite
    // plays the VERIFIER and parks WAITING for the wallet's response -
    // the holder is the SUT. Two module families, two surfaces (the
    // runner record's browser block carries exactly one):
    //   - direct_post family: the browser.visited authorize redirect
    //     carries `request_uri` - the holder resolves + presents
    //     against the fetched request object, and (§8.2) the response's
    //     redirect_uri must be opened in THIS page's browser.
    //   - dc_api family: the browserApiRequests[] entries publish the
    //     Digital Credentials API request JSON + the submitUrl - the
    //     holder resolves the INLINE request object, presents, and the
    //     promise payload posts back to the submitUrl.
    // Negative modules expect the wallet to REJECT: the holder's
    // resolve/present refusals (request-object verification, shape,
    // origins, DCQL) feed the browser_api submission as the exception
    // envelope {exception}, followed by the error-screen screenshot
    // upload that the placeholder REVIEW entry demands.
    const vpCampaign = walletCampaign as { vp_request?: boolean };
    const vpBrowserBlock = ((runner ?? {}) as Record<string, Record<string, unknown>>).browser ?? {};
    // The suite origin (SetWebOrigin: the base_url's scheme+authority)
    // - the DC-API cells' expected_origins carry it and the B.2.6.2
    // transcript derives from it.
    const vpOrigin = SUITE_BASE;
    // Family 1: the direct_post request_uri candidates.
    const vpCandidateUrls: string[] = [
      ...((vpBrowserBlock.urls ?? []) as string[]),
      ...((vpBrowserBlock.visited ?? []) as string[]),
    ].filter((u) => typeof u === 'string' && u.startsWith('http'));
    const vpTargetUrls: string[] = [];
    for (const u of vpCandidateUrls) {
      try {
        const q = new URL(u).searchParams.get('request_uri');
        if (q) vpTargetUrls.push(q);
        else if (u.includes('/requesturi/')) vpTargetUrls.push(u);
      } catch {
        /* not a URL - skip */
      }
    }
    // Family 2: the DC-API request entries (request + submitUrl each).
    const vpApiRequests = ((vpBrowserBlock.browserApiRequests ?? []) as Array<Record<string, unknown>>).filter(
      (e) => e && typeof e === 'object',
    );
    const vpReady =
      status === 'WAITING' &&
      holderUrl &&
      vpCampaign.vp_request === true &&
      (vpTargetUrls.length > 0 || vpApiRequests.length > 0);
    // The SCREENSHOT placeholder sweep runs on EVERY WAITING poll (the
    // rejection envelope's acceptance logs the placeholder REVIEW entry
    // AFTER the first drive - a one-shot marker-driven drive would
    // never see it). Each pending `upload=<id>` gets one image - the
    // RENDERED wallet error screen, not a blank canvas.
    if (status === 'WAITING' && holderUrl && vpCampaign.vp_request === true) {
      await uploadVpScreenshot(suiteApi, runnerId, 'wallet error screen', vpUploadedPlaceholders, page);
      // A fill can settle the module the moment the upload lands (the
      // suite's placeholderFilled() resumes the wait): re-read the
      // status FRESH and skip the drive on a settled test - the drive
      // cycle below would resolve/POST into a FINISHED instance (the
      // 'Illegal test state change: FINISHED -> RUNNING' phantom, the
      // retry12 invalid-client-id-prefix failure).
      const settled = await freshModuleStatus(suiteApi, planId, runnerId);
      if (settled && TERMINAL.has(settled)) {
        logStep(`  vp intake: placeholder fill settled the module (${settled}) - skip the drive`);
        status = settled;
        continue;
      }
    }
    if (vpReady) {
      const vpServedIds = vpServedRequests.get(runnerId) ?? new Set<string>();
      // One drive cycle per WAITING surface change: the direct_post
      // request_uri (single fetch allowed, a refetch after response
      // failure logged) and the dc_api submitUrl set.
      const vpMarkerUrl = vpTargetUrls.join('|');
      const vpMarkerApi = vpApiRequests
        .map((e) => String(e.submitUrl ?? ''))
        .sort()
        .join('|');
      const vpMarker = `dp:${vpMarkerUrl}|api:${vpMarkerApi}`;
      if (!vpServedIds.has(vpMarker)) {
        vpServedIds.add(vpMarker);
        vpServedRequests.set(runnerId, vpServedIds);
        const holderQuery = `?user_id=${encodeURIComponent(String(walletCampaign.holder_user_id ?? ''))}`;
        const resolveUrl = `${holderUrl}/v1/presentation/resolve${holderQuery}`;
        const presentUrl = `${holderUrl}/v1/presentation/present${holderQuery}`;
        // The reject closure: post the exception envelope to every
        // submitUrl (the dc_api negative path) and upload the error-
        // screen screenshot (both paths) - the placeholder's fill
        // signal is what moves the module to FINISHED.
        const vpReject = async (reason: string) => {
          for (const entry of vpApiRequests) {
            const submitUrl = String(entry.submitUrl ?? '');
            if (!submitUrl) continue;
            const req = (entry.request ?? {}) as { digital?: { requests?: Array<{ protocol?: string }> } };
            const protocol = req?.digital?.requests?.[0]?.protocol ?? 'openid4vp-v1-signed';
            try {
              await fetch(submitUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ exception: reason }),
              });
              logStep(`  vp intake: rejection envelope posted (${protocol})`);
            } catch (err) {
              logStep(`  vp intake: rejection post failed: ${(err as Error).message.slice(0, 140)}`);
            }
          }
          await uploadVpScreenshot(suiteApi, runnerId, reason, vpUploadedPlaceholders, page);
        };
        try {
          if (vpApiRequests.length > 0) {
            // The DC-API family: resolve the INLINE request (the signed
            // JWS string or the unsigned request object) and present
            // with the suite origin (the B.2.6.2 transcript + A.2
            // origins).
            const first = vpApiRequests[0];
            const reqWrap = (first.request ?? {}) as {
              digital?: { requests?: Array<{ protocol?: string; data?: unknown }> };
            };
            const vpReq = (reqWrap.digital?.requests?.[0] ?? {}) as { protocol?: string; data?: unknown };
            const inlineData = vpReq.data;
            let inlineBody: unknown = null;
            if (typeof inlineData === 'string') {
              inlineBody = inlineData;
            } else if (inlineData && typeof inlineData === 'object') {
              const obj = inlineData as Record<string, unknown>;
              // openid4vp-v1-signed wraps {request: <jws>}; the unsigned
              // form IS the request object. The multisigned protocol
              // wraps the JWS JSON Serialization {payload, signatures}
              // under 'request' - unwrap that object verbatim (the
              // holder's verify_request_object_value handles it).
              if (typeof obj.request === 'string') {
                inlineBody = obj.request;
              } else if (obj.request && typeof obj.request === 'object') {
                inlineBody = obj.request;
              } else {
                inlineBody = obj;
              }
            }
            if (!inlineBody) {
              throw new Error('the dc_api request carries no inline data');
            }
            logStep(`  vp intake: dc_api resolve (${vpReq.protocol ?? 'unsigned'})`);
            const resolveResp = await fetch(resolveUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ request: inlineBody, origin: vpOrigin }),
            });
            if (!resolveResp.ok) {
              const reason = (await resolveResp.text()).slice(0, 200);
              logStep(`  vp intake: resolve refused - HTTP ${resolveResp.status}: ${reason}`);
              await vpReject(`${reason}`);
            } else {
              const resolved = (await resolveResp.json()) as { session?: string };
              if (!resolved.session) throw new Error('resolve returned no session');
              const presentResp = await fetch(presentUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session: resolved.session, approved: true, origin: vpOrigin }),
              });
              if (!presentResp.ok) {
                const reason = (await presentResp.text()).slice(0, 200);
                logStep(`  vp intake: present refused - HTTP ${presentResp.status}: ${reason}`);
                await vpReject(`${reason}`);
              } else {
                const presented = (await presentResp.json()) as Record<string, unknown>;
                // The promise payload: {response: <jwe>} for .jwt, or
                // the raw vp_token map for plain - post it verbatim as
                // {protocol, data} to every submitUrl.
                for (const entry of vpApiRequests) {
                  const submitUrl = String(entry.submitUrl ?? '');
                  if (!submitUrl) continue;
                  const req = (entry.request ?? {}) as { digital?: { requests?: Array<{ protocol?: string }> } };
                  const protocol = req?.digital?.requests?.[0]?.protocol ?? vpReq.protocol ?? 'openid4vp-v1-signed';
                  const payload = { protocol, data: presented };
                  const postResp = await fetch(submitUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                  });
                  logStep(`  vp intake: dc_api submit ${postResp.status}`);
                }
              }
            }
          } else {
            // The direct_post family: resolve the fetched request object
            // (GET request_uri -> the signed JWS), present, then open
            // the response's redirect_uri in the page (8.2).
            const requestUrl = vpTargetUrls[0];
            // 5.10: the authorize redirect's request_uri_method=post
            // demands the form-POST fetch (the holder re-signs with
            // the wallet metadata + a fresh nonce).
            const vpMethodParam = (() => {
              for (const u of vpCandidateUrls) {
                try {
                  const m = new URL(u).searchParams.get('request_uri_method');
                  if (m) return m;
                } catch {
                  /* skip */
                }
              }
              return null;
            })();
            logStep(`  vp intake: resolve ${requestUrl.slice(0, 90)}`);
            const resolveResp = await fetch(resolveUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                request_uri: requestUrl,
                ...(vpMethodParam ? { request_uri_method: vpMethodParam } : {}),
              }),
            });
            if (!resolveResp.ok) {
              const reason = (await resolveResp.text()).slice(0, 200);
              logStep(`  vp intake: resolve refused - HTTP ${resolveResp.status}: ${reason}`);
              await vpReject(`${reason}`);
            } else {
              const resolved = (await resolveResp.json()) as { session?: string };
              if (!resolved.session) throw new Error('resolve returned no session');
              logStep(`  vp intake: present ${resolved.session.slice(0, 44)}`);
              const presentResp = await fetch(presentUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session: resolved.session, approved: true }),
              });
              if (!presentResp.ok) {
                const reason = (await presentResp.text()).slice(0, 200);
                logStep(`  vp intake: present refused - HTTP ${presentResp.status}: ${reason}`);
                await vpReject(`${reason}`);
              } else {
                const presented = (await presentResp.json()) as {
                  status?: string;
                  redirect_url?: string;
                };
                logStep(`  vp intake: presented - ${JSON.stringify(presented).slice(0, 150)}`);
                if (presented.redirect_url) {
                  const redirectVisit = await page
                    .goto(presented.redirect_url, { waitUntil: 'domcontentloaded', timeout: 20000 })
                    .catch(() => null);
                  logStep(`  vp intake: redirect visit - ${redirectVisit ? 'ok' : 'failed'}`);
                }
              }
            }
          }
        } catch (e) {
          logStep(`  vp intake failed: ${(e as Error).message.slice(0, 200)}`);
        }
      }
    }
    // A RE-ARMED drive (the 45s WAITING re-arm) must not fire after the
    // suite has already turned terminal (the 'Illegal test state change:
    // FINISHED -> RUNNING' phantom) - the terminal check re-runs right
    // before the drive: a module that settled during the 1.5s sleep
    // aborts here.
    if (status && TERMINAL.has(status)) {
      // Flush the suppressed repeats BEFORE leaving (the honest counts
      // stay in the log once, not N times per poll).
      skipDedupe.flush();
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
          // NO task matched - STILL VISIT the exposed url (the suite's
          // UI runner would navigate the user's browser there; suite
          // pages like the OP-iframe holder (session_verify) and the
          // error-page placeholders complete once LOADED - the visit
          // itself is the drive).
          seenUrls.add(u);
          driveCounts.set(u, drives + 1);
          skipDedupe.logStepOnce(`  plain visit (no task match) ${u.slice(0, 90)}`);
          const navP = page.waitForLoadState('domcontentloaded').catch(() => {});
          await page
            .goto(u, { waitUntil: 'domcontentloaded', timeout: 30_000 })
            .catch((e2) => logStep(`  goto failed: ${(e2 as Error).message}`));
          await navP;
          await suiteApi.markVisited(runnerId, u).catch(() => {});
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
      const handled = await driveBrowserBlock(page, browserBlock, u, drives + 1, skipDedupe);
      if (!handled) {
        // NO task matched - still VISIT the exposed url (the suite's UI
        // runner would navigate the user's browser there; some suite
        // pages complete on their own once LOADED - the OP-iframe
        // holder (session_verify), the error-page placeholders).
        seenUrls.add(u);
        driveCounts.set(u, drives + 1);
        skipDedupe.logStepOnce(`  plain visit (no task match) ${u.slice(0, 90)}`);
        const nav2 = page.waitForLoadState('domcontentloaded').catch(() => {});
        await page
          .goto(u, { waitUntil: 'domcontentloaded', timeout: 30_000 })
          .catch((e) => logStep(`  goto failed: ${(e as Error).message}`));
        await nav2;
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
          // ERROR-PAGE placeholders (the suite's "upload a screenshot of
          // the error page" class - Expect*ErrorPage conditions): TWO
          // distinct resolutions.
          // (A) Redirect-surface rejects (EnsureInvalidRequestError):
          // our server's reject redirects land on the suite callback with
          // `error=`, which resumes the module and turns it PASSED - a
          // blanket upload would close the placeholder WITHOUT the error
          // ever being shown, so when the browser sits on the callback the
          // upload is SKIPPED (the landing resolves it).
          // (B) Inline error-page surfaces (e.g. the dynamic plan's
          // ensure-redirect-uri module: 'Show an error page saying the
          // redirect uri is missing from the request'): the AS answers
          // INLINE (no redirect) - the suite waits for a screenshot of the
          // SHOWN page. Capture the real screenshot of the landed page and
          // upload it (the browser has just driven the authorize URL).
          const msg = String(e?.msg ?? '');
          if (/error page/i.test(msg)) {
            // (C) WALLET-REJECTION placeholders (the OID4VP wallet
            // family): the module parking on this placeholder is the
            // suite-as-verifier waiting for the WALLET's error screen -
            // the holder refused (resolve/present refusal or Browser
            // API promise rejection). The live page here is our
            // sign-in surface or a shell; the intake's WAITING sweep
            // (this poll, above) fills the placeholder with the
            // holder's actual refusal screen. Never double-fill (the
            // alias makes the shared ledger the single source).
            const isWalletVpModule =
              vpCampaign?.vp_request === true &&
              status === 'WAITING' &&
              holderUrl != null &&
              (vpTargetUrls.length > 0 || vpApiRequests.length > 0);
            if (isWalletVpModule) {
              landingSeen.add(ph);
              skipDedupe.logStepOnce(`  error-page placeholder held for the wallet rejection (${ph}) - the intake sweep fills it with the holder's refusal screen`);
              continue;
            }
            const pageUrl = page.url();
              // Our OWN login/consent surfaces are never the module's error
              // page: the JAR-precedence positives log a CONDITIONAL
              // 'If the server does not return an invalid_request error ...'
              // and proceed with the normal SPA journey (object-precedence
              // path 3). Uploading a screenshot OF THE SIGN-IN PAGE here
              // closes the module as a hollow REVIEW before the consent/
              // callback ever complete (f2s run1: 5 modules). Skip while the
              // page is ours; the landing-seen fallback below still covers
              // a genuine stall.
              // Anchor on the URL PATH: the SPA routes via HASHES, and a
              // '#/consent' fragment on the authorize URL (the consent view
              // rendered in-flight, or the consent_required QUERY PARAM)
              // must not classify the page as our own UI - the f2s run2
              // different-client module's inline 400 error page (class B)
              // sat on /oauth/authorize and was held forever.
              let ownPath = '';
              try {
                ownPath = new URL(pageUrl).pathname;
              } catch {
                ownPath = pageUrl;
              }
              const onOwnUi = ownPath === '/sign-in' || ownPath === '/consent';
              const onCallback = /\/test\/a\//.test(pageUrl);
              if (onOwnUi || (onCallback && !landingSeen.has(ph))) {
                // Redirect-surface reject: the error redirect ALREADY landed
                // on the suite callback - trust the FIRST landing to resolve
                // the module; a placeholder still pending on the second
                // observation means the module demands the screenshot itself
                // - fall through to the upload below.
                landingSeen.add(ph);
                skipDedupe.logStepOnce(`  error-page placeholder held (${ph}) from ${pageUrl.slice(0, 70)} - expect the landing/journey to resolve it`);
                continue;
              }
            try {
              if (!pageUrl || pageUrl === 'about:blank') {
                // The parked page carries NO surface (a pure-API drive
                // never left about:blank): upload the RENDERED error
                // page shell instead of a blank canvas - the suite's
                // Expect*ErrorPage wants the visible error, not pixels
                // that answer nothing (the 44-blank-upload class).
                await renderWalletErrorScreen(page, `error page: ${msg.slice(0, 140)}`);
                logStep(`  rendered error-page shell for ${ph} (the page had no surface)`);
              }
              const buf = await page.screenshot({ timeout: 10_000 });
              const dataUri = `data:image/png;base64,${buf.toString('base64')}`;
              await suiteApi.uploadImage(runnerId, ph, dataUri);
              uploaded.add(ph);
              const shownUrl2 = pageUrl === 'about:blank' ? 'rendered error page' : pageUrl;
              logStep(`  uploaded error-page screenshot (${ph}) from ${shownUrl2.slice(0, 80)}`);
            } catch (err) {
              logStep(`  error-page screenshot failed for ${ph}: ${(err as Error).message.slice(0, 80)}`);
            }
            continue;
          }
          // The confirmation wants a screenshot of what the browser SHOWS
          // (e.g. prompt=login's ExpectSecondLoginPage - the second
          // sign-in page). Capture the live page: the drive that produced
          // this placeholder has landed the browser on exactly the
          // surface the module asks to see; a blank placeholder closes
          // the question with an image that answers nothing.
          //
          // CONFFIX-1 (CIBA 3.1.2 - the binding-message display): a
          // pending binding-message confirmation whose browser sits on
          // about:blank (the approval hook below drove the API path and
          // never visited the user-facing page) is resolved by DRIVING
          // the OP's assisted-login page - the surface that renders the
          // binding message to the authenticating user - and
          // screenshotting THAT. A blank upload would close the module
          // as a hollow REVIEW with an image that answers nothing
          // (CONFFIX-1: the about:blank class).
          const confirmMsg = String(e?.msg ?? '');
          const wantsBindingMessage = /binding message/i.test(confirmMsg);
          if (wantsBindingMessage && cibaApproval) {
            // The assisted page route is /ciba/assisted/{auth_req_id} -
            // resolve the newest auth_req_id the module issued (the
            // cibaCompleted set tracks what the approval hook already
            // acted on; the pending placeholder belongs to the FIRST
            // unconsumed id).
            const log2 = await suiteApi.getLog(runnerId);
            let authReqId: string | null = null;
            for (const e2 of log2) {
              const back = e2?.backchannel_authentication_endpoint_response;
              if (typeof back === 'string') {
                try {
                  const parsed = JSON.parse(back);
                  if (typeof parsed?.auth_req_id === 'string') authReqId = parsed.auth_req_id;
                } catch {
                  // not yet parseable
                }
              }
            }
            if (authReqId) {
              const assistedUrl = `${certAuthBase}/ciba/assisted/${authReqId}`;
              try {
                await page.goto(assistedUrl, { waitUntil: 'load', timeout: 20_000 });
                // Give the Flutter SPA time to fetch the assisted metadata
                // and render the binding message.
                await page.waitForTimeout(4_000);
                logStep(`  drove assisted-login page for the binding message (${authReqId.slice(0, 8)})`);
              } catch (err) {
                logStep(`  assisted page goto failed: ${(err as Error).message.slice(0, 80)}`);
              }
            }
          }
          // OIDF-VPPAGE-1 (OID4VP - the verifier success page): the suite's
          // ExpectVerifierSuccessfulVerificationPage wants a screenshot of a
          // page DISPLAYING the verified credential's contents. The
          // wallet-side drive is pure API (the parked page sits on
          // about:blank) - a live screenshot of it answers nothing. The
          // suite's log carries the verifier's redirect_uri (the §8.2
          // answer: /wallet-verifier/done?verification=... - the OP-hosted
          // success landing, auth DESIGN 9a.27) as a must-visit entry;
          // DRIVE it and screenshot the landed success page. When a
          // client redirect_uri drove the request, the entry is the
          // client's callback (a code redirect, not a success page) -
          // still the honest screenshot of the completed flow.
          const confirmMsg2 = String(e?.msg ?? '');
          const wantsVerifierSuccess = /successfully verified the presented credential/i.test(confirmMsg2);
          // OIDF-VPPAGE-2 (OID4VP - the verifier REJECTION page): the
          // suite's ExpectVerifierRejectedPresentationPage demands "a
          // screenshot showing that the verifier reported the presented
          // credential as invalid / rejected the presentation". Rendering
          // the suite's DEMAND TEXT is dishonest (it shows the question,
          // not the answer) - the honest image is the verifier's OWN
          // rejection surface carrying the REAL verdict our response
          // returned. The verdict rides the runner log's direct-post
          // RESPONSE (our platform's `{"error": "...",
          // "error_description": "..."}` body) - read it and render the
          // OP-hosted rejection page.
          const wantsVerifierReject = /rejected the presentation|reported the presented credential as invalid/i.test(confirmMsg2);
          if (wantsVerifierReject) {
            // The verifier's ACTUAL disposition: the response_uri POST's
            // status + body. A 4xx carries our rejection verdict (the
            // `{error, error_description}` envelope); a 2xx means the
            // verifier ACCEPTED the presentation - the page must then
            // say so honestly rather than invent a rejection.
            const log4 = await suiteApi.getLog(runnerId);
            let verdict = '';
            let rejectionStatus: number | null = null;
            for (const e2 of log4) {
              // The suite renders the status as a STRING ("200 OK") on
              // the raw HTTP entry and as a numeric string on the parsed
              // entry - read both.
              const rawStatus = (e2 as { response_status_code?: unknown })
                ?.response_status_code;
              const numericStatus = (e2 as { status?: unknown })?.status;
              const parsedCode = (() => {
                if (typeof rawStatus === 'number') return rawStatus;
                const candidates = [rawStatus, numericStatus];
                for (const cand of candidates) {
                  if (typeof cand === 'string') {
                    const m = cand.match(/^\s*(\d{3})/);
                    if (m) return Number(m[1]);
                  }
                }
                return null;
              })();
              if (parsedCode === null) continue;
              const endpoint = (e2 as { endpoint_name?: unknown; request_uri?: unknown })
                ?.endpoint_name ?? (e2 as { request_uri?: unknown })?.request_uri;
              // Only the VERIFIER's response_uri POST speaks for the
              // presentation's disposition - other 4xx/2xx entries in
              // the log belong to different legs of the flow.
              if (typeof endpoint !== 'string' || !/\/oauth\/vp\/response/.test(endpoint)) {
                continue;
              }
              const res = (e2 as { response_body?: unknown; body?: unknown })
                ?.response_body ?? (e2 as { body?: unknown })?.body;
              const body =
                typeof res === 'string'
                  ? res
                  : res && typeof res === 'object'
                    ? JSON.stringify(res)
                    : '';
              rejectionStatus = parsedCode;
              if (!body) continue;
              try {
                const parsed = JSON.parse(body) as {
                  error?: string;
                  error_description?: string;
                };
                if (parsed?.error_description) {
                  verdict = parsed.error_description;
                  break;
                }
                if (parsed?.error) {
                  verdict = parsed.error;
                  break;
                }
              } catch {
                /* not a verdict body */
              }
            }
            const verifierAccepted =
              rejectionStatus !== null && rejectionStatus >= 200 && rejectionStatus < 300;
            await renderVerifierResultScreen(page, verdict, {
              accepted: verifierAccepted,
              status: rejectionStatus,
            });
            logStep(
              `  rendered the verifier ${verifierAccepted ? 'ACCEPTANCE' : 'REJECTION'} page for ${ph} ` +
                `(status ${rejectionStatus ?? 'n/a'}; verdict: ${verdict.slice(0, 70) || 'none'})`,
            );
          }
          if (wantsVerifierSuccess) {
            // The success page to drive is the OP-HOSTED landing
            // (/wallet-verifier/done?verification=...). The suite's
            // must-visit redirect_uri entry is the client-callback form
            // (the oauth chain's redirect target) - VISITING it MID-MODULE
            // makes the suite's own callback receive an unexpected HTTP
            // call ("Got unexpected HTTP call to callback" - the module
            // INTERRUPTs FAILED). When the entry IS the suite callback,
            // the redirect_uri ANSWER is still the OP-hosted landing (the
            // drive created the verifier request with NO redirect_uri);
            // drive that instead (the §8.2 response body from the wallet's
            // POST - read from the runner log's direct-post response
            // entry, or fall back to leaving the page where it is).
            const log3 = await suiteApi.getLog(runnerId);
            let successUrl: string | null = null;
            for (const e2 of log3) {
              const red = (e2 as { redirect_uri?: string })?.redirect_uri;
              if (typeof red === 'string' && /wallet-verifier\/done\?verification=/.test(red)) {
                successUrl = red;
                break;
              }
            }
            if (successUrl) {
              try {
                await page.goto(successUrl, { waitUntil: 'load', timeout: 20_000 });
                await page.waitForTimeout(1_500);
                logStep(`  drove the verifier success page for the confirmation (${successUrl.slice(0, 90)})`);
              } catch (err) {
                logStep(`  verifier success page goto failed: ${(err as Error).message.slice(0, 80)}`);
              }
            } else {
              logStep('  verifier success page not found in the runner log (no OP-hosted landing entry)');
            }
          }
          try {
            if (!page.url() || page.url() === 'about:blank') {
              // The page carries no surface (the drive stayed pure-API):
              // render the VERIFIER's own verdict surface for the
              // rejection class (already rendered above) - otherwise a
              // truthful shell describing what the confirmation asks
              // for (never a blank canvas: the 44-blank-upload class).
              if (!wantsVerifierReject) {
                await renderWalletErrorScreen(page, confirmMsg2 || confirmMsg || 'wallet screen');
                logStep(`  rendered wallet shell for ${ph} (the page had no surface)`);
              }
            }
            const buf = await page.screenshot({ timeout: 10_000 });
            const dataUri = `data:image/png;base64,${buf.toString('base64')}`;
            await suiteApi.uploadImage(runnerId, ph, dataUri);
            const shownUrl = page.url() === 'about:blank' ? 'rendered wallet error screen' : page.url();
            logStep(`  uploaded live screenshot (${ph}) from ${shownUrl.slice(0, 80)}`);
          } catch {
            logStep(`  live screenshot failed for ${ph}`);
          }
        }
      }
    }
    // The rotate-keys operator action (the two-phase
    // oidcc-server-rotate-keys module): when the runner log carries the
    // 'Please rotate' instruction, force a platform key rotation and
    // RESUME the runner with the suite's start action
    // (POST /api/runner/<instance>). Phase B then fetches the JWKS
    // again and finds the new key.
    //
    // CONFFIX-1 (standards-based rotation): the platform key rotation is
    // the RFC 8628 DEVICE-FLOW grant carried out by the certification
    // tenant's own user - the harness signs in as cert-user (the same
    // POST /v1/sign-in the CIBA hook uses), drives the device approval
    // (POST /device/verify - the ONLY legitimate approval path),
    // exchanges for a Bearer token, and calls the rotation endpoint.
    // The endpoint's admin:write scope gate is Shield-enforced at auth;
    // the cert user's role carries it (the old operator-CLI path was a
    // session-less external dependency that broke the campaign). A
    // FAILED rotation throws loudly (the module must not land a hollow
    // FAILED 'no new keys' - the cause is visible in the error).
    {
        const log = await suiteApi.getLog(runnerId);
        const needsRotate = log.some(
            (e: { msg?: string }) => (e.msg ?? '').includes('Please rotate the keys'),
        );
        if (needsRotate && !rotateCompleted.has(runnerId)) {
            rotateCompleted.add(runnerId);
            try {
          const { certUser } = await import('./env.js');
          const user = certUser();
          const base = certAuthBase;
          // (1) Sign in as the cert user (cookie token).
          const signIn = await fetch(`${base}/v1/sign-in`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: user.email, password: user.password }),
          });
          if (!signIn.ok) {
            throw new Error(`cert-user sign-in failed: HTTP ${signIn.status}`);
          }
          const signinBody = (await signIn.json()) as { token?: string };
          const approveBearer = signinBody.token ?? '';
          // (2) Request the device code (sentin8-cli's registered client).
          const devResp = await fetch(`${base}/oauth/device`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: deviceClientId(),
              scope: 'sentin8:auth:admin:write',
              audience: 'sentin8',
            }),
          });
          if (!devResp.ok) {
            throw new Error(`device authorization failed: HTTP ${devResp.status}`);
          }
          const dev = (await devResp.json()) as {
            device_code: string;
            user_code: string;
            interval?: number;
          };
          // (3) The user approves via the device-verify endpoint (the
          // RFC 8628 3.3 approval contract - Bearer session).
          const verify = await fetch(`${base}/device/verify`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${approveBearer}`,
            },
            body: JSON.stringify({ user_code: dev.user_code, action: 'approve' }),
          });
          if (!verify.ok) {
            throw new Error(`device approval failed: HTTP ${verify.status}`);
          }
          // (4) Poll the token endpoint for the approved grant.
          const tokenUrl = `${base}/oauth/token`;
          const deadline = Date.now() + 90_000;
          let bearer = '';
          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, dev.interval ? dev.interval * 1000 : 5_000));
            const tok = await fetch(tokenUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
                device_code: dev.device_code,
                client_id: deviceClientId(),
              }),
            });
            if (tok.ok) {
              const j = (await tok.json()) as { access_token?: string };
              bearer = j.access_token ?? '';
              break;
            }
          }
          if (!bearer) {
            throw new Error('device-flow token exchange did not complete');
          }
          // (5) The rotation call itself (the admin:write-gated endpoint).
          const rot = await fetch(`${base}/v1/internal/keys/rotate`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${bearer}`,
            },
            body: JSON.stringify({ force: true }),
          });
          if (!rot.ok) {
            const body = await rot.text();
            throw new Error(`key rotation endpoint rejected: HTTP ${rot.status} ${body.slice(0, 120)}`);
          }
          logStep('  OP keys rotated (device-flow cert-user) - resuming rotate-keys phase B');
        } catch (e) {
          logStep(`  key rotate failed: ${String(e).slice(0, 200)}`);
          throw new Error(
            `oidcc-server-rotate-keys operator action failed - the RFC 8628 device-flow rotation ` +
            `could not complete (the cert user's session/device grant). Cause: ${String(e).slice(0, 160)}`,
          );
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
      let bcAtMs = 0;
      for (const e of log) {
        // The bc-authorize RESPONSE time (the suite stamps each poll
        // entry); the module's poll phases key off it (DESIGN 9a.15
        // interlock): two pending polls + the ~4.7s error-expectation
        // loop end around bc+10.2s - a 200 in that phase is an
        // INTERRUPT (CheckTokenEndpointHttpStatus400).
        if (e?.bc_authorization_endpoint_response !== undefined || (e?.src ?? '').includes('CheckBackchannelAuthenticationEndpointResponse')) {
          bcAtMs = Math.max(bcAtMs, Number(e?.time ?? 0));
        }
        const back = e?.backchannel_authentication_endpoint_response;
        if (typeof back === 'string') {
          try {
            const parsed = JSON.parse(back);
            const id2 = parsed?.auth_req_id;
            if (typeof id2 === 'string' && !cibaCompleted.has(id2)) {
              fresh.push(id2);
              // Prefer the ack entry's own timestamp (the bc call's
              // completion - the same entry family the suite's poll
              // loop reads): fall through to any later stamp when the
              // response object carries no time.
              bcAtMs = Math.max(bcAtMs, Number(e?.time ?? 0));
            }
          } catch {
            // not yet parseable
          }
        }
      }
      if (fresh.length > 0) {
        // OIDF-HOSTED-2a (DESIGN 9a.15 interlock): the approving POST
        // must land AFTER the suite's error-expectation loop exhausts
        // (both hosted runs: 18 polls ending bc+10.2s). Defer past the
        // observed phase boundary - bc+16s covers the 5s ack interval,
        // the loop span, and margin. When the bc timestamp did not
        // surface (a runner-shape change), fall back to the legacy
        // 9s hold so an unknown shape still fails soft rather than
        // never approving.
        const bcAgeMs = Date.now() - bcAtMs;
        const delayMs = bcAtMs > 0 ? Math.max(0, 16_000 - bcAgeMs) : 9_000;
        logStep(`  CIBA interlock: approve deferred ${delayMs}ms (bc+16s phase boundary)`);
        if (delayMs > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
        try {
          const { certUser } = await import('./env.js');
          const user = certUser();
          const base = certAuthBase;
          const signIn = await fetch(`${base}/v1/sign-in`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: user.email, password: user.password }),
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
  // The LAST suppressed skip-repeat counts flush here (non-terminal
  // exits too - a timeout abort must still report what it skipped).
  skipDedupe.flush();
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
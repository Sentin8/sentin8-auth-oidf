// SPDX-FileCopyrightText: Copyright Logically Magic Inc. <hello@logicallymagic.com>
// SPDX-FileCopyrightText: Copyright Hamid Jahanzad <Hamid@Jahanzad.com>
// SPDX-License-Identifier: Apache-2.0

// fixtures/suite.ts - the OIDF suite REST client (server-side API).
//
// The suite's API (5.3.x) needs the browser session (JSESSIONID) for
// mutating calls in devmode; this client acquires + carries the cookie
// transparently. Plan/runner/log reads are the campaign's data plane:
//   POST /api/runner?test=<module>&plan=<planId>  create + auto-start ONE module
//   GET  /api/runner/<id>                         poll its state
//   GET  /api/log/<id>                            fetch its event log
//   GET  /api/plan/<id>                           plan + per-module results

import { certDiscoveryUrl, suiteCallback, CONFORMANCE_ALIAS, CERT_USER, SUITE_BASE, certAuthHost } from './env.js';
import { logStep } from './log.js';

/** Terminal test states (suite `result` values). */
export const TERMINAL = new Set(['FINISHED', 'INTERRUPTED']);

/** A result the no-fail rule accepts (auth DESIGN §9a.10/§9a.11). */
export const ACCEPTABLE = new Set(['PASSED', 'WARNING', 'REVIEW']);

export interface SuiteModule {
  testModule: string;
  result: string | null;
  status: string | null;
  instances: string[];
  testSummary?: string;
}

export interface SuitePlan {
  id: string;
  planName: string;
  modules: SuiteModule[];
}

export interface SuiteClientConfig {
  client_id: string;
  client_secret?: string;
  scope?: string;
  token_endpoint_auth_method?: string;
  [k: string]: unknown;
}

/**
 * The suite's browser-automation block: client-side commands the running
 * test page executes when the test goes WAITING on a front-channel URL.
 */
export type BrowserCommand = (string | number)[]; // ['text','id','username','cert-user@…']

export interface BrowserTask {
  task: string;
  match: string;
  commands: BrowserCommand[];
}

/**
 * One browser-automation ENTRY (the suite's own shape): an outer match
 * over the exposed URLs, whose inner tasks match + run in order.
 */
export interface BrowserAutomationEntry {
  match: string;
  tasks: BrowserTask[];
  // Two-visit modules (e.g. the FAPI2-SP PAR "reused request_uri before
  // authentication completion" module) expose the SAME authorize URL
  // twice: the FIRST visit must NOT authenticate (the suite requires
  // the login page to be merely visited - it asserts a visit frequency
  // of >= 2 and rejects an authentication on visit 1), the SECOND visit
  // completes the login. When set, driving skips interactive commands
  // (bridge calls) on the first visit of the matched URL.
  twoVisit?: boolean;
}

export interface SuiteTestConfig {
  alias: string;
  description: string;
  server: { discoveryUrl: string };
  // static_client plans pass the pre-registered clients; dynamic_client
  // plans leave them out entirely (the suite DCRs its own).
  client?: SuiteClientConfig;
  client2?: SuiteClientConfig;
  // The client_secret_post VARIANT module's client (the Basic plan's
  // variant client_auth_type=client_secret_post reads a DEDICATED key).
  client_secret_post?: SuiteClientConfig;
  client_registration_static?: SuiteClientConfig; // dynamic plans
  [k: string]: unknown;
}

/**
 * Build the standard browser automation for the cert tenant's login.
 *
 * NOT sent to the suite - the suite's server-side WebRunner (Selenium)
 * would consume the `browser` block and drive the OLD HTML login page;
 * the block lives in the HARNESS: `runModule` matches exposed front-
 * channel URLs against these tasks and drives them in OUR page - where
 * the ORIGINAL Flutter auth-ui (test bridge) completes the login.
 */
export function standardBrowserAutomation(): BrowserAutomationEntry[] {
  const authHost = certAuthHost();
  return [
    {
      match: `${authHost}|https://*/test/a/${CONFORMANCE_ALIAS}/callback*`,
      tasks: [
        {
          task: 'Initial Login',
          // The EXPOSED url is the authorize request; visiting it
          // redirects to the SPA with the full OAuth context (the
          // platform's only login surface - DESIGN §9a.11) where the
          // bridge completes the sign-in.
          match: `${authHost}/oauth/authorize*`,
          commands: [
            ['waitFlutter'],
            ['callBridge', 'sentin8TestSignIn', CERT_USER.email, CERT_USER.password],
          ],
        },

        {
          task: 'Consent Approve',
          match: `${authHost}/consent*`,
          commands: [
            ['waitFlutter'],
            ['callBridge', 'sentin8TestConsentApprove'],
          ],
        },
        {
          task: 'Verify Complete',
          // The code-carrying callback - wait for the suite's landing
          // page to submit the response server-side.
          match: `https://*/test/a/${CONFORMANCE_ALIAS}/callback*`,
          commands: [['wait', 'id', 'submission_complete', 10]],
        },
        {
          task: 'Logout Landing',
          // RP-initiated logout (OC-13): the suite's front-channel
          // url is /oauth/logout?id_token_hint=... - a plain GET the
          // OP answers 302 to the registered post_logout_redirect_uri
          // (the suite's landing page); the goto itself completes the
          // hop - no interactive commands.
          match: `${authHost}/oauth/logout*`,
          commands: [],
        },
      ],
    },
  ];
}

/**
 * The user-rejects variant: the exposed authorize URL drives the SPA to
 * the consent screen with the DENY instruction (`sentin8TestDeny` -
 * the deny completes the continuation on the session the sign-in
 * created) - auth redirects back with error=access_denied + state
 * (RFC 6749 SS4.1.2.1). The sign-in itself STILL happens (the deny
 * needs a session to deny with) - the first part of the task chain
 * signs in, then denies.
 */
export function denyBrowserAutomation(): BrowserAutomationEntry[] {
  const authHost = certAuthHost();
  return [
    {
      match: `${authHost}|https://*/test/a/${CONFORMANCE_ALIAS}/callback*`,
      tasks: [
        {
          task: 'Login',
          match: `${authHost}/oauth/authorize*`,
          commands: [
            ['waitFlutter'],
            ['callBridge', 'sentin8TestSignIn', CERT_USER.email, CERT_USER.password],
          ],
        },

        {
          task: 'Deny Consent',
          // The consent screen (reached after sign-in when the client
          // requires consent) - the bridge DENY presses the consent
          // page's Deny button's code path; auth redirects back with
          // error=access_denied.
          match: `${authHost}/consent*`,
          commands: [
            ['waitFlutter'],
            ['callBridge', 'sentin8TestConsentDeny'],
          ],
        },
        {
          task: 'Verify Complete',
          match: `https://*/test/a/${CONFORMANCE_ALIAS}/callback*`,
          commands: [['wait', 'id', 'submission_complete', 10]],
        },
        {
          task: 'Logout Landing',
          match: `${authHost}/oauth/logout*`,
          commands: [],
        },
      ],
    },
  ];
}

/**
 * Per-module browser block selection: the module-family names the
 * USER-BEHAVIOR variant the suite expects (the harness mirrors the
 * suite's manual-test instructions).
 */
export function browserAutomationFor(module: string): BrowserAutomationEntry[] {
  if (/user-rejects|rejects-authentication|abort|authoriz(ation|e)-error/i.test(module)) {
    return denyBrowserAutomation();
  }
  // FAPI2-SP PAR: reusing the request_uri BEFORE authentication
  // completion must SUCCEED. The suite exposes the authorize URL
  // twice (visit 1 = login page reached, NOT authenticated; visit 2
  // = the reused request_uri, login completes) and asserts the visit
  // frequency >= 2.
  if (/par-ensure-reused-request-uri-prior-to-auth/i.test(module)) {
    return twoVisitParReusedAutomation();
  }
  return standardBrowserAutomation();
}

/**
 * The PAR reused-before-completion variant: the standard login chain
 * with `twoVisit: true` on the login task - the first authorize visit
 * stops at the login page (no bridge sign-in), the second performs it.
 */
export function twoVisitParReusedAutomation(): BrowserAutomationEntry[] {
  const entries = standardBrowserAutomation();
  for (const e of entries) {
    for (const t of e.tasks) {
      if (t.task === 'Initial Login') {
        e.twoVisit = true;
      }
    }
  }
  return entries;
}

/**
 * OIDF suite API client. Cookie-scoped (JSESSIONID from the suite's
 * session) - devmode's API accepts the session cookie for POSTs.
 */
export class SuiteApi {
  private cookie: string | null = null;

  private async ensureCookie(): Promise<void> {
    if (this.cookie) return;
    const res = await fetch(`${SUITE_BASE}/`, {
      redirect: 'manual',
    });
    const setCookie = res.headers.get('set-cookie') ?? '';
    const m = setCookie.match(/JSESSIONID=([^;]+)/);
    this.cookie = m ? `JSESSIONID=${m[1]}` : null;
  }

  /**
   * Wait until the AUTH service under test responds healthy (a restart
   * mid-campaign must never poison the first module with a
   * "unable to fetch server configuration" INTERRUPT).
   */
  static async waitAuthReady(maxMs = 120_000): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      try {
        const res = await fetch(`${certAuthHost()}/v1/health`, { signal: AbortSignal.timeout(5_000) });
        if (res.ok) return;
      } catch {
        // booting - retry
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`auth not healthy after ${maxMs}ms (${certAuthHost()}/v1/health)`);
  }

  /** Raw fetch against the suite API with the session cookie. */
  async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    await this.ensureCookie();
    const res = await fetch(path.startsWith('http') ? path : `${SUITE_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    // Node fetch needs the agent-level TLS config; the rig's leaf is
    // platform-CA-signed but Node's bundle may lack it.
    return res.json() as Promise<T>;
  }

  /** GET a plan (its modules + per-module results). */
  async getPlan(planId: string): Promise<SuitePlan> {
    const raw = await this.request<any>(`/api/plan/${planId}`);
    return {
      id: raw._id ?? raw.id,
      planName: raw.planName,
      modules: raw.modules ?? [],
    };
  }

  /**
   * Create a test plan. `variant` rides as repeated `variant[k]=v` query
   * entries (the suite's typed map param - the UI's own encoding).
   */
  async createPlan(
    planName: string,
    config: SuiteTestConfig,
    variant: Record<string, string> = {},
    options: { client_registration?: string } = {},
  ): Promise<SuitePlan> {
    // Variant selection = a JSON-string query param (the suite's
    // OpenAPI: "a JSON object mapping variant parameter names to values").
    // `options.client_registration` rides in the CONFIG body (the suite's
    // static/dynamic-registration switch is a test-configuration field,
    // not a plan variant).
    const body = { ...config, ...(options.client_registration ? { client_registration: options.client_registration } : {}) };
    const qs = new URLSearchParams({
      planName,
      variant: JSON.stringify(variant),
    });
    await this.ensureCookie();
    const res = await fetch(`${SUITE_BASE}/api/plan?${qs.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`plan create failed: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
      throw new Error(`plan create failed: HTTP ${res.status} ${JSON.stringify(parsed).slice(0, 200)}`);
    }
    return { id: parsed._id ?? parsed.id, planName, modules: parsed.modules ?? [] };
  }

  /** Create + auto-start a test module within a plan. Returns its id. */
  async createTest(planId: string, testModule: string): Promise<string> {
    await this.ensureCookie();
    const res = await fetch(
      `${SUITE_BASE}/api/runner?test=${encodeURIComponent(testModule)}&plan=${encodeURIComponent(planId)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.cookie ? { Cookie: this.cookie } : {}),
        },
      },
    );
    const text = await res.text();
    try {
      const body = JSON.parse(text);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
      return body.id;
    } catch (e) {
      throw new Error(`runner create failed: ${(e as Error).message} (${text.slice(0, 120)})`);
    }
  }

  /** A runner's current exposed state (browser URLs + status). */
  async getRunner(runnerId: string): Promise<any> {
    return this.request(`/api/runner/${runnerId}`);
  }

  /** A runner's event log (array of entries). */
  async getLog(runnerId: string): Promise<any[]> {
    const raw = await this.request<any>(`/api/log/${runnerId}`);
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw?.log)) return raw.log;
    if (Array.isArray(raw?.items)) return raw.items;
    return [];
  }

  /**
   * Mark an exposed front-channel URL as visited (the headless contract:
   * the suite's browser simulation learns the URL it exposed was acted
   * on - flows that end in a browser-final state need this or the test
   * stays WAITING forever).
   */
  async markVisited(runnerId: string, url: string): Promise<void> {
    const enc = encodeURIComponent(url);
    await fetch(`${SUITE_BASE}/api/runner/browser/${runnerId}/visit?url=${enc}`, {
      method: 'POST',
      headers: this.cookie ? { Cookie: this.cookie } : undefined,
    });
  }

  /**
   * Upload a screenshot for a log entry's placeholder (the suite's
   * screenshot-confirmation steps - e.g. prompt=login's
   * ExpectSecondLoginPage - park the test in WAITING/REVIEW until an
   * image lands). Body = the image as a data URI (text/plain).
   */
  async uploadImage(runnerId: string, placeholder: string, dataUri: string): Promise<void> {
    await fetch(`${SUITE_BASE}/api/log/${runnerId}/images/${placeholder}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: dataUri,
    });
  }
}

/** A tiny valid PNG (screenshot confirmations only need A png). */
export const SCREENSHOT_PNG_DATA_URI =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
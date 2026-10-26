// SPDX-FileCopyrightText: Copyright Logically Magic Inc. <hello@logicallymagic.com>
// SPDX-FileCopyrightText: Copyright Hamid Jahanzad <Hamid@Jahanzad.com>
// SPDX-License-Identifier: Apache-2.0

// tests/oid4vci-wallet.spec.ts - OID4VCI 1.0 Final WALLET plan.
//
// The wallet plan drives the suite as the WALLET against sentin8:auth as the
// credential ISSUER: the issuer opens its credential offer (the browser visit
// of `vci.credential_offer_redirect_url`), the flow runs the authorization-code
// grant + the credential endpoint family (auth DESIGN §9a.7). Variant axes the
// plan fixes: FAPI_ClientType=plain_oauth, FAPIResponseMode=plain_response;
// the grant/offer axes are plan-resolved per module.
//
// Campaign rule (auth DESIGN §9a.10/§9a.11): every module terminal, no
// FAILED/SKIPPED/INTERRUPTED, zero warnings.

import { test, expect } from '@playwright/test';
import { SuiteApi, ACCEPTABLE, standardBrowserAutomation, type SuiteTestConfig, type SuiteClientConfig } from '../fixtures/suite.js';
import { runModule, planResults } from '../fixtures/runner.js';
import {certDiscoveryUrl, certAuthHost, suiteCallback, CONFORMANCE_ALIAS, resultsDir, seedOutPath, certUser } from '../fixtures/env.js';
import { logStep, stepLog } from '../fixtures/log.js';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VciClient = any;
function seededVciClients(): { client: VciClient; client2: VciClient; attesterJwks: unknown; signingJwk: Record<string, unknown> | null } {
  const seedOut = process.env.OIDF_SEED_OUT ?? seedOutPath();
  const fallback = (id: string): VciClient => ({
    client_id: id,
    token_endpoint_auth_method: 'private_key_jwt',
    scope: 'openid profile email offline_access credential:VerifiedPersonCredential credential:VerifiedEmployeeCredential',
    redirect_uri: suiteCallback(),
    hint_type: 'login_hint',
    hint_value: certUser().email,
  });
  if (!existsSync(seedOut)) {
    return { client: fallback(''), client2: fallback(''), attesterJwks: null, signingJwk: null };
  }
  const text = readFileSync(seedOut, 'utf8');
  const attJwksLine = text.match(/private_jwks\(vciatt\)=(\{.*\})/)?.[1] ?? '';
  const anchorPem = text.match(/attester_pem\(vciatt\)=([\s\S]*?-----END CERTIFICATE-----)/)?.[1] ?? '';
  const ATTESTATION_ISSUER = 'https://vci-attester.conformance-local';
  let attesterJwks: unknown = null;
  try {
    const parsed = attJwksLine ? JSON.parse(attJwksLine) : null;
    attesterJwks = parsed ? { keys: [parsed] } : null;
  } catch {
    attesterJwks = null;
  }
  const leafB64 = text.match(/haip_issuer_leaf_der_b64\(haip\)=([A-Za-z0-9+/=]+)/)?.[1] ?? '';
  const xyLine = text.match(/haip_issuer_xy\(haip\)=([a-zA-Z0-9-]+) ([A-Za-z0-9+_/-]+) ([A-Za-z0-9+_/-]+)/) ?? null;
  const cid = text.match(/client_id\(vci\)=([a-f0-9]+)/)?.[1] ?? '';
  const cid2 = text.match(/client_id\(vci2\)=([a-f0-9]+)/)?.[1] ?? '';
  const jwksLine = text.match(/private_jwks\(vci\)=(\{.*\})/)?.[1] ?? '';
  const jwks2Line = text.match(/private_jwks\(vci2\)=(\{.*\})/)?.[1] ?? '';
  const parse = (l: string) => {
    try {
      return l ? { keys: [JSON.parse(l)] } : null;
    } catch {
      return null;
    }
  };
  // The wallet plan's client role = a published WALLET: client.jwks is
  // PUBLIC-only (the issuer fetches it over jwks_uri - the plan's
  // EnsureJwksHasNoPrivateOrSymmetricKeyMaterial rejects `d` members);
  // the wallet's request-signing keys ride the client-attestation
  // section (client_attestation.attester_jwks, private) exactly like the
  // issuer-plan's attester keys. The attestation issuer + trust anchor
  // mirror the issuer profile's ATCA-07 registration.
  const pubOnly = (l: string) => {
    try {
      const k = l ? JSON.parse(l) : null;
      if (!k) return null;
      const { d: _d, ...rest } = k;
      return { keys: [rest] };
    } catch {
      return null;
    }
  };
  const mk = (id: string, keys: unknown, pubKeys: unknown): VciClient => ({
    client_id: id,
    token_endpoint_auth_method: 'private_key_jwt',
    scope: 'openid profile email offline_access credential:VerifiedPersonCredential credential:VerifiedEmployeeCredential eudi.pid.1 eudi.pid.1.nobinding eudi.pid.1.attestation eudi.pid.1.jwt.keyattest eudi.pid.1.attestation.keyattest eudi.pid.1.jwt_and_attestation.keyattest openid.example.cert.1',
    redirect_uri: suiteCallback(),
    hint_type: 'login_hint',
    hint_value: certUser().email,
    ...(pubKeys ? { jwks: pubKeys } : {}),
    ...(keys && anchorPem.trim()
      ? {
          client_attestation: {
            issuer: ATTESTATION_ISSUER,
            trust_anchor: anchorPem.trim(),
            attester_jwks: keys,
          },
        }
      : {}),
  });
  // The credential.signing_jwk the wallet plan validates
  // (VCIEnsureCredentialSigningCertificateIsNotSelfSigned): the issuer's
  // ES256 signing JWK whose x5c[0] is the RIG-MINTED issuance leaf (a
  // CA-signed cert - the HAIP 6.1.1 no-self-signed rule; the rig CA is
  // the pinned trust anchor).
  const signingJwk = leafB64 && xyLine
    ? {
        kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig',
        kid: xyLine[1], x: xyLine[2], y: xyLine[3],
        x5c: [leafB64],
      }
    : null;
  return {
    client: mk(cid, parse(jwksLine), pubOnly(jwksLine)),
    client2: mk(cid2 || cid, parse(jwks2Line) ?? parse(jwksLine), pubOnly(jwksLine)),
    attesterJwks,
    signingJwk,
  };
}

let suiteApi: SuiteApi;
let planId: string;
const seeded = seededVciClients();
// LoadServerJWKs reads the nested dot-path `server.jwks` from the plan
// config: the ISSUER's published JWKS (the wallet verifies the issuer's
// tokens/client-assertion keys + the attestation chain against it).
// Fetched live at spec load from the issuer's /.well-known/jwks.json
// (the ES256 family per the tenant-plane filter is fine - the kid set
// covers the keys the issuer actually signs with for this env).
function issuerJwksInline(): unknown {
  try {
    // Node-less fetch via Bun/undici in Playwright runtime:
    const res = (globalThis as unknown as { fetch: (u: string) => Promise<Response> })
      .fetch(`${certAuthHost()}/.well-known/jwks.json`);
    // Playwright tests run in node - await at module load would async the
    // config; cache synchronously is impossible, so the config builds a
    // placeholder resolved inside beforeAll. The function returns a MARKER
    // and beforeAll replaces the jwks value via the real fetch.
    void res;
    return { keys: [] };
  } catch {
    return { keys: [] };
  }
}

const config: SuiteTestConfig = {
  alias: CONFORMANCE_ALIAS,
  description: 'Sentin8 auth certification run - OID4VCI Wallet (OC-13 warning-zero)',
  server: { discoveryUrl: certDiscoveryUrl(), jwks: { keys: [] } },
  credential: seeded.signingJwk ? { signing_jwk: seeded.signingJwk } : {},
  vci: {
    // NO credential_configuration_id hint: the wallet plan builds the
    // issuer metadata from ITS OWN default catalog (the EUDI PID family,
    // VCICredentialConfigurations defaults) - the issuer advertises that
    // exact set - so the suite's getDefaultCredentialConfigurationId()
    // (eu.europa.ec.eudi.pid.1 for the sd_jwt_vc format) is the correct
    // hint.
    credential_issuer_url: certAuthHost(),
    key_attestation_jwks: seeded.attesterJwks ?? {},
  },
  vci_key_attestation_jwks: seeded.attesterJwks ?? {},
  client: seeded.client,
  client2: seeded.client2,
} as SuiteTestConfig;

const harnessBrowserBlock = standardBrowserAutomation();

test.beforeAll(async () => {
  await SuiteApi.waitAuthReady();
  // Inline the issuer's LIVE JWKS into the plan config (LoadServerJWKs).
  const jwks = await (await fetch(`${certAuthHost()}/.well-known/jwks.json`)).json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (config.server as Record<string, unknown>).jwks = jwks;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (config as Record<string, unknown>).server_jwks = jwks;
  // The issuer-initiated offer URL: the offer LANDING page rides the ISSUER
  // (DESIGN 9a.20) with the client/redirect/scope bound through pass-through
  // query params (the suite's UriComponentsBuilder preserves them when it
  // appends credential_offer), and the issuer_state we hand the offer grant.
  const issuerState = `wlt-${Date.now()}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (config.vci as Record<string, unknown>).issuer_state = issuerState;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (config.vci as Record<string, unknown>).credential_offer_endpoint =
    `${certAuthHost()}/oauth/credential-offer?client_id=${encodeURIComponent(config.client?.client_id ?? '')}&redirect_uri=${encodeURIComponent(suiteCallback())}`;
  suiteApi = new SuiteApi();
  logStep(`creating plan: ${config.description}`);
});

test.afterAll(async () => {
  writeFileSync(join(resultsDir(), 'oid4vci-wallet-steps.log'), stepLog());
  if (planId) writeFileSync(join(resultsDir(), 'oid4vci-wallet-plan.txt'), planId);
});

test('OID4VCI Wallet - run every module-variant to terminal, zero-warning green', async ({ browser }) => {
  test.setTimeout(1_800_000);
  const onlyList = (process.env.OIDF_MODULES ?? '')
    .split(',').map((x) => x.trim()).filter(Boolean);
  const failures: string[] = [];

  const plan = await suiteApi.createPlan(
    'oid4vci-1_0-wallet-test-plan',
    config,
    {
      fapi_profile: 'vci',
      fapi_request_method: 'unsigned',
      credential_format: 'sd_jwt_vc',
      sender_constrain: 'dpop',
      client_auth_type: 'private_key_jwt',
    },
  );
  planId = plan.id;
  logStep(`plan ${planId}: ${plan.modules.length} module-variants`);
  {
    const moduleVariants = new Map<string, Record<string, string>>();
    for (const m of (await suiteApi.getPlan(planId)).modules) {
      moduleVariants.set(m.testModule, (m.variant ?? {}) as Record<string, string>);
    }
    for (const modEntry of (await suiteApi.getPlan(planId)).modules) {
      const m = modEntry;
      if (onlyList.length > 0 && !onlyList.includes(m.testModule)) {
        logStep(`SKIP-ONLY ${m.testModule}`);
        continue;
      }
      if (m.result) {
        logStep(`SKIP ${m.testModule} (already ${m.result})`);
        continue;
      }
      const run = await runModule(suiteApi, browser, planId, m.testModule,
        { ...config, browser: harnessBrowserBlock }, 600_000, moduleVariants.get(m.testModule));
      expect(run.status, `${m.testModule} must finish (not INTERRUPTED)`).toBe('FINISHED');
      expect(run.result, `${m.testModule} must not fail`).not.toMatch(/FAILED|SKIPPED|INTERRUPTED/);
      if (run.warnings.length > 0) {
        failures.push(`${m.testModule}: ${run.warnings.join(' | ')}`);
      }
      const out = join(resultsDir(), 'logs');
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, `oid4vci-wallet-${m.testModule}.json`), JSON.stringify(run.log));
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

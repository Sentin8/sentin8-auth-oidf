// SPDX-FileCopyrightText: Copyright Logically Magic Inc. <hello@logicallymagic.com>
// SPDX-License-Identifier: Apache-2.0

// tests/fapi2-message-signing.spec.ts - FAPI 2.0 Message Signing plan.
//
// The suite's dynamic_client variants DCR-REGISTER their own clients
// (private_key_jwt keys, DPoP keys) against the cert env's registration
// endpoint - the config carries only discovery + alias + browser block.
// The cert env's security profile flips to fapi_2 BEFORE the run (the
// suite.ts helper does it -) and back to standard after.

import { test, expect } from '@playwright/test';
import { SuiteApi, standardBrowserAutomation, browserAutomationFor, type SuiteTestConfig } from '../fixtures/suite.js';
import { runModule, planResults, ACCEPTABLE } from '../fixtures/runner.js';
import {
  certDiscoveryUrl, certAuthHost, suiteCallback, CONFORMANCE_ALIAS, resultsDir, seedOutPath } from '../fixtures/env.js';
import { logStep, stepLog } from '../fixtures/log.js';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let suiteApi: SuiteApi;
let planIds: string[] = [];

// dynamic_client: the suite DCRs its own clients - no pre-registered ids.
const config = {
  alias: CONFORMANCE_ALIAS,
 description: 'Sentin8 auth certification run - FAPI 2 Message Signing ',
  server: { discoveryUrl: certDiscoveryUrl() },
  // The protected resource the suite calls with the exchanged access
  // token - the cert auth's OWN userinfo endpoint is a real
  // OAuth-protected resource on this rig.
  resource: {
    // the suite flattens resource.resourceUrl -> protected_resource_url
    resourceUrl: `${certAuthHost().replace(/\/$/, '')}/oauth/userinfo`,
  },
};
const harnessBrowserBlock = standardBrowserAutomation();

// The seeded FAPI2 static client for a sender-constrain cell: the seed
// registers cert-fapi2-<cell> with the PUBLIC jwks and publishes the
// PRIVATE jwks (the suite signs client_assertions with it).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FapiClient = any;
function seededFapiClients(cell: string, includeOpenid = true): { client: FapiClient; client2: FapiClient } | null {
  const seedOut = process.env.OIDF_SEED_OUT ?? seedOutPath();
  if (!existsSync(seedOut)) return null;
  const text = readFileSync(seedOut, 'utf8');
  const cid = text.match(new RegExp(`client_id\\(fapi2-${cell}\\)=([a-f0-9]+)`))?.[1];
  const cid2 = text.match(new RegExp(`client_id\\(fapi2-second-${cell}\\)=([a-f0-9]+)`))?.[1];
  const jwksLine = text.match(new RegExp(`private_jwks\\(fapi2-${cell}\\)=(\\{.*\\})`))?.[1];
  const jwksLine2 = text.match(new RegExp(`private_jwks\\(fapi2-second-${cell}\\)=(\\{.*\\})`))?.[1];
  if (!cid || !cid2 || !jwksLine || !jwksLine2) return null;
  let jwksObj: unknown = null;
  let jwksObj2: unknown = null;
  try {
    jwksObj = JSON.parse(jwksLine);
    jwksObj2 = JSON.parse(jwksLine2);
  } catch {
    return null;
  }
  const mk = (id: string, key: unknown): FapiClient => ({
    client_id: id,
    client_auth_type: 'private_key_jwt',
    token_endpoint_auth_method: 'private_key_jwt',
    // The per-cell scope (the plain_oauth scope addendum, auth DESIGN
    // 9a.2): the suite's FAPI2ProfileBehavior rejects a plan whose variant
    // axis is plain_oauth while the client scope carries 'openid' - the
    // plain_oauth cells ride the OAuth-only scope, the openid_connect
    // cells keep it (the suite's isOpenId id_token mandate reads THIS
    // value, not the variant axis).
    scope: includeOpenid
      ? 'openid profile email phone address offline_access'
      : 'profile email phone address offline_access',
    redirect_uri: suiteCallback(),
    // The seed's doc may be a BARE JWK or the multi-key JWKS
    // (ES256 + RSA) - pass through to {keys: [...]}.
    jwks: Array.isArray((key as { keys?: unknown[] })?.keys)
      ? (key as { keys: unknown[] })
      : { keys: [key] },
  });
  // The mtls-SENDER pk cell (private_key_jwt auth + sender_constrain=mtls):
  // the suite's holder-of-key family still needs the client CERT pair in
  // the config (the module strips it for the negative). The seed's mtls
  // material rides the SAME cert pair as the mtls cell - attach BOTH
  // clients' pairs (mtls.* for client 1, mtls2.* for client 2 - the
  // ExtractMTLSCertificates2 precondition).
  const mtlsExtras = cell === 'mtls-pk'
    ? (() => {
        const certB64 = text.match(/mtls_cert_der_b64\(main\)=([A-Za-z0-9+/=]+)/)?.[1];
        const certB642 = text.match(/mtls_cert_der_b64\(second\)=([A-Za-z0-9+/=]+)/)?.[1];
        const keyPem = text.match(/mtls_key_pem\(main\)=([\s\S]*?)-----END PRIVATE KEY-----/)?.[1];
        const keyPem2 = text.match(/mtls_key_pem\(second\)=([\s\S]*?)-----END PRIVATE KEY-----/)?.[1];
        const caPem = readFileSync(process.env.SENTIN8_TLS_CA_PEM!
          ?? join(resultsDir(), '..', '..', '..', '.run', 'secrets', 'acme-ca', 'root-ca.crt'), 'utf8');
        if (!certB64 || !certB642 || !keyPem || !keyPem2) return null;
        const keyB64 = keyPem
          .replace(/-----(BEGIN|END) [A-Z ]+-----/g, '')
          .replace(/\s+/g, '');
        const keyB642 = keyPem2
          .replace(/-----(BEGIN|END) [A-Z ]+-----/g, '')
          .replace(/\s+/g, '');
        return { mtls: { cert: certB64, key: keyB64, ca: caPem }, mtls2: { cert: certB642, key: keyB642, ca: caPem } };
      })()
    : null;
  if (cell === 'mtls-pk' && !mtlsExtras) return null;
  return {
    client: mk(cid, jwksObj),
    client2: mk(cid2, jwksObj2),
    ...(mtlsExtras ?? {}),
  } as { client: FapiClient; client2: FapiClient };
}

/**
 * The mTLS cell's SEEDed static client (DESIGN 9a.12): the seed registered
 * cert-fapi2-mtls(-2) with `self_signed_tls_client_auth` + the sha-256
 * thumbprint and published the client cert/key PEMs to seed-out - the
 * suite presents the SAME certificate on its token + resource calls
 * (RFC 8705 self-signed; auth binds `cnf.x5t#S256` at the mint).
 */
function seededFapiMtlsClients(crossDpop: boolean, includeOpenid = true): { client: FapiClient; client2: FapiClient; mtls?: { cert: string; key: string; ca?: string }; mtls2?: { cert: string; key: string; ca?: string } } | null {
  const seedOut = process.env.OIDF_SEED_OUT ?? seedOutPath();
  if (!existsSync(seedOut)) return null;
  const text = readFileSync(seedOut, 'utf8');
  // The mtls/dpop cross cell reads its DEDICATED dpop_bound client
  // (fapi2-mtls-dpop, DPoPRS-2); the plain mtls cell reads the base
  // pair.
  const cell = crossDpop ? 'fapi2-mtls-dpop' : 'fapi2-mtls';
  const cid = text.match(new RegExp(`client_id\\(${cell}\\)=([a-f0-9]+)`))?.[1];
  const cid2 = text.match(/client_id\(fapi2-second-mtls\)=([a-f0-9]+)/)?.[1];
  // The suite's PEMFormatter stripPEM decodes the config values AS
  // BASE64 (PEM-body extraction + strict Base64). The seed publishes
  // the RAW base64(DER) forms alongside the PEMs; this parser reads
  // THOSE (the no-marker stripPEM path validates + passes them
  // through unchanged - no multiline-PEM row fragility).
  const certB64 = text.match(/mtls_cert_der_b64\(main\)=([A-Za-z0-9+/=]+)/)?.[1];
  const certB642 = text.match(/mtls_cert_der_b64\(second\)=([A-Za-z0-9+/=]+)/)?.[1];
  const keyPem = text.match(/mtls_key_pem\(main\)=([\s\S]*?)-----END PRIVATE KEY-----/)?.[1];
  const keyPem2 = text.match(/mtls_key_pem\(second\)=([\s\S]*?)-----END PRIVATE KEY-----/)?.[1];
  const jwksLine = text.match(/private_jwks\(fapi2-mtls-main\)=\{.*\}/)?.[0]?.split('=').slice(1).join('=');
  const jwksLine2 = text.match(/private_jwks\(fapi2-mtls-second\)=\{.*\}/)?.[0]?.split('=').slice(1).join('=');
  if (!cid || !cid2 || !certB64 || !certB642 || !keyPem || !keyPem2 || !jwksLine || !jwksLine2) return null;
  // The keys have no pre-baked b64 rows: strip PEM + whitespace here.
  const keyB64 = keyPem
    .replace(/-----(BEGIN|END) [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  const keyB642 = keyPem2
    .replace(/-----(BEGIN|END) [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  const certificate = certB64;
  const privateKey = keyB64;
  let jwksObj: unknown = null;
  let jwksObj2: unknown = null;
  try {
    jwksObj = JSON.parse(jwksLine);
    jwksObj2 = JSON.parse(jwksLine2);
  } catch {
    return null;
  }
  const mk = (id2: string, jwks: unknown): FapiClient => ({
    client_id: id2,
    client_auth_type: 'mtls',
    token_endpoint_auth_method: 'self_signed_tls_client_auth',
    // The per-cell scope (the plain_oauth scope addendum, auth DESIGN
    // 9a.2) - same split as the pk helper above.
    scope: includeOpenid
      ? 'openid profile email phone address offline_access'
      : 'profile email phone address offline_access',
    redirect_uri: suiteCallback(),
    // The seed's doc may be a BARE JWK or the multi-key JWKS
    // (ES256 + RSA, the RS256-negative signer) - pass through.
    jwks: Array.isArray((jwks as { keys?: unknown[] })?.keys)
      ? (jwks as { keys: unknown[] })
      : { keys: [jwks] },
  });
  // The suite reads the TLS credentials at the TOP-LEVEL config
  // (Environment "config" / "mtls.cert|key|ca") - both clients share
  // them; the CA decodes as the (self-signed) chain root - the rig's
  // Acme root covers the self-signed thumbprint checks in the OP.
  const caPem = readFileSync(process.env.SENTIN8_TLS_CA_PEM!
    ?? join(resultsDir(), '..', '..', '..', '.run', 'secrets', 'acme-ca', 'root-ca.crt'), 'utf8');
  // The suite wants SEPARATE TLS credential sections per client
  // (mtls.* for client 1, mtls2.* for client 2 - no shared private
  // keys); the ca rides both.
  return {
    client: mk(cid, jwksObj),
    client2: mk(cid2, jwksObj2),
    mtls: { cert: certificate, key: privateKey, ca: caPem },
    mtls2: { cert: certB642, key: keyB642, ca: caPem },
  };
}

// The FAPI2 plan's variant axes (the suite REQUIRES them at plan
// create - a bare create 400s): sender_constrain (mtls|dpop) x
// client_auth_type (private_key_jwt|mtls). One plan per CELL covers
// that cell's module-variants; the run iterates all four cells.
// The plain_fapi plans run STATIC clients only (the plan has no
// client_registration variant axis). The seed registers one
// private_key_jwt client per sender-constrain cell (cert-fapi2-<cell>)
// and publishes the client's PRIVATE jwks to seed-out - the suite signs
// client_assertions from config.client.jwks.
const FAPI2_BASE = {
  fapi_profile: 'plain_fapi',
  // The MSG-SIGNING plan REQUIRES these variant axes (the security-profile
  // plan does not): signed request objects + JARM response.
  fapi_request_method: 'signed_non_repudiation',
  fapi_response_mode: 'jarm',
};
// The FULL catalog matrix (OIDF-ALL-1): sender_constrain x
// client_auth_type (4 combinations) + the plain_oauth variant of the
// primary cells.
const VARIANTS = [
  { ...FAPI2_BASE, openid: 'openid_connect', client_auth_type: 'private_key_jwt', sender_constrain: 'dpop' },
  { ...FAPI2_BASE, openid: 'openid_connect', client_auth_type: 'mtls', sender_constrain: 'mtls' },
  { ...FAPI2_BASE, openid: 'openid_connect', client_auth_type: 'mtls', sender_constrain: 'dpop' },
  { ...FAPI2_BASE, openid: 'openid_connect', client_auth_type: 'private_key_jwt', sender_constrain: 'mtls' },
  { ...FAPI2_BASE, openid: 'plain_oauth', client_auth_type: 'private_key_jwt', sender_constrain: 'dpop' },
  { ...FAPI2_BASE, openid: 'plain_oauth', client_auth_type: 'mtls', sender_constrain: 'mtls' },
];
// The seed CELL the variant runs against (kept OUT of the variant sent
// to the suite - the suite rejects unknown variant parameters). The
// private_key_jwt + mtls-sender cell reads the mtls-pk jwks client.
const CELL: Record<string, string> = { dpop: 'dpop', mtls: 'mtls-pk' };
type FapiVariant = { client_auth_type: string; sender_constrain: string; openid: string; fapi_profile: string };
const cellFor = (v: FapiVariant): string => CELL[v.sender_constrain] ?? v.sender_constrain;

// The beforeAll creates NO plans: the plan-creation per cell happens in
// the run body itself (each cell's plan carries its OWN static client
// config - a beforeAll plan would be clientless, never run, and sits
// in the suite UI as a ghost "all modules not run" entry that reads as
// a skipped variant cell). The suite API is still warmed here.
test.beforeAll(async () => {
  await SuiteApi.waitAuthReady();
  suiteApi = new SuiteApi();
});

test.afterAll(async () => {
  writeFileSync(join(resultsDir(), 'fapi2-message-signing-steps.log'), stepLog());
  if (planIds.length > 0) writeFileSync(join(resultsDir(), 'fapi2-message-signing-plan.txt'), planIds.join('\n'));
});

test('FAPI2 Message Signing - run every module-variant to terminal', async ({ browser }) => {
  test.setTimeout(7_200_000);
  // Singles filter (same contract as oidc-basic.spec.ts): OIDF_MODULES=a,b →
  // only those module names run (proves a targeted fix without the full cell).
  const onlyList = (process.env.OIDF_MODULES ?? '')
    .split(',').map((x) => x.trim()).filter(Boolean);
  const failures: string[] = [];
  for (const v of VARIANTS) {
    // The mtls cell's static client is the CERT pair (self_signed_tls_client_auth,
    // DESIGN 9a.12); the private_key_jwt cells use the jwks clients.
    // The mtls/dpop CROSS cell uses the DEDICATED dpop_bound client
    // (fapi2-mtls-dpop, DPoPRS-2 - auth DESIGN 9a.22).
    // The per-cell scope follows the variant axis (auth DESIGN 9a.2):
    // openid_connect cells keep the scope's openid value, the plain_oauth
    // cells drop it (the suite's FAPI2ProfileBehavior rejects openid +
    // PLAIN_OAUTH at variant initialization).
    const includeOpenid = v.openid !== 'plain_oauth';
    const cellClients = v.client_auth_type === 'mtls'
      ? (v.sender_constrain === 'dpop'
          ? seededFapiMtlsClients(true, includeOpenid)
          : seededFapiMtlsClients(false, includeOpenid))
      : seededFapiClients(cellFor(v), includeOpenid);
    if (!cellClients) {
      failures.push(`seeded FAPI2 client for cell ${v.client_auth_type}/${v.sender_constrain} missing - re-run the seed with CONFORMANCE_PROFILE=fapi_2_message_signing`);
      continue;
    }
    const plan = await suiteApi.createPlan(
      'fapi2-message-signing-final-test-plan',
      { ...config, ...cellClients },
      v,
    );
    const cellPlan = plan.id;
    planIds.push(cellPlan);
    logStep(`VARIANT ${v.openid}/${v.client_auth_type}/${v.sender_constrain} -> plan ${cellPlan} (${plan.modules.length} modules)`);
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    for (const m of (await suiteApi.getPlan(cellPlan)).modules) {
      if (onlyList.length > 0 && !onlyList.includes(m.testModule)) {
        logStep(`SKIP-ONLY ${m.testModule}`);
        continue;
      }
      if (m.result) {
        logStep(`SKIP ${m.testModule} (already ${m.result})`);
        continue;
      }
      // The expired-request_uri module parks the suite in a 600-second
      // expiry sleep BEFORE the (error-page) browser round - the shared
      // 600s drive window would expire DURING the sleep. Give the known
      // long-sleep modules a 1080s window (600 sleep + browser rounds
      // + variant-creation/polling margin; battery-11: 960s proved ZERO
      // margin on the last variant block - the harness returned WAITING
      // with auth already past the PAR push), F2EXPURI-1.
      const driveMs = /expired-request_uri/i.test(m.testModule) ? 1080_000 : undefined;
      const run = await runModule(suiteApi, browser, cellPlan, m.testModule,
        { ...config, ...cellClients, browser: browserAutomationFor(m.testModule) },
        driveMs);
      expect(run.status, `${m.testModule} must finish (not INTERRUPTED)`).toBe('FINISHED');
      // SUITE-SANCTIONED SKIPPED: the final suite SKIPS a module when the
      // seeded client's cryptography makes it inapplicable (ES256 client →
      // "ensure-signed-client-assertion-with-RS256-fails" skips with
      // "this will not prevent you certifying"). That terminal state is a
      // by-design pass for our cell - the alg-family gate is OUR choice and
      // the suite explicitly blesses it. Everything else (FAILED/other
      // SKIPPED/INTERRUPTED) stays a failure.
      const result = String(run.result);
      const skipMsg = (run.log ?? [])
        .filter((e: { result?: string; msg?: string }) => e.result === 'SKIPPED')
        .map((e: { msg?: string }) => e.msg ?? '')
        .join(' | ');
      // The multi-DPoP negative is NO LONGER sanctioned - the
      // sentin8-tls context middleware preserves the two-line DPoP shape
      // (sdk-v0.6.24), so the wire serves the RFC 9449 7.1 reject and the
      // module finishes PASSED (the former JVM-collapse FAIL-SANCTION is
      // dead code, removed).
      if (result === 'SKIPPED') {
        if (!/requires RSA keys|alg in client configuration is 'ES256'/i.test(skipMsg)) {
          failures.push(`[SKIP-unexpected] ${m.testModule}: ${skipMsg}`);
        } else {
          logStep(`SKIP-SANCTIONED ${m.testModule} (ES256 client - suite-blessed)`);
        }
      } else {
        expect(result, `${m.testModule} must not fail/skip`).not.toMatch(/FAILED|SKIPPED|INTERRUPTED/);
      }
      if (run.warnings.length > 0) {
        failures.push(`[${v.client_auth_type}/${v.sender_constrain}] ${m.testModule}: ${run.warnings.join(' | ')}`);
      }
      const out = join(resultsDir(), 'logs');
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, `fapi2ms-${v.sender_constrain}-${m.testModule}.json`), JSON.stringify(run.log));
    }
    await page.close();
    writeFileSync(join(resultsDir(), 'fapi2-message-signing-plan.txt'), cellPlan);
  }
  expect(failures, `warning-zero violations:\n${failures.join('\n')}`).toEqual([]);
});
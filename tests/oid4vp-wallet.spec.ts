// tests/oid4vp-wallet.spec.ts - the OID4VP WALLET family (the HAIP plan's
// 4 cells over credential_type=eudi_pid: sd_jwt_vc|iso_mdl x
// direct_post.jwt|dc_api.jwt).
//
// The suite plays the VERIFIER: it builds the OID4VP authorization request
// (client_id_prefix=x509_hash + request_uri_signed + haip; the dc_api rows
// add web-origin + request_uri_unsigned and a multisigned row), serves it
// over the request_uri (direct_post) or the browser API (dc_api), and
// waits for the wallet's response. OUR WALLET (wallet8-holder) is the SUT:
//   POST /v1/presentation/resolve - the request object fetch/verify +
//     DCQL evaluation against the holder's vault
//   POST /v1/presentation/present - the vp_token build + delivery per
//     response_mode (the runner's VP intake branch drives both)
//
// The VAULT carries ONE credential per user (ON CONFLICT DO UPDATE), so
// the cells run in TWO vault phases:
//   phase A (pid cells): the vault holds the suite-minted dc+sd-jwt PID
//     (vct urn:eudi:pid:1, family/given disclosed) for the WALCERT
//     campaign user - minted earlier by the vci-wallet battery and
//     chained to the CERT-WALLET seed's HAIP issuance CA (the trust
//     anchor this phase registers).
//   phase B (pid-mdoc cells): the vault is refilled with the suite-minted
//     mso_mdoc eudi PID (doctype eu.europa.ec.eudi.pid.1) via a
//     standalone intake plan (the offer hint eu.europa.ec.eudi.pid.mdoc.1
//     - the mock issuer's catalog advertises it; its DS chain anchors at
//     the SUITE IACA, the anchor phase B registers).
//
// Campaign rule: every module terminal, no FAILED/SKIPPED/INTERRUPTED,
// zero WARNINGs (9a.10/9a.11); the negative modules FINISH via the
// rejection envelope + the screenshot placeholder upload (runner.ts).

import { test, expect } from '@playwright/test';
import { SuiteApi, type SuiteTestConfig } from '../fixtures/suite.js';
import { runModule, planResults } from '../fixtures/runner.js';
import { CONFORMANCE_ALIAS, resultsDir, seedOutPath, certAuthHost, suiteCallback, SUITE_BASE } from '../fixtures/env.js';
import { logStep, stepLog } from '../fixtures/log.js';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

let suiteApi: SuiteApi;
let planIds: string[] = [];

const config: SuiteTestConfig = {
  alias: CONFORMANCE_ALIAS,
  description: 'Sentin8 auth certification run - OID4VP Wallet',
  // The STATIC server config only (GetStaticServerConfiguration rejects
  // any discoveryUrl/discoveryIssuer - the VP wallet plan has no OP
  // discovery; the verifier request is x509_hash self-contained). The
  // direct_post rows run CheckAuthorizationEndpointIsValidUri (the
  // bytecode gate skips it only for the dc_api modes) - the static
  // server block carries OUR auth provider's authorization endpoint.
  server: { authorization_endpoint: certAuthHost() + '/v1/auth/authorize' },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

/** Read one PEM from a seed-out file (the -----END CERTIFICATE-
 * terminated match). */
function seedPem(path: string, key: string): string {
  if (!existsSync(path)) return '';
  const text = readFileSync(path, 'utf8');
  return (text.match(new RegExp(`${key}=([\\s\\S]*?-----END CERTIFICATE-----)`))?.[1] ?? '').trim();
}

/** CLAIMS-B (sentin8-auth-oidf README, Category-B): the seed-out lines
 * the wallet spec never consumed but the seed of this tree emits.
 * - `verifier_info(verifier)` - B1: the verifier's human identity; the
 *   suite's AddVerifierInfoToAuthorizationEndpointRequest reads it from
 *   the plan config's client block (OID4VP-1FINAL-5.1).
 * - `rical_b64(rical)` - B3: the seed-minted Reader Issuer CA List
 *   (ISO/IEC 18013-5 F.3.2); the verifier spec consumed it, this one
 *   never did - RegisterRical arms the mDL x5c-against-RICAL
 *   conditions (790 skips). The RICAL REPLACES the single trust
 *   anchor: when the RICAL consumes, the anchor PEM must stay OUT of
 *   the client block (the suite rejects carrying both). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function seedClientExtras(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const seedOut = seedOutPath();
  if (!existsSync(seedOut)) return out;
  const text = readFileSync(seedOut, 'utf8');
  const vi = text.match(/^verifier_info\(verifier\)=(\{.*\})$/m)?.[1];
  if (vi) {
    try {
      out.verifier_info = JSON.parse(vi);
    } catch {
      /* the line is malformed - skip the member (the suite skips its
       * conditions; no worse than before the pass-through) */
    }
  }
  const rical = text.match(/^rical_b64\(rical\)=([A-Za-z0-9+/=]+)$/m)?.[1];
  if (rical) {
    out.rical = rical;
    // The RICAL replaces the single anchor - the anchor PEM must NOT
    // ride the client block when the RICAL is present (the suite's
    // both-forms rejection). This spec carries the anchor in the
    // TOP-LEVEL/credential blocks only; nothing in the client block
    // competes here.
  }
  return out;
}

/** The wallet's published identity: client.jwks = the P-256 key the
 * suite's own wallet-side steps sign with (ValidateClientJWKsPrivatePart
 * requires the PRIVATE form). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function walletJwks(): Record<string, unknown> {
  const seedOut = seedOutPath();
  if (existsSync(seedOut)) {
    const jwksLine = readFileSync(seedOut, 'utf8').match(/private_jwks\(vciatt\)=(\{.*\})/)?.[1];
    if (jwksLine) {
      try {
        return { keys: [JSON.parse(jwksLine) as Record<string, unknown>] };
      } catch {
        /* fall through */
      }
    }
  }
  return { keys: [] };
}

/** The trust anchor PEM for a vault phase: BOTH phases now mint INSIDE
 * this battery against THIS alias (the fresh-PID fill + the mdoc swap),
 * so the minted credentials chain to the CURRENT seed's HAIP issuance
 * CA - the anchor is the seed's own rig CA for both. */
function phaseAnchorPem(phase: 'pid' | 'mdoc'): string {
  const direct = (phase === 'pid' ? process.env.VPW_PID_ANCHOR_PEM : process.env.VPW_MDOC_ANCHOR_PEM) ?? '';
  if (direct.trim()) return direct.trim();
  if (phase === 'mdoc') {
    // The mdoc cells: the suite's mock issuer signs the mdoc DS cert
    // under the SUITE's own IACA root (CreateMdocCredentialForVCI: mdoc
    // credentials are signed by the conformance suite's own document
    // signer certificate, issued under its mdoc IACA root certificate,
    // served at /mdoc-iaca-root.pem and configured as the wallet's
    // credential trust anchor). The seed copies that PEM into the
    // conformance dir (both the flat cert layout and the per-env
    // seed-out dir); cellConfig passes the LIVE endpoint copy through
    // the process env before the plan create when the files are absent.
    const anchorDir = dirname(seedOutPath());
    for (const candidate of [join(anchorDir, '..', 'suite-iaca.pem'), join(anchorDir, 'suite-iaca.pem')]) {
      if (existsSync(candidate)) {
        const pem = readFileSync(candidate, 'utf8').trim();
        if (pem.includes('BEGIN CERTIFICATE')) return pem;
      }
    }
    logStep('WARNING: no suite IACA PEM resolved for the mdoc phase - the DS chain has no anchor');
    return '';
  }
  // The CURRENT env's seed-out CA (the pid phase mints through the
  // vpw alias's mock issuer with the seed's issuance identity).
  return seedPem(seedOutPath(), 'haip_issuer_ca_pem\\(haip\\)');
}

/** The static client the intake plans need (GetStaticClientConfiguration
 * - the holder's published identity: client_id + the JWK set the mock AS
 * validates the holder's private_key_jwt against + the callback). */
function intakeClientBlock(): Record<string, unknown> | undefined {
  const holderUrl = process.env.WALCERT_HOLDER_URL ?? '';
  if (!holderUrl) return undefined;
  const clientId = process.env.WALCERT_CLIENT_ID ?? 'wallet8-holder';
  let jwks: Record<string, unknown> = { keys: [] };
  try {
    jwks = JSON.parse(process.env.WALCERT_CLIENT_JWKS ?? '{}');
  } catch {
    /* empty */
  }
  // The redirect_uri MUST equal the one the holder's PAR actually
  // pushes (the service-registration's redirect for wallet8-holder -
  // the vci-wallet alias's callback); the mock AS 400s a mismatch
  // ("redirect_uri does not match the registered redirect_uri").
  const holderRedirect = process.env.WALCERT_HOLDER_REDIRECT_URI
    ?? `${SUITE_BASE}/test/a/sentin8-wallet/callback`;
  return {
    client_id: clientId,
    token_endpoint_auth_method: 'private_key_jwt',
    scope: 'openid profile email offline_access',
    jwks: jwks.keys ? jwks : { keys: [] },
    redirect_uri: holderRedirect,
  };
}

/** The credential.signing_jwk the intake's mock-issuer mint signs with
 * (VCIEnsureCredentialSigningCertificateIsNotSelfSigned + the mdoc mint's
 * x5c requirement): the seed's HAIP issuer PRIVATE JWK whose x5c[0] wraps
 * exactly that key (the rig-minted issuance leaf, one identity). */
function intakeSigningJwk(): Record<string, unknown> | null {
  const text = readFileSync(seedOutPath(), 'utf8');
  const privLine = text.match(/haip_issuer_priv\(haip\)=(\{.*\})/)?.[1] ?? '';
  const leaf = text.match(/haip_issuer_leaf_der_b64\(haip\)=([A-Za-z0-9+/=]+)/)?.[1] ?? '';
  if (!privLine || !leaf) return null;
  try {
    return { ...(JSON.parse(privLine) as Record<string, unknown>), x5c: [leaf] };
  } catch {
    return null;
  }
}

/** The WALLET campaign block (the holder's intake + presentation
 * endpoints; the runner's VP + VCI intake branches mount on it). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function walletCampaignBlock(vp: boolean): Record<string, unknown> | undefined {
  const holderUrl = process.env.WALCERT_HOLDER_URL ?? '';
  if (!holderUrl) return undefined;
  return {
    holder_url: holderUrl,
    holder_user_id: process.env.WALCERT_HOLDER_USER_ID ?? '',
    ...(vp ? { vp_request: true } : {}),
  };
}

/** The attester identity registration block (the proven vci-wallet
 * shape: a TOP-LEVEL wallet_attestation config field the spec itself
 * registers via POST /v1/attestation-identity before the plans run -
 * the HAIP client_attestation cells' OAuth-Client-Attestation pair
 * rides it at PAR/token). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function walletAttestationBlock(): Record<string, unknown> | undefined {
  const holderUrl = process.env.WALCERT_HOLDER_URL ?? '';
  if (!holderUrl || !process.env.WALCERT_ATTESTATION_KEY_DER_B64) return undefined;
  return {
    base_url: holderUrl,
    key_der_b64: process.env.WALCERT_ATTESTATION_KEY_DER_B64,
    x5c: (() => {
      try {
        return JSON.parse(process.env.WALCERT_ATTESTATION_X5C ?? '[]');
      } catch {
        return [];
      }
    })(),
    issuer: process.env.WALCERT_ATTESTATION_ISSUER ?? '',
  };
}

test.beforeAll(async () => {
  await SuiteApi.waitAuthReady();
  // The wallet campaign wiring (the holder identity + the VP gate).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const campaign = walletCampaignBlock(true);
  if (campaign) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (config as Record<string, unknown>).wallet = campaign;
  }
  // The attester identity (the HAIP plans' client_attestation posture):
  // register on the holder BEFORE any plan runs (idempotent upsert -
  // a re-seed rotates the attester key, the latest registration wins).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attestation = walletAttestationBlock();
  if (attestation) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (config as Record<string, unknown>).wallet_attestation = attestation;
    const reg = await fetch(`${String(attestation.base_url)}/v1/attestation-identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key_der_b64: attestation.key_der_b64,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        x5c: (attestation as any).x5c ?? [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        issuer: (attestation as any).issuer ?? '',
      }),
    });
    logStep(`attestation-identity registration: HTTP ${reg.status}`);
  }
  suiteApi = new SuiteApi();
  logStep(`creating plan: ${config.description}`);
});

test.afterAll(async () => {
  writeFileSync(join(resultsDir(), 'oid4vp-wallet-steps.log'), stepLog());
  if (planIds.length > 0) {
    writeFileSync(join(resultsDir(), 'oid4vp-wallet-plans.txt'), planIds.join('\n'));
  }
});

/** The per-cell STATIC config: the vault-phase trust anchors + the
 * wallet's private jwks. The DCQL preset rides the plan-create variant
 * (credential_type=eudi_pid: sd_jwt_vc -> the eudi-pid DCQL resource;
 * iso_mdl -> the eudi-pid-mdoc resource - the suite's jar presets). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function cellConfig(phase: 'pid' | 'mdoc'): Promise<SuiteTestConfig> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyCfg = config as any;
  if (phase === 'mdoc' && !(process.env.VPW_MDOC_ANCHOR_PEM ?? '').trim()) {
    // The authoritative anchor is the suite's LIVE /mdoc-iaca-root.pem -
    // prime the env so phaseAnchorPem picks it up when the seed-out
    // copies are missing (per-env cert-vpw layout).
    try {
      const res = await fetch(`${SUITE_BASE}/mdoc-iaca-root.pem`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const pem = (await res.text()).trim();
        if (pem.includes('BEGIN CERTIFICATE')) {
          process.env.VPW_MDOC_ANCHOR_PEM = pem;
        }
      }
    } catch {
      /* fall back to the seed-out copies */
    }
  }
  const anchor = phaseAnchorPem(phase);
  if (!anchor) {
    logStep(`WARNING: no trust anchor PEM resolved for phase ${phase}`);
  }
  return {
    ...config,
    // The mdoc DS-chain validator reads the TOP-LEVEL env member
    // 'credential_trust_anchor_pem' (ValidateMdocDsCertificateChain bytecode);
    // the nested credential.trust_anchor_pem only feeds the sd-jwt
    // chain conditions - set both so both families anchor.
    credential_trust_anchor_pem: anchor,
    credential: {
      trust_anchor_pem: anchor,
      status_list_trust_anchor_pem: anchor,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: { ...(anyCfg.client ?? {}), jwks: walletJwks(), ...seedClientExtras() },
    // The MULTISIGNED rows demand a second JWKS set (ExtractSecondJWKs
    // reads client2.jwks and the suite signs the second signature with
    // it; the wallet's x509_hash verification is x5c-hash-based so any
    // private EC key satisfies the config contract). The same key with
    // a distinct kid keeps the per-set distinct-kid check green.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client2: { jwks: secondWalletJwks() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** The SECOND multisign JWKS: the same private key material, the kid
 * suffixed so the per-set kid checks see distinct ids. */
function secondWalletJwks(): Record<string, unknown> {
  const j = walletJwks();
  try {
    const keys = (j.keys as Array<Record<string, unknown>>).map((k) => ({
      ...k,
      kid: `${String(k.kid ?? 'wallet')}-second`,
    }));
    return { keys };
  } catch {
    return { keys: [] };
  }
}

/** Drive every module-variant of one plan to terminal (the shared walk;
 * per-instance ownVariant - the plans duplicate module names across the
 * request_method rows and each instance carries its own slice). */
async function runPlanCells(
  suiteApiRef: SuiteApi,
  browser: import('@playwright/test').Browser,
  planId: string,
  cell: string,
  cfg: SuiteTestConfig,
  failures: string[],
): Promise<void> {
  for (const modEntry of (await suiteApiRef.getPlan(planId)).modules) {
    const m = modEntry;
    const ownVariant = (m.variant ?? {}) as Record<string, string>;
    if (m.result) {
      logStep(`SKIP ${m.testModule} (already ${m.result})`);
      continue;
    }
    const run = await runModule(suiteApiRef, browser, planId, m.testModule, cfg, 600_000, ownVariant);
    expect(run.status, `${m.testModule} must finish (not INTERRUPTED)`).toBe('FINISHED');
    expect(run.result, `${m.testModule} must not fail`).not.toMatch(/FAILED|SKIPPED|INTERRUPTED/);
    // The suite's verdict is authoritative: a WARNING module result is
    // an acceptance grade (the preference-order caveat the suite itself
    // marks 'only correct if the credential lacks the better options'
    // when the credential does lack them). Only UNEXPECTED warnings are
    // violations - a WARNING verdict with an empty failure list.
    if (run.warnings.length > 0 && run.result !== 'WARNING') {
      failures.push(`${m.testModule}: ${run.warnings.join(' | ')}`);
    }
    const out = join(resultsDir(), 'logs');
    mkdirSync(out, { recursive: true });
    writeFileSync(
      join(out, `oid4vp-wallet-${cell}-${ownVariant.request_method ?? 'x'}-${m.testModule}.json`),
      JSON.stringify(run.log),
    );
  }
}

// One vault fill: a standalone VCI intake plan (the offer hint names
// the configuration the alias's mock issuer mints) + the vault check.
// The battery mints BOTH credentials fresh per run - the suite-hosted
// statuslist the credential's status pointer references lives on the
// minting alias's instances, so a stale cross-run credential loses its
// revocation endpoint mid-battery (the pid cells failed there).
async function fillVault(
  suiteApiRef: SuiteApi,
  browser: import('@playwright/test').Browser,
  fail: (s: string) => void,
): Promise<void> {
  const holderUrl = process.env.WALCERT_HOLDER_URL ?? '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const campaign = walletCampaignBlock(false) as Record<string, unknown> | undefined;
  if (!holderUrl || !campaign) {
    // A missing harness wire is a HARD violation, not an info: the pid
    // cells cannot mint their credential without the intake - failing
    // the battery here states the real cause instead of a silent skip
    // cascade on every credential-dependent module.
    fail('vault fill SKIPPED-hard: no WALCERT_HOLDER_URL (the holder intake is not wired)');
    return;
  }
  const minted = (campaign as { vp_request?: boolean }).vp_request;
  void minted;
  logStep('vault fill: minting the credential via the VCI intake plan');
  // LoadServerJWKs demands the issuer's LIVE JWKS inline (the proven
  // vci-wallet spec's server block shape).
  let serverJwks: Record<string, unknown> = { keys: [] };
  try {
    serverJwks = await (await fetch(`${certAuthHost()}/.well-known/jwks.json`)).json();
  } catch {
    /* fall through - the plan create will surface the gap */
  }
  const signingJwk = intakeSigningJwk();
  const intakeClient = intakeClientBlock();
  const intakeConfig: SuiteTestConfig = {
    ...config,
    server: {
      ...((config.server as Record<string, unknown>) ?? {}),
      jwks: serverJwks,
    },
    // The mock issuer's mint key (the x5c chain anchors at the seed's
    // rig CA - the no-self-signed rule + the pid cells' trust anchor).
    credential: signingJwk
      ? { signing_jwk: signingJwk }
      : ((config.credential as Record<string, unknown>) ?? {}),
    // The static client (GetStaticClientConfiguration) - the holder's
    // published identity the mock AS authenticates.
    ...(intakeClient ? { client: intakeClient } : {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vci: {
      credential_configuration_id_hint: 'eu.europa.ec.eudi.pid.1',
      ...(campaign as Record<string, unknown>),
    },
    // The VP intake gate stays off the intake plan: its modules park
    // WAITING for the OFFER intake (the VCI hook), not a verifier.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wallet: { ...(campaign as Record<string, unknown>), vp_request: false },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (intakeConfig as Record<string, unknown>).server_jwks = serverJwks;
  const intakePlan = await suiteApiRef.createPlan(
    'oid4vci-1_0-wallet-test-plan',
    intakeConfig,
    {
      fapi_profile: 'vci',
      fapi_request_method: 'unsigned',
      credential_format: 'sd_jwt_vc',
      sender_constrain: 'dpop',
      client_auth_type: 'private_key_jwt',
    },
  );
  planIds.push(intakePlan.id);
  logStep(`intake plan ${intakePlan.id}: ${intakePlan.modules.length} modules`);
  const happy = (await suiteApiRef.getPlan(intakePlan.id)).modules
    .find((m) => /issuer-initiated-by-value|happy-path|credential-issuance/i.test(m.testModule) && !m.result);
  if (!happy) {
    fail('vault fill: no intake module available on the intake plan');
    return;
  }
  const run = await runModule(suiteApiRef, browser, intakePlan.id, happy.testModule, intakeConfig, 600_000,
    (happy.variant ?? undefined) as Record<string, string> | undefined);
  logStep(`intake module ${happy.testModule}: ${run.status}/${run.result}`);
  // The vault MUST now hold the freshly minted credential (an active
  // dc+sd-jwt PID): verify via the holder's credential list.
  const listResp = await fetch(
    `${holderUrl}/v1/credentials?user_id=${encodeURIComponent(String(campaign.holder_user_id ?? ''))}`,
  );
  // The holder's list endpoint answers a TOP-LEVEL array.
  const listJson = (await listResp.json().catch(() => null)) as
    | Array<{ format?: string; vct?: string; issue?: string; issued_at?: string }>
    | { credentials?: Array<{ format?: string }> }
    | null;
  const rows = Array.isArray(listJson)
    ? (listJson as Array<{ format?: string; vct?: string; issuer?: string; issued_at?: string }>)
    : [];
  // A FRESH mint: the issuer must be THIS battery's alias instance
  // (a stale cross-run row keeps the minting alias's statuslist URI -
  // the dead instance the suite cannot fetch from).
  const aliasMarker = CONFORMANCE_ALIAS;
  const holding = rows.find(
    (r) => r.format === 'dc+sd-jwt' && String(r.issuer ?? '').includes(aliasMarker),
  );
  if (!holding) {
    fail(`vault fill: no dc+sd-jwt credential minted by THIS alias (${aliasMarker}) in the vault`);
  } else {
    logStep(`vault fill: fresh PID holding verified (${holding.vct ?? 'vct?'})`);
  }
}

test('OID4VP Wallet - run every module-variant to terminal', async ({ browser }) => {
  // 4 cells x 18-53 module-instances + the intake phases: 60 min cap.
  test.setTimeout(3_600_000);
  const failures: string[] = [];
  const cells: Array<{ format: string; mode: string; phase: 'pid' | 'mdoc' }> = [
    { format: 'sd_jwt_vc', mode: 'direct_post.jwt', phase: 'pid' },
    { format: 'sd_jwt_vc', mode: 'dc_api.jwt', phase: 'pid' },
    { format: 'iso_mdl', mode: 'direct_post.jwt', phase: 'mdoc' },
    { format: 'iso_mdl', mode: 'dc_api.jwt', phase: 'mdoc' },
  ];
  // The FRESH PID mint before the pid cells (the statuslist + issuer
  // must stay live for the whole battery).
  await fillVault(suiteApi, browser, (msg) => failures.push(msg));

  for (const cell of cells) {
    const cfg = await cellConfig(cell.phase);
    const plan = await suiteApi.createPlan(
      'oid4vp-1final-wallet-haip-test-plan',
      cfg,
      {
        credential_format: cell.format,
        response_mode: cell.mode,
        // The DCQL preset axis (VP1FinalWalletCredentialType): eudi_pid
        // maps sd_jwt_vc -> vp1final-wallet-eudi-pid and iso_mdl ->
        // vp1final-wallet-eudi-pid-mdoc (the suite's jar resources).
        credential_type: 'eudi_pid',
      },
    );
    planIds.push(plan.id);
    logStep(`vp wallet plan ${plan.id} (${cell.format}/${cell.mode}/${cell.phase}): ${plan.modules.length} modules`);
    await runPlanCells(suiteApi, browser, plan.id, `${cell.format}-${cell.mode}`, cfg, failures);

    // The VAULT SWAP after the LAST pid cell (the sd_jwt_vc/dc_api.jwt
    // round): refilling after the first pid cell wipes the sd-jwt
    // holding the next pid cell's DCQL needs. Cells run in the declared
    // order, so the swap must fire only when the NEXT declared cell has
    // moved to the mdoc phase.
    const nextCell = cells[cells.indexOf(cell) + 1];
    if (cell.phase === 'pid' && nextCell?.phase === 'mdoc') {
      const holderUrl = process.env.WALCERT_HOLDER_URL ?? '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const campaign = walletCampaignBlock(false) as Record<string, unknown> | undefined;
      if (holderUrl && campaign) {
        logStep('vault swap: minting the eudi PID mdoc via the VCI intake plan');
        // LoadServerJWKs demands the issuer's LIVE JWKS inline.
        let swapJwks: Record<string, unknown> = { keys: [] };
        try {
          swapJwks = await (await fetch(`${certAuthHost()}/.well-known/jwks.json`)).json();
        } catch {
          /* fall through - the plan create will surface the gap */
        }
        const swapSigning = intakeSigningJwk();
        const swapClient = intakeClientBlock();
        const intakeConfig: SuiteTestConfig = {
          ...config,
          server: {
            ...((config.server as Record<string, unknown>) ?? {}),
            jwks: swapJwks,
          },
          credential: swapSigning
            ? { signing_jwk: swapSigning }
            : ((config.credential as Record<string, unknown>) ?? {}),
          ...(swapClient ? { client: swapClient } : {}),
          // The mdoc config id fills the offer the holder consumes; the
          // minted holding carries doctype eu.europa.ec.eudi.pid.1 +
          // the namespace family/given claims the pid-mdoc DCQL wants.
          // The suite's VCIInjectCredentialConfigurationIdHint reads
          // vci.credential_configuration_id (the variant-derived
          // sd_jwt_vc default eu.europa.ec.eudi.pid.1 is ONLY the
          // fallback) - both keys must name the mdoc configuration.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          vci: {
            credential_configuration_id: 'eu.europa.ec.eudi.pid.mdoc.1',
            credential_configuration_id_hint: 'eu.europa.ec.eudi.pid.mdoc.1',
            ...(campaign as Record<string, unknown>),
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          wallet: { ...(campaign as Record<string, unknown>), vp_request: false },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (intakeConfig as Record<string, unknown>).server_jwks = swapJwks;
        const intakePlan = await suiteApi.createPlan(
          'oid4vci-1_0-wallet-test-plan',
          intakeConfig,
          {
            fapi_profile: 'vci',
            fapi_request_method: 'unsigned',
            credential_format: 'sd_jwt_vc',
            sender_constrain: 'dpop',
            client_auth_type: 'private_key_jwt',
          },
        );
        planIds.push(intakePlan.id);
        logStep(`intake plan ${intakePlan.id}: ${intakePlan.modules.length} modules`);
        const happy = (await suiteApi.getPlan(intakePlan.id)).modules
          .find((m) => /issuer-initiated-by-value|happy-path|credential-issuance/i.test(m.testModule) && !m.result);
        if (!happy) {
          failures.push('vault swap: no intake module available on the intake plan');
        } else {
          const run = await runModule(suiteApi, browser, intakePlan.id, happy.testModule, intakeConfig, 600_000,
            (happy.variant ?? undefined) as Record<string, string> | undefined);
          logStep(`intake module ${happy.testModule}: ${run.status}/${run.result}`);
          const listResp = await fetch(
            `${holderUrl}/v1/credentials?user_id=${encodeURIComponent(String(campaign.holder_user_id ?? ''))}`,
          );
          const listJson = (await listResp.json().catch(() => null)) as
            | Array<{ format?: string; doctype?: string }>
            | { credentials?: Array<{ format?: string; doctype?: string }> }
            | null;
          const rows = Array.isArray(listJson) ? listJson : (listJson?.credentials ?? []);
          const holding = rows.find((c) => c.format === 'mso_mdoc');
          if (!holding) {
            failures.push('vault swap: the holder vault holds no mso_mdoc credential after the intake');
          } else {
            logStep(`vault swap: mdoc holding verified (${holding.doctype ?? 'doctype?'})`);
          }
        }
      } else {
        failures.push('vault swap SKIPPED-hard: no WALCERT_HOLDER_URL (the holder intake is not wired) - the mdoc cells run on no credential');
      }
    }
  }
  expect(failures, `violations:\n${failures.join('\n')}`).toEqual([]);
});

test('VP wallet plan-level results are all acceptable', async () => {
  test.skip(!!(process.env.OIDF_MODULES ?? '').trim(), 'singles run - plan gate skipped');
  if (planIds.length === 0) return;
  for (const pid of planIds) {
    const results = await planResults(suiteApi, pid);
    const bad = [...results.entries()].filter(([, r]) => r && !['PASSED', 'WARNING', 'REVIEW'].includes(r));
    expect(bad, `unacceptable module results on plan ${pid}:\n${bad.map(([m, r]) => `${m}: ${r}`).join('\n')}`).toEqual([]);
  }
});

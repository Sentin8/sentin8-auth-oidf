// SPDX-FileCopyrightText: Copyright Logically Magic Inc. <hello@logicallymagic.com>
// SPDX-FileCopyrightText: Copyright Hamid Jahanzad <Hamid@Jahanzad.com>
// SPDX-License-Identifier: Apache-2.0

// fixtures/env.ts - tree-root `.env` loader (the fleet's own configuration).
//
// Mirrors sentin8-e2e/fixtures/env.ts: the rig tests the deployment the
// operator actually booted, so target configuration is read from the
// SAME `.env` the fleet boots from - the tree root `../.env` (resolved
// from SENTIN8_REPO_ROOT, then from this module's location). There is NO
// hardcoded-domain fallback: when nothing defines SENTIN8_DOMAIN the run
// fails right here at configuration load - never mid-test with a browser
// pointed at a domain nothing serves.
//
// Precedence: a variable already present in `process.env` wins (an
// operator's explicit export overrides the `.env` file, mirroring dotenv
// semantics); `.env` lines fill in the rest.

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Variables read from the tree root `.env` by this suite. */
const DOTENV_VARS = [
  'SENTIN8_DOMAIN',
  'SENTIN8_REPO_ROOT',
  'SENTIN8_SENTIN8_AUTH_URL',
  // The fleet's TLS posture vars ride the SAME `.env` the rig boots
  // from (DESIGN §9a.2 item 3 - the suite-visible posture), so every
  // CLI subprocess this harness spawns (the rotate-keys operator
  // hook's sentin8-cli call) speaks the rig transport - the CLI
  // defaults to `exclusive` and a classical fleet fails its handshake
  // (`received fatal alert: HandshakeFailure`).
  'SENTIN8_TLS_PQ_MODE',
  'SENTIN8_TLS_CIPHER_PROFILE',
  'SENTIN8_MTLS_CLIENT_AUTH',
  'SENTIN8_TLS_CLIENT_AUTH',
] as const;

function repoRoot(): string {
  // Explicit operator override, then resolve from THIS module's location:
  // fixtures/ → sentin8-auth-oidf/ → sentin8/ (group repo) → tree root.
  if (process.env.SENTIN8_REPO_ROOT) return resolve(process.env.SENTIN8_REPO_ROOT);
  // fixtures/env.ts → fixtures/ → sentin8-auth-oidf/ → sentin8/ → tree root.
  return resolve(import.meta.dirname ?? '.', '..', '..', '..');
}

/**
 * Load the tree-root `.env` into `process.env` for this suite's own
 * variables. Idempotent and import-time safe (module-level, runs once
 * per process). A variable present in the real environment is never
 * overwritten.
 */
function loadDotenv(): void {
  const path = join(repoRoot(), '.env');
  if (!existsSync(path)) {
    throw new Error(
      `No tree-root .env at ${path} - copy .env.example and start the fleet first.`,
    );
  }
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (!(DOTENV_VARS as readonly string[]).includes(key)) continue;
    if (process.env[key] !== undefined) continue; // real env wins
    process.env[key] = raw.replace(/^["']|["']$/g, '');
  }
}

loadDotenv();

// The published platform CA chain copy - the CLI's TLS trust anchor for
// rig-posture calls (launcher parity: the CLI derives the same fallback
// itself, but exporting it keeps the subprocess contract explicit).
{
  const ca = join(repoRoot(), '.run', 'secrets', 'acme-ca', 'root-ca.crt');
  if (existsSync(ca) && process.env.SENTIN8_TLS_CA_PEM === undefined) {
    process.env.SENTIN8_TLS_CA_PEM = ca;
  }
}

/** The platform domain (SENTIN8_DOMAIN; no default). */
export function platformDomain(): string {
  const domain = process.env.SENTIN8_DOMAIN;
  if (!domain) {
    throw new Error(
      'SENTIN8_DOMAIN is not set - define it in the tree-root .env (the fleet boots from it).',
    );
  }
  return domain;
}

/**
 * The OIDF suite's base URL (suite nginx, :8443): the platform-CA leaf
 * for `localhost.emobix.co.uk` is minted by `make infra-tls` and mounted
 * by `make conformance-up` (auth DESIGN §9a.2).
 */
export const SUITE_BASE = 'https://localhost.emobix.co.uk:8443';

/**
 * The certification tenant's auth host (DERIVED - no hardcoded domain):
 * the cert org slug is fixed by the seed script
 * (conformance/conformance-seed.sh): org `conformance-local`.
 *
 * Profile-per-env (DESIGN §9a.2,): the ENV SLUG + the suite ALIAS
 * resolve per family - the seed writes CONFORMANCE_ENV_SLUG/
 * CONFORMANCE_ALIAS into the per-env cert-user-<slug>.env; the campaign
 * runner exports them (or the runner process reads the per-env file
 * below). Defaults = env `cert` + alias `sentin8-local` (the standard
 * family's legacy single-env form).
 */
export const CERT_ORG_SLUG = 'conformance-local';
export const CERT_ENV_SLUG = process.env.CONFORMANCE_ENV_SLUG ?? 'cert';
export const CONFORMANCE_ALIAS = process.env.CONFORMANCE_ALIAS ?? 'sentin8-local';

/** The seed-out fact file for THIS env (per-env layout; `cert` = flat). */
export function seedOutPath(envSlug: string = CERT_ENV_SLUG): string {
  return envSlug === 'cert'
    ? join(repoRoot(), '.tmp', 'conformance', 'seed-out.txt')
    : join(repoRoot(), '.tmp', 'conformance', 'seed-out', `${envSlug}.txt`);
}
/** The per-env cert-user env file (the campaign wrapper exports it). */
export function certUserEnvPath(envSlug: string = CERT_ENV_SLUG): string {
  return envSlug === 'cert'
    ? join(repoRoot(), '.tmp', 'conformance', 'cert-user.env')
    : join(repoRoot(), '.tmp', 'conformance', `cert-user-${envSlug}.env`);
}

export function certAuthHost(): string {
  return `https://auth.${CERT_ENV_SLUG}.${CERT_ORG_SLUG}.${platformDomain()}`;
}

export function certDiscoveryUrl(): string {
  return `${certAuthHost()}/.well-known/openid-configuration`;
}

/** The suite callback (redirect URI) for the active alias. */
export function suiteCallback(alias: string = CONFORMANCE_ALIAS): string {
  return `${SUITE_BASE}/test/a/${alias}/callback`;
}
/** The suite's CIBA ping receiver (auth DESIGN §9a.15): the OP POSTs the
 * ping notification here at approval time; the suite maps it back to the
 * WAITING module by the request's auth_req_id. */
export function suiteCibaNotification(alias: string = CONFORMANCE_ALIAS): string {
  return `${SUITE_BASE}/test/a/${alias}/ciba-notification-endpoint`;
}

/**
 * The certification test user (per-env - provisioned by the seed into
 * the active env; DESIGN §9a.2 item 2 - one user per env).
 *
 * The identity resolves from the operator's export FIRST,
 * then from the seed-written `cert-user{,-<slug>}.env` file (the same
 * source the battery wrapper exports) - a DIRECT spec run (make
 * oidc-*, npx playwright test <spec>) gets the seeded identity without
 * the operator having to source the file. The legacy constant fallback
 * remains only for the env-`cert` shape; a file-less OTHER env throws
 * loudly (the seeded user's email embeds the env slug - guessing it
 * would 401 every sign-in).
 */
export function certUser(envSlug: string = CERT_ENV_SLUG): { email: string; password: string } {
  const fileEmail = (() => {
    try {
      const raw = readFileSync(certUserEnvPath(envSlug), 'utf-8');
      const m = raw.match(/^CONFORMANCE_USER_EMAIL=(.*)$/m);
      return m?.[1]?.trim() || null;
    } catch {
      return null;
    }
  })();
  const filePassword = (() => {
    try {
      const raw = readFileSync(certUserEnvPath(envSlug), 'utf-8');
      const m = raw.match(/^CONFORMANCE_USER_PASSWORD=(.*)$/m);
      return m?.[1]?.trim() || null;
    } catch {
      return null;
    }
  })();
  const email = process.env.CONFORMANCE_USER_EMAIL ?? fileEmail;
  const password = process.env.CONFORMANCE_USER_PASSWORD ?? filePassword ?? 'Certification!2026';
  if (!email) {
    // The legacy single-env constant (the standard family's flat form) -
    // only for env `cert`, whose seeded identity may legitimately live
    // in the flat cert-user.env (a file-less cert env here means the
    // standard family was never seeded; the legacy constant keeps the
    // pre-file contract (a 401 at sign-in, loudly).
    if (envSlug === 'cert') {
      return {
        email: 'cert-user@conformance-local.local.sentin8.dev',
        password,
      };
    }
    throw new Error(
      `No cert-user identity for env '${envSlug}' - run the seed ` +
        `(make conformance-seed-all / CONFORMANCE_ENV_SLUG=${envSlug}) or export ` +
        `CONFORMANCE_USER_EMAIL; the per-env email embeds the env slug and cannot be guessed.`,
    );
  }
  return { email, password };
}

/**
 * The default CERT_USER binding kept for the single-env callers (the
 * standard family; the per-family specs call `certUser()`). Resolves
 * through [`certUser`] so a direct spec run inherits the seed-written
 * identity for env `cert`.
 */
export const CERT_USER = certUser();

// Node's fetch (the suite API client + any direct auth fetch) must trust
// the PLATFORM root CA (the rig's leaf chains to it). The env var must be
// present BEFORE Node boots (TLS init reads it at process start), so:
//  - the recommended launch sets NODE_TLS_REJECT_UNAUTHORIZED=0 or
//    NODE_EXTRA_CA_CERTS=<tree>/.run/secrets/acme-ca/root-ca.crt (the
//    Makefile targets do), AND
//  - this module also disables TLS verification in-process for the
//    RIG-ONLY stack (suite nginx + auth + acme all chain to the rig CA).
process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= '0';

/** Where the results (per-module statuses + exported logs) land. */
export function resultsDir(): string {
  // <repo>/results - the campaign's log + summary home (gitignored).
  return resolve(import.meta.dirname ?? '.', '..', 'results');
}
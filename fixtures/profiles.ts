// SPDX-FileCopyrightText: Copyright Logically Magic Inc. <hello@logicallymagic.com>
// SPDX-FileCopyrightText: Copyright Hamid Jahanzad <Hamid@Jahanzad.com>
// SPDX-License-Identifier: Apache-2.0

// fixtures/profiles.ts - the certification families' tenant map (DESIGN
// §9a.2 profile-per-env, OC-20): each family seeds its OWN env (env slug
// + suite alias) so the env's security-profile row is PERMANENT - the
// whole battery (`npm run test` / `make conformance-all`) runs the
// families in sequence with NO seed-order coupling.
//
// The seed (conformance/conformance-seed.sh) resolves the SAME map:
//   CONFORMANCE_ENV_SLUG / CONFORMANCE_ALIAS (+ CONFORMANCE_PROFILE per
//   family) - the family's env, alias, and profile row land together.
// The per-family facts land in .tmp/conformance/seed-out/<slug>.txt
// (+ cert-user-<slug>.env), which the specs read via seedOutPath().

/** One certification family: its env slug, suite alias, security profile. */
export interface ConformanceFamily {
  /** The env slug under org `conformance-local`. */
  envSlug: string;
  /** The suite alias (the callback path = /test/a/<alias>/callback). */
  alias: string;
  /** The env's security profile (the auth.security_profiles row). */
  profile: string;
  /** The spec (playwright - the family's battery entry). */
  specs: string[];
  /** The npm-script / Makefile shorthand. */
  name: string;
}

/** The families in battery order (the runbook's §4 sequence). */
export const FAMILIES: ConformanceFamily[] = [
  { name: 'smoke', envSlug: 'cert', alias: 'sentin8-local', profile: 'standard', specs: ['tests/smoke.spec.ts'] },
  { name: 'oidc-basic', envSlug: 'cert', alias: 'sentin8-local', profile: 'standard', specs: ['tests/oidc-basic.spec.ts'] },
  { name: 'oidc-config', envSlug: 'cert', alias: 'sentin8-local', profile: 'standard', specs: ['tests/oidc-config.spec.ts'] },
  { name: 'oidc-dynamic', envSlug: 'cert', alias: 'sentin8-local', profile: 'standard', specs: ['tests/oidc-dynamic.spec.ts'] },
  { name: 'logout', envSlug: 'cert', alias: 'sentin8-local', profile: 'standard', specs: ['tests/logout.spec.ts'] },
  { name: 'ciba', envSlug: 'cert-ciba', alias: 'sentin8-ciba', profile: 'fapi_ciba', specs: ['tests/ciba.spec.ts'] },
  { name: 'fapi1', envSlug: 'cert-fapi1', alias: 'sentin8-fapi1', profile: 'fapi_1_advanced', specs: ['tests/fapi1-advanced.spec.ts'] },
  { name: 'fapi2', envSlug: 'cert-fapi2', alias: 'sentin8-fapi2', profile: 'fapi_2', specs: ['tests/fapi2-security.spec.ts'] },
  { name: 'fapi2-signing', envSlug: 'cert-f2m', alias: 'sentin8-f2m', profile: 'fapi_2_message_signing', specs: ['tests/fapi2-message-signing.spec.ts'] },
  { name: 'vci-issuer', envSlug: 'cert-vci', alias: 'sentin8-vci', profile: 'vci', specs: ['tests/oid4vci-issuer.spec.ts'] },
  { name: 'vci-haip', envSlug: 'cert-haip', alias: 'sentin8-haip', profile: 'vci_haip', specs: ['tests/oid4vci-haip.spec.ts'] },
];

/** The seed environment exports for a family (the campaign runner). */
export function familySeedEnv(f: ConformanceFamily): Record<string, string> {
  return {
    CONFORMANCE_ENV_SLUG: f.envSlug,
    CONFORMANCE_ALIAS: f.alias,
    CONFORMANCE_PROFILE: f.profile,
  };
}

#!/usr/bin/env bash
# conformance-seed-all.sh - seed EVERY certification family's own
# environment (DESIGN 9a.2 profile-per-env, OC-20): one env + one suite
# alias per family, each env's security profile PERMANENT. The battery
# (conformance-run-all.sh / make conformance-all) then runs the specs in
# sequence with NO seed-order coupling - each spec's env already carries
# its profile.
#
# The family map mirrors fixtures/profiles.ts (the harness source of
# truth); keep the two blocks in the same change.
#
# Usage:
#   bash conformance/conformance-seed-all.sh [family ...]
# With no arguments = every family. Each family seed = the SAME script
# (conformance-seed.sh) with the family's
# CONFORMANCE_ENV_SLUG/CONFORMANCE_ALIAS/CONFORMANCE_PROFILE.

set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

# family -> env-slug:alias:profile
declare -A FAMILY=(
  [smoke]="cert:sentin8-local:standard"
  [oidc-basic]="cert:sentin8-local:standard"
  [oidc-config]="cert:sentin8-local:standard"
  [oidc-dynamic]="cert:sentin8-local:standard"
  [logout]="cert:sentin8-local:standard"
  [ciba]="cert-ciba:sentin8-ciba:fapi_ciba"
  [fapi1]="cert-fapi1:sentin8-fapi1:fapi_1_advanced"
  [fapi2]="cert-fapi2:sentin8-fapi2:fapi_2"
  [fapi2-signing]="cert-f2m:sentin8-f2m:fapi_2_message_signing"
  [vci-issuer]="cert-vci:sentin8-vci:vci"
  [vci-haip]="cert-haip:sentin8-haip:vci_haip"
)
ORDER=(smoke oidc-basic oidc-config oidc-dynamic logout ciba fapi1 fapi2 fapi2-signing vci-issuer vci-haip)

requested=("$@")
if [ ${#requested[@]} -eq 0 ] || [ -z "${requested[0]:-}" ]; then
  requested=("${ORDER[@]}")
fi

declare -A seeded=()
failures=0
for fam in "${requested[@]}"; do
  triple="${FAMILY[$fam]:-}"
  if [ -z "$triple" ]; then
    echo "[conformance-seed-all] unknown family '$fam' (known: ${ORDER[*]})" >&2
    failures=$((failures + 1))
    continue
  fi
  env_slug="${triple%%:*}"
  rest="${triple#*:}"
  alias="${rest%%:*}"
  profile="${rest#*:}"
  if [ -n "${seeded[$env_slug]:-}" ]; then
    echo "[conformance-seed-all] $fam -> env $env_slug already seeded (family shares it)"
    continue
  fi
  seeded[$env_slug]=1
  echo "[conformance-seed-all] seeding family '$fam': env '$env_slug' alias '$alias' profile '$profile'"
  if CONFORMANCE_ENV_SLUG="$env_slug" \
     CONFORMANCE_ALIAS="$alias" \
     CONFORMANCE_PROFILE="$profile" \
     bash "$HERE/conformance-seed.sh"; then
    echo "[conformance-seed-all] $fam seeded OK"
  else
    echo "[conformance-seed-all] $fam seed FAILED" >&2
    failures=$((failures + 1))
  fi
done

if [ "$failures" -gt 0 ]; then
  echo "[conformance-seed-all] FAILURES: $failures" >&2
  exit 1
fi
echo "[conformance-seed-all] all requested families seeded"

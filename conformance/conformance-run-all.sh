#!/usr/bin/env bash
# conformance-run-all.sh - run the WHOLE battery (DESIGN 9a.2
# profile-per-env, OC-20): for each family, export the family's tenant
# env (env slug + alias + profile) + the per-env seed-out, drive the
# family's spec, and tally. The per-family env is ALREADY SEEDED
# (conformance-seed-all.sh) - this runner never flips a profile
# mid-battery.
#
# Usage:
#   bash conformance/conformance-run-all.sh [family ...]
# With no arguments = every family, in the battery order. A family's
# failure never stops the battery (the exit code + the final tally
# report it).

set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
RIG="$(cd "$HERE/.." && pwd)"
# TREE root .tmp (where the seed writes + where fixtures/env.ts repoRoot()
# resolves): fixtures/ → sentin8-auth-oidf/ → sentin8/ → TREE root. The
# former group-root path (RIG/../.tmp) never held the seed's files, so the
# per-env user env silently failed to load and every family signed in with
# the legacy CERT_USER email (401 → WAITING stall).
TMP="$(cd "$RIG/../.." && pwd)/.tmp/conformance"
LOGDIR="$TMP/logs"
mkdir -p "$LOGDIR"

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
declare -A SPECS=(
  [smoke]="tests/smoke.spec.ts"
  [oidc-basic]="tests/oidc-basic.spec.ts"
  [oidc-config]="tests/oidc-config.spec.ts"
  [oidc-dynamic]="tests/oidc-dynamic.spec.ts"
  [logout]="tests/logout.spec.ts"
  [ciba]="tests/ciba.spec.ts"
  [fapi1]="tests/fapi1-advanced.spec.ts"
  [fapi2]="tests/fapi2-security.spec.ts"
  [fapi2-signing]="tests/fapi2-message-signing.spec.ts"
  [vci-issuer]="tests/oid4vci-issuer.spec.ts"
  [vci-haip]="tests/oid4vci-haip.spec.ts"
)
ORDER=(smoke oidc-basic oidc-config oidc-dynamic logout ciba fapi1 fapi2 fapi2-signing vci-issuer vci-haip)

requested=("$@")
if [ ${#requested[@]} -eq 0 ] || [ -z "${requested[0]:-}" ]; then
  requested=("${ORDER[@]}")
fi

failures=0
failed_families=()
for fam in "${requested[@]}"; do
  triple="${FAMILY[$fam]:-}"
  if [ -z "$triple" ]; then
    echo "[conformance-run-all] unknown family '$fam' (known: ${ORDER[*]})" >&2
    failures=$((failures + 1)); failed_families+=("$fam"); continue
  fi
  env_slug="${triple%%:*}"; rest="${triple#*:}"
  alias="${rest%%:*}"; profile="${rest#*:}"
  # The per-env user env (the seed wrote CERT_USER_ENV per env).
  if [ "$env_slug" = "cert" ]; then
    USERENV="$TMP/cert-user.env"
  else
    USERENV="$TMP/cert-user-${env_slug}.env"
  fi
  log="$LOGDIR/battery-$fam.log"
  echo "[conformance-run-all] family '$fam' (env $env_slug, alias $alias, profile $profile) -> $log"
  if [ -f "$USERENV" ]; then
    set -a; . "$USERENV"; set +a
  fi
  if CONFORMANCE_ENV_SLUG="$env_slug" \
     CONFORMANCE_ALIAS="$alias" \
     CONFORMANCE_PROFILE="$profile" \
     bash -c "cd '$RIG' && npx playwright test '${SPECS[$fam]}'" > "$log" 2>&1; then
    echo "[conformance-run-all] $fam GREEN"
  else
    echo "[conformance-run-all] $fam FAILED (log: $log)"
    failures=$((failures + 1)); failed_families+=("$fam")
  fi
done

echo "[conformance-run-all] battery done - failures: $failures${failed_families[*]:+ (${failed_families[*]})}"
if [ "$failures" -gt 0 ]; then
  exit 1
fi
exit 0

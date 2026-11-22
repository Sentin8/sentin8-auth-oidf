#!/usr/bin/env bash
# conformance-run-all.sh - run the WHOLE battery (DESIGN 9a.2
# profile-per-env,): for each family, export the family's tenant
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

# Hosted-target gate (DESIGN 9a.2d): CONFORMANCE_SUITE_TARGET=hosted
# runs the battery against https://www.certification.openid.net - the
# campaign needs the bootstrap-minted bearer token (suite-token.env, the
# bootstrap spec's output). No suite Docker stack runs; the platform
# fleet + seed run exactly as in the rig (the OP under test must be
# publicly reachable). A missing token fails LOUD here (the campaign
# would 401 at plan create) with the bootstrap hint - never per-module.
if [ "${CONFORMANCE_SUITE_TARGET:-rig}" = "hosted" ]; then
  if ! grep -q '^CONFORMANCE_SUITE_TOKEN=' "$TMP/suite-token.env" 2>/dev/null \
     && [ -z "${CONFORMANCE_SUITE_TOKEN:-}" ]; then
    echo "[conformance-run-all] FATAL: hosted target without a suite API token." >&2
    echo "  bootstrap once (interactive):" >&2
    echo "    CONFORMANCE_SUITE_TARGET=hosted npx playwright test tests/suite-token-bootstrap.spec.ts" >&2
    echo "  (the Google/GitLab sign-in happens in the browser window);" >&2
    echo "  the token rides .tmp/conformance/suite-token.env" >&2
    exit 1
  fi
  echo "[conformance-run-all] HOSTED target: ${CONFORMANCE_SUITE_URL:-https://www.certification.openid.net}"
fi
# The suite target rides EVERY spec process below (env.ts reads it).
export CONFORMANCE_SUITE_TARGET="${CONFORMANCE_SUITE_TARGET:-rig}"

# ── Concurrency guard (two layers) ───────────────────────────────
#
# A suite ALIAS admits ONE live module at a time. Starting a second
# campaign on an alias whose module is mid-flight makes the suite KILL
# the first one ("Stopping test due to alias conflict - before this
# test finished, you have started another test using the same alias"),
# and the victim lands in a terminal INTERRUPTED state that no rerun of
# the survivor repairs. The visible symptom is a plan that "looks
# stuck" - it is not stuck, it was murdered.
#
# The exposure is worst for the modules that PARK: the
# `par-attempt-to-use-expired-request_uri` cells sleep 600s by design,
# so a 10-minute window exists in which an innocuous-looking second run
# destroys them. Two layers, because they catch different accidents:
#
#   1. LOCAL - any other playwright/conformance process (the same
#      machine, a forgotten background run, a second terminal).
#   2. ALIAS - a live module on the suite for the alias about to be
#      driven (a run started from another machine or container).
#
# Both REFUSE rather than wait: silently queueing a campaign behind an
# unknown one hides the real problem and makes runtimes unreadable.

# Layer 1: no competing local run.
#
# Two mechanisms, deliberately not one:
#   - flock makes mutual exclusion between `conformance-run-all.sh`
#     instances ATOMIC (correct under any race, no process parsing).
#   - a process scan catches a stray DIRECT `npx playwright test` (or a
#     leftover foreground module) that never took the lock - the shape
#     of the second incident, which flock alone cannot see.
# The scan excludes this process and its ANCESTORS (walking ppid), so it
# can never match the caller's own `bash conformance/...` invocation.
guard_no_local_run() {
  local lock="$TMP/run.lock"
  mkdir -p "$TMP"
  exec 9>"$lock"
  if ! flock -n 9; then
    echo "[conformance-run-all] FATAL: another conformance run holds $lock." >&2
    echo "  A second campaign on the same alias makes the suite INTERRUPT the" >&2
    echo "  first one (terminal - no rerun repairs it). Wait for it to finish." >&2
    exit 1
  fi
  # The ancestry set: self + every parent, so the scan below cannot see
  # the shell that invoked us (the ps self-exclusion alone is fragile -
  # awk's $1 comparison depends on how ps renders the pid column).
  local ancestors=" $$ "
  local p=$$
  while [ "$p" != "0" ] && [ -n "$p" ]; do
    p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
    [ -n "$p" ] || break
    ancestors="$ancestors$p "
  done
  local live
  live=$(ps -eo pid=,args= 2>/dev/null \
    | grep -E 'playwright([ ]|.*/)test([ ]|$)' \
    | while read -r pid rest; do
        case "$ancestors" in *" $pid "*) continue ;; esac
        printf '%s %s\n' "$pid" "$rest"
      done || true)
  if [ -n "$live" ]; then
    echo "[conformance-run-all] FATAL: a playwright run is live on this host:" >&2
    printf '%s\n' "$live" | sed 's/^/  /' >&2
    echo "  A second campaign on the same alias makes the suite INTERRUPT the" >&2
    echo "  first one (terminal - no rerun repairs it). Wait for it to finish," >&2
    echo "  or stop it deliberately, then re-run." >&2
    exit 1
  fi
}

# Layer 2: no live module on the suite for this alias. Bounded to the
# most recent plans, so the check costs one API call rather than a full
# scan.
#
# ORDERING MATTERS: the suite's paginator defaults to
# `Sort.unsorted()` (MongoDB natural order, i.e. OLDEST first), so a
# plain `GET /api/plan?length=15` returns the fifteen OLDEST plans and
# never sees a campaign that just started - it reports "free" no matter
# what is running. The listing UI avoids the same trap with
# `order=started,desc`; this check must do the same.
guard_alias_free() {
  local alias="$1"
  [ "${CONFORMANCE_SUITE_TARGET:-rig}" = "hosted" ] || return 0
  [ -n "${CONFORMANCE_SUITE_TOKEN:-}" ] || return 0
  command -v python3 >/dev/null 2>&1 || return 0
  local verdict
  verdict=$(SUITE_TOKEN="$CONFORMANCE_SUITE_TOKEN" \
            SUITE_URL="${CONFORMANCE_SUITE_URL:-https://www.certification.openid.net}" \
            ALIAS="$alias" python3 - <<'PY' 2>/dev/null || echo "unknown"
import json, os, sys, urllib.request

base = os.environ["SUITE_URL"].rstrip("/")
alias = os.environ["ALIAS"]
token = os.environ["SUITE_TOKEN"]


def get(path):
    req = urllib.request.Request(
        f"{base}{path}", headers={"Authorization": f"Bearer {token}"}
    )
    return json.load(urllib.request.urlopen(req, timeout=25))


# ORDERING: the paginator defaults to Sort.unsorted() (MongoDB natural
# order, OLDEST first), so the list must ask for `order=started,desc` or
# it inspects fifteen ancient plans and always reports "free".
try:
    plans = get("/api/plan?length=8&order=started,desc")["data"]
except Exception:
    print("unknown")
    sys.exit(0)

# The LIST view omits per-module status entirely (it is null for every
# module, live or not) - the per-plan DETAIL is the only surface that
# carries it. So resolve the newest plan per alias, then read it.
newest_by_alias = {}
for plan in plans:
    a = (plan.get("config") or {}).get("alias")
    if a and a not in newest_by_alias:
        newest_by_alias[a] = plan.get("_id")

plan_id = newest_by_alias.get(alias)
if not plan_id:
    print("free")
    sys.exit(0)

try:
    detail = get(f"/api/plan/{plan_id}")
except Exception:
    print("unknown")
    sys.exit(0)

live = [
    f"{plan_id}:{m.get('testModule')}({str(m.get('status')).upper()})"
    for m in (detail.get("modules") or [])
    if (m.get("status") or "").upper() in ("RUNNING", "WAITING")
]
print("live " + " ".join(live) if live else "free")
PY
)
  case "$verdict" in
    free|unknown) return 0 ;;
    live\ *)
      echo "[conformance-run-all] FATAL: alias '$alias' already has a live module:" >&2
      echo "  ${verdict#live }" >&2
      echo "  Starting another would INTERRUPT it permanently. Wait, or stop it," >&2
      echo "  then re-run." >&2
      exit 1
      ;;
  esac
}

guard_no_local_run

# The battery order: simple to hard security (DESIGN 9a.2) - the plain
# OIDC Core families first (basic/config/dynamic/logout, then the
# response-type families implicit/hybrid/formpost, session management),
# the CIBA channel, the FAPI security profiles, and the credential
# families (OID4VCI issuer + HAIP, OID4VP verifier) at the end.
declare -A FAMILY=(
  [smoke]="cert:sentin8-local:standard"
  [oidc-basic]="cert:sentin8-local:standard"
  [oidc-config]="cert:sentin8-local:standard"
  [oidc-dynamic]="cert:sentin8-local:standard"
  [logout]="cert:sentin8-local:standard"
  [fcl]="cert-fcl:sentin8-fcl:fcl"
  [implicit]="cert-imp:sentin8-imp:standard"
  [hybrid]="cert-hyb:sentin8-hyb:standard"
  [formpost]="cert-fp:sentin8-fp:formpost"
  [sessionmgmt]="cert-sm:sentin8-sm:sm_session"
  [ciba]="cert-ciba:sentin8-ciba:fapi_ciba"
  [fapi1]="cert-fapi1:sentin8-fapi1:fapi_1_advanced"
  [fapi2]="cert-fapi2:sentin8-fapi2:fapi_2"
  [fapi2-signing]="cert-f2m:sentin8-f2m:fapi_2_message_signing"
  [vci-issuer]="cert-vci:sentin8-vci:vci"
  [vci-haip]="cert-haip:sentin8-haip:vci_haip"
  [oid4vp]="cert-vp:sentin8-vp:vp"
  [vci-wallet]="cert-wallet:sentin8-wallet:vci"
  [oid4vp-wallet]="cert-vpw:sentin8-vpw:vp"
)
declare -A SPECS=(
  [smoke]="tests/smoke.spec.ts"
  [oidc-basic]="tests/oidc-basic.spec.ts"
  [oidc-config]="tests/oidc-config.spec.ts"
  [oidc-dynamic]="tests/oidc-dynamic.spec.ts"
  [logout]="tests/logout.spec.ts"
  [fcl]="tests/fcl.spec.ts"
  [implicit]="tests/implicit.spec.ts"
  [hybrid]="tests/hybrid.spec.ts"
  [formpost]="tests/formpost.spec.ts"
  [sessionmgmt]="tests/sessionmgmt.spec.ts"
  [ciba]="tests/ciba.spec.ts"
  [fapi1]="tests/fapi1-advanced.spec.ts"
  [fapi2]="tests/fapi2-security.spec.ts"
  [fapi2-signing]="tests/fapi2-message-signing.spec.ts"
  [vci-issuer]="tests/oid4vci-issuer.spec.ts"
  [vci-haip]="tests/oid4vci-haip.spec.ts"
  [oid4vp]="tests/oid4vp.spec.ts"
  [vci-wallet]="tests/oid4vci-wallet.spec.ts"
  [oid4vp-wallet]="tests/oid4vp-wallet.spec.ts"
)
ORDER=(smoke oidc-basic oidc-config oidc-dynamic logout fcl implicit hybrid formpost sessionmgmt ciba fapi1 fapi2 fapi2-signing vci-issuer vci-haip oid4vp vci-wallet oid4vp-wallet)

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
  # Refuse to start on an alias someone else is already driving (layer
  # 2 of the concurrency guard - a live module here would be INTERRUPTED
  # by us, permanently).
  guard_alias_free "$alias"
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

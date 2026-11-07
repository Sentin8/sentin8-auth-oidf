# SPDX-FileCopyrightText: Copyright Logically Magic Inc. <hello@logicallymagic.com>
# SPDX-FileCopyrightText: Copyright Hamid Jahanzad <Hamid@Jahanzad.com>
# SPDX-License-Identifier: Apache-2.0

# Makefile — sentin8-auth-oidf (OIDF conformance automation, RS §4.5)
#
# The certification campaign's driver: create suite plans, run every
# module, drive the front channel through the ORIGINAL Flutter auth-ui
# (test bridge), enforce no-skip/warning-zero, export logs to results/.
#
# Prerequisites (rig bootstrap, auth DESIGN §9a.2):
#   make -C .. start-conformance  # platform fleet in the rig posture
#                                 # (classical TLS + FAPI ciphers + self-signed
#                                 # client certs - no .env edit needed)
#   make -C .. conformance-up     # suite stack (this target implies the above)
#   make -C .. conformance-seed
#   pnpm install && pnpm run install-browsers (once)
#
# The rig collateral (suite compose, seed script, runbook) lives here in
# conformance/ - moved from the group scripts/ directory .
SHELL := /bin/bash

# The tree root (fixtures/env.ts resolves the same way): the seed
# writes its per-env files under {tree}/.tmp/conformance/.
SENTIN8_REPO_ROOT ?= $(abspath ../..)

.PHONY: help install test oidc-basic oidc-config oidc-dynamic fapi2 fapi1 ciba logout results clean

help: ## Show this help
	@echo "sentin8-auth-oidf (OIDF conformance automation)"
	@grep -E '^[a-z-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: ## pnpm install + browsers
	@pnpm install --frozen-lockfile && pnpm run install-browsers

test: ## Run every profile suite (serial)
	@pnpm run test

# ── Per-family env loading ────────────────────────────────────────────────
# The seed writes the per-env user identity + slug/alias into
# cert-user{,-<slug>}.env (DESIGN §9a.2 item 2); the battery wrapper
# (conformance-run-all.sh) exports it before each family - a DIRECT
# target run must source the SAME file or the harness falls back to a
# wrong-tenant identity.
# FAMILY_ENV = the env slug (cert | cert-ciba | ...); resolve the seed
# file, source it, then hand the slug/alias to playwright.
FAMILY_ENV ?= cert
CERT_USER_FILE = $(if $(filter cert,$(FAMILY_ENV)),cert-user.env,cert-user-$(FAMILY_ENV).env)
CERT_USER_PATH = $(SENTIN8_REPO_ROOT)/.tmp/conformance/$(CERT_USER_FILE)
CERT_USER_SLUG = $(shell [ -f "$(CERT_USER_PATH)" ] && grep -m1 '^CONFORMANCE_ENV_SLUG=' "$(CERT_USER_PATH)" | cut -d= -f2)
CERT_USER_ALIAS = $(shell [ -f "$(CERT_USER_PATH)" ] && grep -m1 '^CONFORMANCE_ALIAS=' "$(CERT_USER_PATH)" | cut -d= -f2)

define with_family_env
	@test -f "$(CERT_USER_PATH)" || { echo 'No $(CERT_USER_FILE) - run the seed first (make conformance-seed-all or CONFORMANCE_ENV_SLUG=$(FAMILY_ENV) make conformance-seed).'; exit 1; }; \
	set -a; . "$(CERT_USER_PATH)"; set +a; \
	CONFORMANCE_ENV_SLUG=$(or $(CERT_USER_SLUG),$(FAMILY_ENV)) \
	CONFORMANCE_ALIAS=$(or $(CERT_USER_ALIAS),$(FAMILY_ENV)) \
	$(1)
endef

oidc-basic: ## OIDC Core Basic OP (35 modules, warning-zero)
	@$(call with_family_env,pnpm run test:basic)

oidc-config: ## OIDC Core Config OP (discovery completeness, warning-zero)
	@$(call with_family_env,pnpm run test:config)

oidc-dynamic: ## OIDC Core Dynamic OP (RFC 7591 DCR cells, warning-zero)
	@$(call with_family_env,pnpm run test:dynamic)

oid4vci-issuer: FAMILY_ENV := cert-vci
oid4vci-issuer: ## OID4VCI 1.0 Issuer plan (wallet role = suite, warning-zero)
	@$(call with_family_env,pnpm run test:oid4vci-issuer)

fapi2: FAMILY_ENV := cert-fapi2
fapi2: ## FAPI 2 Security Profile
	@$(call with_family_env,pnpm run test:fapi2)

fapi1: FAMILY_ENV := cert-fapi1
fapi1: ## FAPI 1 Advanced
	@$(call with_family_env,pnpm run test:fapi1)

ciba: FAMILY_ENV := cert-ciba
ciba: ## FAPI-CIBA poll + ping
	@$(call with_family_env,pnpm run test:ciba)

oid4vci-wallet: FAMILY_ENV := cert-vci
oid4vci-wallet: ## OID4VCI 1.0 Wallet plan
	@$(call with_family_env,pnpm run test:oid4vci-wallet)

oid4vci-haip: FAMILY_ENV := cert-haip
oid4vci-haip: ## OID4VCI 1.0 Issuer HAIP (client attestation)
	@$(call with_family_env,pnpm run test:oid4vci-haip)

implicit: FAMILY_ENV := cert-imp
implicit: ## OIDC Core Implicit OP (2 pinned response_type cells)
	@$(call with_family_env,pnpm run test:implicit)

hybrid: FAMILY_ENV := cert-hyb
hybrid: ## OIDC Core Hybrid OP (3 pinned response_type entries)
	@$(call with_family_env,pnpm run test:hybrid)

formpost: FAMILY_ENV := cert-fp
formpost: ## Form Post OP (the 3-plan form_post profile)
	@$(call with_family_env,pnpm run test:formpost)

sessionmgmt: FAMILY_ENV := cert-sm
sessionmgmt: ## Session + 3rdparty + Back-Channel OP trio
	@$(call with_family_env,pnpm run test:sessionmgmt)

oid4vp: FAMILY_ENV := cert-vp
oid4vp: ## OID4VP verifier (HAIP + plain plans)
	@$(call with_family_env,pnpm run test:oid4vp)

clean: ## Remove exported results + scratch/run dirs (.run .run/logs .tmp)
	@rm -rf results .run .run/logs .tmp

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
# conformance/ - moved from the group scripts/ directory (OC-13).
SHELL := /bin/bash

.PHONY: help install test oidc-basic oidc-config oidc-dynamic fapi2 fapi1 ciba logout results

help: ## Show this help
	@echo "sentin8-auth-oidf (OIDF conformance automation)"
	@grep -E '^[a-z-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: ## pnpm install + browsers
	@pnpm install --frozen-lockfile && pnpm run install-browsers

test: ## Run every profile suite (serial)
	@pnpm run test

oidc-basic: ## OIDC Core Basic OP (35 modules, warning-zero)
	@pnpm run test:basic

oidc-config: ## OIDC Core Config OP (discovery completeness, warning-zero)
	@pnpm run test:config

oidc-dynamic: ## OIDC Core Dynamic OP (RFC 7591 DCR cells, warning-zero)
	@pnpm run test:dynamic

oid4vci-issuer: ## OID4VCI 1.0 Issuer plan (wallet role = suite, warning-zero)
	@pnpm run test:oid4vci-issuer

fapi2: ## FAPI 2 Security Profile
	@pnpm run test:fapi2

fapi1: ## FAPI 1 Advanced
	@pnpm run test:fapi1

ciba: ## FAPI-CIBA poll + ping
	@pnpm run test:ciba

results: ## Show the latest results JSON
	@cat results/oidf-results.json 2>/dev/null | head -50
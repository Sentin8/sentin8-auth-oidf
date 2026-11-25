# Sentin8 — OIDF Certification Record

The authoritative record of Sentin8's OpenID Foundation certification status:
what is **certified**, what is **open**, and what closing each open bucket
actually costs.

Supersedes the three working files that used to live at the tree root
(`done.md`, `not-done.md`, `rp-and-jurisdiction-plan.md`); they are combined
here so there is one place to read and one place to update.

- **Harness** — the runs behind this record are driven by this repo
  (`sentin8-auth-oidf`). See `README.md` for the campaign rules
  (no-skip, warning-zero, honest evidence).
- **Evidence rule** — every certified cell carries two published artifacts:
  the **signed result zip** and the **suite plan-detail view**. Nothing here
  is a self-declared claim. A cell showing `(1/3)`, `(2/3)`, `(3/3)` is a
  **multi-plan cell**: the suite certifies each variant slice as its own
  plan, so one catalog cell can publish several artifacts and therefore
  several rows.

## Status at a glance

| Bucket | What it is | Total cells | Certified | **Open** |
|---|---|---|---|---|
| **OP** | OpenID Provider / issuer / verifier (server-side, non-jurisdiction) | 50 | 45 | **5** |
| **JOP** | Jurisdiction OP overlays (UK, AU, BR, KSA, CBUAE, ConnectID, superseded) | 50 | 0 | **50** |
| **RP** | Relying Party role (all RP pages) | 72 | 0 | **72** |
| | **TOTAL** | **172** | **45** | **127** |

Two implementations are published:

- **`Sentin8 v1.0`** — the OpenID Provider (OP) and FAPI profiles served by
  `Sentin8:Auth`.
- **`Wallet8 1.0`** — the OpenID4VC wallet and issuer roles served by
  `Wallet8`.

**Read the numbers this way:** only **5** of the 127 open cells are gaps in
the code we already ship. The other **122** are two separate programmes —
jurisdiction overlays (50) and the RP role (72) — both of which are product
decisions before they are engineering work (§4).

The mark is used under
[Section 3(d) of the OpenID Certification Terms and Conditions](https://openid.net/wordpress-content/uploads/2015/03/OpenID-Certification-Terms-and-Conditions.pdf);
mark usage is described on the Foundation's
[About the OpenID Certified Mark](https://openid.net/certification/mark/) page.

---

# Part 1 — Certified cells

Published on the OpenID Foundation's
[All Certified Implementations](https://openid.net/certification/all-certified-implementations/)
catalog.

## 1. OpenID Providers & Profiles — 7 / 7

Core OpenID Connect provider profiles: Basic, Implicit, Hybrid, Config, Dynamic,
Form Post (all three plans), and Third-Party-Initiated login.

Catalog page: [https://openid.net/certification/certified-openid-providers-profiles/](https://openid.net/certification/certified-openid-providers-profiles/)

| Profile cell | Certified | Evidence |
|---|---|---|
| Basic OP | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-1jwplvnlmtojd-oidcc-basic-certification-test-plan-discovery-static-client-1jwplvnlmtojd-21-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=1JWplVnLmtOJd&public=true) |
| Implicit OP | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-qlbjpqdigegie-oidcc-implicit-certification-test-plan-discovery-static-client-qlbjpqdigegie-21-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=QLBJpQdIgegIe&public=true) |
| Hybrid OP | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-7wbdsxvdkgma0-oidcc-hybrid-certification-test-plan-discovery-static-client-7wbdsxvdkgma0-21-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=7wbdSXvDKGmA0&public=true) |
| Config OP | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-fjkh1oawthfrz-oidcc-config-certification-test-plan-fjkh1oawthfrz-21-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=fjKH1oaWThfRz&public=true) |
| Dynamic OP | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-v20p5gwirelfz-oidcc-dynamic-certification-test-plan-code-v20p5gwirelfz-21-nov-2026-1.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=v20p5GWIRElFz&public=true) |
| Form Post OP (1/3) | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-7npqsckbbws1n-oidcc-formpost-basic-certification-test-plan-discovery-static-client-7npqsckbbws1n-21-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=7NpQsCKbbws1N&public=true) |
| Form Post OP (2/3) | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-mrqzmhkginbmi-oidcc-formpost-implicit-certification-test-plan-discovery-static-client-mrqzmhkginbmi-21-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=WIdvxlbSCUEkL&public=true) |
| Form Post OP (3/3) | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-7npqsckbbws1n-oidcc-formpost-basic-certification-test-plan-discovery-static-client-7npqsckbbws1n-21-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=7NpQsCKbbws1N&public=true) |
| 3rd Party-Init OP | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-dvklaxkds0zjd-oidcc-3rdparty-init-login-certification-test-plan-code-dvklaxkds0zjd-21-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=DvklAXkDs0ZJD&public=true) |

## 2. OpenID Providers for Logout Profiles — 4 / 4

OpenID Provider logout profiles: RP-Initiated (both plans), Session Management,
Front-Channel, and Back-Channel logout.

Catalog page: [https://openid.net/certification/certified-openid-providers-for-logout-profiles/](https://openid.net/certification/certified-openid-providers-for-logout-profiles/)

| Profile cell | Certified | Evidence |
|---|---|---|
| RP-Initiated OP (1/2) | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-wc9ki9zdukdua-oidcc-rp-initiated-logout-certification-test-plan-id-token-static-client-wc9ki9zdukdua-21-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=WC9KI9ZDUkdUA&public=true) |
| RP-Initiated OP (2/2) | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-gck1yiyhjblmm-oidcc-rp-initiated-logout-certification-test-plan-code-static-client-gck1yiyhjblmm-21-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=Gck1YiyHJBlmM&public=true) |
| Session OP | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-bipatb1d4skup-oidcc-session-management-certification-test-plan-code-static-client-bipatb1d4skup-21-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=BIPaTb1d4SKup&public=true) |
| Front-Channel OP | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-lsotviuldkcbe-oidcc-frontchannel-rp-initiated-logout-certification-test-plan-code-static-client-lsotviuldkcbe-21-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=LsOtvIULDkcbE&public=true) |
| Back-Channel OP | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-nep6dskig87jv-oidcc-backchannel-rp-initiated-logout-certification-test-plan-code-dynamic-client-nep6dskig87jv-21-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=NeP6dsKig87jV&public=true) |

## 3. FAPI1-Advanced OpenID Providers & Profiles — 8 / 8

Financial-grade API 1.0 Advanced OP profiles - mTLS and private-key JWT client
authentication crossed with PAR and JARM response modes.

Catalog page: [https://openid.net/certification/certified-fapi1-adv-openid-providers-profiles/](https://openid.net/certification/certified-fapi1-adv-openid-providers-profiles/)

| Profile cell | Certified | Evidence |
|---|---|---|
| FAPI Adv. OP w/ MTLS | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-8v5mvyj4tgqgg-fapi1-advanced-final-test-plan-mtls-by_value-plain_fapi-plain_response-8v5mvyj4tgqgg-22-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?public=true&plan=8V5mvyj4tgQGG) |
| FAPI Adv. OP w/ MTLS, PAR | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-xxk2x7bciuvhv-fapi1-advanced-final-test-plan-mtls-pushed-plain-fapi-plain-response-xxk2x7bciuvhv-21-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=xXK2X7BCIUVhV&public=true) |
| FAPI Adv. OP w/ Private Key | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-nf6lhttbjufux-fapi1-advanced-final-test-plan-private-key-jwt-by-value-plain-fapi-plain-response-nf6lhttbjufux-21-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=Nf6lhttBjufux&public=true) |
| FAPI Adv. OP w/ Private Key, PAR | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-vxprneqojy1fk-fapi1-advanced-final-test-plan-private-key-jwt-pushed-plain-fapi-plain-response-vxprneqojy1fk-21-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=VXPRNEqoJY1fk&public=true) |
| FAPI Adv. OP w/ MTLS, JARM | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-rl6koub3mohk3-fapi1-advanced-final-test-plan-mtls-by_value-plain_fapi-jarm-rl6koub3mohk3-22-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?public=true&plan=rL6KOuB3mOHK3) |
| FAPI Adv. OP w/ Private Key, JARM | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-s3uqieereurug-fapi1-advanced-final-test-plan-private-key-jwt-by-value-plain-fapi-jarm-s3uqieereurug-21-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=s3UQIEereurUG&public=true) |
| FAPI Adv. OP w/ MTLS, PAR, JARM | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-9g4rv02d7bdlm-fapi1-advanced-final-test-plan-mtls-pushed-plain-fapi-jarm-9g4rv02d7bdlm-21-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=9g4RV02D7bdLm&public=true) |
| FAPI Adv. OP w/ Private Key, PAR, JARM | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-uqakg5j7oovyl-fapi1-advanced-final-test-plan-private-key-jwt-pushed-plain-fapi-jarm-uqakg5j7oovyl-21-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=UQakG5j7OOVyL&public=true) |

## 4. FAPI CIBA OpenID Providers & Profiles — 4 / 4

Client-Initiated Backchannel Authentication: poll and ping modes over mTLS and
private-key JWT.

Catalog page: [https://openid.net/certification/certified-fapi-ciba-openid-providers-profiles/](https://openid.net/certification/certified-fapi-ciba-openid-providers-profiles/)

| Profile cell | Certified | Evidence |
|---|---|---|
| FAPI-CIBA OP Poll w/ MTLS | 22-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-xmn0uzugeixcl-fapi-ciba-id1-test-plan-mtls-poll-plain-fapi-static-client-xmn0uzugeixcl-22-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=XMN0uZUgEIXcl&public=true) |
| FAPI-CIBA OP Poll w/ Private Key | 22-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-gczegbywqa5yc-fapi-ciba-id1-test-plan-private-key-jwt-poll-plain-fapi-static-client-gczegbywqa5yc-22-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=gCZEGbYWqA5YC&public=true) |
| FAPI-CIBA OP Ping w/ MTLS | 22-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-krbr9ohu9mtvj-fapi-ciba-id1-test-plan-mtls-ping-plain-fapi-static-client-krbr9ohu9mtvj-22-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=kRbR9oHU9mtVJ&public=true) |
| FAPI-CIBA OP Ping w/ Private Key | 22-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-gpmjuqklvrosi-fapi-ciba-id1-test-plan-private-key-jwt-ping-plain-fapi-static-client-gpmjuqklvrosi-22-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=GPmJUQKLVrOsI&public=true) |

## 5. FAPI 2.0 Provider Security Profile Final + Message Signing Final — 7 / 11

The current financial-grade generation: the FAPI 2.0 Security Profile and the
FAPI 2.0 Message Signing (JAR/JARM) OP profiles.

Catalog page: [https://openid.net/certification/certified-fapi-2-0-op-security-profile-final-message-signing-final/](https://openid.net/certification/certified-fapi-2-0-op-security-profile-final-message-signing-final/)

### 5a. Security Profile / Message Signing table (7 / 7)

| Profile cell | Certified | Evidence |
|---|---|---|
| FAPI2SP OP MTLS + MTLS (1/2) | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-qn0vtfevksdkj-fapi2-security-profile-final-test-plan-mtls-mtls-simple-openid-connect-disabled-plain-fapi-qn0vtfevksdkj-22-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=qN0vTFEvKSDkj&public=true) |
| FAPI2SP OP MTLS + MTLS (2/2) | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-hngolfkfknrop-fapi2-security-profile-final-test-plan-mtls-mtls-simple-plain-oauth-disabled-plain-fapi-hngolfkfknrop-22-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=hnGolFkFkNrOp&public=true) |
| FAPI2SP OP MTLS + DPoP | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-9mdpq3tj0maab-fapi2-message-signing-final-test-plan-mtls-dpop-simple-openid-connect-signed-non-repudiation-disabled-plain-fapi-jarm-9mdpq3tj0maab-22-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=9MdpQ3tj0maaB&public=true) |
| FAPI2SP OP private key + MTLS | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-wrzc0nr9a8aga-fapi2-security-profile-final-test-plan-private-key-jwt-mtls-simple-openid-connect-disabled-plain-fapi-wrzc0nr9a8aga-22-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=wRzc0NR9a8Aga&public=true) |
| FAPI2SP OP private key + DPoP (1/2) | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-hm0urxezes10r-fapi2-security-profile-final-test-plan-private-key-jwt-dpop-simple-plain-oauth-disabled-plain-fapi-hm0urxezes10r-22-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=hM0URXezEs10R&public=true) |
| FAPI2SP OP private key + DPoP (2/2) | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-bgcwiwlpqkmxo-fapi2-security-profile-final-test-plan-private-key-jwt-dpop-simple-openid-connect-disabled-plain-fapi-bgcwiwlpqkmxo-22-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=bGcwIwLPQKmXo&public=true) |
| FAPI2SP OP OpenID Connect (1/4) | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-qn0vtfevksdkj-fapi2-security-profile-final-test-plan-mtls-mtls-simple-openid-connect-disabled-plain-fapi-qn0vtfevksdkj-22-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=qN0vTFEvKSDkj&public=true) |
| FAPI2SP OP OpenID Connect (2/4) | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-wrzc0nr9a8aga-fapi2-security-profile-final-test-plan-private-key-jwt-mtls-simple-openid-connect-disabled-plain-fapi-wrzc0nr9a8aga-22-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=wRzc0NR9a8Aga&public=true) |
| FAPI2SP OP OpenID Connect (3/4) | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-pqgehgbm2dem8-fapi2-security-profile-final-test-plan-mtls-dpop-simple-openid-connect-disabled-plain-fapi-pqgehgbm2dem8-22-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=pqGEHGbM2dEM8&public=true) |
| FAPI2SP OP OpenID Connect (4/4) | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-bgcwiwlpqkmxo-fapi2-security-profile-final-test-plan-private-key-jwt-dpop-simple-openid-connect-disabled-plain-fapi-bgcwiwlpqkmxo-22-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=bGcwIwLPQKmXo&public=true) |
| FAPI2MS OP JAR (1/6) | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-8bjnxhxbxsgcs-fapi2-message-signing-final-test-plan-private-key-jwt-dpop-simple-openid-connect-signed-non-repudiation-disabled-plain-fapi-jarm-8bjnxhxbxsgcs-22-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=8bJnxhXbxsgCS&public=true) |
| FAPI2MS OP JAR (2/6) | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-wgexpe9axwhpc-fapi2-message-signing-final-test-plan-private-key-jwt-mtls-simple-openid-connect-signed-non-repudiation-disabled-plain-fapi-jarm-wgexpe9axwhpc-22-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=WGexPE9AxWhpc&public=true) |
| FAPI2MS OP JAR (3/6) | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-jrksky240tjbw-fapi2-message-signing-final-test-plan-mtls-mtls-simple-openid-connect-signed-non-repudiation-disabled-plain-fapi-jarm-jrksky240tjbw-22-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=jrKSky240tJbw&public=true) |
| FAPI2MS OP JAR (4/6) | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-twzgda18ja9wk-fapi2-message-signing-final-test-plan-mtls-mtls-simple-plain-oauth-signed-non-repudiation-disabled-plain-fapi-jarm-twzgda18ja9wk-22-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=tWzGdA18JA9wk&public=true) |
| FAPI2MS OP JAR (5/6) | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-9mdpq3tj0maab-fapi2-message-signing-final-test-plan-mtls-dpop-simple-openid-connect-signed-non-repudiation-disabled-plain-fapi-jarm-9mdpq3tj0maab-22-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=9MdpQ3tj0maaB&public=true) |
| FAPI2MS OP JAR (6/6) | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-rbiepuulmdsjl-fapi2-message-signing-final-test-plan-private-key-jwt-dpop-simple-plain-oauth-signed-non-repudiation-disabled-plain-fapi-jarm-rbiepuulmdsjl-22-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=rbiepUUlMdsjl&public=true) |
| FAPI2MS OP JARM (1/6) | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-8bjnxhxbxsgcs-fapi2-message-signing-final-test-plan-private-key-jwt-dpop-simple-openid-connect-signed-non-repudiation-disabled-plain-fapi-jarm-8bjnxhxbxsgcs-22-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=8bJnxhXbxsgCS&public=true) |
| FAPI2MS OP JARM (2/6) | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-wgexpe9axwhpc-fapi2-message-signing-final-test-plan-private-key-jwt-mtls-simple-openid-connect-signed-non-repudiation-disabled-plain-fapi-jarm-wgexpe9axwhpc-22-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=WGexPE9AxWhpc&public=true) |
| FAPI2MS OP JARM (3/6) | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-jrksky240tjbw-fapi2-message-signing-final-test-plan-mtls-mtls-simple-openid-connect-signed-non-repudiation-disabled-plain-fapi-jarm-jrksky240tjbw-22-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=jrKSky240tJbw&public=true) |
| FAPI2MS OP JARM (4/6) | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-twzgda18ja9wk-fapi2-message-signing-final-test-plan-mtls-mtls-simple-plain-oauth-signed-non-repudiation-disabled-plain-fapi-jarm-twzgda18ja9wk-22-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=tWzGdA18JA9wk&public=true) |
| FAPI2MS OP JARM (5/6) | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-9mdpq3tj0maab-fapi2-message-signing-final-test-plan-mtls-dpop-simple-openid-connect-signed-non-repudiation-disabled-plain-fapi-jarm-9mdpq3tj0maab-22-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=9MdpQ3tj0maaB&public=true) |
| FAPI2MS OP JARM (6/6) | 21-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-rbiepuulmdsjl-fapi2-message-signing-final-test-plan-private-key-jwt-dpop-simple-plain-oauth-signed-non-repudiation-disabled-plain-fapi-jarm-rbiepuulmdsjl-22-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=rbiepUUlMdsjl&public=true) |

## 6. OpenID4VP 1.0 + HAIP 1.0 — 6 / 6

OpenID for Verifiable Presentations with the High Assurance Interoperability
Profile - wallet and verifier roles.

Catalog page: [https://openid.net/certification/certified-oid4vp-haip-final/](https://openid.net/certification/certified-oid4vp-haip-final/)

### 6a. VP Wallet (4 / 4)

| Profile cell | Certified | Evidence |
|---|---|---|
| OID4VP-1.0+HAIP-1.0 Wallet sd_jwt_vc direct_post.jwt | 23-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-cvthvuqjgayir-oid4vp-1final-wallet-haip-test-plan-eudi-pid-sd-jwt-vc-direct-post.jwt-cvthvuqjgayir-23-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=CvthvUqjgAyir&public=true) |
| OID4VP-1.0+HAIP-1.0 Wallet sd_jwt_vc dc_api.jwt | 23-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-ntmzrzqu5uqqz-oid4vp-1final-wallet-haip-test-plan-eudi-pid-sd-jwt-vc-dc-api.jwt-ntmzrzqu5uqqz-23-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=NTmZRZQU5UQQZ&public=true) |
| OID4VP-1.0+HAIP-1.0 Wallet iso_mdl direct_post.jwt | 23-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-divz7z90gmdcj-oid4vp-1final-wallet-haip-test-plan-eudi-pid-iso-mdl-direct-post.jwt-divz7z90gmdcj-23-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=divZ7z90GMDcj&public=true) |
| OID4VP-1.0+HAIP-1.0 Wallet iso_mdl dc_api.jwt | 23-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-2kbfbqdfzirgw-oid4vp-1final-wallet-haip-test-plan-eudi-pid-iso-mdl-dc-api.jwt-2kbfbqdfzirgw-23-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=2KBFbQDfZiRGw&public=true) |

### 6b. VP Verifier (2 / 2)

| Profile cell | Certified | Evidence |
|---|---|---|
| OID4VP-1.0+HAIP-1.0 Verifier sd_jwt_vc direct_post.jwt | 23-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-3p1iuknqqwpjq-oid4vp-1final-verifier-haip-test-plan-sd-jwt-vc-direct-post.jwt-3p1iuknqqwpjq-23-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=3P1IUknqqwPJq&public=true) |
| OID4VP-1.0+HAIP-1.0 Verifier iso_mdl direct_post.jwt | 23-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-wkw3mzujidsao-oid4vp-1final-verifier-haip-test-plan-iso-mdl-direct-post.jwt-wkw3mzujidsao-23-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=wkw3mZuJidSao&public=true) |

## 7. OpenID4VCI 1.0 + HAIP 1.0 — 9 / 10

OpenID for Verifiable Credential Issuance with the High Assurance
Interoperability Profile - wallet and issuer roles, SD-JWT VC and mdoc formats.

Catalog page: [https://openid.net/certification/certified-oid4vci-haip-final/](https://openid.net/certification/certified-oid4vci-haip-final/)

### 7a. VCI Wallet SD_JWT_VC (3 / 3)

| Profile cell | Certified | Evidence |
|---|---|---|
| OID4VCI-1.0+HAIP-1.0 Wallet sd_jwt_vc wallet_initiated | 22-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-76xclayzzuzre-oid4vci-1_0-wallet-haip-test-plan-sd_jwt_vc-wallet_initiated-disabled-by_value-76xclayzzuzre-23-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?public=true&plan=76XcLAyZZuZRE) |
| OID4VCI-1.0+HAIP-1.0 Wallet sd_jwt_vc issuer_initiated by_value | 22-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-3xx2bdkboeswr-oid4vci-1_0-wallet-haip-test-plan-sd_jwt_vc-issuer_initiated-disabled-by_value-3xx2bdkboeswr-23-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?public=true&plan=3XX2bdkboeSWr) |
| OID4VCI-1.0+HAIP-1.0 Wallet sd_jwt_vc issuer_initiated by_reference | 22-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-mamnajbpemkoc-oid4vci-1_0-wallet-haip-test-plan-sd_jwt_vc-issuer_initiated-disabled-by_reference-mamnajbpemkoc-23-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?public=true&plan=mamnAJbpeMKoc) |

### 7b. VCI Wallet mDoc (3 / 3)

| Profile cell | Certified | Evidence |
|---|---|---|
| OID4VCI-1.0+HAIP-1.0 Wallet mdoc wallet_initiated | 22-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-vjsjgmchcwi6o-oid4vci-1_0-wallet-haip-test-plan-mdoc-wallet_initiated-disabled-by_value-vjsjgmchcwi6o-23-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?public=true&plan=vJSJgMchcWI6O) |
| OID4VCI-1.0+HAIP-1.0 Wallet mdoc issuer_initiated by_value | 22-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-o8iefridnokj6-oid4vci-1_0-wallet-haip-test-plan-mdoc-issuer_initiated-disabled-by_value-o8iefridnokj6-23-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?public=true&plan=o8IeFRIdnOKJ6) |
| OID4VCI-1.0+HAIP-1.0 Wallet mdoc issuer_initiated by_reference | 22-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-ttdg1i9iessbq-oid4vci-1_0-wallet-haip-test-plan-mdoc-issuer_initiated-disabled-by_reference-ttdg1i9iessbq-23-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?public=true&plan=Ttdg1i9ieSsbQ) |

### 7c. VCI Issuer (3 / 4)

| Profile cell | Certified | Evidence |
|---|---|---|
| OID4VCI-1.0+HAIP-1.0 Issuer sd_jwt_vc issuer_initiated | 22-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-bjqnbxe1hbhsp-oid4vci-1-0-issuer-haip-test-plan-sd-jwt-vc-issuer-initiated-disabled-bjqnbxe1hbhsp-23-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=bJqNBXE1hBhsp&public=true) |
| OID4VCI-1.0+HAIP-1.0 Issuer sd_jwt_vc wallet_initiated | 22-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-18poexsrwypop-oid4vci-1-0-issuer-haip-test-plan-sd-jwt-vc-wallet-initiated-disabled-18poexsrwypop-23-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=18PoEXsRwyPOP&public=true) |
| OID4VCI-1.0+HAIP-1.0 Issuer mdoc wallet_initiated | 22-Nov-2026 | [signed result](https://openid.net/wp-content/uploads/2026/11/signed-bso4lvtlemeyq-oid4vci-1-0-issuer-haip-test-plan-mdoc-wallet-initiated-disabled-bso4lvtlemeyq-23-nov-2026.zip) · [plan view](https://www.certification.openid.net/plan-detail.html?plan=bsO4lvtLemeYQ&public=true) |

---

# Part 2 — The 5 open OP cells (real platform work, small)

These are the only open cells on pages we otherwise pass: four are one
DPoP-binding fix plus one new spec, and the fifth is a filing we never made.

## FAPI2 OP SP+MS Final — 4 open of 11

Catalog page: [https://openid.net/certification/certified-fapi-2-0-op-security-profile-final-message-signing-final/](https://openid.net/certification/certified-fapi-2-0-op-security-profile-final-message-signing-final/)

| Open cell | Status |
|---|---|
| FAPI2SP OP Client Credentials MTLS + MTLS | **Open** |
| FAPI2SP OP Client Credentials MTLS + DPoP | **Open** |
| FAPI2SP OP Client Credentials private key + MTLS | **Open** |
| FAPI2SP OP Client Credentials private key + DPoP | **Open** |

## OID4VCI+HAIP — 1 open of 10

Catalog page: [https://openid.net/certification/certified-oid4vci-haip-final/](https://openid.net/certification/certified-oid4vci-haip-final/)

| Open cell | Status |
|---|---|
| OID4VCI-1.0+HAIP-1.0 Issuer mdoc issuer_initiated | **Open** |

### Gap 1 — FAPI2 OP Client Credentials (4 cells) → story `OIDF-CCGRANT-1`

The suite plan is one we already drive
(`fapi2-security-profile-final-test-plan`), selected by the variant
`fapi_profile=fapi_client_credentials_grant`.

**Already works:** the grant itself (`handle_client_credentials` in
`sentin8-auth/src/oauth.rs`), the discovery advertisement, the profile gate,
`refresh_token` omission, mTLS `cnf` binding.

**The defect:** `handle_client_credentials` hardcodes `token_type: "Bearer"`
and discards the `jkt` from `validate_and_verify_dpop`. So the two **DPoP**
cells fail. The fix is the pattern already used 200 lines away in the
auth-code path (`if dpop_jkt.is_some() { "DPoP" } else { "Bearer" }`) plus
stamping `cnf.jkt`.

**Work:** endpoint fix (~S) + `tests/fapi2-client-credentials.spec.ts` +
seeded clients + Makefile/package.json wiring. **Size: S–M.**

### Gap 2 — VCI Issuer mdoc `issuer_initiated` (1 cell) → no code

`tests/oid4vci-haip.spec.ts` already loops `FORMAT_CELLS × FLOW_CELLS`, so
this plan runs locally. It was simply **never filed** — the published row
carries exactly three issuer zips, and this is the fourth. **Size: S**
(re-verify the cell, then submit).

---

# Part 3 — The 50 jurisdiction OP cells

Every one of these pages has a Sentin8 row with all cells blank: we have
never run any of them. Grouped by what closing them actually costs.

All **14 jurisdiction OP catalog pages**, enumerated cell by cell:

| # | Page | Open cells |
|---|---|---|
| 1 | FAPI1 OP — UK Open Banking | 2 |
| 2 | FAPI1 OP — Australia CDR | 3 |
| 3 | FAPI1 OP — Brazil Open Banking | 9 |
| 4 | FAPI1 OP — Brazil Open Finance (FAPI-BR v2) | 2 |
| 5 | FAPI1 OP — Brazil Open Insurance | 9 |
| 6 | FAPI1 OP — Brazil Open Insurance (FAPI-BR v2) | 2 |
| 7 | FAPI1 OP — KSA Open Banking | 2 |
| 8 | FAPI1 OP — Second Implementer's Draft (incl. UK-OB) | 8 |
| 9 | FAPI2 OP — KSA Open Banking | 2 |
| 10 | CBUAE FAPI 2.0 OP Message Signing | 1 |
| 11 | CBUAE FAPI 2.0 OP Message Signing ID1 | 1 |
| 12 | Australia FAPI 2.0 OP ConnectID Final | 1 |
| 13 | Australia FAPI 2.0 OP ConnectID ID draft | 1 |
| 14 | FAPI 2.0 OP SP 2nd ID + MS 1st ID (superseded) | 7 |
| | **Total** | **50** |

## 3.1 What each group actually requires

These are **not** plan re-runs. Reading
`FAPI1AdvancedFinalClientTestPlan.certificationProfileName()` and
`FAPI2SPFinalTestPlan.certificationProfileName()` shows each jurisdiction
profile adds *protocol surface*, not just config:

| Group | New platform surface required | Verdict |
|---|---|---|
| **Superseded FAPI2 OP ID2 (7)** | Nothing — we hold the **Final** versions | **Do not pursue** — close as superseded |
| **CBUAE (2), ConnectID AU (2), FAPI2 KSA (2), FAPI1 KSA (2)** | The suite *rejects* these on the FAPI2 SP plan (`throw ... "requires JAR, please use the message signing test plan"`), so they run on the **Message Signing** plan we already pass. KSA/ConnectID need `purpose` claims, ConnectID trust-framework `verified_claims`, forced `openid`-only scope, KSA consent/`acr` profile | **Feasible, low value** — 8 cells, each a distinct claim/consent model |
| **Australia CDR (3 OP)** | CDR register integration, `cdr_arrangement_id` grant management (merge/replace/revoke), sharing-duration rules, the 90-day re-authorisation rule | **Real product work**, ~1–2 weeks of OP surface |
| **UK Open Banking (2 OP)** | An `intent_id` obtained via a *client_credentials* call to the AS, then passed as an essential claim in the request object; ecosystem `acr` values | **Real product work** — needs the CC grant (Gap 1) first, plus intent lifecycle |
| **Brazil (22 OP)** | Directory **software statements**, `org_jwks`, consent-scoped `authorization_details`, `consentUrl` flow, `brazilCpf`/`brazilCnpj` claims, DCR variant with signed software statements | **Heaviest** — 22 cells, ~4–6 weeks |
| **FAPI1 second-ID draft (8)** | Superseded draft + a mix of UK-OB/AU-CDR/FAPI-RW behaviours | **Do not pursue** — superseded |

**Summary:** 15 superseded (7 FAPI2-ID2 + 8 FAPI1-ID2), 8 low-value
jurisdiction claims, 25 real product work (UK 2, AU-CDR 3, Brazil 22).

## 3.2 Sizing

| Option | Cells closed | Effort | Recommendation |
|---|---|---|---|
| **C-lite** — the 8 low-value claims (CBUAE 2, ConnectID 2, KSA 4) + close the 15 superseded | 8 (+15 closed) | **M**, ~1.5 wk | Only if a UAE/KSA/AU market is real |
| **C-uk** — C-lite + UK-OB OP | 10 (+15) | **L**, ~3–4 wk | Cheapest *useful* market (needs Gap 1 first) |
| **C-au** — C-lite + AU-CDR OP | 11 (+15) | **L**, ~3–4 wk | Needs CDR register + arrangement grants |
| **C-br** — C-lite + Brazil OP | 30 (+15) | **XL**, ~6–8 wk | Only if Brazil Open Finance/Insurance is a target market |
| **C-max** — all 50 | 50 | **XL**, ~8–10 wk | Includes the 15 superseded cells — **not recommended** |

**Recommendation: do not start bucket C.** Every group except the 15
superseded cells is market-driven, and Brazil/UK/CDR are separate product
programmes (directory onboarding, regulator certification, consent
lifecycle) — not conformance chores. Revisit per market.

---

# Part 4 — The 72 RP cells

We have never certified an RP. All 17 RP catalog pages have blank cells.

## 4.1 Are we an RP? Yes — but not a certifiable one

We already ship RP code in three places. The gap is not capability, it is
*certifiability*: none of it is packaged as a conformant, testable RP
endpoint.

| Component | Path | What it is | RP-conformance readiness |
|---|---|---|---|
| **`sentin8-auth-client`** | `sentin8-sdk/identity/auth-client/src/lib.rs` (1,785 lines) | Generic OIDC/OAuth client: discovery, `authorize_url` with PKCE-S256, `exchange_code`, `refresh_token`, `revoke_token`, `introspect_token`, `verify_token` (JWKS-backed), `user_info` | **Partial** — no `nonce` on authorize, no `at_hash`/`c_hash`/`s_hash` validation, no `iss` validation, no id_token decryption, no logout. `verify_token` checks signature + `exp` only |
| **`sentin8-sdk-identity-fapi`** | `sentin8-sdk/identity/fapi/src/` (1,985 lines, 8 files) | Full FAPI RP stack: PAR push, JAR request objects, DPoP proofs with nonce, JARM validation, mTLS aliases, `private_key_jwt` client assertions, discovery, JWKS cache | **Strong — closest to certifiable.** This is the crate the FAPI RP cells would certify |
| **`sentin8-bff`** | `sentin8-bff/src/handlers.rs` | Production RP: `/auth/login` → authorize with PKCE + state cookie, `/auth/callback` → `exchange_code` | **Works, not conformant** — an app surface, not a test harness |
| `wallet8` / `wallet8-sdk` | separate vertical repo | OID4VP/OID4VCI **wallet** role (already certified) | n/a — wallet role ≠ RP role |

## 4.2 The structural inversion that drives all the sizing

**In every campaign shipped to date, the suite is the CLIENT and we are the
SERVER.** The suite drives browser URLs and our harness drives the browser.
OPs, issuers, verifiers: all server-side.

**In an RP campaign the roles invert: the suite becomes the OP/AS**, and our
code becomes the *client under test*:

> "When you are testing a relying party, you configure it to use the
> conformance suite as the identity provider... The conformance suite
> essentially provides a 'fake' OpenID Provider / OAuth2 Authorization
> Server. When you start a test, you will see the 'issuer' and
> 'discoveryUrl' in the 'exported values' section. The test will show as
> 'WAITING' status and in most cases the next step is to start the login
> flow in your relying party."

Confirmed in `AbstractOIDCCClientTest.java`: `start()` sets
`Status.WAITING` and waits for **the RP to call it**; `handleHttp(path, ...)`
routes `authorize`, `token`, `jwks`, `userinfo`, `webfinger`.

### Consequences

1. **The harness needs a new driver mode.** Today `fixtures/runner.ts`
   polls WAITING → drives a browser → reads our server's log. RP tests need
   WAITING → **run an RP client against the suite's `issuer`** → the suite
   advances on *its own* inbound requests. This is a new fixture, not a tweak.
2. **The RP under test must be reachable by the suite** over HTTPS, on a
   stable host, with a registered `redirect_uri`.
3. **The RP must be a headless HTTP service**, not a Flutter UI — the
   suite's "browser" step is just "some user-agent hits the RP's login URL".
   A JSON/redirect HTTP endpoint suffices; no new Flutter work.
4. **Test isolation.** RP tests mutate RP state (tokens, sessions). Each
   module needs a clean RP, so the RP needs a reset/stateless mode.

## 4.3 Composition (verified plan names)

| Page | Cells | Suite plan name(s) |
|---|---|---|
| OIDC RP — Basic | 1 | `oidcc-client-basic-certification-test-plan` |
| OIDC RP — Config | 1 | `oidcc-client-config-certification-test-plan` |
| OIDC RP — Dynamic | 1 | `oidcc-client-dynamic-certification-test-plan` |
| OIDC RP — Implicit | 1 | `oidcc-client-implicit-certification-test-plan` |
| OIDC RP — Hybrid | 1 | `oidcc-client-hybrid-certification-test-plan` |
| OIDC RP — Form Post (basic/implicit/hybrid) | 1 | `oidcc-client-formpost-{basic,implicit,hybrid}-certification-test-plan` |
| OIDC RP — 3rd Party-Init | 1 | `oidcc-client-test-3rd-party-init-login-test-plan` |
| OIDC RP Logout — RP-Initiated / Session / Front-Channel / Back-Channel | 4 | `OIDCCClient{RPInitiatedLogout,SessionManagement,FrontChannelLogout,BackChannelLogout}RP{Basic,Hybrid,Implicit}TestPlan` |
| FAPI1-Adv RP | 12 | `fapi1-advanced-final-client-test-plan` |
| FAPI2 RP SP+MS Final | 7 | `fapi2-security-profile-final-client-test-plan`, `fapi2-message-signing-final-client-test-plan` |
| **Superseded** FAPI2 RP ID2+MS ID1 | 16 | `fapi2-*-id{2,1}-client-test-plan` |
| FAPI-CIBA RP (BR-OF) | 1 | Brazil-specific |
| Jurisdiction RP (BR-OB 8, BR-OF 2, BR-OPIN 4+1, KSA 2, FAPI1-ID2 2, FAPI2-KSA 2, CBUAE 2, ConnectID 2) | 25 | mixed |

**Non-superseded, non-jurisdiction RP cells: 31**
(7 OIDC + 4 OIDC-logout + 12 FAPI1-Adv + 7 FAPI2 + 1 CIBA).

## 4.4 The one architectural prerequisite

A **certifiable RP harness**: a headless HTTPS RP service that

- boots from a config (issuer/discovery URL, client_id/secret or JWKS, redirect_uri)
- serves `/login` → builds the authorize request (PKCE, nonce, state, `response_type` per profile)
- serves `/callback` → validates the response, exchanges the code, **validates the id_token fully**
- serves `/logout`, `/post-logout`, and the front/back-channel logout receivers
- serves a JWKS endpoint when it registers `jwks_uri`
- can be driven for every negative case the suite injects

This is one new crate plus one new fixture, and it is **shared by all 31
non-jurisdiction RP cells** — that is the leverage.

## 4.5 Gap analysis vs. what we own

| Requirement | Today | Work |
|---|---|---|
| Discovery-driven authorize + PKCE | ✅ `auth-client`, `fapi` | reuse |
| `nonce` on authorize | ❌ `auth-client`; ✅ FAPI path | small |
| `at_hash` / `c_hash` / `s_hash` validation | ❌ | **new**, ~200 LOC |
| `iss` validation (OIDC Core 3.1.3.7) | ❌ | small |
| id_token signature + `aud`/`azp` | ✅ partial | small |
| **id_token decryption (JWE)** | ❌ no JWE path | **new** — required by FAPI1 RP `EncryptedIdToken` + `RSA15` modules |
| PAR / JAR / DPoP / JARM / mTLS / pki-jwt | ✅ `fapi` crate | reuse |
| Front-channel logout receiver | ❌ | **new** (iframe HTML) |
| Back-channel logout receiver + logout-token validation | ❌ | **new** (ES256/RS256, `sid`, `events`, `iss`/`aud`) |
| Session-management `check_session_iframe` postMessage client | ❌ | **new** (browser-side JS + orchestration) |
| RP-Initiated Logout (`end_session` + `post_logout_redirect_uri`) | ❌ (only discovery field parsed) | **new** |
| 3rd-party-initiated login (`login_hint`/`iss` handling) | ❌ | small |
| Dynamic client registration as an RP | ❌ | small (DCR client) |
| Headless harness crate | ❌ | **new**, ~1 crate |
| Playwright fixture for RP mode | ❌ | **new**, ~1 fixture |

### Why openfin8 matters here

`sentin8-auth/DESIGN.md` §9a.1 says *"RP-role certification belongs to
relying parties, not the OP/issuer/verifier platform"* — and that is correct
about **who certifies**. openfin8 is the relying party:

- `openfin8-eopenca` — *"the open-finance **Data Recipient** demo app"*
  (a data recipient **is** a relying party)
- `openfin8-core/src/handlers.rs` runs the OAuth client: PAR push with
  PKCE-S256, `/fdx/consents/callback` code exchange with a DPoP proof
- `openfin8-uk` / `openfin8-au` ceremony modules build the jurisdiction
  request objects (`response_type: "code id_token"` + nonce; CDR PAR shape)

The reusable client libraries live in the platform SDK
(`sentin8-sdk/identity/auth-client`, `sentin8-sdk/identity/fapi` — the
latter a near-complete FAPI RP stack).

**The blocker: openfin8 validates no id_tokens.** Grepping every `.rs` file
in openfin8 for `id_token` outside response-type literals returns **4 hits,
all strings/assertions**. There is **zero** id_token validation. openfin8 is
an OAuth recipient, not an OIDC RP. Missing: id_token
signature/`aud`/`iss`/`nonce`/`at_hash`/`c_hash` validation, id_token JWE
decryption, RP-initiated logout, front-channel logout iframe, back-channel
logout-token validation, session-management `check_session_iframe`, and the
implicit/hybrid/form_post response paths (it only does `code`).

## 4.6 Sizing

| Sub-bucket | Cells | Effort | Notes |
|---|---|---|---|
| **D0. RP harness + id_token validation core** | 0 (enabler) | **L**, ~2 wk | New crate + fixture; unblocks everything below |
| **D1. OIDC RP Basic / Config / Dynamic / 3rd-Party** | 4 | **M**, ~1 wk | builds on D0 |
| **D2. OIDC RP Implicit + Hybrid + Form Post** | 3 | **M**, ~1 wk | response-type + form_post handling |
| **D3. OIDC RP Logout (4)** | 4 | **L**, ~2 wk | front-channel iframe, back-channel logout JWT, session-management postMessage |
| **D4. FAPI2 RP SP + MS Final** | 7 | **M**, ~1.5 wk | `fapi` crate is ~80% there; JARM + JWE id_token are the gaps |
| **D5. FAPI1-Adv RP** | 12 | **L**, ~2.5 wk | 12 cells, incl. encrypted id_token + RSA1_5 negatives |
| **D6. FAPI-CIBA RP (BR-OF)** | 1 | **S**, ~2 d | needs Brazil CIBA config |
| **Generic RP total** | **31** | **~10–11 wk** | sequential, one engineer |
| + jurisdiction RP | 25 | ~+0.5–1 wk each **once D5 lands** | market-driven |
| Superseded RP ID2 | 16 | — | **do not pursue** |

### The economics that matter

**RP is cheap per jurisdiction; OP is expensive.** Confirmed in
`FAPI1AdvancedFinalClientTestPlan.certificationProfileName()`: each
jurisdiction is a `switch` on `fapi_profile`, not a separate plan. So one
RP implementation passes `plain_fapi`, then UK-OB / AU-CDR / KSA with only
profile-specific claim changes.

Because jurisdiction RP is nearly free once FAPI1 RP is certified, the RP
work should be sequenced **immediately before the first market entry**, not
as a standalone programme. That converts an 11-week isolated cost into a
~2-week enabler that rides along with whichever market you enter first.

---

# Part 5 — Families with no certification catalog

Verified absent (404 on every plausible URL; no such table on the
"All Certified Implementations" index):

| Family | Status |
|---|---|
| OpenID Shared Signals Framework (SSF / CAEP) | Conformance **tests** exist, **no** certified-implementations listing |
| OpenID Federation | Conformance **tests** exist (early stage), **no** catalog |
| AuthZEN Authorization API | Conformance **tests** exist, **no** catalog |
| OpenID Connect for Identity Assurance (eKYC-IDA) | **Working group only** — no test page, no catalog |

**Action item:** `sentin8-auth/DESIGN.md` §9a.1 lists "Identity Assurance
(eKYC-IDA) — OP" as in-scope. That entry buys no catalog cell and should be
dropped or re-labelled.

---

# Part 6 — Sequencing and decisions

```
D0  RP harness + id_token validation        L   2 wk   ← enabler, nothing ships without it
 ├─ D1 OIDC RP Basic/Config/Dynamic/3rd    M   1 wk   → +4 cells
 ├─ D2 OIDC RP Implicit/Hybrid/FormPost    M   1 wk   → +3 cells
 ├─ D3 OIDC RP Logout (4)                  L   2 wk   → +4 cells
 ├─ D4 FAPI2 RP SP+MS (7)                  M   1.5wk  → +7 cells
 └─ D5 FAPI1-Adv RP (12)                   L   2.5wk  → +12 cells
D6  FAPI-CIBA RP BR-OF                    S   2 d    → +1 cell
                                          ──────────
                                          10-11 wk → 31 cells
```

### Total effort

| Scope | Cells | Effort | When |
|---|---|---|---|
| **Gap 1 (Client Credentials)** | 4 | S–M | **now** — cheapest, last OP-side gap |
| **Gap 2 (VCI mdoc issuer cell)** | 1 | S | **now** — verify + file |
| **Nothing from jurisdiction OP** | 0 | — | market-driven; formally close the 15 superseded cells |
| **D0–D6 (non-jurisdiction RP)** | 31 | **~10–11 wk** | **only on an explicit product decision** |

### The honest summary

| | Cells | What it really means |
|---|---|---|
| **Code we ship is 5 cells short** | 5 | 4 = one DPoP fix + one spec; 1 = a filing we forgot |
| **Jurisdiction OP** | 50 | 15 = close as superseded; 8 = ~1.5 wk claims work; 25 = market-driven product work |
| **RP role** | 72 | 16 = close as superseded; 31 = ~11 wk (openfin8 owns it); 25 = nearly free after the 31 |

### What to do, in order

1. **Gap 1** — FAPI2 Client Credentials DPoP binding + spec → **+4 cells, S–M**
2. **Gap 2** — verify + file the VCI mdoc issuer cell → **+1 cell, S**
   *(after these two, every non-jurisdiction OP-side cell is done: 50/50)*
3. **Formally close** the 31 superseded cells (15 JOP + 16 RP) here and in
   the catalog plan, so they read as *decided* not *pending*
4. **Decide the RP role.** If yes → **D0** first (~2 wk), then D4/D5, then
   each market's RP cells ride along nearly free
5. **Decide markets** for jurisdiction OP. No market → no work.

After steps 1–2 the platform holds **every non-jurisdictional OP-side
catalog cell (50/50)**, with 122 remaining cells being RP-role (72) and
jurisdiction overlays (50) — both owned by openfin8 / market decisions
rather than platform gaps.

### Open questions

1. **Is the RP role a product goal?** (Gates ~11 weeks of work.)
2. **Which markets, if any, are real** for jurisdiction OP — Brazil, UAE,
   KSA, AU? (Absent a market, it is pure cost.)
3. **Where should the RP-under-test live** — a new
   `sentin8-rp-conformance` crate, or an extension of
   `sentin8-sdk/identity/fapi`? (The harness belongs in `sentin8-auth-oidf`
   so the certified code is the code we ship.)
4. **Should the BFF become the certified RP**, or a dedicated harness? (A
   dedicated harness is far safer — certifying the BFF would mean freezing
   its behaviour against 31 conformance plans.)

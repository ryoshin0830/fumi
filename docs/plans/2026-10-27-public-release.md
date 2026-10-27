# Fumi Public Release Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkboxes for tracking.

**Goal:** Publish the existing application as ryoshin0830/fumi on main and deploy the verified application to Vercel.

**Architecture:** Preserve browser-only cryptography and the bounded Next.js public-key fetch endpoint. Separate the web crypto worker into a content-hashed static asset, keep standalone HTML self-contained, and extract UI rendering from the application controller. Retain legacy protocol identifiers for compatibility.

**Tech Stack:** Node24, Next.js16, esbuild, OpenPGP.js, Go/WASM age and SSHSIG, node:test, GitHub Actions, Vercel.

## Global Constraints

- Never commit disposable private keys, logs, local configuration, personal paths, generated outputs, or credentials.
- Plaintext, ciphertext, private keys and passphrases stay in the browser. Server requests contain only a GitHub username and public-key type.
- Preserve existing dgpg signature namespace, notation and package markers; display the product name Fumi.
- Preserve the existing UI and all crypto interoperability/error handling.
- Keep the original local working directory intact; implement in the newly created repository checkout.

### Task 1: Public source and reproducible tooling

Files: package.json, .gitignore, .vercelignore, README.md, scripts/, tests/, .github/workflows/ci.yml, docs/.

- [x] Create the explicitly authorized public repository with ghnew and copy only source, tests and vendored runtime.
- [x] Rename product-facing text and package metadata to Fumi; document retained protocol identifiers.
- [x] Remove machine-specific paths and consolidate duplicate browser scripts into the current portable suite.
- [x] Add CI for formatting, build and meaningful crypto tests; exclude all generated/test material from Git and deployment.
- [x] Document setup, privacy, architecture, compatibility and Vercel deployment.

### Task 2: Web delivery and UI boundaries

Files: scripts/build.mjs, src/worker-client.js, src/ui/, src/app.js, next.config.mjs, tests/build.test.mjs, tests/worker-client.test.mjs.

- [x] Add failing assertions for a small web HTML response, same-origin hashed worker, standalone embedding and worker lifecycle.
- [x] Build a separate content-hashed static worker for web, keep the standalone worker embedded, and preserve strict CSP.
- [x] Include generated web HTML in function tracing and set immutable/security headers on hashed worker assets.
- [x] Extract stateless result/signature views and shared DOM presentation helpers from the controller; format maintained source.
- [x] Verify build artifacts, cancellation and restart, full crypto suite and native CLI compatibility.

### Task 3: Release verification and deployment

Files: main branch, GitHub Actions configuration, vercel.json if required, deployment metadata excluded locally.

- [x] Run a clean production build, unit/integration tests, native GPG/age/OpenSSH matrix and browser scenarios with disposable keys.
- [x] Obtain a read-only review of the actual release source and resolve material findings.
- [x] Scan the staged file list for secrets/private fixtures and personal paths; commit verified source to main and push.
- [x] Link the new Vercel project and GitHub repository; deploy production with the existing authenticated account.
- [ ] Verify public HTTPS page, CSP, static worker, live .gpg/.keys fetches, real browser crypto and absence of private-file routes.
- [ ] Confirm remote main SHA and CI/deployment readiness, then deliver repository and live URLs with remaining limitations.

## Verification record

- Production build and formatting check passed.
- 166 automated tests and 12 native GPG/age/OpenSSH compatibility cases passed.
- 13 browser scenario groups passed at 375/768/1024/1440px; no JavaScript or CSP errors.
- Independent static review found no must-fix issues; its documentation-size correction is resolved.
- 59 staged files were scanned: no private fixtures, credentials, personal paths, generated outputs, or local environment files were included.

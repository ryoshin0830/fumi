# Progressive input disclosure implementation plan

> **For agentic workers:** Use superpowers:executing-plans for inline execution of the user's concrete UI correction.

**Goal:** Show only the input needed for the current task, update PR #2, and leave the corrected application running locally.

**Architecture:** Keep local worker crypto. GitHub recipient lookup discloses a GPG/SSH public-key fallback when no keys are registered or fetching fails, without interrupting username entry. Decryption runs after both inputs settle; a typed worker error reveals a password field only for protected private keys.

**Constraints:** Remove the introductory delivery link. GitHub username is the default recipient input. Manual keys accept GPG armor/binary and SSH Ed25519/RSA with automatic format selection. Keep errors, cancellation, input/file drafts, old signatures and full Copy/Save. Wrong keys and damaged ciphertext must not be described as password requirements. No private inputs leave the browser.

The user specified this flow directly after reviewing the current UI. Returning to GitHub must stop use of any supplied manual key. An automatic lookup must never hide the username while the user is typing. A secondary explicit manual-key action preserves offline use. Remove the unnecessary visible format selector.

## 1. Typed password requirement

- [x] Add failing tests for `PASSPHRASE_REQUIRED` on protected GPG and SSH keys; wrong/malformed unprotected keys must not receive that code.
- [x] Add the code at the existing key-unlock boundary, preserve it through the Go bridge and worker client, rebuild WASM using the existing matching Go toolchain.
- [x] Run affected worker, GPG and age tests.

## 2. Contextual input flow

- [x] Add browser acceptance for the absent delivery link, initially hidden manual-key/password fields, automatic missing-key fallback, both manual key formats, input changes and stale requests.
- [x] Extend the existing recipient controller's 450ms request to check registered public keys. Preserve explicit network-failure messages and allow manual keys; do not treat unavailable GitHub as proof of no registered keys.
- [x] Replace advanced public-key/format UI with a contextual key box and a clearly labeled optional manual path. Keep GitHub input visible until the user supplies a manual key.
- [x] After ciphertext and private-key inputs settle for 600ms, try decryption once. Show success immediately; reveal password only on `PASSPHRASE_REQUIRED`. Do not automatically retry expensive password guesses while typing. Keep a password submit and cancelled/error retry.
- [x] Stop pending checks on edits, clear and mode change; reject stale results. Do not auto-decrypt again merely because the user selected Edit.

## 3. Verify and deliver

- [x] Update browser regressions to the new automatic decryption/manual-key flow. Cover protected/unprotected GPG and SSH, wrong keys, wrong passwords, invalid data, cancellation, files and legacy signatures.
- [x] Run formatting, build, unit tests, browser suites and CLI checks. Request focused independent review and address material findings.
- [x] Update documentation/screenshots and the existing PR description; push changes and check CI. Leave the corrected production app at http://127.0.0.1:3100/.

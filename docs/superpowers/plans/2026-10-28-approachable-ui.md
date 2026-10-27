# Minimum Useful Fumi Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans in the current feature branch. This revision implements the user's concrete review instructions.

**Goal:** Remove encryption signing and demos, reduce the task to one submit, and display copyable ciphertext directly.

**Architecture:** Keep the crypto worker, recipient resolver, DOM/result/signature views, and current build. Replace the wizard controller with a single-form controller; remove the flow model and view. Only compatibility tests may create old signed fixtures.

**Tech Stack:** Existing Next.js, vanilla JavaScript, HTML/CSS, esbuild, Node tests, browser regressions. No new dependencies.

## Constraints

- Work on `codex/approachable-ui`; keep Draft PR#1 unmerged.
- Preserve Japanese, standard PGP/age, old signed-data reads, CSP, byte limits, draft safety, cancellation and validation.
- Keep short visible labels,44px targets,16px inputs, keyboard focus, reduced motion and375–1440px layouts.
- Use the existing local preview port3001; port3000 is another project.

## Task 1: Prove the removal contract

Files: `tests/signature-worker.test.mjs`, `scripts/browser/scenarios.mjs`.

- [x] Add and run failing worker checks for removed sample generation and rejected signing requests:

```js
await assert.rejects(rpc('demo', {}), /処理|対応/);
await assert.rejects(
  rpc('encrypt', {
    data: new Uint8Array([1]),
    format: 'pgp',
    recipients: [pgpPair.publicKey],
    filename: 'message.txt',
    armored: true,
    signer: { privateKey: pgpSigner.privateKey },
  }),
  /署名/,
);
```

- [x] Add browser checks that the sample/signing/progress controls are absent, a single submit resolves the recipient and encrypts, ciphertext is visible, and Copy is primary. Verify clipboard rejection, large-preview fallback, file round trips, manual-key precedence, mode drafts, cancellation, and legacy signature states.

## Task 2: Delete the runtime features and simplify the UI

Files: `src/crypto-worker.js`, `src/app.js`, `src/template.html`, `src/styles.css`, `src/ui/result.js`, `src/ui/signature.js`. Delete `src/flow.js`, `src/ui/flow.js`, `tests/flow.test.mjs`.

- [x] Remove key generation and signed-encryption imports/branches from the worker. Keep ordinary encryption and existing signed-data decryption. Reject the old signing option explicitly:

```js
if (payload.signer) throw new Error('署名付きの暗号化には対応していません。');
```

- [x] Retain the controller's busy/job/AbortController boundaries and per-operation drafts. Remove all stage, signer and sample state. `resolveRecipient(current)` consumes manual-key bytes or the GitHub field and optional format; it returns `{format, keys, username}` only after successful inspection. Never fall back from an explicit format or partial lookup failure.
- [x] Replace HTML with two operation tabs, labeled content and attachment inputs, the necessary key/recipient inputs, one submit, one clear action, Advanced settings, and compact results. User-provided content stays in `textContent`.
- [x] Make a manual public key replace the visible GitHub recipient field and expose the active source in the Advanced summary.
- [x] Display text results directly. Copy uses the complete stored text. A denied clipboard selects a complete small preview; a truncated preview directs the user to Save instead of copying invalid partial ciphertext.
- [x] Retain visible legacy signature failure/pending/retry/cancel, remove signature creation and unsigned explanations, and consolidate the CSS around the smaller interface.

## Task 3: Preserve compatibility and deliver

Files: `scripts/legacy-encryption.mjs`, worker and native CLI compatibility tests, current README/design docs/screenshots, PR body.

- [x] Generate old signed fixtures through a development-only helper, so compatibility tests no longer request the removed application capability. Exercise the production worker when reading those fixtures.
- [x] Run formatting, build, full unit tests with the installed Go toolchain, native CLI checks, and the revised browser suite. Require zero JS/CSP errors and bodyless GET-only key requests.
- [x] Inspect375/768/1024/1440px, keyboard and short-window results. Update the retained review screenshots and current docs to describe this final interface.
- [x] Review the connected code and fix concrete findings. Leave the local Chrome preview open.

The user authorized merging PR#1 after the final review and E2E checks. Require successful CI/Vercel checks on the final head before merging.

## Local evidence

- Removal checks were observed failing before implementation and passing afterward.
- `npm run format:check` and `npm run build` passed. Web HTML70 KiB, standalone9.54 MiB.
- `GO=/tmp/dgpg-go-toolchain/go/bin/go npm test`:170 passed,0 failed.
- Native GPG/age compatibility:12 cases passed, including production-worker reads of legacy signed fixtures.
- Browser:9 scenario groups passed against the production build;375/768/1024/1440px, no horizontal overflow, zero JavaScript/CSP errors,15 bodyless credential-free public-key GETs.
- Focused checks cover full ciphertext copying, denied clipboard and successful retry, file bytes, manual-key source, draft retention, legacy signature states, verification cancellation/late responses, tampering rejection, rate limits and cancellation. Keyboard operation tabs and mobile advanced/decrypt layouts also inspected.
- Independent connected-code review findings fixed and re-reviewed: stale copy error, missing pending-verification cancellation regression.
- Chrome local preview: `http://127.0.0.1:3001/`.

## Pre-merge review

Two independent read-only reviewers checked the full PR against main, including connected UI/worker/server callers. Neither found a correctness, data-loss or security blocker. Removed the unused `size` import and `originalFilename` result field, and delegated duplicate username validation to `resolveGitHub`, which rejects invalid input before fetching. Added a browser check proving that invalid recipients preserve drafts and make no network request. The focused cleanup was re-reviewed.

Rebuilt and tested the final runtime: formatting/build passed,170 Node tests passed,12 native CLI cases passed, and9 Chromium E2E scenario groups passed at `http://127.0.0.1:3002/`. Production-build public-key lookup also returns an empty array for the actual GitHub no-GPG response. Verification assumes a public utility with cryptography in each browser; concurrent-load and non-Chromium browser execution were not performed.

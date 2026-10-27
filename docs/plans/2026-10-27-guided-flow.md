# Guided Flow Implementation Plan

> **For agentic workers:** Use executing-plans and independent code review. Track completion with checkboxes.

**Goal:** Make Fumi understandable for first-time users through purposeful steps and contextual disclosure, preserving browser-only cryptography and existing encrypted data compatibility.

**Architecture:** A small pure flow model determines the current step and which steps can be reached from existing draft readiness. A stateless view shows one input section at a time; the current controller owns transitions, drafts and async operations. Encryption remains three steps (content, recipient, review), decryption two (received content, own secret key). Existing crypto/server modules and protocols are unchanged.

**Design decision:** Use guided steps with editable summaries, rather than another layer of technical accordions or a second expert mode. Keep the existing light Apple-inspired visual system and equal access to both operations. Default interface language remains Japanese unless the user requests otherwise.

## Interaction requirements

- First view shows only the content input, a brief purpose, a trial action and a clear continuation button. Later fields are actually hidden and inaccessible to keyboard focus.
- Step completion requires content; encryption then requires a usable recipient. Returning or switching operations preserves drafts. Clearing a mode resets its progress. Losing prerequisite data returns to an available step.
- Review identifies the content and intended recipient, and explains the recipient's opening tool before encryption. Signature is optional and its fields appear only when selected. No silent format or signature downgrade.
- Explain public versus private keys only where needed. State that a missing private key cannot be downloaded from GitHub. Distinguish the recipient's public key from the sender's own signing secret key.
- Results replace the input surface and offer save/copy plus editing. Encrypted text and technical details start collapsed; readable decrypted text is immediately visible. Signature warnings and retry/cancel remain visible when applicable.
- Signature wording reports actual verification of the generated signature, without implying that every byte of the supplied key file was checked.
- Preserve privacy boundaries, async cancellation, failures retaining inputs, keyboard focus, 44px targets, reduced motion and narrow-screen layouts.

## Implementation tasks

- [x] Add failing tests for gated progress, prerequisite loss, separate encryption/decryption step counts, and final-action readiness.
- [x] Implement `src/flow.js`, `src/ui/flow.js`, template steps, controller transitions and contextual key help.
- [x] Make results and signature explanations progressive while preserving pending/error/retry behavior.
- [x] Update the design-system document, README and browser regression script to exercise the actual guided flow.
- [x] Verify formatting, production build, full automated tests, keyboard/mobile behavior, real browser crypto and signature flows; perform independent review.
- [x] Merge verified changes to main, deploy through the existing Vercel Git integration, verify the public build/API/crypto and final CI.

## Validation

- Pure model tests assert that blank/whitespace content cannot advance, missing recipient cannot reach review, missing signing inputs cannot run, backwards edits remain available, and obsolete progress is clamped after data removal.
- Browser coverage: text/file round trips; optional PGP/SSH signatures; valid, unavailable and mismatched GitHub states; corrupted ciphertext; previous-step edits; per-mode drafts; clear/cancel; sample shortcuts; hidden optional controls; encrypted preview disclosure; mobile widths375/768/1024/1440; keyboard-only progress and focus.
- Existing crypto suites and CLI interoperability remain regression checks; no cryptographic algorithms or envelope formats are changed.

## Design references

UI UX Pro Max search verified form-label, submit-feedback and focus guidance. Its progressive-disclosure query did not return a specific matching rule, so the disclosure structure uses the primary design guidance below and the user's stated requirement.

- Apple Human Interface Guidelines: https://developer.apple.com/design/human-interface-guidelines/disclosure-controls
- Nielsen Norman Group: https://www.nngroup.com/articles/progressive-disclosure/

## Review findings resolved

- A malformed ciphertext error now returns to the content step before showing/focusing its message.
- Clipboard rejection expands the encrypted preview before selecting text for manual copy.
- Help and result notes use the actual operation-tab label.
- Submission failures move focus to their visible error; username blur validation retains normal keyboard navigation.
- After a step change or result, the two operation tabs remain in the viewport instead of being clipped by automatic scrolling.
- Independent follow-up review closed its three findings; runtime regression checks remain the release gate.

## Verification record

- Production build, formatting and 170 automated tests passed.
- 9 browser regression groups passed: real text/file crypto, PGP/SSH signatures, key changes/offline/retry, tampering and malformed inputs, clipboard denial, drafts/back/clear, cancellation, trial flow and rate-limit recovery. No JavaScript or CSP errors.
- 375/768/1024/1440px layouts have no horizontal overflow. Final initial-view checks confirm later fields stay hidden and the continuation button is visible at375×844 and1440×1000.
- Final mobile review shortened the opening tab to 「受け取って開く」 and removed redundant introductory instructions. Signature warnings and recipient opening requirements remain directly visible when relevant.
- Browser evidence stays in ignored test-results/; no private fixture material is published.

## Published verification

- Version2.5.0 is deployed at https://fumi-delta.vercel.app/?v=2.5.0 through the main-branch Vercel integration.
- Public HTTPS HTML is byte-for-byte equal to the local verified web build; CSP hashes match. Both live .gpg/.keys endpoints return registered keys.
- Public browser check completed the guided recipient lookup, age encryption and trial encryption/decryption. Only one username-bearing public-key GET was sent; no JavaScript or CSP errors occurred.
- Production mobile initial view fits375px without horizontal overflow and keeps the continuation button inside844px height.
- GitHub Actions passed for the UI release commit.

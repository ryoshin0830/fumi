# Approachable Fumi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The user explicitly requested inline execution and a local Chrome preview.

**Goal:** Give non-programmers a clear, progressively disclosed interface, then deliver the running local application in Chrome and a reviewable PR.

**Architecture:** Preserve the existing controller, flow model, cryptographic worker, and Next.js route handler. Revise the HTML and the existing flow/result views; keep optional-feature visibility and validation in the controller. Consolidate the UI stylesheet instead of appending another override layer.

**Tech Stack:** Next.js 16.4.3, browser JavaScript, semantic HTML/CSS, esbuild, existing Node and Ego browser checks. No new dependencies.

## Global Constraints

- Retain Japanese as the interface language.
- Body and form inputs are at least 16px; secondary descriptions are at least 14px; compact supporting labels are at least 12px.
- All controls have at least 44px targets, visible keyboard focus, sufficient text contrast, and reduced-motion support.
- Do not alter cryptographic algorithms, encrypted formats, worker boundaries, GitHub lookup contracts, privacy policy/CSP, file limits, or CLI interoperability.
- Keep dynamic user content rendered through `textContent`.
- No new persistence, account system, analytics, key generation workflow, or automatic message delivery.
- Work on `codex/approachable-ui`. Keep main and its automatic Vercel deployment untouched until final user review.
- Existing baseline: 170 Node tests pass with `GO=/tmp/dgpg-go-toolchain/go/bin/go`, production build passes, 12 native CLI compatibility cases pass.
- Local port 3000 belongs to a different project. Use `http://127.0.0.1:3001/` for Fumi and verify its working directory before reusing an existing listener.

---

## Task 1: Capture the novice interaction regressions

**Files:** Modify `scripts/browser/scenarios.mjs`.

**Interfaces:** Consume the existing `page`, `visible(id)`, `value(id)`, `stage()`, `idle()`, `finished()`, `content()`, `manualRecipient()`, and `signing()` helpers. Preserve the real cryptographic round trips and network-boundary checks.

- [ ] Add initial-state assertions before filling content:

```js
assert.equal(await visible('flow-hint'), true);
assert.match(await value('flow-hint'), /入力|ファイル/);
assert.equal(await visible('sample-invitation'), true);
```

- [ ] Assert that entering a draft hides the trial invitation and that a programmatic trial click cannot replace that draft:

```js
assert.equal(await visible('sample-invitation'), false);
await page.evaluate(() => document.getElementById('demo-button').click());
assert.equal(await page.evaluate(() => document.getElementById('encrypt-text').value), original);
```

- [ ] At review, assert the optional signature is initially outside the visible path, then update the signing helper to expand `#additional-options > summary` only when closed. Use the two `[data-edit-step]` controls to return to content and recipient and assert drafts remain intact.
- [ ] Close `additional-options` after entering a wrong signing password. Submit; assert that `signer-error` is visible, its disclosure is open, and it receives focus.
- [ ] After encryption, assert that `result-handoff` is visible, describes email/chat and the recipient's secret key, and that the technical result disclosure remains closed.
- [ ] Open `#privacy-options > summary` before the clear-all control. Replace the former draft-overwriting trial case with a file-draft preservation check: the sample is unavailable and programmatic activation leaves the selected file intact.
- [ ] Generate disposable fixtures with `npm run fixtures:signatures`. Run the scenario against the unchanged local app, expecting the first empty-state assertion to fail. Reuse the same Ego task space for retries; do not open another space after a failure.

## Task 2: Build the focused working surface

**Files:** Modify `src/template.html`, `src/ui/flow.js`, `src/styles.css`, and `src/app.js`.

**Interfaces:** `renderFlow()` retains its existing state/result inputs and receives a `sampleAvailable` boolean from `updateButton()`. All existing DOM IDs used by the controller remain present. Add `sample-invitation`, `additional-options`, `privacy-options`, and two buttons with `data-edit-step="0"` / `data-edit-step="1"`.

- [ ] Replace the purpose copy with 「大切な内容を、相手だけに。」 and one explanatory sentence. Use operation labels 「鍵をかけて渡す」 / 「受け取って開く」. Put compact step progress before the current task heading; make the step-count caption visually hidden while retaining its announcement.
- [ ] Give text and key inputs visible labels. Use 「メッセージ」 for content text choices and clear examples in placeholders. Recipient instructions explain both GitHub lookup and the alternate supplied-public-key path; add a disclosure describing what to ask the recipient for.
- [ ] Keep review summaries and add specific edit buttons. Wrap signing in `details#additional-options` with a descriptive summary. Keep the GPG/age opening requirement visible before creation. Explain the secret key and its password in ordinary language at the decryption step.
- [ ] Move the sample action to a small invitation below the working card, with an explicit sample-data explanation. Move clearing both drafts and the About control into `details#privacy-options`; retain the current-draft reset as a quiet, directly available action.
- [ ] Compute trial availability from all active-mode draft fields and files, not just the visible input:

```js
const sampleFields =
  mode === 'encrypt'
    ? [
        'encrypt-text',
        'github-user',
        'recipient-text',
        'signer-github',
        'signer-text',
        'signer-passphrase',
      ]
    : ['decrypt-text', 'secret-text', 'passphrase'];
const sampleKinds = mode === 'encrypt' ? ['encrypt', 'signer'] : ['decrypt', 'secret'];
const sampleAvailable =
  state.step === 0 &&
  !sampleFields.some((id) => $(id).value.length) &&
  !sampleKinds.some((kind) => drafts[kind].file) &&
  (mode !== 'encrypt' || !recipient);
```

- [ ] In `renderFlow()`, set `sample-invitation.hidden = busy || Boolean(result) || !sampleAvailable`. In the demo click handler, return when the invitation is hidden or work is busy. Preserve the existing real sample cryptography.
- [ ] Make the empty first-step explanation visible whenever content is missing, and retain the existing malformed-ciphertext explanation when entered data is unrecognized. Set the next action to 「次へ：相手を選ぶ」 or 「自分の鍵を用意する」 as appropriate; the final encrypt action is 「鍵をかけて作成」.
- [ ] Before displaying any field error, open its ancestor disclosures:

```js
let parent = $(id).parentElement;
while (parent) {
  if (parent.tagName === 'DETAILS') parent.open = true;
  parent = parent.parentElement;
}
```

- [ ] Register `[data-edit-step]` clicks with the existing `changeStep()` function. Reset the additional-options disclosure when encryption is reset. Preserve busy state, draft separation, key requirements, and cancellation.
- [ ] Consolidate CSS into one set of base rules and responsive overrides: neutral canvas, white working card, blue action, 680–736px content width, quiet progress line, 16px inputs, 14px supporting text, 44px targets, mobile wrapping, and reduced motion. Preserve all signature warning colors, file picker focus, selected controls, drop zones, dialogs, and preview overflow behavior.
- [ ] Run `npm run build:client`, then repeat the initial browser interaction checks. Expect the empty explanation, draft-safe trial, navigation, and signature error checks to pass.

## Task 3: Make completion and delivery clear

**Files:** Modify `src/template.html` and `src/ui/result.js`.

**Interfaces:** `renderResultView(result, mode)` retains its signature and all crypto result data. Add `result-handoff`; preserve signature status and retry/cancel IDs, preview, filename, save/copy, technical notes, and CLI output.

- [ ] Put result filename and save/copy actions immediately after the heading and any visible signature status. Move unsigned signature explanation and technical notes below the primary actions.
- [ ] Add the practical delivery instructions, using semantic HTML:

```html
<section id="result-handoff" class="delivery-guide" aria-labelledby="delivery-title">
  <h3 id="delivery-title">あとは、相手に渡すだけ。</h3>
  <ol>
    <li>
      <strong>いつもの方法で送る</strong>
      <p>保存したファイルやコピーした文章を、メールやチャットで送ってください。</p>
    </li>
    <li>
      <strong>相手はFumiで開く</strong>
      <p>「受け取って開く」で、受け取ったデータと対応する秘密鍵を指定します。</p>
    </li>
  </ol>
</section>
```

- [ ] Set the encrypted result title to 「渡す準備ができました」 and `result-handoff.hidden = !encrypt`. Keep the decrypted text preview open and the encrypted preview closed. Move `result-note` into the technical disclosure without removing format/ZIP/native-tool details.
- [ ] Run the updated complete browser scenario against the local build. Expect all existing and added interaction/crypto cases to pass with no JavaScript or CSP errors.

## Task 4: Verify and deliver the review surface

**Files:** Modify `docs/design-system.md`, `README.md`, this plan, and the PR description. Retain the Next.js-generated `AGENTS.md` guidance so subsequent local runs do not generate an unexplained untracked file.

- [ ] Update the design document and README to describe the actual final interaction, safe trial entry, and result handoff. Mark plan steps only after their evidence exists.
- [ ] Run `npm run format:check`, `npm run build`, `GO=/tmp/dgpg-go-toolchain/go/bin/go npm test`, and `GO=/tmp/dgpg-go-toolchain/go/bin/go npm run test:cli`. Capture output; require zero failures.
- [ ] Inspect screenshots at 375, 768, 1024, and 1440px. Cover initial, recipient, review, encrypted result, own-key, decrypted result, and expanded signing states. Check keyboard navigation, visible error focus, no horizontal overflow, and 200% browser zoom.
- [ ] Review the connected UI/controller code and the diff, correcting any real findings. Run focused follow-up checks only for changes made after the full checks.
- [ ] Commit the verified UI and documentation. Create the PR through `gh`, using the gh-pr-body skill and a body file. Include concrete before/after behavior and validation; leave the PR unmerged for the user's review.
- [ ] Ensure the server on 3001 still serves this repository's current generated build. Open that URL in Google Chrome, verify its rendered first view, and leave the tab open for the user.
- [ ] Report the preview URL, PR link, validation, and any remaining limits. Do not merge or deploy main before the user's final review.

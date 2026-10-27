# Fumi: a calmer first-time experience

Status: implemented. The local preview and pull request are the review boundary before any merge to main.

## Goal and review boundary

Make Fumi usable by someone who has never used an encryption tool. They should understand what they can do, what they need at each step, and what to do with the result without knowing OpenPGP, SSH, age, fingerprints, or command-line tools.

Deliver the implementation on a feature branch as a pull request and run a local preview for the user's review. Incorporate feedback before merging. The existing Vercel integration automatically publishes main, so a merge requires the user's final approval.

## What the current UI gets wrong

- It already separates content, recipient, and confirmation. Adding more steps would not solve its underlying problem.
- The page repeats purpose text, step counts, numbered button cards, section headings, and privacy statements. These compete with the actual task.
- The first action is disabled with little visible explanation. Input labels are visually hidden, leaving the placeholder to teach the task.
- Recipient selection assumes familiarity with GitHub and public keys. A novice needs to know what to ask the recipient for and why it is needed.
- The trial button does not explain that it supplies sample content and keys; it can replace an existing draft.
- Review and result descriptions bring format/tool details into the main path. The result should first explain how to deliver or save the item.
- Clearing the current draft and clearing everything have similar visual weight beneath the main task.
- The stylesheet has several layers of overrides. Revise the affected rules into one coherent set rather than adding another override block.

## Alternatives considered

| Approach                                        | Benefit                                                                              | Cost                                                                     | Decision    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ----------- |
| Focused guided workspace                        | Keeps the useful three-step model while simplifying choices, language, and hierarchy | Requires careful work on each state                                      | Recommended |
| Welcome screen followed by a full-screen wizard | Strong separation of intentions                                                      | Adds a mandatory click and makes switching tasks less direct             | Do not add  |
| Separate beginner and expert modes              | Lets experts see more fields                                                         | Duplicates UI states and makes users classify themselves before starting | Do not add  |

## Visual direction

Use an Apple-inspired utility surface: a soft neutral background, a single white working card, system typography, blue primary actions, restrained borders, and comfortable spacing. No marketing hero, external fonts, animation library, decorative imagery, or new component framework.

- Retain Japanese as the interface language.
- Retain the established palette: background `#f5f5f7`, surface `#ffffff`, text `#1d1d1f`, secondary `#6e6e73`, accent `#0066cc`, error `#b42318`, success `#247247`.
- Body and form inputs are at least 16px; secondary descriptions are at least 14px; compact supporting labels are at least 12px.
- Use a single-column workspace approximately 680–736px wide, with 24px mobile / 32px desktop padding and 20px card corners.
- Replace boxed progress tiles with a quiet, compact step indicator. Completed steps remain keyboard-accessible and show what can be edited.
- Use one strong task heading per view. Keep the purpose line and operation choice concise.
- Keep the current step and primary action comfortably visible at 375×844 and 1440×1000 without hiding essential instructions.
- All controls have at least 44px targets, visible keyboard focus, sufficient text contrast, and reduced-motion support. Verify 375, 768, 1024, and 1440px widths and browser zoom.

## Information architecture and copy

The page first explains the outcome: messages and files can be prepared so that the recipient's matching key opens them. The two operations remain equally discoverable, using everyday language such as 「鍵をかけて渡す」 and 「受け取って開く」. Keep formal encryption terms in contextual explanations and technical details.

One concise privacy statement explains that content and secret keys are processed on the device. Public-key lookup and signature-account verification still require network requests; do not imply the whole app is always offline.

### Prepare something to send

1. **Content:** 「何を届けますか？」 shows a message/file choice, a visible input label, a short example, and one next action. Before content exists, show an explanation of what enables that action. No recipient, secret-key, or signature inputs are visible or focusable here.
2. **Recipient:** 「誰に届けますか？」 explains that the recipient must have a matching secret key. The normal path accepts the recipient's GitHub username or profile URL; a clearly named alternate path accepts a public-key file or pasted key. A contextual disclosure explains what to ask the recipient for when the user does not know their GitHub account or key. Do not suggest any arbitrary person can open the result without a key.
3. **Review:** Summarize the content and recipient with clear edit links. Explain how the recipient can open the file. Show any GPG/age incompatibility before creation. Put optional signing under an explicitly named additional-options disclosure; enabling signing reveals the existing identity/key/password fields. Validation must open any containing disclosure before focusing an error.

Use concrete actions such as 「次へ：相手を選ぶ」, 「内容を確認する」, and 「鍵をかけて作成」. Preserve the current gating, separate drafts, back navigation, keyboard shortcut, cancellation, and prevention of stale progress after an input is removed.

### Open something received

1. Ask for the received message or encrypted file using the same content surface.
2. Ask for the matching secret key with a short explanation beside its input. Explain that it belongs to the recipient and is distinct from a GitHub password. The password field is optional and clearly labeled as the key's password.
3. Make 「鍵がわからないとき」 available in context. Explain that GitHub exposes public keys only and that the sender must use a public key for which the recipient has the secret key. Preserve unsupported-key and wrong-password recovery without losing input.

### Results and handoff

For encryption, the primary message is 「渡す準備ができました」. Show the file and the save/copy actions first, followed by short practical instructions: send the saved file or copied text using the user's usual email/chat; the recipient opens it in Fumi using their matching secret key. Creation does not claim that delivery has occurred.

For decryption, show readable text immediately or the save action for binary data. Preserve the original bytes, names, and preview truncation behavior.

Encrypted previews, format names, fingerprints, and CLI commands are secondary disclosures. Tool-specific compatibility details remain available and warnings that affect successful opening stay visible at review. Pending, failed, or mismatched signature verification stays directly visible with retry/cancel actions; it must never be hidden in an advanced disclosure. Clipboard rejection still reveals the preview and selects text for manual copying.

### Trial and clearing

Label the trial action 「サンプルで体験」 and explain that it supplies sample content and keys. Offer it on an empty first step so it cannot silently replace a nonempty draft. The sample-opening shortcut also preserves any existing decryption draft, key, password, and result; explain when those inputs need to be cleared before continuing the trial. Retain the existing real sample encryption/decryption rather than inventing a fake success state.

Keep restarting the current task as a secondary action. Move clearing both operations and technical background to a clearly labeled secondary disclosure, preserving both capabilities and their cancellation semantics.

## Implementation boundaries

- Work with the current HTML/CSS/JavaScript UI served by Next.js. Do not rewrite the app in React or add dependencies.
- Keep `src/app.js` as the controller and the existing `src/ui/` views as the presentation layer. Update the existing flow model only if an interaction requires it; do not introduce a second state machine.
- Most changes belong to `src/template.html`, `src/styles.css`, `src/ui/flow.js`, and `src/ui/result.js`. Controller changes cover only presentation state, edit links, disclosures, and trial availability.
- Do not alter cryptographic algorithms, encrypted formats, worker boundaries, GitHub lookup contracts, privacy policy/CSP, file limits, or CLI interoperability.
- Keep dynamic user content rendered through `textContent`. No new persistence, account system, analytics, key generation workflow, or automatic message delivery.

## Verification and acceptance

- Run the existing unit, production-build, formatting, CLI interoperability, and browser regression checks.
- Add focused browser assertions for the changed behavior: the empty-state explanation, stage-specific controls, edit links preserving drafts, advanced signature errors being revealed, the safe sample entry, and practical result instructions.
- Manually inspect desktop and mobile screenshots for initial, recipient, review, encrypted result, secret-key, and decrypted result states. Verify keyboard navigation and disclosure focus behavior.
- The local server must be running and its URL supplied to the user before final review. The PR describes the actual before/after behavior, includes validation results and screenshots where practical, and remains unmerged while the user reviews it.

## Design evidence

- Current UI inspected in the real browser and code, including the previous guided-flow plan.
- UI UX Pro Max returned a verified Minimalism & Swiss Style match and error-announcement guidance. Its general design-system palette suggested a dark security dashboard; keep the established light palette because it fits this product and the user's direction. Its progressive-disclosure search did not return a specific match, so the disclosure decisions use the user's requirement and the primary UX reference below.
- [Nielsen Norman Group: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) distinguishes secondary options from the sequential stages of a task. Apply both deliberately rather than hiding required information.
- [Apple Human Interface Guidelines: Disclosure controls](https://developer.apple.com/design/human-interface-guidelines/disclosure-controls) is a reference for the requested interaction direction; the documentation body was not available through the text browsing tool during this audit.

## User review

The user has instructed implementation to continue. Deliver a running local preview in Chrome for their review. The separate final merge review remains required.

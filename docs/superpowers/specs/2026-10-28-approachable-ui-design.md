# Fumi: minimum useful interface

Status: revised from the user's UI review. Implement directly on `codex/approachable-ui` and update Draft PR#1. Final merge still waits for user review.

## Product decision

The essential task is encrypt/decrypt text or a file. Remove the wizard, review screen, demo, and encryption signing. Keep two operation tabs and one form per operation. Keep the current Japanese language, browser-only processing, key formats, limits, cancellation, and readable errors.

- Encryption: message/file + recipient → Encrypt. Resolve the GitHub key during this action, without a separate lookup or confirmation step.
- Decryption: ciphertext/file + own secret key + optional key password → Decrypt.
- Text results: display the text immediately and make Copy the primary action. Save and Edit are secondary. No collapsed ciphertext, delivery tutorial, filename card for ordinary text, or success prose.
- File results: show the filename and make Save primary.
- Advanced settings: one native disclosure for a supplied public key and explicit format. Technical result format and commands are another disclosure. Do not create separate duplicated beginner/expert applications.
- Keep labels, rather than relying on placeholders. Use short nouns and verbs. Keep one small privacy line and a compact help dialog.
- A supplied public key visibly replaces the GitHub recipient field; it must never silently override a different visible username.
- Copy uses the complete result. For exceptionally large previews, clearly identify truncation; clipboard denial must never offer a truncated ciphertext as a complete manual copy.
- Old signed ciphertext remains readable and checked. Retain mismatch/offline/retry/cancel where such a file needs it. Creating signatures is unavailable and worker requests for signing must reject rather than silently produce unsigned output.

## Deletions

Remove `src/flow.js`, `src/ui/flow.js`, their tests, progress/review UI, signing inputs, sample entry/continuation and generation, unsigned signature explanations, duplicate clear controls, and the verbose result handoff. Remove their controller states and styles, rather than hiding them in Advanced.

Legacy signature writers used only for compatibility fixtures may remain development helpers; the application worker must not import or call them. Preserve cryptographic validation and compatibility readers.

## Research applied

- [NN/g: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/): expose common tasks directly and reserve secondary controls for less common needs. A wizard adds navigation to this short task.
- [NN/g: Aesthetic and Minimalist Design](https://www.nngroup.com/articles/aesthetic-minimalist-design/): every extra piece of information competes with the information needed for the task.
- [Apple: Principles of great design, WWDC26](https://developer.apple.com/videos/play/wwdc2026/250/): simplicity removes friction; plain language, clear purpose, and recognizable actions matter more than merely hiding functionality.
- UI UX Pro Max verified explicit input labels and visible submit feedback. Keep those while shortening prose.

## Acceptance

No demo or encryption-signing controls or worker actions remain. Encryption takes one submit, produces unsigned standard PGP/age, and shows text immediately with a prominent full-text Copy action. Text/file drafts, cancellation, private-key errors, clipboard failure, and legacy signed-data verification remain safe. Check desktop/mobile/keyboard, existing crypto tests, native CLI compatibility, and the generated CSP. Keep the local server and Chrome preview available and the PR unmerged.

# Fumi — a private letter

The interface combines an Apple-inspired editorial introduction with a directly usable encryption tool. System fonts, a local letter illustration, restrained blue and purposeful motion express the idea of sealing a private letter. UI UX Pro Max, frontend-design, apple-design, animate and web-design-guidelines inform the design; no UI runtime dependencies were added. See the [skill comparison](ui-animation-skills-research.md).

## Visible by default

- Two operation tabs: 「暗号化」「復号」. Each retains its draft in memory.
- Encryption: content, a file attachment action, the recipient's GitHub name, and one submit button. Recipient lookup and encryption happen in one submission.
- Decryption: ciphertext/file and the matching private key. After both inputs settle, try decryption automatically. Show the password and submit action only if the private key is protected; a cancelled/failed check has an explicit retry.
- Header: Fumi, 「すべて消去」 and help. Clear removes inputs, keys and results from both modes.
- A short privacy caption. Detailed limits, licensing and background live in help.

The short introduction sits beside the tool on desktop and above it on mobile. It has no redundant delivery link. It does not add a wizard or confirmation step. Keep visible labels even when reducing prose. A debounced GitHub preview shows public name, avatar, login and optional bio. Profile information remains advisory; encryption validates the selected keys before use.

## Progressive disclosure

GitHub username is the default recipient field. Check registered GPG/SSH keys after input settles. If neither is registered, reveal a public-key box with the reason and next action. A network failure also offers manual input but never claims that no key is registered. The username remains editable during automatic lookup. An explicit 「公開鍵を直接入力」 action supports recipients without GitHub and offline use.

Manual GPG armor/binary and SSH Ed25519/RSA keys use automatic format detection; there is no extra format selector. Supplying a manual key visibly replaces the GitHub recipient. 「GitHubユーザー名で指定する」 removes the manual key before switching back.

Decryption inputs settle for 600ms before a single local attempt. Protected GPG and SSH keys return the typed `PASSPHRASE_REQUIRED` condition, which reveals the password field with a plain-language explanation. Wrong/malformed keys and damaged ciphertext remain ordinary errors. Password typing does not launch expensive guesses. Changing ciphertext or secret key clears the old password and check; Edit does not resubmit. Cancel, file-read cancellation, clear and mode switches prevent stale jobs from appearing.

Text results display immediately, including ciphertext. 「コピー」 is primary, 「保存」 secondary, and 「編集」 retains the draft. Binary results prioritize Save. Format, filename and CLI commands are in the result's closed 「詳細」. The first 100,000 characters are previewed; Copy and Save use the complete result. A failed clipboard operation selects a complete short preview; a large result directs the user to Save rather than selecting truncated ciphertext.

Existing signed ciphertext keeps visible pending, verified, mismatch and unavailable states, with retry/cancel when relevant. Signature details are secondary. Unsigned results need no signature explanation. Copy/Save remain disabled while verification is pending; cancelling cannot be reversed by a late response.

## Visual system

- Background `#f5f5f7`, surface `#ffffff`, text `#1d1d1f`, secondary `#61616b`, accent `#0066cc`, line `#d2d2d7`, error `#b42318`, success `#247247`.
- System sans-serif. Inputs and result text 16px; labels and buttons 14px; privacy/metadata 12px. No external fonts.
- A 1160px outer grid contains the introduction and tool with a 64px gap. Stack below 760px; use 28px workspace padding (20px on mobile), 28px tool corners (24px mobile), and 12px input corners.
- Minimum 44px targets, 48px primary actions, visible keyboard focus, explicit labels, inline errors and a live status region. Decorative SVGs are hidden from assistive technology.
- Responsive 375/768/1024/1440px layouts, no horizontal page overflow, reduced-motion support. The selected tab has a moving surface and subtle shadow. The sticky header keeps clear/help available while scrolling long keys.

## Motion

A 650ms entrance introduces the composition. Actions use 160ms press feedback, a 250ms tab transition and a brief result reveal. A fixed illustrative phrase transforms into cipher characters over 700ms on encryption and reverses on decryption. Real work starts immediately; quick results are available while the illustration finishes. Cancel, error, clear and mode changes stop pending frames. The letter becomes a compact line on mobile.

Decorative text never copies a user’s message and is hidden from assistive technology. Reduced motion disables transforms and character animation while keeping readable status. Reduced transparency makes the header solid.

## Data boundaries

Content, private keys and passwords stay in the browser. Public-key, public-profile and avatar lookup use the network through fixed-origin endpoints. Web avatars are same-origin raster images; standalone uses an initial instead. No persistent input or key storage. Preserve the worker, byte limits, validation, cancellation and legacy signed-data verification.

## References

- [NN/g: Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/): prioritize common actions and move infrequent choices to a second layer.
- [NN/g: Aesthetic and minimalist design](https://www.nngroup.com/articles/aesthetic-minimalist-design/): extra information competes with the information a task needs.
- [Apple design session](https://developer.apple.com/videos/play/wwdc2026/250/).
- [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill).

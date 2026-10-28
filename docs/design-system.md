# Fumi UI

The interface combines an Apple-inspired introduction with a directly usable encryption tool. System fonts, a local letter illustration, blue accents and purposeful motion show encryption and decryption. UI UX Pro Max, frontend-design, apple-design, animate and web-design-guidelines inform the design; no UI runtime dependencies were added. See the [skill comparison](ui-animation-skills-research.md) and [copy and motion research](ui-copy-motion-research.md).

## Visible by default

- Two operation tabs: 「暗号化」「復号」. Each retains its draft in memory.
- Encryption: content, a file attachment action, the recipient's GitHub name, and one submit button. Recipient lookup and encryption happen in one submission.
- Decryption: initially two unselected native radio choices, 「ブラウザーで復号」「コマンドで復号」. One selection reveals that method in place, with no confirmation step. Choices remain editable while work is running so switching can cancel it.
- Header: Fumi, 「すべて消去」 and help. Clear removes inputs, keys and results from both modes.
- A short privacy caption. Detailed limits, licensing and background live in help.

The short introduction sits beside the tool on desktop and above it on taller mobile screens. Hide the introduction on short mobile screens to preserve space for the form. Keep visible labels even when reducing prose. A debounced GitHub preview shows public name, avatar and login in a compact passive row below the username. It has no card surface, border, arrow, link, hover treatment or keyboard stop, so it does not resemble a recipient-confirmation action. Profile information remains advisory; encryption validates the selected keys before use.

## Progressive disclosure

GitHub username is the default recipient field. Check registered GPG/SSH keys after input settles. If neither is registered, reveal a public-key box with the reason and next action. A network failure also offers manual input but never claims that no key is registered. The username remains editable during automatic lookup. An explicit 「公開鍵を使う」 action supports recipients without GitHub and offline use.

Manual GPG armor/binary and SSH Ed25519/RSA keys use automatic format detection; there is no extra format selector. Supplying a manual key visibly replaces the GitHub recipient. 「GitHubユーザー名で指定する」 removes the manual key before switching back.

The browser method prioritizes private-key file selection; paste is secondary. Its inputs settle for 600ms before a single local attempt. Protected GPG and SSH keys return the typed `PASSPHRASE_REQUIRED` condition, which reveals the password field with a plain-language explanation. Wrong/malformed keys and damaged ciphertext remain ordinary errors. Password typing does not launch expensive guesses. Changing ciphertext or secret key clears the old password and check; Edit does not resubmit. Cancel, file-read cancellation, clear and operation/method switches prevent stale jobs from appearing. Method changes preserve drafts, clear the password, cancel pending work and invalidate old results. Clear-all also resets the method to unselected. Protected-key detection folds the secret paste area and keeps the password in view; key-location Tips are hidden once a protected key has been found.

Text results display immediately, including ciphertext. 「コピー」 is primary, 「保存」 secondary, and 「編集」 retains the draft. Binary results prioritize Save and retain the actual file name. Results have no format disclosure or always-visible CLI commands. Encryption alone shows a short envelope-to-recipient animation and copy/save instructions for email or SNS. Use the actual GitHub recipient when registered keys were used; manual public keys get a neutral explanation of the matching private key. Do not imply the app sent anything. Decryption shows the recovered content without this delivery guide.

Command guidance belongs to the decryption method, not encryption results or a finished plaintext result. Detect PGP/age from the ciphertext header using the existing detector; this selects a tool without claiming successful ciphertext validation. The command method never submits retained secrets, runs a crypto Worker, reads private-key files or asks for a password in the browser. File mode requires saving pasted ciphertext before showing a command; editing the ciphertext resets preparation. Selected files are already available and retain their real names. The execution path is editable in a closed disclosure because browser downloads cannot confirm the final directory or renamed filename. Command Copy has a selection fallback on clipboard failure.

Ciphertext and secret-key sources are independent. GPG offers an explicitly selected existing keyring, a key file, or clipboard; age offers a key file or clipboard. Key paths begin empty. Choosing a key file supplies its name only, with a visible reminder to enter a path if it lives elsewhere. Recognizable key contents in a path field are rejected without repeating them. Supplied GPG keys use a temporary isolated keyring; clipboard SSH keys use a restricted temporary file. Generated scripts remove their temporary material on completion, failure and interrupt. Each clipboard read waits for a copy-and-Enter prompt because copying the command replaces the clipboard. Two clipboard sources prompt separately. macOS uses `pbpaste`, Windows uses PowerShell `Get-Clipboard -Raw`, and Linux requires choosing Wayland or X11. Binary ciphertext files retain file input; only armored ciphertext can use clipboard. POSIX and PowerShell quote paths separately. Ordinary controls stay compact. Command text opens in its own disclosure; execution environment and path changes live in Tips, which opens automatically when an environment must be selected. No private filesystem scan, SSH agent bridge or new key generation is offered.

The browser method reads the clipboard only after the corresponding paste-button action. Permission denial leaves manual paste available. A pasted secret-key path is identified as a location and directs the user to file selection instead of attempting cryptography with the path text. Stale asynchronous clipboard results cannot overwrite edited drafts or return after switching methods or clearing the form.

The first 100,000 characters are previewed; Copy and Save use the complete result. A failed clipboard operation selects a complete short preview; a large result directs the user to Save rather than selecting truncated ciphertext.

Existing signed ciphertext keeps visible pending, verified, mismatch and unavailable states, with retry/cancel when relevant. Signature details are secondary. Unsigned results need no signature explanation. Copy/Save remain disabled while verification is pending; cancelling cannot be reversed by a late response.

## Visual system

- Background `#f5f5f7`, surface `#ffffff`, text `#1d1d1f`, secondary `#61616b`, accent `#0066cc`, line `#d2d2d7`, error `#b42318`, success `#247247`.
- System sans-serif. Inputs and result text 16px; labels and buttons 14px; privacy/metadata 12px. No external fonts.
- A 1160px outer grid contains the introduction and tool with a 48px gap. Stack below 760px; use 24px workspace padding (20px on mobile), 24px tool corners and 12px input corners.
- Minimum 44px targets, 48px primary actions, visible keyboard focus, explicit labels, inline errors and a live status region. Decorative SVGs are hidden from assistive technology.
- Allocate the `100svh` height between the header and workspace. Normal initial, profile, manual-key, password and result states fit the viewport without page scrolling. Primary actions stay outside the inner scroll areas. Long files, ciphertext and expanded signature metadata scroll inside the result content. Do not mask overflow on the document or disable zoom.
- Responsive layouts tested from 375×667 to 1440×900, with reduced-motion support. The selected tab has a moving surface and subtle shadow. Clear/help remain in the header above the tool.

## Motion

A 650ms entrance introduces the composition. Actions use 160ms press feedback, a 250ms tab transition and a brief result reveal. A fixed illustrative phrase transforms into cipher characters over 950ms on encryption and reverses on decryption. An approximately 1100ms choreography folds the paper, moves the seal, draws an orbit and emits a wave and twelve particles. The encrypted result includes a finite 1100ms envelope-to-recipient animation. Real work starts immediately; quick results are available while the illustration finishes. Cancel, error, clear and mode changes stop frames and Web Animations. The letter becomes a compact icon on taller mobile screens.

Decorative text never copies a user’s message and is hidden from assistive technology. Reduced motion disables transforms and character animation while keeping readable status. Reduced transparency makes the header solid.

## Data boundaries

Content, private keys and passwords stay in the browser. Public-key, public-profile and avatar lookup use the network through fixed-origin endpoints. Web avatars are same-origin raster images; standalone uses an initial instead. No persistent input or key storage. Preserve the worker, byte limits, validation, cancellation and legacy signed-data verification.

## References

- [NN/g: Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/): prioritize common actions and move infrequent choices to a second layer.
- [NN/g: Aesthetic and minimalist design](https://www.nngroup.com/articles/aesthetic-minimalist-design/): extra information competes with the information a task needs.
- [Apple design session](https://developer.apple.com/videos/play/wwdc2026/250/).
- [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill).

# Fumi — minimal utility

The interface uses a compact Apple-inspired light style, system fonts and native disclosure controls. UI UX Pro Max supplied form-label, submission-feedback and keyboard-focus guidance. No new UI dependencies.

## Visible by default

- Two operation tabs: 「暗号化」「復号」. Each retains its draft in memory.
- Encryption: content, a file attachment action, the recipient's GitHub name, and one submit button. Recipient lookup and encryption happen in one submission.
- Decryption: ciphertext or file, the matching private key, its optional password, and one submit button.
- Header: Fumi, 「すべて消去」 and help. Clear removes inputs, keys and results from both modes.
- A short privacy caption. Detailed limits, licensing and background live in help.

There is no demo, sample-key generation, signature creation, wizard, confirmation step or introductory hero. Keep visible labels even when reducing prose.

## Progressive disclosure

「詳細設定」 contains manual public-key entry/file import and the format override. Auto is the default. Manual keys replace the GitHub recipient field; the summary shows that this source is active even when collapsed. Relevant errors reopen the disclosure. Explicit formats and partial lookup failures never silently fall back to another format.

Text results display immediately, including ciphertext. 「コピー」 is primary, 「保存」 secondary, and 「編集」 retains the draft. Binary results prioritize Save. Format, filename and CLI commands are in the result's closed 「詳細」. The first 100,000 characters are previewed; Copy and Save use the complete result. A failed clipboard operation selects a complete short preview; a large result directs the user to Save rather than selecting truncated ciphertext.

Existing signed ciphertext keeps visible pending, verified, mismatch and unavailable states, with retry/cancel when relevant. Signature details are secondary. Unsigned results need no signature explanation. Copy/Save remain disabled while verification is pending; cancelling cannot be reversed by a late response.

## Visual system

- Background `#f5f5f7`, surface `#ffffff`, text `#1d1d1f`, secondary `#6e6e73`, accent `#0066cc`, line `#d2d2d7`, error `#b42318`, success `#247247`.
- System sans-serif. Inputs and result text 16px; labels and buttons 14px; privacy/metadata 12px. No external fonts.
- Main content width 640px within a 688px shell; 28px workspace padding, 20px on mobile; 18px card corners and 10px control corners.
- Minimum 44px targets, 48px primary actions, visible keyboard focus, explicit labels, inline errors and a live status region. Decorative SVGs are hidden from assistive technology.
- Responsive 375/768/1024/1440px layouts, no horizontal page overflow, reduced-motion support. Selected tabs have a subtle shadow; the workspace uses a border.

## Data boundaries

Content, private keys and passwords stay in the browser. Only public-key lookup uses the network. No persistent input or key storage. Preserve the worker, byte limits, validation, cancellation and legacy signed-data verification.

## References

- [NN/g: Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/): prioritize common actions and move infrequent choices to a second layer.
- [NN/g: Aesthetic and minimalist design](https://www.nngroup.com/articles/aesthetic-minimalist-design/): extra information competes with the information a task needs.
- [Apple design session](https://developer.apple.com/videos/play/wwdc2026/250/).
- [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill).

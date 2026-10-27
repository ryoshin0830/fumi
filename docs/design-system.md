# Fumi — Apple-inspired utility

Applied skill: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.

Verified style search: **Minimalism & Swiss Style**. The general privacy palette returned a dark security dashboard, so it is intentionally replaced by the user's Apple-inspired light direction. No external fonts, decorative hero, marketing sections or animation libraries.

## Visual system

- Background #f5f5f7; surface #ffffff; text #1d1d1f; secondary text #6e6e73; accent #0066cc; accent text #ffffff; borders #d2d2d7; success #247247; error #b42318.
- System sans-serif (`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, Japanese system fallbacks). Body and form inputs 16px; descriptions and labels 14px; compact supporting labels at least 12px; page heading 32px desktop / 25px mobile. Line height 1.6.
- 8px spacing rhythm; 24px card padding mobile and 32px desktop; 20px card corners; 10px control corners; subtle shadows only on main workspace and selected segments.
- Main working width 736px; app frame 1040px. Content takes priority over decorative elements.
- A prominent, equally weighted segmented control for **鍵をかけて渡す / 受け取って開く**. Each mode preserves its own draft in memory. One blue primary action per mode. Input type and key details use subordinate controls. Progress is a compact line above the task heading, without boxed tiles or a repeated visible step count.
- All interactive targets at least 44px; visible keyboard focus; semantic labels, inline errors and one live status region. Normal text contrast >=4.5:1. Hide decorative SVGs from assistive technology. Support 375, 768, 1024, 1440px and reduced motion.

## Guided interaction

Use staged disclosure for task order and progressive disclosure for optional capabilities. The initial screen contains only content selection, the two equally available operation tabs, and a trial action. Do not show recipient, signature, private key, fingerprint or command inputs together.

- Encrypt: content → recipient → review/create → result. Decrypt: received content → own private key → result.
- Completed steps remain available as editable summaries. Next is disabled until prerequisites are present, with an explanation. Missing prerequisites clamp progress back to a reachable step. Back and operation switching retain separate drafts; clearing resets the relevant progress and inputs.
- Use everyday Japanese labels: 「鍵をかけて渡す」「受け取って開く」「何を届けますか？」「誰に届けますか？」. Give inputs visible labels and explain disabled continuation in the empty state. Explain public/private keys in their actual input context, including what to ask the recipient for and why a secret key differs from a GitHub password. A missing secret key cannot be fetched from GitHub.
- Show the recipient's opening tool at review. Explain clearly when age cannot be opened by GPG and when signatures require ZIP extraction in native tools.
- Signature starts off inside the review step's 「追加オプション：送り主の証明」 disclosure. Enabling 「送り主の証明を付ける（署名）」 reveals the sender's account, own secret key and optional password. Key details, format choice and extended compatibility help remain collapsed. An error inside a closed disclosure reopens it before receiving focus.
- Review summaries offer direct edits for content and recipient without losing drafts. Results replace inputs and prioritize save/copy plus editing. 「渡す準備ができました」 describes creation, followed by practical email/chat handoff and the recipient's opening instructions. Encrypted previews start closed; readable decrypted text starts open. Technical formats and commands are on demand. Clipboard denial opens the preview before selecting its content for manual copy.
- Unsigned output has an optional explanation instead of a prominent verification panel. Signed output always shows pending/verified/mismatch/unavailable status and any retry/cancel action. A pending lookup cannot hide its cancellation control or enable saving prematurely.
- Move focus to the current heading after navigation, or to a visible inline error. Errors in earlier input steps reopen the relevant step. Do not use fixed overlays that obscure keyboard focus. Keep touch targets >=44px, readable labels and reduced-motion support.
- Offer 「サンプルで体験」 only on an empty first step, with an explanation that sample content and keys are supplied. Check both input kinds and any active-mode keys/passwords so a trial cannot overwrite a draft. Keep current-input reset secondary; place clearing both modes and technical background in 「プライバシーとデータの消去」.

## Data and identity

Next.js retrieves fixed GitHub `.gpg`/`.keys` public pages through the same-origin endpoint. Only the username and key type are sent. Keep existing cryptography, verification, cancellation and privacy boundaries. No persistent storage of inputs, keys or progress.

Current-key verification confirms an actual signature using the account's current registered public key. It does not certify the entire secret-key file or a person's real-world identity. Keep those limits in the optional explanation while showing material signature failures directly.

## References and verification

UI UX Pro Max searches verified explicit form labels, submission feedback and keyboard focus guidance. The search did not contain a direct progressive-disclosure rule; structure follows the user's requirement, Apple disclosure controls and NN/g's distinction between progressive and staged disclosure. Browser checks cover the actual staged sequence, previous-step edits, errors, clipboard fallback, optional controls and375/768/1024/1440px widths.

# Fumi — Apple-inspired utility

Applied skill: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.

Verified style search: **Minimalism & Swiss Style**. The general privacy palette returned a dark security dashboard, so it is intentionally replaced by the user's Apple-inspired light direction. No external fonts, decorative hero, marketing sections or animation libraries.

## Visual system

- Background #f5f5f7; surface #ffffff; text #1d1d1f; secondary text #6e6e73; accent #0066cc; accent text #ffffff; borders #d2d2d7; success #247247; error #b42318.
- System sans-serif (`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, Japanese system fallbacks). Body 16px; labels 14px; notes at least 12px; heading 36px desktop / 28px mobile. Line height 1.6.
- 8px spacing rhythm; 24px card padding mobile and 32px desktop; 20px card corners; 10px control corners; subtle shadows only on main workspace and selected segments.
- Main working width 840px; app frame 1040px. Content takes priority over decorative elements.
- A prominent, equally weighted segmented control for **暗号化 / 復号**. Each mode preserves its own draft in memory. One blue primary action per mode. Input type and key details use subordinate controls.
- All interactive targets at least 44px; visible keyboard focus; semantic labels, inline errors and one live status region. Normal text contrast >=4.5:1. Hide decorative SVGs from assistive technology. Support 375, 768, 1024, 1440px and reduced motion.

## Interaction

Encrypt: content → recipient → encrypt → result. Decrypt: encrypted content → private key/passphrase → decrypt → result. Keep the entire operation on one screen, with progressive disclosure for raw keys/fingerprints and command-line instructions.

Fetch keys only when the user presses **公開鍵を取得**. Resolve GitHub handles/profile URLs/.gpg/.keys URLs to an account. Use the CORS-enabled GitHub API for the equivalent public key data. Never send content, private keys or passphrases. Show fetched account, count and format; fetching is not identity verification. OpenPGP and SSH/age are distinct formats. Show **OpenPGP・GPG互換** or **age・SSH鍵** on the action and result; no silent fallback after an error.

Loading is visible and cancellable; edits clear stale results. Success reveals a result card with copy/save and a concise explanation of how the recipient opens it. Errors appear alongside the related input and retain the draft. Reset clears only the active mode; **すべて消去** clears both drafts and keys. No persistent storage.

## Optional signatures

Use an off-by-default switch in a grouped row to reveal signer account/private-key/passphrase inputs. Only necessary controls are visible. Keep signature status beside the restored file and distinguish local signature validity, a claimed GitHub account, and verification with the account's current key. Neutral unsigned, blue pending, green current-key match, red current-key mismatch, amber unavailable; always include descriptive text and an icon. Retry is secondary. No routine modal prompts. Sources: Apple HIG Toggles, Disclosure controls, Feedback; UI UX Pro Max required-field and submit-feedback guidance. Only public keys/usernames use the network; update privacy copy for automatic signed-file checks.

# Passive recipient summary correction

The user identified that the full-width GitHub profile link resembles a recipient confirmation button. Keep the existing automatic lookup and information below the username, but use a passive identity row: 32px avatar, name and GitHub login, with no enclosing card, border, tinted surface, arrow, hover treatment, link or keyboard stop. No explanation text is added. The blue encryption button remains the primary action.

- [x] Replace the profile anchor with a plain identity row in `src/template.html`; remove link setup/reset in `src/ui/recipient.js`.
- [x] Simplify the profile styles in `src/styles.css`, retaining name truncation and fallback initials.
- [x] Extend the existing browser profile scenario to check the passive semantics and click/keyboard behavior; rerun profile/motion and layout states, inspect desktop/mobile screenshots.
- [x] Add encryption-only terminal Tips and verify both tools, filename shell quoting, cleanup and expanded Tips at all eight sizes (64 layout states total).

Delivery: verify formatting and production build, update the current PR #2 and push this correction. Keep Next running as a detached local process. The PR records the delivered commit and CI outcome; see the current [verification record](../../review/motion-ui-verification.md).

Separate runtime diagnosis: GitHub `.gpg` and `.keys` both returned 200, but the previous local port 3100 process had ended. The existing browser recorded successful initial API requests; a new same-origin key request failed with connection refused. Restart Next as a detached local process with its own log and verify repeat requests after the launcher exits. No crypto or key-fetch fallback change is justified by this evidence.

Follow-up request: add optional local-decryption commands below the encrypted result. Use a closed native disclosure, GPG/age according to the actual output, the actual shell-quoted saved filename, and short private-key/folder guidance. Keep decryption results free of these instructions. Extend the result tests for both tools, safe shell argument handling and cleanup; exercise expanded Tips at all eight viewport sizes.

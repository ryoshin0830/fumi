# Fumi UI and motion verification

Verified 2026-10-28 on Node.js 24.15.0, Next.js 16.4.3 and Go 1.27.3. The existing isolated worktree remains available on `tree-pushing-ferry`.

## Automated checks

- `npm run format:check`: passed.
- `npm run build`: production build passed, including the two new dynamic profile/avatar routes. Web HTML is approximately 86 KiB; standalone HTML is 9.56 MiB. No new runtime dependencies.
- `GO=/private/tmp/dgpg-go-toolchain/go/bin/go npm test`: 184 tests passed, none skipped. Includes profile transport boundaries, streamed byte limits, abort/timeout handling, avatar content types, motion frame cleanup/reduced motion and both generated CSPs.
- `GO=/private/tmp/dgpg-go-toolchain/go/bin/go npm run test:cli`: all 12 compatibility cases passed, including six signed archives and six direct original outputs.
- `FUMI_URL=http://127.0.0.1:3100/ FUMI_TASK=18 npm run test:browser`: all nine scenario groups passed. Covers GPG/age text and binary files, exact round trips, complete Copy/Save, denied clipboard, manual keys, retained drafts, cancellation, old signatures, mismatched/offline/retry states and tampered data. No JavaScript or CSP errors; captured application requests used only allowed GET endpoints without bodies.
- `FUMI_URL=http://127.0.0.1:3100/ FUMI_TASK=18 npm run test:motion`: passed against both development and production servers. Covers stale profiles, safe text, advisory failures, manual-key replacement, reset/mode changes, actual encryption/decryption, cancellation/error motion reset, reduced-motion submission and immediate access when the real worker result arrives.

The first baseline test run could not find Go in PATH. Reusing the existing `/private/tmp/dgpg-go-toolchain/go/bin/go` resolved that environment issue. No toolchain installation or global PATH change was needed.

## Visual and live checks

- Viewports 375, 768, 1024 and 1440px had no horizontal page overflow. The initial primary action stayed inside 844, 1000, 900 and 714px heights respectively.
- Visually inspected [desktop with live profile](motion-desktop.png), [mobile](motion-mobile.png), and [completed encryption](motion-result.png).
- Production profile and avatar endpoints returned the real public `ryoshin0830` profile and a PNG. Encrypting a short sample through that account's live GitHub public key produced an OpenPGP result without errors.
- Arrow keys switched operation tabs; Escape closed Help. The local browser tab remains available for inspection.
- The sticky tab position was adjusted after a scroll test exposed header overlap. Subsequent complete browser regression passed.

## Reviews

Applied frontend-design, apple-design, animate, UI UX Pro Max and the freshly fetched Vercel Web Interface Guidelines. Checked semantic controls, labels, focus, text containment, avatar dimensions, safe rendering, touch sizes and reduced motion. Decorative motion uses a fixed phrase rather than message contents.

An independent read-only code review found that the original broad `[data-operation]` listener also included the decorative letter. A browser regression reproduced that unintended mode change before the listener was narrowed to the actual tabs. The review also requested motion lifecycle coverage; deterministic frame tests and real browser submissions were added. Follow-up review found both issues resolved and no remaining important findings.

## Limits

Physical Safari/iPhone testing was not performed. GitHub public-profile API limits may temporarily prevent the preview; normal encryption and supplied public keys remain available. Standalone HTML deliberately uses a local initial instead of a remote avatar to preserve its image policy.

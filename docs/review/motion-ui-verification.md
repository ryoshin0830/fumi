# Fumi UI and motion verification

Verified 2026-10-28 on Node.js 24.15.0, Next.js 16.4.3 and Go 1.27.3. The existing isolated worktree remains available on `tree-pushing-ferry`.

## Automated checks

- `npm run format:check`: passed.
- `npm run build`: production build passed, including the two new dynamic profile/avatar routes. Web HTML is approximately 93 KiB; standalone HTML is 9.56 MiB. No new runtime dependencies.
- `GO=/private/tmp/dgpg-go-toolchain/go/bin/go npm test`: 187 tests passed, none skipped. Includes profile transport boundaries, streamed byte limits, abort/timeout handling, avatar content types, result guidance, motion cleanup/reduced motion and both generated CSPs.
- `GO=/private/tmp/dgpg-go-toolchain/go/bin/go npm run test:cli`: all 12 compatibility cases passed, including six signed archives and six direct original outputs.
- `FUMI_URL=http://127.0.0.1:3100/ FUMI_TASK=18 npm run test:browser`: all nine scenario groups passed. Covers GPG/age text and binary files, exact round trips, complete Copy/Save, denied clipboard, manual keys, retained drafts, cancellation, old signatures, mismatched/offline/retry states and tampered data. No JavaScript or CSP errors; captured application requests used only allowed GET endpoints without bodies.
- `FUMI_URL=http://127.0.0.1:3100/ FUMI_TASK=18 npm run test:motion`: passed against both development and production servers. Covers stale profiles, safe text, advisory failures, manual-key replacement, reset/mode changes, actual encryption/decryption, cancellation/error motion reset, reduced-motion submission and immediate access when the real worker result arrives.

The first baseline test run could not find Go in PATH. Reusing the existing `/private/tmp/dgpg-go-toolchain/go/bin/go` resolved that environment issue. No toolchain installation or global PATH change was needed.

## Visual and live checks

- Viewports 375, 768, 1024 and 1440px had no horizontal page overflow. The initial primary action stayed inside 844, 1000, 900 and 714px heights respectively.
- Visually inspected [desktop with live profile](motion-desktop.png), [mobile](motion-mobile.png), and [completed encryption](motion-result.png).
- Production profile and avatar endpoints returned the real public `ryoshin0830` profile and a PNG. Encrypting a short sample through that account's live GitHub public key produced an OpenPGP result without errors.
- Arrow keys switched operation tabs; Escape closed Help. The local browser tab remains available for inspection.
- Tabs and actions now have fixed positions within the available viewport. See the subsequent layout correction below.

## Reviews

Applied frontend-design, apple-design, animate, UI UX Pro Max and the freshly fetched Vercel Web Interface Guidelines. Checked semantic controls, labels, focus, text containment, avatar dimensions, safe rendering, touch sizes and reduced motion. Decorative motion uses a fixed phrase rather than message contents.

An independent read-only code review found that the original broad `[data-operation]` listener also included the decorative letter. A browser regression reproduced that unintended mode change before the listener was narrowed to the actual tabs. The review also requested motion lifecycle coverage; deterministic frame tests and real browser submissions were added. Follow-up review found both issues resolved and no remaining important findings.

## Limits

Physical Safari/iPhone testing was not performed. GitHub public-profile API limits may temporarily prevent the preview; normal encryption and supplied public keys remain available. Standalone HTML deliberately uses a local initial instead of a remote avatar to preserve its image policy.

## Delivery

[PR #2](https://github.com/ryoshin0830/fumi/pull/2) is open against main, with screenshots and validation in the description. The production server is running at http://127.0.0.1:3100/ using `npx next start --hostname 127.0.0.1 --port 3100`. The worktree and review browser tab are preserved.

## Progressive-disclosure correction

The follow-up removes the delivery link and format selector. GitHub is the default recipient; absent registered keys or a failed lookup reveal a contextual GPG/SSH public-key box. The username remains editable, and returning from a manual key removes that key and starts a fresh username entry.

Decryption initially shows only ciphertext and private key. A settled pair starts one local attempt. Unprotected GPG/SSH keys decrypt without a password step; the typed protected-key condition reveals the password field. Wrong keys, invalid ciphertext and wrong passwords remain separate error paths. Edit does not resubmit, and cancelled file reads cannot start a late decryption. Cancellation leaves an explicit retry action.

Reverified production build, formatting, all 184 unit tests and 12 CLI cases. Updated the existing browser regression to the new flow; all nine groups passed with no JavaScript/CSP errors. The motion suite passed, and `npm run test:disclosure` passed against development and production with protected/unprotected GPG and SSH, wrong passwords/keys, manual-source reset, and a delayed cancelled file read. Long legacy-signature regressions use native keyboard submission; the disclosure suite verifies pointer submission too.

An independent review found the late file-read continuation issue. Its job guard and a browser regression address that issue; no other material findings remained. The SSH WASM was rebuilt using the existing matching Go 1.27.3 toolchain to preserve the typed password condition across the bridge.

Visually inspected [initial decryption](progressive-decrypt.png), [conditional password](progressive-password.png) and [missing-key fallback](progressive-manual-key.png), and refreshed the prior desktop/mobile/result screenshots. A real `octocat` lookup returned no GPG or SSH keys and revealed the fallback without hiding username entry.

## Result clarity, expressive motion and viewport fit

Removed the format/filename disclosure and CLI commands from encryption and decryption results. Encryption alone explains copying or saving for email/SNS and identifies the actual registered GitHub key holder. Manual keys get neutral matching-private-key guidance. Decryption shows the recovered content without delivery instructions. Binary file names and legacy signature verification remain available where needed.

Applied the [copy and motion research](../ui-copy-motion-research.md): removed slogans, ornamental English and the footer. Re-read animate recipes, apple-design and frontend-design. The bounded 950ms character transformation now accompanies paper folding, a moving seal, orbit, wave and twelve particles. A finite envelope-to-recipient motion explains the encrypted result. Result access is immediate, reduced motion is honored, and reset/cancel cancels active Web Animations and frames. [Motion recording](delivery-motion.gif) uses a public GitHub recipient and a harmless sample message.

The page allocates its `100svh` height between the header and tool. The form and result each have an inner content area, with action buttons outside it. Ordinary states need no page or form scrolling. Exceptionally long file names and expanded signature metadata scroll within the result content while Save remains visible. The document does not hide overflow. Short mobile viewports omit only the decorative introduction. Profile biographies are omitted, and long display names truncate within the card while the GitHub login remains visible.

`npm run test:layout` passed 56 state/viewport combinations across 1440×900, 1366×768, 1440×714, 1280×720, 1024×768, 375×844, 390×844 and 375×667. At each size it checks initial, profile (including a long display name), encrypted, manual-key fallback, password, decrypted and long-file/expanded-signature states. Whole-document overflow was zero, ordinary inner-form overflow was zero, and primary actions stayed on screen. Real disposable-key encryption/decryption drives normal states; the long-file/signature case is a layout fixture.

Reverified all 187 unit tests, 12 CLI cases, the full nine-group browser regression, disclosure suite and motion suite. Browser regression reported no JavaScript/CSP errors and only expected public-data GET requests. Full production build and formatting passed. The production HTTP response was byte-identical to the generated web HTML. Refreshed all six review screenshots, including manual-key and password states at 375×667, and inspected intermediate motion frames.

An independent review found that a long binary file name and expanded signature could still push Save off-screen. Reproduced the failure at 375×667 (document height 920px), then moved result contents into a scrollable wrapper with actions outside it. The 56-state regression and follow-up review confirm that fix; no other material findings remained.

# Fumi: expressive, private by design

Status: implemented and verified. [PR #2](https://github.com/ryoshin0830/fumi/pull/2) is open; the production build is running locally at http://127.0.0.1:3100/.

## Direction and alternatives

Recommended: an Apple-inspired editorial utility. Use a spacious light canvas, ink typography, a restrained blue accent, a short large headline, a crafted encryption illustration, and the working tool on the first screen. Encryption has one submit action. Decryption now follows the user’s subsequent correction: automatically try after ciphertext and private key input, then request a password only for protected keys. On desktop, place the introduction beside the tool; on mobile, use a short stacked introduction.

Alternative: a long product landing page with scroll chapters. It offers more storytelling but delays the everyday encryption task. Alternative: a dark glass dashboard. It offers stronger spectacle but fits the requested Apple landing-page direction less closely. Adopt the editorial utility.

## Visual system

- Japanese interface, system fonts, off-white surfaces, dark ink, blue accent, fine borders, soft shadows and generous spacing.
- Build the encryption illustration with local HTML/CSS/SVG. No remote font, decorative asset or animation runtime is needed.
- Keep content labels, file attachments, operation tabs, help and clear-all. Manual public keys are disclosed contextually when GitHub has no registered keys, when lookup fails, or through an explicit manual-input action. Detect GPG/SSH format automatically.
- Preserve drafts on mode changes and Edit. Copy and Save always use the complete real result.
- The previous prohibition on an introductory hero in `docs/design-system.md` is superseded by this requested landing-page treatment.

## Meaningful motion

- A brief entrance for the introduction and workspace, subtle button feedback, and a sliding tab indicator.
- On an actual encryption submission, show a bounded decorative text-to-cipher transformation with a lock/seal motif and a clear live processing label. Use a fixed illustrative phrase rather than cloning message contents into decorative DOM.
- Start real work immediately. Do not manufacture progress percentages or add a timer that delays a ready result. Keep cancellation available. A failure restores the editable input and existing inline error.
- Reveal the genuine result with a short transition and completion feedback. Decryption uses the inverse visual language where appropriate.
- Decorative scrambled text is hidden from assistive technology. Honor `prefers-reduced-motion` in CSS and JavaScript, cancel active frames/timers when work is cancelled, cleared, or the operation changes. A successful quick operation may finish its bounded illustration alongside the already available result; no animation may block result access.

## GitHub recipient preview

- After a valid GitHub username, @name or supported profile/key URL is entered, debounce lookup by approximately 450 ms.
- Show public display name, login, avatar, and an optional short bio, with a GitHub profile link. Use textContent and validated GitHub/avatar URLs.
- A same-origin GET endpoint fetches only the public GitHub user profile. Validate usernames; fix the upstream host; bound time and response size; do not forward credentials or arbitrary URLs. Proxy avatars through a narrowly scoped same-origin path or return a safe locally rendered fallback so the page's image policy stays restricted.
- Profile information is presentation only. A profile card is not a confirmation of usable keys or a person's identity. Check registered key presence as the username settles; validate the actual encryption keys when submitting.
- Abort superseded requests and guard late responses. Clear/reset, invalid input, manual public keys and mode changes remove stale presentation. Loading, missing accounts, rate limits and network errors have compact states and never block manual keys or normal encryption.
- The standalone HTML uses its existing public GitHub API network allowance; avatar fallback must work without adding arbitrary network permissions.
- Update the privacy copy and architecture documentation to describe the new public profile/avatar requests accurately. Content, private keys and passwords remain local to the worker.

## Architecture and scope

Keep the current Next.js Route Handler + generated HTML/vanilla JavaScript architecture. Read installed Next.js route documentation before changing routes. Add focused profile/motion UI modules and a bounded profile server helper; do not migrate the application to React or alter crypto, signatures, formats, limits or worker boundaries. Install agent skills at user scope rather than adding their code or npm dependencies to the application.

## Verification and delivery

- Test profile validation, fixed upstream destination, timeout/error/size cases, and stale-response cancellation.
- Run formatting, production build, existing unit/crypto tests and CLI interoperability checks when tooling is available.
- Exercise real encryption/decryption, cancel, error, mode switches, clear-all, manual public keys and result copy/save in ego-browser. Check narrow mobile and wide desktop, keyboard focus and reduced motion, with screenshots saved for review.
- Record verified skill popularity and installation paths. Commit the completed change, push this isolated branch and open an unmerged pull request with validation and screenshots.
- Leave the completed application running locally and provide its URL and the PR link.

The user’s progressive-disclosure correction is implemented by [the follow-up plan](../plans/2026-10-28-progressive-inputs.md). It removes the delivery link and visible format choice and makes password input conditional on a typed protected-key result.

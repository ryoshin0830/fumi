# Fumi multilingual interface

Approved scope: provide Japanese, English, Simplified Chinese, Traditional Chinese,
Korean, Spanish, French, German, Portuguese, Hindi and Arabic. The user authorized
implementation, PR creation, review, browser verification and merge if checks pass.

Use browser language preferences on first visit, a native language selector in the
header, and English for unsupported languages. Store only the selected locale in
localStorage; handle unavailable storage without breaking the app. Recognize Chinese
script/region variants. Keep inputs, files, results and active operations intact
when changing language; update all visible copy, accessible labels, errors,
signature states, title, description and locale-sensitive dates. Do not translate
user content, key material, filenames, commands, third-party license text or protocol
names. Arabic uses RTL layout while technical fields and commands remain LTR.

Use small bundled translation catalogs and native browser APIs, without adding a
runtime dependency or remote translation service. Both web and embedded standalone
HTML must contain all translations and preserve the existing CSP and privacy
boundaries. Translation rendering uses textContent/attributes, never translated
HTML. Keep cryptographic algorithms, byte limits and validation behavior intact.
Existing Japanese crypto diagnostics may be mapped at the display boundary, but
all known messages and variable placeholders must be covered and unknown errors
must receive a safe localized fallback. Never translate ciphertext or plaintext.

Retain the current compact light interface, system fonts, blue accent and visible
labels. The selector must have a visible label, native language names, keyboard
support and a 44px touch target. Check long labels and RTL at mobile widths.

Validation: catalog key and placeholder parity; language negotiation and persistence;
blocked storage; static and dynamic text and errors; input/result preservation;
web and standalone assets/CSP; real OpenPGP and age encryption/decryption; signature
verification states; responsive layout. Run formatting, production build, unit and
CLI compatibility suites. Review the branch independently before merging, and
verify CI and deployment where available.

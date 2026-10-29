# Fumi Multilingual Interface Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to execute this plan task by task with independent review before merge.

**Goal:** Ship eleven complete interface languages with browser detection and safe switching.

**Architecture:** Bundle catalogs in the existing esbuild client. Keep one locale module responsible for negotiation, lookup, persistence and static DOM translation. Render dynamic copy through the same translations while preserving crypto state.

**Tech Stack:** Plain JavaScript, HTML/CSS, native Intl/localStorage, esbuild, Next.js route handler, node:test, ego-browser.

## Global Constraints

- No new runtime dependencies, external fonts, translation network calls or input persistence.
- Support ja, en, zh-CN, zh-TW, ko, es, fr, de, pt, hi and ar; fallback en.
- Preserve byte limits, crypto validation, CSP, cancellation and standalone functionality.
- Preserve user-entered text, files and results during locale changes.

### Task 1: Translation foundation and all catalogs

Files: `src/i18n.js`, locale catalogs under `src/`, `tests/i18n.test.mjs`.

- [x] Write tests that import locale APIs and fail before implementation. Cover exact/base language negotiation, Chinese script/region matching, ordered preferences, unsupported fallback, invalid saved value, storage exceptions and interpolation.
- [x] Implement `resolveLocale(preferences, saved)`, `t(key, params)` and locale getter/setter using an explicit allowlist. Never interpolate HTML. Keep browser globals optional so node:test can import it.
- [x] Supply complete dictionaries with equal keys and placeholders in every supported language, including all static copy, status and error diagnostics. Test key and placeholder parity against English.
- [x] Run `node --test tests/i18n.test.mjs` and record passing output.

### Task 2: UI integration and localized diagnostics

Files: `src/template.html`, `src/styles.css`, `src/app.js`, `src/ui/{dom,result,signature}.js`, `src/worker-client.js`, `scripts/build.mjs`, relevant error producers as needed.

- [x] Add a visible language label and native select to the header; annotate static text and translated attributes with stable keys.
- [x] Apply the initial locale before app interaction; update html lang/dir, title and description and safely persist explicit selection only.
- [x] Localize dynamic actions, results, signature states, dates and known diagnostic messages. Keep original error classification stable; use a localized safe fallback for unknown library diagnostics.
- [x] Language changes re-render copy without clearing drafts/results, resetting file inputs, cancelling work or enabling locked actions. Inputs holding keys/code, usernames, result previews and CLI commands stay LTR.
- [x] Use logical spacing and wrapping so mobile and RTL labels fit the current design. Keep external license text unchanged.
- [x] Run client build, unit tests and formatting checks; retain exact CSP hashes and keep the web client lightweight.

### Task 3: Browser verification, review and integration

Files: browser regression scenario(s), `README.md`, verification notes if useful.

- [x] Extend existing ego-browser coverage for every language, persistence, RTL, long labels, input/result retention, errors and standalone file behavior. Pin existing Japanese-specific regression scenarios to Japanese explicitly.
- [ ] Run production build, `npm test`, `npm run test:cli`, fixtures and browser regression tests. Inspect desktop and mobile screenshots.
- [x] Document supported languages and the locale-only storage exception in README/privacy copy.
- [ ] Commit and push the feature branch. Create and attach a PR with exact validation results using a body file.
- [ ] Apply `ponytail-review` and `superpowers:requesting-code-review` through an independent reviewer. Fix material findings and rerun affected checks.
- [ ] Wait for required CI/deployment checks. Merge only the reviewed passing revision. Verify merged state and deployed UI.

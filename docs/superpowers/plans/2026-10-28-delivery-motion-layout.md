# Result clarity, motion and viewport-fit implementation plan

> **For agentic workers:** Use superpowers:executing-plans for inline execution of the user's explicit UI corrections.

**Goal:** Remove result technical details, explain encrypted-content handoff, strengthen purposeful animation, remove generic copy, fit the viewport and push the completed correction to PR #2.

**Architecture:** Preserve the generated HTML UI and local crypto worker. Simplify result rendering, add an encryption-only handoff illustration, extend the existing bounded motion controller and fit the tool to available viewport height with inner content scrolling only where needed.

**Constraints:** No CLI/format disclosure in encryption or decryption results. Text downloads keep their real filenames internally; binary result filenames remain useful. Use the actual GitHub recipient only when its registered keys were used. Manual keys use a neutral key-holder explanation. No implication of automatic sending. No external libraries, private-content duplication or artificial result delay. Keep reduced motion, cancellation, complete copy/save and legacy signatures.

The user requested these changes directly. Use direct Japanese wording, remove ornamental slogans and decorative English, and retain concise recovery instructions. Stronger motion explains message → encrypted packet → recipient, rather than running an endless effect.

- [x] Research primary UI-writing and motion guidance and record the applied copy decisions.
- [x] Add failing result tests for removal of technical details, GitHub/manual recipient explanation and encryption-only guidance. Preserve complete result copy/save data.
- [x] Remove the disclosure and CLI formatter; render a compact handoff panel for encrypted text/files. Decryption shows only recovered content and relevant verification.
- [x] Strengthen the letter transformation with bounded folding, orbit/seal and particle motion, and animate the handoff visual. Reuse existing easing tokens, keep controls interactive and honor reduced motion.
- [x] Replace poetic/redundant interface copy with concrete descriptions and remove redundant footer content.
- [x] Add browser assertions for whole-document overflow and visible primary actions at desktop 1440×900, 1366×768, 1440×714, 1280×720, 1024×768 and mobile 375×844, 390×844, 375×667. Check initial/profile/manual/password/result states, not only empty input.
- [x] Adjust the height budget, field density and result preview so ordinary states do not create page scroll. Keep actions pinned and use an inner scroll area for exceptional content/short viewports, never hide necessary inputs or disable zoom.
- [x] Verify formatting, production build, unit/CLI tests, disclosure/motion/layout/browser regressions and visually inspect action and motion states. Request a focused independent review and fix material findings.
- [x] Refresh screenshots and docs, including a motion GIF and the long-file/expanded-signature regression.

Delivery: push this verified correction to the existing PR #2, confirm its checks, and leave the production build running at http://127.0.0.1:3100/. The PR records the delivered commit and CI result. See [verification evidence](../../review/motion-ui-verification.md).

# Terminal file decryption implementation plan

**Goal:** Decrypt downloaded PGP and age files through the copied terminal command, using pasted keys or key files.

**Design:** Keep the existing two prompts. Each accepts pasted armor or a literal file path (spaces and enclosing quotes allowed, without shell evaluation). Detect raw age by its header and binary PGP by its packet prefix; native tools validate the full input. File ciphertext always produces a new private `restored-*` file, including UTF-8 text. Pasted text retains its current display behavior. Preserve isolated keyrings, authenticated output, hidden input and cleanup on interruption. Apply the same behavior to POSIX and Windows PowerShell, without new runtime dependencies.

## Tasks

- [ ] Add failing tests in `tests/decryption-ui.test.mjs`: armored/raw file input, binary PGP keys, literal paths with spaces/quotes/metacharacters, invalid-path retry, text-file output, no overwrite and failed-decryption cleanup. Run `node --test tests/decryption-ui.test.mjs` and confirm failures come from missing file support.
- [ ] Update `src/ui/decryption.js`: read paths as bytes, validate format, copy into private temporary storage and remember whether ciphertext came from a file. Save file results uniquely. Repeat in PowerShell using literal paths and byte APIs. Run the same tests until green.
- [ ] Extend `scripts/e2e/container.mjs` and `terminal.py` to upload actual PNG, empty and UTF-8 files in the browser, download raw ciphertext and run the UI-copied command in a real PTY with file paths and mixed input sources. Compare exact bytes, permissions, input preservation, shell history, echo and temporary cleanup; retain existing cases.
- [ ] Document file paths and saved output in `README.md`. Run `npm run format:check`, `npm test`, `npm run build`, `npm run test:cli` and `DOCKER_CONTEXT=desktop-linux npm run test:container`.
- [ ] Review the complete diff and connected code, correct all actionable findings, open a PR, verify CI, merge to main and confirm the merged commit. Record evidence in `docs/review/terminal-files-verification.md`.

**Validation limits:** Linux container E2E covers POSIX with real GPG, age, zsh, Chromium, clipboard and PTY. Native Windows PowerShell and macOS terminal behavior require their own runtimes and are not implied by Linux results.

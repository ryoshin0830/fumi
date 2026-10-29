# GitHub profile HTML implementation plan

> Execute inline with superpowers:executing-plans, checking each completed task.

**Goal:** Display public GitHub profiles without using the REST API in the web app.

**Architecture:** Keep the existing profile JSON contract. Fetch bounded public
HTML, parse identity fields on the server, and cache successful public JSON for
five minutes on Vercel.

**Tech stack:** Next.js 16.4.3, Node.js 24+, parse5 8.0.1, node:test.

## Constraints

- Fetch only `https://github.com/{validated username}` without visitor credentials.
- Keep eight-second cancellation and a 2 MiB HTML limit.
- Return normalized public fields; never render fetched HTML.
- Cache successful profiles for 300 seconds only on Vercel; failures stay uncached.
- Preserve standalone API mode, key lookup, and avatar validation.

## Tasks

- [x] Reproduce production 429 and verify public HTML returns the actual profile.
- [x] Read the connected implementation and local Next.js route/fetch guides.
- [x] Reuse the isolated worktree, create `fix/github-profile-html`, run the baseline.
- [x] Update `tests/github-profile-server.test.mjs` with HTML fixtures, decoded
      entities, mismatched identity, fake tags in comments/scripts, HTTP errors,
      bounded streams and successful-only CDN caching. Run
      `node --test tests/github-profile-server.test.mjs` and observe the failures.
- [x] Add the bounded HTML parser in `server/github-profile-html.mjs`; update
      `server/github-profile.mjs` to fetch public HTML and normalize its fields.
      Install parse5 8.0.1 as a server dependency. Run the focused tests again.
- [x] Update the web data-source description in `scripts/build.mjs` and README.
      Rebuild generated HTML and run formatting, the full unit suite, and build.
- [x] Request real GitHub profile HTML through the local Next.js endpoint and
      confirm the real profile, icon and encryption in the browser.
- [ ] Review the diff, create the PR, verify CI, merge main, and verify the public
      profile, avatar and successful cache response on `https://fumi.ryosh.in/`.

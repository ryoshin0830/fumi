# GitHub public profile HTML

The production profile endpoint returns 429 while GitHub's public HTML profile
returns 200. The user requested a solution that does not use the official API.

Use the public profile HTML for the web application. An API retry keeps the same
rate limit; displaying only an avatar loses the person's name. Parse the public
HTML with parse5 and return the existing bounded `{ id, login, name, bio }` shape.
Validate the profile username and the avatar's fixed GitHub origin and numeric ID.
Never return HTML, execute its scripts, or forward visitor credentials.

Keep the existing eight-second deadline, cancellation, input validation and safe
errors. Permit at most 2 MiB of HTML because normal profiles exceed 64 KiB. Cache
only successful normalized profiles on Vercel for 300 seconds; browser responses
and all failures remain `no-store`. Existing key and avatar routes keep their
contracts. The standalone file continues using its documented API implementation
because GitHub HTML cannot be read cross-origin from a local HTML file.

Verification: fail-first tests for public HTML, entity decoding, identity checks,
response limits and errors; the full test suite and production build; actual
profile and avatar requests and browser display on the custom production domain.

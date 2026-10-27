import { githubKeysResponse } from '../../../../server/github-keys.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, context) {
  const { username } = await context.params;
  return githubKeysResponse(request, { username });
}

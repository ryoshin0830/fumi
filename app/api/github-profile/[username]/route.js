import { githubProfileResponse } from '../../../../server/github-profile.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, context) {
  const { username } = await context.params;
  return githubProfileResponse(request, { username });
}

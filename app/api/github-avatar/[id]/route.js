import { githubAvatarResponse } from '../../../../server/github-profile.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, context) {
  const { id } = await context.params;
  return githubAvatarResponse(request, { id });
}

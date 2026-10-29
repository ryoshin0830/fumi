import { parse } from 'parse5';
import { normalizeProfile } from '../src/profiles.js';

function* walk(root) {
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    yield node;
    for (let i = (node.childNodes?.length || 0) - 1; i >= 0; i--) pending.push(node.childNodes[i]);
  }
}

export function parseGitHubProfile(html, username) {
  const nodes = [...walk(parse(html))];
  const attribute = (node, name) => node?.attrs?.find((attr) => attr.name === name)?.value;
  const meta = (property) =>
    attribute(
      nodes.find((node) => node.tagName === 'meta' && attribute(node, 'property') === property),
      'content',
    );
  const avatar = new URL(meta('og:image'));
  if (
    avatar.origin !== 'https://avatars.githubusercontent.com' ||
    !/^\/u\/[1-9]\d{0,15}$/.test(avatar.pathname)
  )
    throw new Error('Invalid public profile avatar');
  const name = nodes.find(
    (node) => node.tagName === 'span' && attribute(node, 'itemprop') === 'name',
  );
  const bio = nodes.find((node) => attribute(node, 'data-bio-text') !== undefined);
  return normalizeProfile(
    {
      id: Number(avatar.pathname.slice(3)),
      login: meta('profile:username'),
      name: [...walk(name)]
        .filter((node) => node.nodeName === '#text')
        .map((node) => node.value)
        .join('')
        .trim(),
      bio: attribute(bio, 'data-bio-text'),
    },
    username,
  );
}

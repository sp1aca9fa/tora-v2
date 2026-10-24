import type { PostView } from './post-views';

/**
 * Posts with their replies folded under them, oldest reply first (a reply whose post is not in
 * the list stands on its own), newest post first.
 */
export function threads(posts: PostView[]): { post: PostView; replies: PostView[] }[] {
  const refs = new Set(posts.map((p) => p.ref));
  const replies = new Map<string, PostView[]>();
  for (const p of posts) {
    if (!p.parent || !refs.has(p.parent)) continue;
    const list = replies.get(p.parent);
    if (list) list.push(p);
    else replies.set(p.parent, [p]);
  }
  return posts
    .filter((p) => !p.parent || !refs.has(p.parent))
    .map((post) => ({ post, replies: (replies.get(post.ref) ?? []).toReversed() }));
}

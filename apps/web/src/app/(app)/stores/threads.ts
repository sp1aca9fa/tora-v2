import type { PostView } from './post-views';

/**
 * Posts with their replies folded under them, answers to replies included, oldest reply first (a
 * reply whose post is not in the list stands on its own, with the replies under it), newest post
 * first.
 */
export function threads(posts: PostView[]): { post: PostView; replies: PostView[] }[] {
  const byRef = new Map(posts.map((p) => [p.ref, p]));
  // The first post of a reply's thread found in the list (a reply in a loop stands on its own).
  const rootOf = (p: PostView) => {
    let root = p;
    const seen = new Set([p.ref]);
    while (root.parent && byRef.has(root.parent)) {
      root = byRef.get(root.parent)!;
      if (seen.has(root.ref)) return p;
      seen.add(root.ref);
    }
    return root;
  };
  const replies = new Map<string, PostView[]>();
  const firsts: PostView[] = [];
  for (const p of posts) {
    const root = rootOf(p);
    if (root === p) {
      firsts.push(p);
      continue;
    }
    const list = replies.get(root.ref);
    if (list) list.push(p);
    else replies.set(root.ref, [p]);
  }
  return firsts.map((post) => ({ post, replies: (replies.get(post.ref) ?? []).toReversed() }));
}

/**
 * Threads split by the posts that left Now (S29: a confirmed lottery's, whose replies all go with
 * it), and how many posts moved: each thread's post and replies, once each.
 */
export function splitMoved<T extends { post: { id: string }; replies: { id: string }[] }>(
  list: T[],
  moved: Set<string>,
): { kept: T[]; gone: T[]; count: number } {
  const gone = list.filter((th) => moved.has(th.post.id));
  return {
    kept: list.filter((th) => !moved.has(th.post.id)),
    gone,
    count: new Set(gone.flatMap((th) => [th.post.id, ...th.replies.map((r) => r.id)])).size,
  };
}

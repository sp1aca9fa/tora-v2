import { describe, expect, it } from 'vitest';
import type { PostView } from './post-views';
import { splitMoved, threads } from './threads';

const post = (id: string, parent: string | null = null) =>
  ({ ref: `b|${id}`, parent: parent && `b|${parent}` }) as PostView;
const shape = (posts: PostView[]) =>
  threads(posts).map((t) => [t.post.ref, t.replies.map((r) => r.ref)]);

describe('threads', () => {
  it('folds answers to replies under the first post, oldest first', () => {
    // Newest first, as the lists read them.
    const list = [post('5', '3'), post('4', '1'), post('3', '2'), post('2', '1'), post('1')];
    expect(shape(list)).toEqual([['b|1', ['b|2', 'b|3', 'b|4', 'b|5']]]);
  });

  it('keeps a reply whose post is not in the list on its own, with its answers', () => {
    expect(shape([post('9'), post('3', '2'), post('2', '1')])).toEqual([
      ['b|9', []],
      ['b|2', ['b|3']],
    ]);
  });

  it('shows replies in a loop of parents on their own', () => {
    expect(shape([post('2', '1'), post('1', '2')])).toEqual([
      ['b|2', []],
      ['b|1', []],
    ]);
  });
});

describe('splitMoved (S29)', () => {
  const th = (id: string, replies: string[] = []) => ({
    post: { id },
    replies: replies.map((r) => ({ id: r })),
  });
  it('splits by the moved posts and counts each post and reply once', () => {
    const list = [th('a', ['a1', 'a2']), th('b', ['b1']), th('c'), th('a', ['a1', 'a2'])];
    const { kept, gone, count } = splitMoved(list, new Set(['a', 'a1', 'a2', 'c']));
    expect(kept.map((x) => x.post.id)).toEqual(['b']);
    expect(gone.map((x) => x.post.id)).toEqual(['a', 'c', 'a']);
    expect(count).toBe(4);
  });
  it('moves nothing with nothing to move', () => {
    const list = [th('a')];
    expect(splitMoved(list, new Set())).toEqual({ kept: list, gone: [], count: 0 });
    expect(splitMoved([], new Set(['a']))).toEqual({ kept: [], gone: [], count: 0 });
  });
});

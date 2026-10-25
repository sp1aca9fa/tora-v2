import { describe, expect, it } from 'vitest';
import type { PostView } from './post-views';
import { threads } from './threads';

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

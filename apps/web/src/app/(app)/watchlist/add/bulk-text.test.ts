import { describe, expect, it } from 'vitest';
import { sameList } from './bulk-text';

describe('sameList', () => {
  it('takes a pasted list and the text the server sends back as the same list', () => {
    expect(
      sameList(
        'Star Fox | switch\nMetroid Prime | switch 2',
        'Star Fox | switch\r\nMetroid Prime | switch 2',
      ),
    ).toBe(true);
    expect(sameList('a\n\nb\n', 'a\r\n\r\nb\r\n')).toBe(true);
    expect(sameList('one line', 'one line')).toBe(true);
  });

  it('sees an edit made after the preview', () => {
    expect(sameList('a\nb', 'a\r\nc')).toBe(false);
    expect(sameList('a\nb\n', 'a\r\nb')).toBe(false);
    expect(sameList('a b', 'a\r\nb')).toBe(false);
  });
});

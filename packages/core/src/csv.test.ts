import { describe, expect, it } from 'vitest';
import { decodeText, parseCsv, toCsv } from './csv';

describe('csv', () => {
  it('round-trips quotes, commas, line breaks and formulas', () => {
    const rows = [
      ['item', 'cost', 'notes'],
      ['Box "A", 2nd', '-1200', 'line 1\nline 2'],
      ['=HYPERLINK("x")', '@sum', ' padded '],
      ['ピカチュウ', '', '+81'],
    ];
    const text = toCsv(rows);
    expect(text).toContain(`"'=HYPERLINK(""x"")"`);
    expect(text).toContain(',-1200,');
    expect(parseCsv(text)).toEqual(rows);
  });

  it('reads a byte order mark, bare line ends and blank lines', () => {
    expect(parseCsv('﻿a,b\n\n1,2\r3,"4"')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('reads Shift_JIS files from Excel', () => {
    // "商品,数量" in Shift_JIS.
    const sjis = new Uint8Array([0x8f, 0xa4, 0x95, 0x69, 0x2c, 0x90, 0x94, 0x97, 0xca]);
    expect(decodeText(sjis)).toBe('商品,数量');
    expect(decodeText(new TextEncoder().encode('商品,数量'))).toBe('商品,数量');
  });
});

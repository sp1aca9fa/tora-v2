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

  it("reads semicolons and tabs from other languages' Excel, and UTF-16 text", () => {
    expect(parseCsv('item;cost\n"A; B";1,5')).toEqual([
      ['item', 'cost'],
      ['A; B', '1,5'],
    ]);
    expect(parseCsv('item\tcost (€, net)\tshop\nA\t2\tB')).toEqual([
      ['item', 'cost (€, net)', 'shop'],
      ['A', '2', 'B'],
    ]);
    expect(parseCsv('"a;b",c\n1;2,3')).toEqual([
      ['a;b', 'c'],
      ['1;2', '3'],
    ]);
    const utf16 = new Uint8Array([
      0xff,
      0xfe,
      ...[...'商品\t数'].flatMap((c) => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8]),
    ]);
    expect(decodeText(utf16)).toBe('商品\t数');
  });

  it('gives no columns for a binary file named .csv', () => {
    const zip = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0xe3, 0x81, 0xff, 0x00,
    ]);
    const rows = parseCsv(decodeText(zip));
    expect(rows.flat().some((c) => c === 'item')).toBe(false);
  });
});

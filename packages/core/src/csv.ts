// CSV for spreadsheets (requirements S6): what Excel and other spreadsheet apps open and save.

/** A cell a spreadsheet would run as a formula (`=`, `+`, `-`, `@`), unless it is a number. */
const FORMULA = /^[=+\-@\t\r]/;
const NUMBER = /^-?\d+(\.\d+)?$/;

function cell(value: string): string {
  // Text from shops (item names) never runs as a formula: a leading ' makes it plain text.
  const safe = FORMULA.test(value) && !NUMBER.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) || safe !== safe.trim() ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Rows as CSV text, with Excel's line ends; the caller adds a byte order mark for Excel. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/**
 * The first row's separator: a comma, or the semicolon of Excel in many European languages, or
 * the tab of Excel's "Unicode text" and of cells copied from a spreadsheet; the most common one,
 * a comma on a tie.
 */
function separatorOf(text: string): string {
  const first = (text.match(/^[^\r\n]*/)?.[0] ?? '').replace(/"[^"]*"/g, '');
  const count = (c: string) => first.split(c).length - 1;
  return [',', ';', '\t'].reduce((best, c) => (count(c) > count(best) ? c : best));
}

/**
 * Parses CSV text (quoted cells, `""` inside quotes, any line ends, the separator of the first
 * row); drops empty rows.
 */
export function parseCsv(text: string): string[][] {
  const sep = separatorOf(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const endCell = () => {
    // Undo the export's guard against formulas.
    row.push(/^'[=+\-@]/.test(value) ? value.slice(1) : value);
    value = '';
  };
  const endRow = () => {
    endCell();
    if (row.some((v) => v.trim() !== '')) rows.push(row);
    row = [];
  };
  for (; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (c === '"') quoted = false;
      else value += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) endCell();
    else if (c === '\n') endRow();
    else if (c === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
    } else value += c;
  }
  if (value !== '' || row.length) endRow();
  return rows;
}

/**
 * A file's text: UTF-16 when it starts with its byte order mark (Excel's "Unicode text"), UTF-8,
 * or Shift_JIS (what Japanese Excel saves as "CSV") when it is not valid UTF-8.
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('shift_jis').decode(bytes);
  }
}

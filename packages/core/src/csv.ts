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

/** Parses CSV text (quoted cells, `""` inside quotes, any line ends); drops empty rows. */
export function parseCsv(text: string): string[][] {
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
    else if (c === ',') endCell();
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
 * A file's text: UTF-8, or Shift_JIS (what Japanese Excel saves as "CSV") when it is not valid
 * UTF-8.
 */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('shift_jis').decode(bytes);
  }
}

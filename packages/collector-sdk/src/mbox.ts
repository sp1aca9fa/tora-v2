// Reads a Google Takeout (or any mbox) mail export as a stream, so a large export never has to
// fit in memory. Only messages whose raw header block passes `filter` are parsed.
import { simpleParser } from 'mailparser';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export interface Email {
  subject: string;
  from: string;
  date: Date | null;
  text: string;
  html: string | null;
}

/** Raw messages of an mbox file (bytes kept as-is through latin1). */
export async function* readMboxRaw(path: string): AsyncGenerator<Buffer> {
  const lines = createInterface({
    input: createReadStream(path, { encoding: 'latin1' }),
    crlfDelay: Infinity,
  });
  let message: string[] | null = null;
  let previousBlank = true;
  for await (const line of lines) {
    // A message starts at a "From " line after a blank line (or at the top of the file).
    if (previousBlank && line.startsWith('From ')) {
      if (message) yield Buffer.from(message.join('\n'), 'latin1');
      message = [];
      previousBlank = false;
      continue;
    }
    // mboxrd escapes body lines starting with "From " as ">From ".
    message?.push(line.replace(/^>(>*From )/, '$1'));
    previousBlank = line.trim() === '';
  }
  if (message) yield Buffer.from(message.join('\n'), 'latin1');
}

/** Parsed messages of an mbox file; `filter` sees the raw header block (cheap pre-filter). */
export async function* readMbox(
  path: string,
  filter: (rawHeader: string) => boolean = () => true,
): AsyncGenerator<Email> {
  for await (const raw of readMboxRaw(path)) {
    const end = raw.indexOf('\n\n');
    if (!filter(raw.toString('latin1', 0, end < 0 ? raw.length : end))) continue;
    const mail = await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true });
    yield {
      subject: mail.subject ?? '',
      from: mail.from?.text ?? '',
      date: mail.date ?? null,
      text: mail.text ?? '',
      html: typeof mail.html === 'string' ? mail.html : null,
    };
  }
}

// Reads a Google Takeout (or any mbox) mail export as a stream, so a large export never has to
// fit in memory. Only messages whose raw header block passes `filter` are parsed.
import { simpleParser } from 'mailparser';
import { createReadStream } from 'node:fs';

export interface Email {
  subject: string;
  from: string;
  date: Date | null;
  text: string;
  html: string | null;
}

/** Raw messages of an mbox file (bytes kept as-is through latin1). */
export async function* readMboxRaw(path: string): AsyncGenerator<Buffer> {
  let message: string[] | null = null;
  let previousBlank = true;
  function* take(line: string): Generator<Buffer> {
    // A message starts at a "From " line after a blank line (or at the top of the file).
    if (previousBlank && line.startsWith('From ')) {
      if (message) yield Buffer.from(message.join('\n'), 'latin1');
      message = [];
      previousBlank = false;
      return;
    }
    // mboxrd escapes body lines starting with "From " as ">From ".
    message?.push(line.replace(/^>(>*From )/, '$1'));
    previousBlank = line.trim() === '';
  }
  // Lines split by hand: readline's iterator can close while the consumer is still parsing.
  let rest = '';
  for await (const chunk of createReadStream(path, { encoding: 'latin1' })) {
    const lines = (rest + (chunk as string)).split('\n');
    rest = lines.pop()!;
    for (const line of lines) yield* take(line.endsWith('\r') ? line.slice(0, -1) : line);
  }
  if (rest) yield* take(rest);
  if (message) yield Buffer.from((message as string[]).join('\n'), 'latin1');
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

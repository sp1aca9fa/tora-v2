/**
 * Whether the list in the box is still the one the preview was made from. A form reaches the server
 * with its line breaks as CR LF (the browser's multipart encoding), so the text the action sends
 * back never equals a list of two or more lines as it sits in the box: line breaks compare as one.
 */
export function sameList(typed: string, previewed: string): boolean {
  return lineBreaks(typed) === lineBreaks(previewed);
}

const lineBreaks = (s: string) => s.replace(/\r\n?/g, '\n');

// The lots spreadsheet (requirements S6): every lot of the account as CSV for Excel (with a byte
// order mark, so Japanese text opens right). `?template`: the header row only.
import { localDate, toCsv } from '@tora/core';
import { lotSheet } from '@tora/db';
import { currentSession } from '@/lib/auth/guard';
import { sheetLabels } from '@/lib/lot-sheet';

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return new Response(null, { status: 401 });
  const { header, name, label, template: empty } = await sheetLabels();
  const template = new URL(request.url).searchParams.has('template');
  const rows = template
    ? [empty]
    : await lotSheet(session.db, session.user.id, header, name, label);
  const file = template ? 'tora-lots-template.csv' : `tora-lots-${localDate()}.csv`;
  return new Response('\uFEFF' + toCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

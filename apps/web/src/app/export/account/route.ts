// "Download my data" (requirements S6): the account's own data as JSON, without collected prices.
import { localDate } from '@tora/core';
import { accountData } from '@tora/db';
import { currentSession } from '@/lib/auth/guard';

export async function GET() {
  const session = await currentSession();
  if (!session) return new Response(null, { status: 401 });
  const data = await accountData(session.db, session.user.id);
  const file = `tora-${session.user.username}-${localDate()}.json`;
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

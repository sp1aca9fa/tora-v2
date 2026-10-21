// Runs once when the app's server starts. On the home server (a long-lived server) it checks
// every few minutes whether a store feed went silent (requirements S25: no silent failures), and
// runs the morning check once a day from 08:00 (nothing ran; the daily summaries, S17). A hosted
// app has no long-lived server: there, /api/feed/check and /api/cron/daily are called from
// outside.
const CHECK_MINUTES = 2;

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.VERCEL) return;
  const { checkFeeds, getDb, loadTimeZone, morningCheck } = await import('@tora/db');
  const { alertContext } = await import('./lib/alert-context');
  const check = async () => {
    const ctx = alertContext();
    if (!ctx) return;
    try {
      const db = getDb();
      await loadTimeZone(db);
      await checkFeeds(db, ctx);
    } catch (error) {
      console.error('store feed check:', error);
    }
    try {
      await morningCheck(getDb(), ctx);
    } catch (error) {
      console.error('morning check:', error);
    }
  };
  setInterval(check, CHECK_MINUTES * 60_000).unref?.();
}

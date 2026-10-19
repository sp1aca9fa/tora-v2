// Runs once when the app's server starts. On the home PC (`pnpm app`, a long-lived server) it
// checks every few minutes whether a store feed went silent (requirements S25: no silent
// failures). A hosted app has no long-lived server: there, /api/feed/check is called from outside.
const CHECK_MINUTES = 2;

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.VERCEL) return;
  const { checkFeeds, getDb, loadTimeZone } = await import('@tora/db');
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
  };
  setInterval(check, CHECK_MINUTES * 60_000).unref?.();
}

import { importAttention } from '@tora/db';
import { Nav } from '@/components/nav';
import { authed } from '@/lib/auth/guard';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { db, user } = await authed();
  // Not awaited: the badge fills in when counted.
  const badges = importAttention(db, user.id).then((a) => ({ imports: a.total }));
  return (
    <>
      <Nav badges={badges} />
      <div className="md:pl-56">
        <main className="mx-auto max-w-3xl px-4 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] md:px-8 md:pb-10">
          {children}
        </main>
      </div>
    </>
  );
}

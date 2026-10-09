import { Nav } from '@/components/nav';
import { requireSession } from '@/lib/auth/guard';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  return (
    <>
      <Nav />
      <div className="md:pl-56">
        <main className="mx-auto max-w-3xl px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[calc(5rem+env(safe-area-inset-bottom))] md:px-8 md:pb-10">
          {children}
        </main>
      </div>
    </>
  );
}

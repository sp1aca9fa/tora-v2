import { actionTotal } from '@tora/db';
import { Nav } from '@/components/nav';
import { PageWidth } from '@/components/page-width';
import { userActions } from '@/lib/actions';
import { authed } from '@/lib/auth/guard';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await authed();
  // Not awaited: the badges fill in when counted. Imports counts only its own things.
  const badges = userActions().then((items) => ({
    actions: actionTotal(items),
    imports: actionTotal(
      items.filter((i) => i.type === 'import_review' || i.type === 'failed_link'),
    ),
  }));
  return (
    <>
      <Nav badges={badges} />
      <div className="md:pl-16 xl:pl-56">
        <PageWidth>{children}</PageWidth>
      </div>
    </>
  );
}

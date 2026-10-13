import { actionTotal } from '@tora/db';
import { Nav } from '@/components/nav';
import { PageWidth } from '@/components/page-width';
import { SourcesProvider } from '@/components/sources-context';
import { userActions } from '@/lib/actions';
import { getRegistry } from '@/lib/sources';
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
  // Names, badges and colour slots of the described sources, for client components.
  const registry = await getRegistry();
  const sources = Object.fromEntries(
    registry.sources
      .filter((s) => !s.shopOnly)
      .map((s, i) => [
        s.key,
        { label: s.label, badge: s.badge ?? s.label.slice(0, 1).toUpperCase(), slot: i },
      ]),
  );
  return (
    <SourcesProvider value={sources}>
      <Nav badges={badges} />
      <div className="md:pl-16 xl:pl-56">
        <PageWidth>{children}</PageWidth>
      </div>
    </SourcesProvider>
  );
}

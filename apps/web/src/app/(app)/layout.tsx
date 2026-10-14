import { actionTotal } from '@tora/db';
import { MoneyProvider } from '@/components/money-context';
import { Nav } from '@/components/nav';
import { PageWidth } from '@/components/page-width';
import { SourcesProvider } from '@/components/sources-context';
import { TaxonomyProvider } from '@/components/taxonomy-context';
import { userActions } from '@/lib/actions';
import { getMoneySettings } from '@/lib/money-server';
import { getRegistry } from '@/lib/sources';
import { getTaxonomy } from '@/lib/taxonomy';
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
  // Names, badges and colour slots of the described sources, for client components (colours by
  // the plug-ins' priority, so reordering sources in Settings keeps them).
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
      <MoneyProvider value={await getMoneySettings()}>
        <TaxonomyProvider value={await getTaxonomy()}>
          <Nav badges={badges} />
          <div className="md:pl-16 xl:pl-56">
            <PageWidth>{children}</PageWidth>
          </div>
        </TaxonomyProvider>
      </MoneyProvider>
    </SourcesProvider>
  );
}

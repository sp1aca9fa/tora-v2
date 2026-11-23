import {
  consolePlugins,
  consoleUseCounts,
  gameRulesOn,
  getDb,
  heldItemCount,
  listConsoles,
} from '@tora/db';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { adminOnly } from '@/lib/auth/guard';
import { getLanguages } from '@/lib/languages';
import { sourceLabels } from '@/lib/sources';
import { ConsolesEditor } from './consoles-editor';
import { GameRulesSwitch } from './game-rules-switch';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.consoles.title') };
}

/**
 * The consoles Tora knows (S36 Terms "Console table"): names, other spellings, the software category
 * number per marketplace with a search plug-in, and whether "boxed" can be asked for.
 */
export default async function ConsolesSettingsPage() {
  await adminOnly();
  const db = getDb();
  const [rows, plugins, used, languages, label, t, rulesOn, held] = await Promise.all([
    listConsoles(db),
    consolePlugins(db),
    consoleUseCounts(db),
    getLanguages(),
    sourceLabels(),
    getTranslations('consoles'),
    gameRulesOn(db),
    heldItemCount(db),
  ]);
  // Marketplaces with a search plug-in, then any other a saved row names (kept, not lost on save).
  const sources = [
    ...new Set([...plugins.searchSources, ...rows.flatMap((r) => Object.keys(r.categories))]),
  ];
  const have = new Set(rows.map((r) => r.key));
  const suggested = plugins.suggested.filter((s) => !have.has(s.key)).length;
  return (
    <div className="space-y-4">
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>{t('info')}</p>
        <details className="max-w-prose">
          <summary className="cursor-pointer">{t('more')}</summary>
          <p className="mt-1">{t('moreText')}</p>
        </details>
      </div>
      <GameRulesSwitch on={rulesOn} held={held} />
      <ConsolesEditor
        rows={rows.map((r) => ({
          key: r.key,
          names: r.names,
          aliases: [...r.aliases],
          categories: { ...r.categories },
          boxedAllowed: r.boxedAllowed,
          sort: r.sort,
          used: used.get(r.key) ?? 0,
        }))}
        sources={sources.map((key) => ({ key, label: label(key) }))}
        languages={[languages.primary, ...(languages.secondary ? [languages.secondary] : [])]}
        suggested={suggested}
        categoryUrls={plugins.categoryUrls ?? {}}
      />
    </div>
  );
}

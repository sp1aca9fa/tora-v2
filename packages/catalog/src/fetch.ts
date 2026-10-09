// `pnpm catalog:fetch [franchise...]`: builds packages/catalog/data/<franchise>.json from public
// sources. Run occasionally from a dev machine (not Vercel), review the diff, commit, then
// `pnpm catalog:sync` to load it into the database.
//
// Sources (set names, codes, types and release dates are facts; nothing else is copied):
//   Pokemon (JP)   TCGdex API            https://api.tcgdex.net/v2/ja/sets
//   One Piece (JP) Official product list https://www.onepiece-cardgame.com/products/
//   Yu-Gi-Oh! OCG  Yugipedia (SMW API)   https://yugipedia.com/api.php
//   Magic          Scryfall API          https://api.scryfall.com/sets
import type { CatalogSetEntry, SetType, TcgFranchise } from '@tora/core';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const UA = 'tora-catalog/0.1 (personal collection tracker; set list only)';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string, accept = 'application/json'): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept } });
    if (res.ok) return res;
    if (attempt >= 3 || res.status < 500) throw new Error(`${res.status} ${url}`);
    await sleep(2000 * attempt);
  }
}
const getJson = async <T>(url: string) => (await (await get(url)).json()) as T;

/** Plain text: drops ruby readings (<rt>/<rp>) and other markup, normalizes width/spaces. */
const clean = (s: string) =>
  s
    .replace(/<(rt|rp)\b[^>]*>[\s\S]*?<\/\1>/g, '')
    .replace(/<[^>]+>/g, '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();

// ---------------------------------------------------------------------------------------------

async function pokemon(): Promise<CatalogSetEntry[]> {
  const list = await getJson<{ id: string; name: string }[]>('https://api.tcgdex.net/v2/ja/sets');
  const out: CatalogSetEntry[] = [];
  for (const s of list) {
    await sleep(150);
    const d = await getJson<{ id: string; name: string; releaseDate?: string }>(
      `https://api.tcgdex.net/v2/ja/sets/${encodeURIComponent(s.id)}`,
    ).catch(() => null);
    const name = clean(d?.name ?? s.name);
    if (/プロモ|promo/i.test(name)) continue;
    const setType: SetType = /デッキ|スターター|スタートセット|構築/.test(name)
      ? 'deck'
      : /スペシャル|プレミアム|コレクション|セット|ギフト/.test(name)
        ? 'special'
        : 'expansion';
    out.push({
      franchise: 'pokemon',
      region: 'jp',
      code: s.id,
      name,
      nameAlias: null,
      setType,
      releaseDate: d?.releaseDate ?? null,
      source: 'tcgdex',
      sourceKey: `ja:${s.id}`,
    });
  }
  return out;
}

async function onePiece(): Promise<CatalogSetEntry[]> {
  const out: CatalogSetEntry[] = [];
  const categories: [string, SetType][] = [
    ['boosters', 'expansion'],
    ['decks', 'deck'],
  ];
  for (const [subcategory, setType] of categories) {
    for (let page = 1; page <= 30; page++) {
      await sleep(1000);
      const html = await (
        await get(
          `https://www.onepiece-cardgame.com/products/?subcategory=${subcategory}&page=${page}`,
          'text/html',
        )
      ).text();
      const blocks = html.split('class="linkListColBox"').slice(1);
      if (blocks.length === 0) break;
      for (const block of blocks) {
        const href = block.match(
          /href="https:\/\/www\.onepiece-cardgame\.com\/products\/([^"]+)"/,
        )?.[1];
        const title = block.match(/linkListColTitle">([^<]+)</)?.[1];
        if (!href || !title) continue;
        const name = clean(title);
        const code = name.match(/【([^】]+)】/)?.[1] ?? null;
        out.push({
          franchise: 'one_piece',
          region: 'jp',
          code,
          name,
          nameAlias: null,
          setType: /プレミアムブースター/.test(name) ? 'special' : setType,
          releaseDate: block.match(/datetime="([\d-]+)"/)?.[1] ?? null,
          source: 'onepiece-official',
          sourceKey: code ?? href.replace(/\.(html|php)$|\/$/g, ''),
        });
      }
      if (!html.includes(`page=${page + 1}`)) break;
    }
  }
  return out;
}

const YGO_TYPES: Record<string, SetType> = {
  'Booster pack': 'expansion',
  'Enhancement Pack': 'expansion',
  'Premium Pack': 'expansion',
  'Structure Deck': 'deck',
  'Preconstructed Deck': 'deck',
  'Starter Deck': 'deck',
  'Boss Duel Deck': 'deck',
  'Main Deck': 'deck',
  "Collector's Set": 'special',
  'Special Edition': 'special',
  'Collectible tin': 'special',
  'Duelist Set': 'special',
};

/** Yugipedia dates come as "1/2019/2/4" or "1/2018/6". */
function ygoDate(raw: string | undefined): string | null {
  const m = raw?.match(/^1\/(\d{4})(?:\/(\d{1,2}))?(?:\/(\d{1,2}))?$/);
  if (!m) return null;
  return [m[1], m[2]?.padStart(2, '0'), m[3]?.padStart(2, '0')].filter(Boolean).join('-');
}

async function yugioh(): Promise<CatalogSetEntry[]> {
  type Row = {
    printouts: {
      'Japanese release date': { raw: string }[];
      'Japanese name': string[];
      'Japanese set prefix': (string | { fulltext: string })[];
      'Set type': (string | { fulltext: string })[];
    };
  };
  const out: CatalogSetEntry[] = [];
  for (let offset: number | undefined = 0; offset !== undefined;) {
    await sleep(1000);
    const query: string =
      '[[Medium::OCG]][[Japanese release date::+]]|?Japanese release date|?Japanese name' +
      `|?Japanese set prefix|?Set type|limit=500|offset=${offset}`;
    type Page = { query: { results: Record<string, Row> }; 'query-continue-offset'?: number };
    const d: Page = await getJson<Page>(
      `https://yugipedia.com/api.php?${new URLSearchParams({ action: 'ask', format: 'json', query })}`,
    );
    for (const [title, row] of Object.entries(d.query.results)) {
      const p = row.printouts;
      const typeRaw = p['Set type'][0];
      const setType = YGO_TYPES[typeof typeRaw === 'string' ? typeRaw : (typeRaw?.fulltext ?? '')];
      if (!setType) continue;
      const prefix = p['Japanese set prefix'][0];
      out.push({
        franchise: 'yugioh',
        region: 'jp',
        code: (typeof prefix === 'string' ? prefix : prefix?.fulltext) ?? null,
        name: clean(p['Japanese name'][0] ?? title),
        nameAlias: title,
        setType,
        releaseDate: ygoDate(p['Japanese release date'][0]?.raw),
        source: 'yugipedia',
        sourceKey: title,
      });
    }
    offset = d['query-continue-offset'];
  }
  return out;
}

const MTG_TYPES: Record<string, SetType> = {
  expansion: 'expansion',
  core: 'expansion',
  masters: 'expansion',
  draft_innovation: 'expansion',
  funny: 'expansion',
  commander: 'deck',
  starter: 'deck',
  duel_deck: 'deck',
  premium_deck: 'deck',
  planechase: 'deck',
  archenemy: 'deck',
  box: 'special',
  from_the_vault: 'special',
  spellbook: 'special',
  arsenal: 'special',
};

async function mtg(): Promise<CatalogSetEntry[]> {
  const d = await getJson<{
    data: {
      id: string;
      code: string;
      name: string;
      set_type: string;
      released_at?: string;
      digital: boolean;
    }[];
  }>('https://api.scryfall.com/sets');
  return d.data
    .filter((s) => !s.digital && MTG_TYPES[s.set_type])
    .map((s) => ({
      franchise: 'mtg' as const,
      // Magic sets are the same in every language/region.
      region: null,
      code: s.code.toUpperCase(),
      name: s.name,
      nameAlias: null,
      setType: MTG_TYPES[s.set_type]!,
      releaseDate: s.released_at ?? null,
      source: 'scryfall',
      sourceKey: s.id,
    }));
}

// ---------------------------------------------------------------------------------------------

const SOURCES: Record<TcgFranchise, () => Promise<CatalogSetEntry[]>> = {
  pokemon,
  one_piece: onePiece,
  yugioh,
  mtg,
};

const requested = process.argv.slice(2).filter((a): a is TcgFranchise => a in SOURCES);
const targets = requested.length ? requested : (Object.keys(SOURCES) as TcgFranchise[]);
await mkdir(DATA_DIR, { recursive: true });
for (const franchise of targets) {
  process.stdout.write(`${franchise}... `);
  const entries = await SOURCES[franchise]();
  const unique = [...new Map(entries.map((e) => [`${e.source}:${e.sourceKey}`, e])).values()].sort(
    (a, b) =>
      (a.releaseDate ?? '9999').localeCompare(b.releaseDate ?? '9999') ||
      a.name.localeCompare(b.name),
  );
  await writeFile(join(DATA_DIR, `${franchise}.json`), `${JSON.stringify(unique, null, 1)}\n`);
  console.log(`${unique.length} sets`);
}

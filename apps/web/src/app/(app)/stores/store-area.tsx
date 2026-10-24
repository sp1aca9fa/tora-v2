'use client';

import {
  DEFAULT_FEED_PREFS,
  FEED_SILENT_MINUTES,
  PLACE,
  type StoreArea,
  type StoreAreaChoice,
  type StoreFeedPrefs,
  STORE_NOTICE_KM,
  activeArea,
  distanceKm,
  roundPoint,
} from '@tora/core';
import { LocateFixed } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';
import { CopyButton } from '../settings/admin/commands/copy-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import {
  addGlossaryAction,
  addStoreAction,
  forgetBoardAction,
  newFeedTokenAction,
  removeGlossaryAction,
  removeStoreAction,
  saveFeedBoardsAction,
  saveStoreAreaAction,
  saveStoreFeedAction,
  setStoreCodesAction,
} from './actions';

export interface StoreView {
  id: string;
  /** The chain's key ("megastore", "place"). */
  chainKey: string;
  /** The chain as people read it. */
  chain: string;
  name: string;
  codes: string[];
  /** Added by an admin (can be removed). */
  byHand: boolean;
  region: string | null;
  lat: number | null;
  lon: number | null;
}

const EMPTY: StoreArea = { home: { mode: 'stores', storeIds: [] } };
/** Stores shown at a time; more as the list is scrolled. */
const STORES_BATCH = 20;

/** The person's store area and each store's switch (S25); every change is saved at once. */
export function StoreAreaForm({
  stores,
  area: saved,
  today,
}: {
  stores: StoreView[];
  area: StoreArea | null;
  today: string;
}) {
  const t = useTranslations('stores');
  const [area, setArea] = useState<StoreArea>(saved ?? EMPTY);
  const travelling = !!area.travel && today <= area.travel.until;
  const [editing, setEditing] = useState<'home' | 'travel'>(travelling ? 'travel' : 'home');
  const [filter, setFilter] = useState('');
  const [chainFilter, setChainFilter] = useState<string | null>(null);
  const [regionFilter, setRegionFilter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const choice: StoreAreaChoice = editing === 'travel' && area.travel ? area.travel : area.home;
  const active = activeArea(area, today);
  const muted = new Set(area.muted ?? []);

  const save = (next: StoreArea) => {
    setArea(next);
    startTransition(async () => {
      const r = await saveStoreAreaAction(next);
      setError(r.error ? t(`error.${r.error}`) : null);
    });
  };
  const setChoice = (c: StoreAreaChoice) =>
    save(
      editing === 'travel' && area.travel
        ? { ...area, travel: { ...c, until: area.travel.until } }
        : { ...area, home: c },
    );
  const locate = () => {
    if (!navigator.geolocation) return setError(t('error.noLocation'));
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setChoice({
          mode: 'distance',
          point: roundPoint({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
          km: choice.mode === 'distance' ? choice.km : 5,
        }),
      () => setError(t('error.noLocation')),
      { enableHighAccuracy: false, timeout: 15_000 },
    );
  };
  const startTravel = () => {
    const until = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    save({ ...area, travel: { mode: 'stores', storeIds: [], until } });
    setEditing('travel');
  };

  const distanceOf = (s: StoreView) =>
    choice.mode === 'distance' && s.lat != null && s.lon != null
      ? distanceKm(choice.point, { lat: s.lat, lon: s.lon })
      : null;
  const added = new Set(area.added ?? []);
  const within = (s: StoreView) => {
    if (choice.mode === 'stores') return choice.storeIds.includes(s.id);
    const km = distanceOf(s);
    return km !== null && km <= choice.km;
  };
  const on = (s: StoreView) => !muted.has(s.id) && (within(s) || added.has(s.id));
  // Filters from what the store lists hold: their chains, then the prefectures of the chain.
  const [onlyOn, setOnlyOn] = useState(() => stores.some(on));
  const count = <K extends string>(keys: K[]) =>
    [...keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<K, number>())].sort(
      (a, b) => b[1] - a[1],
    );
  const chains = count(stores.map((s) => s.chainKey)).map(([key, n]) => ({
    key,
    n,
    label: stores.find((s) => s.chainKey === key)!.chain,
  }));
  const inChain = stores.filter((s) => !chainFilter || s.chainKey === chainFilter);
  const regions = count(inChain.flatMap((s) => (s.region ? [s.region] : [])));
  const q = filter.normalize('NFKC').toLowerCase().trim();
  const shown = inChain
    .filter((s) => !regionFilter || s.region === regionFilter)
    .filter((s) => !onlyOn || on(s))
    .filter(
      (s) =>
        !q ||
        [s.name, s.chain, s.region ?? '', ...s.codes].some((x) =>
          x.normalize('NFKC').toLowerCase().includes(q),
        ),
    )
    .map((s) => ({ s, km: distanceOf(s) }))
    .sort((a, b) => (choice.mode === 'distance' ? (a.km ?? Infinity) - (b.km ?? Infinity) : 0))
    .map((x) => x.s);
  // A batch at a time, more as the end comes into view; back to one batch when filters change.
  const filters = [chainFilter, regionFilter, onlyOn, filter].join('|');
  const [shownBy, setShownBy] = useState({ filters, limit: STORES_BATCH });
  const limit = shownBy.filters === filters ? shownBy.limit : STORES_BATCH;
  const setLimit = (n: number) => setShownBy({ filters, limit: n });
  const chip = (active: boolean) =>
    cn(
      'rounded-full border px-2.5 py-1 text-xs',
      active ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground',
    );
  // Picked stores: the box picks. Distance: a store of the area is switched off (muted), another
  // added by hand (added); unticking undoes either.
  const toggle = (s: StoreView) => {
    if (choice.mode === 'stores') {
      const ids = choice.storeIds.includes(s.id)
        ? choice.storeIds.filter((id) => id !== s.id)
        : [...choice.storeIds, s.id];
      return setChoice({ mode: 'stores', storeIds: ids });
    }
    const without = (set: Set<string>) => [...set].filter((id) => id !== s.id);
    if (on(s))
      return save({
        ...area,
        added: without(added),
        muted: within(s) ? [...muted, s.id] : without(muted),
      });
    save({
      ...area,
      muted: without(muted),
      added: within(s) ? without(added) : [...added, s.id],
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('area')}</CardTitle>
        <CardDescription>
          {area.travel && travelling ? t('travelOn', { until: area.travel.until }) : t('homeOn')}
          {active.mode === 'distance' ? ` ${t('withinKm', { km: active.km })}` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {(['home', 'travel'] as const).map((which) =>
            which === 'travel' && !area.travel ? (
              <Button key={which} type="button" variant="outline" size="sm" onClick={startTravel}>
                {t('startTravel')}
              </Button>
            ) : (
              <Button
                key={which}
                type="button"
                size="sm"
                variant={editing === which ? 'default' : 'outline'}
                onClick={() => setEditing(which)}
              >
                {t(which)}
              </Button>
            ),
          )}
          {area.travel && editing === 'travel' && (
            <>
              <label className="flex items-center gap-2 text-sm">
                {t('until')}
                <Input
                  type="date"
                  value={area.travel.until}
                  min={today}
                  onChange={(e) =>
                    e.target.value &&
                    save({ ...area, travel: { ...area.travel!, until: e.target.value } })
                  }
                  className="h-8 w-40"
                />
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  const { travel: _, ...rest } = area;
                  save(rest);
                  setEditing('home');
                }}
              >
                {t('endTravel')}
              </Button>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            value={choice.mode}
            onChange={(e) =>
              e.target.value === 'stores'
                ? setChoice({ mode: 'stores', storeIds: stores.filter(on).map((s) => s.id) })
                : locate()
            }
            className="h-9 w-56"
            aria-label={t('mode')}
          >
            <option value="stores">{t('modeStores')}</option>
            <option value="distance">{t('modeDistance')}</option>
          </NativeSelect>
          {choice.mode === 'distance' && (
            <>
              <NativeSelect
                value={choice.km}
                onChange={(e) => setChoice({ ...choice, km: Number(e.target.value) })}
                className="h-9 w-28"
                aria-label={t('distance')}
              >
                {STORE_NOTICE_KM.map((km) => (
                  <option key={km} value={km}>
                    {t('km', { km })}
                  </option>
                ))}
              </NativeSelect>
              <Button type="button" variant="outline" size="sm" onClick={locate}>
                <LocateFixed /> {t('locate')}
              </Button>
            </>
          )}
        </div>
        {choice.mode === 'distance' && (
          <p className="text-xs text-muted-foreground">{t('pointInfo')}</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('chain')}>
            <button
              type="button"
              className={chip(!chainFilter)}
              onClick={() => {
                setChainFilter(null);
                setRegionFilter(null);
              }}
            >
              {t('allChains', { n: stores.length })}
            </button>
            {chains.map((c) => (
              <button
                key={c.key}
                type="button"
                className={chip(chainFilter === c.key)}
                onClick={() => {
                  setChainFilter(c.key);
                  setRegionFilter(null);
                }}
              >
                {c.label} {c.n}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={chip(onlyOn)} onClick={() => setOnlyOn(true)}>
              {t('onlyOn', { n: stores.filter(on).length })}
            </button>
            <button type="button" className={chip(!onlyOn)} onClick={() => setOnlyOn(false)}>
              {t('showAll')}
            </button>
            {regions.length > 1 && (
              <NativeSelect
                value={regionFilter ?? ''}
                onChange={(e) => setRegionFilter(e.target.value || null)}
                className="h-8 w-40"
                aria-label={t('region')}
              >
                <option value="">{t('allRegions')}</option>
                {regions.map(([r, n]) => (
                  <option key={r} value={r}>
                    {r} ({n})
                  </option>
                ))}
              </NativeSelect>
            )}
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('filter')}
              className="h-8 min-w-48 flex-1"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {t('showing', { n: shown.length, total: stores.length })}
          </p>
        </div>
        {stores.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noStores')}</p>
        ) : (
          <>
            <ul
              className={cn(
                'grid grid-cols-1 gap-x-6 text-sm md:grid-cols-2 2xl:grid-cols-3',
                pending && 'opacity-70',
              )}
            >
              {shown.slice(0, limit).map((s) => {
                const km = distanceOf(s);
                const outside = !within(s);
                return (
                  <li key={s.id} className="flex items-start gap-3 border-b py-2">
                    <input
                      type="checkbox"
                      className="mt-1 size-4"
                      checked={on(s)}
                      onChange={() => toggle(s)}
                      aria-label={t('noticesFor', { store: s.name })}
                    />
                    <div className="min-w-0 flex-1">
                      <p className={cn(outside && !on(s) && 'text-muted-foreground')}>
                        {s.name}{' '}
                        {outside && on(s) && (
                          <span className="text-xs text-primary">{t('addedByHand')} </span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {[s.chain, s.region, km !== null ? t('km', { km: km.toFixed(1) }) : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('codes')}: {s.codes.join(', ') || '-'}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
            {limit < shown.length && <ShowMore onShow={() => setLimit(limit + STORES_BATCH)} />}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Every store with its codes, to change them (admins); stores added by hand can be removed. */
export function StoreCodesList({ stores }: { stores: StoreView[] }) {
  const t = useTranslations('stores');
  const [filter, setFilter] = useState('');
  const [shownBy, setShownBy] = useState({ filter, limit: STORES_BATCH });
  const limit = shownBy.filter === filter ? shownBy.limit : STORES_BATCH;
  const q = filter.normalize('NFKC').toLowerCase().trim();
  const shown = stores.filter(
    (s) =>
      !q ||
      [s.name, s.chain, s.region ?? '', ...s.codes].some((x) =>
        x.normalize('NFKC').toLowerCase().includes(q),
      ),
  );
  return (
    <div className="space-y-2">
      <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('filter')} />
      <ul className="divide-y text-sm">
        {shown.slice(0, limit).map((s) => (
          <li key={s.id} className="py-2">
            <p>
              {s.name}{' '}
              <span className="text-xs text-muted-foreground">
                {[s.chain, s.region].filter(Boolean).join(' · ')}
              </span>
            </p>
            <StoreCodes key={s.codes.join('|')} store={s} />
            {s.byHand && <RemoveStore id={s.id} />}
          </li>
        ))}
      </ul>
      {limit < shown.length && (
        <ShowMore onShow={() => setShownBy({ filter, limit: limit + STORES_BATCH })} />
      )}
    </div>
  );
}

/**
 * Every code posters use for the store, the store list's too (admins): a wrong one can be removed
 * or moved to another store; the posts are matched again.
 */
function StoreCodes({ store }: { store: StoreView }) {
  const t = useTranslations('stores');
  const [value, setValue] = useState(store.codes.join(', '));
  const [pending, startTransition] = useTransition();
  return (
    <label className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
      {t('codes')}
      <Input
        value={value}
        disabled={pending}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() =>
          value !== store.codes.join(', ') &&
          startTransition(() => setStoreCodesAction(store.id, value.split(/[,、]/)))
        }
        placeholder={t('extraCodes')}
        title={t('codesEdit')}
        className="h-7 flex-1 text-xs"
      />
    </label>
  );
}

/** Makes the feed token a feed sends posts with; shown once. */
export function FeedToken({ hasToken }: { hasToken: boolean }) {
  const t = useTranslations('stores');
  const [token, setToken] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-2 text-sm">
      {token ? (
        <>
          <p className="text-muted-foreground">{t('tokenOnce')}</p>
          <div className="flex items-center gap-1 rounded-md border bg-muted px-2 py-1">
            <code className="min-w-0 flex-1 break-all text-xs">{token}</code>
            <CopyButton text={token} />
          </div>
        </>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => startTransition(async () => setToken(await newFeedTokenAction()))}
        >
          {t(hasToken ? 'tokenRenew' : 'tokenNew')}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">{t('feedHelp')}</p>
    </div>
  );
}

/** When the person is told about the feed itself: silence (minutes, hours), unknown stores. */
export function FeedAlerts({ prefs: saved }: { prefs: StoreFeedPrefs | null }) {
  const t = useTranslations('stores');
  const [prefs, setPrefs] = useState({ ...DEFAULT_FEED_PREFS, ...saved });
  const [pending, startTransition] = useTransition();
  const save = (part: Partial<typeof prefs>) => {
    const next = { ...prefs, ...part };
    setPrefs(next);
    startTransition(() => saveStoreFeedAction(next));
  };
  return (
    <div className={cn('space-y-2 text-sm', pending && 'opacity-70')}>
      <div className="flex flex-wrap items-center gap-2">
        {t('silentAfter')}
        <NativeSelect
          value={prefs.silentMinutes}
          onChange={(e) => save({ silentMinutes: Number(e.target.value) })}
          className="h-8 w-24"
          aria-label={t('silentAfter')}
        >
          {FEED_SILENT_MINUTES.map((m) => (
            <option key={m} value={m}>
              {t('minutes', { m })}
            </option>
          ))}
        </NativeSelect>
        {t('between')}
        <Input
          type="time"
          value={prefs.from}
          onChange={(e) => e.target.value && save({ from: e.target.value })}
          className="h-8 w-28"
          aria-label={t('from')}
        />
        -
        <Input
          type="time"
          value={prefs.to}
          onChange={(e) => e.target.value && save({ to: e.target.value })}
          className="h-8 w-28"
          aria-label={t('to')}
        />
      </div>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="size-4"
          checked={prefs.unknown}
          onChange={(e) => save({ unknown: e.target.checked })}
        />
        {t('unknownAlerts')}
      </label>
      <p className="text-xs text-muted-foreground">{t('feedAlertsInfo')}</p>
    </div>
  );
}

/** Adds a store or a place by hand (admins): no code needed for a new chain or area. */
export function AddStoreForm({ chains }: { chains: { chain: string; label: string }[] }) {
  const t = useTranslations('stores');
  const empty = { chain: PLACE, chainLabel: '', name: '', region: '', codes: '', location: '' };
  const [form, setForm] = useState(empty);
  const [newChain, setNewChain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const set = (part: Partial<typeof form>) => setForm({ ...form, ...part });
  const locate = () =>
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        const p = roundPoint({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        set({ location: `${p.lat}, ${p.lon}` });
      },
      () => setError(t('error.noLocation')),
    );
  return (
    <form
      className="space-y-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await addStoreAction(form);
          setError(r.error ? t(`addError.${r.error}`) : null);
          if (!r.error) {
            setForm({ ...empty, chain: form.chain, chainLabel: form.chainLabel });
            setDone(true);
          }
        });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">{t('chain')}</span>
          {newChain ? (
            <div className="flex gap-2">
              <Input
                value={form.chain}
                onChange={(e) => set({ chain: e.target.value })}
                placeholder={t('chainKey')}
                className="h-9 font-mono"
              />
              <Input
                value={form.chainLabel}
                onChange={(e) => set({ chainLabel: e.target.value })}
                placeholder={t('chainLabel')}
                className="h-9"
              />
            </div>
          ) : (
            <NativeSelect
              value={form.chain}
              onChange={(e) => {
                if (e.target.value === '') return setNewChain(true);
                const c = chains.find((x) => x.chain === e.target.value);
                set({ chain: e.target.value, chainLabel: c?.label ?? '' });
              }}
              className="h-9"
            >
              <option value={PLACE}>{t('placeOption')}</option>
              {chains
                .filter((c) => c.chain !== PLACE)
                .map((c) => (
                  <option key={c.chain} value={c.chain}>
                    {c.label}
                  </option>
                ))}
              <option value="">{t('newChain')}</option>
            </NativeSelect>
          )}
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">{t('name')}</span>
          <Input
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            className="h-9"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">{t('codes')}</span>
          <Input
            value={form.codes}
            onChange={(e) => set({ codes: e.target.value })}
            placeholder={t('codesHelp')}
            className="h-9"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">{t('region')}</span>
          <Input
            value={form.region}
            onChange={(e) => set({ region: e.target.value })}
            className="h-9"
          />
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className="block text-xs text-muted-foreground">{t('location')}</span>
          <div className="flex gap-2">
            <Input
              value={form.location}
              onChange={(e) => set({ location: e.target.value })}
              placeholder="35.6987, 139.7746"
              className="h-9"
            />
            <Button type="button" variant="outline" size="sm" className="h-9" onClick={locate}>
              <LocateFixed /> {t('locate')}
            </Button>
          </div>
          <span className="block text-xs text-muted-foreground">{t('locationHelp')}</span>
        </label>
      </div>
      {error && <p className="text-destructive">{error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {t('add')}
        </Button>
        {done && !error && <span className="text-xs text-muted-foreground">{t('added')}</span>}
      </div>
    </form>
  );
}

/** Removes a store an admin added. */
function RemoveStore({ id }: { id: string }) {
  const t = useTranslations('stores');
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="mt-1 h-7 px-2 text-xs"
      disabled={pending}
      onClick={() => startTransition(() => removeStoreAction(id))}
    >
      {t('remove')}
    </Button>
  );
}

/** Forgets a board the feed no longer reads. */
export function ForgetBoard({ board }: { board: string }) {
  const t = useTranslations('stores');
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="text-xs text-muted-foreground underline"
      disabled={pending}
      onClick={() => startTransition(() => forgetBoardAction(board))}
    >
      {t('forget')}
    </button>
  );
}

/** Adds a code that is no store or place, a product or not (admins). */
export function AddGlossary() {
  const t = useTranslations('stores');
  const [code, setCode] = useState('');
  const [meaning, setMeaning] = useState('');
  const [product, setProduct] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await addGlossaryAction(code, meaning, product);
          setError(r.error ? t(`addError.${r.error}`) : null);
          if (!r.error) {
            setCode('');
            setMeaning('');
          }
        });
      }}
    >
      <Input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder={t('code')}
        className="h-8 w-24"
      />
      <Input
        value={meaning}
        onChange={(e) => setMeaning(e.target.value)}
        placeholder={t('meaning')}
        className="h-8 min-w-48 flex-1"
      />
      <label className="flex items-center gap-1.5 text-xs">
        <input
          type="checkbox"
          checked={product}
          onChange={(e) => setProduct(e.target.checked)}
          className="size-4"
        />
        {t('isProduct')}
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {t('add')}
      </Button>
      {error && <p className="w-full text-xs text-destructive">{error}</p>}
    </form>
  );
}

/** Removes a code an admin added. */
export function RemoveGlossary({ code }: { code: string }) {
  const t = useTranslations('stores');
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="text-xs text-muted-foreground underline"
      disabled={pending}
      onClick={() => startTransition(() => removeGlossaryAction(code))}
    >
      {t('remove')}
    </button>
  );
}

/**
 * Which boards the feed watches, chosen here: the feed follows at its next push (within a minute
 * or so) and says "tracking these boards". Unset, the feed's own choice stands.
 */
export function BoardsToWatch({
  known,
  chosen,
  watching,
}: {
  known: string[];
  chosen: string[] | null;
  watching: string[];
}) {
  const t = useTranslations('stores');
  const [pending, startTransition] = useTransition();
  const current = chosen ?? watching;
  const save = (boards: string[] | null) => startTransition(() => saveFeedBoardsAction(boards));
  const toggle = (board: string) =>
    save(current.includes(board) ? current.filter((b) => b !== board) : [...current, board]);
  return (
    <div className={cn('space-y-2 text-sm', pending && 'opacity-70')}>
      <h3 className="font-medium">{t('boardsToWatch')}</h3>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {known.map((b) => (
          <label key={b} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              className="size-4"
              checked={current.includes(b)}
              onChange={() => toggle(b)}
            />
            <span className="font-mono text-xs">{b}</span>
          </label>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => save(known)}>
          {t('watchAll')}
        </Button>
        {chosen && (
          <Button type="button" variant="ghost" size="sm" onClick={() => save(null)}>
            {t('feedDecides')}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t(chosen ? 'boardsChosen' : 'boardsByFeed')}</p>
    </div>
  );
}

/** Shows the next batch when it comes into view (or when clicked). */
function ShowMore({ onShow }: { onShow: () => void }) {
  const t = useTranslations('stores');
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([e]) => e?.isIntersecting && onShow(), {
      rootMargin: '200px',
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [onShow]);
  return (
    <button
      ref={ref}
      type="button"
      className="w-full py-2 text-xs text-muted-foreground"
      onClick={onShow}
    >
      {t('showMore')}
    </button>
  );
}

'use client';

import {
  type StoreArea,
  type StoreAreaChoice,
  STORE_NOTICE_KM,
  activeArea,
  distanceKm,
  roundPoint,
} from '@tora/core';
import { LocateFixed } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import { CopyButton } from '../settings/admin/commands/copy-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import { newFeedTokenAction, saveStoreAreaAction, setStoreCodesAction } from './actions';

export interface StoreView {
  id: string;
  chain: string;
  name: string;
  codes: string[];
  /** Codes an admin added. */
  extra: string[];
  region: string | null;
  lat: number | null;
  lon: number | null;
}

const EMPTY: StoreArea = { home: { mode: 'stores', storeIds: [] } };

/** The person's store area and each store's switch (S25); every change is saved at once. */
export function StoreAreaForm({
  stores,
  area: saved,
  today,
  admin,
}: {
  stores: StoreView[];
  area: StoreArea | null;
  today: string;
  admin: boolean;
}) {
  const t = useTranslations('stores');
  const [area, setArea] = useState<StoreArea>(saved ?? EMPTY);
  const travelling = !!area.travel && today <= area.travel.until;
  const [editing, setEditing] = useState<'home' | 'travel'>(travelling ? 'travel' : 'home');
  const [filter, setFilter] = useState('');
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
  const shown = useMemo(() => {
    const q = filter.normalize('NFKC').toLowerCase().trim();
    const list = stores.filter(
      (s) =>
        !q ||
        [s.name, s.chain, s.region ?? '', ...s.codes, ...s.extra].some((x) =>
          x.normalize('NFKC').toLowerCase().includes(q),
        ),
    );
    return choice.mode === 'distance'
      ? list
          .map((s) => ({ s, km: distanceOf(s) }))
          .sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity))
          .map((x) => x.s)
      : list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stores, filter, choice]);

  const added = new Set(area.added ?? []);
  const within = (s: StoreView) => {
    if (choice.mode === 'stores') return choice.storeIds.includes(s.id);
    const km = distanceOf(s);
    return km !== null && km <= choice.km;
  };
  const on = (s: StoreView) => !muted.has(s.id) && (within(s) || added.has(s.id));
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

        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('filter')}
          className="h-9"
        />
        {stores.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noStores')}</p>
        ) : (
          <ul
            className={cn(
              'grid grid-cols-1 gap-x-6 text-sm md:grid-cols-2 2xl:grid-cols-3',
              pending && 'opacity-70',
            )}
          >
            {shown.map((s) => {
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
                      {t('codes')}: {[...s.codes, ...s.extra].join(', ') || '-'}
                    </p>
                    {admin && <ExtraCodes store={s} />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Codes posters use that the store list does not know (admins). */
function ExtraCodes({ store }: { store: StoreView }) {
  const t = useTranslations('stores');
  const [value, setValue] = useState(store.extra.join(', '));
  const [pending, startTransition] = useTransition();
  return (
    <Input
      value={value}
      disabled={pending}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() =>
        value !== store.extra.join(', ') &&
        startTransition(() => setStoreCodesAction(store.id, value.split(/[,、]/)))
      }
      placeholder={t('extraCodes')}
      className="mt-1 h-7 text-xs"
    />
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

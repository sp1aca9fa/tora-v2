import 'server-only';
import {
  type GeoPoint,
  PLACE,
  type StoreArea,
  activeArea,
  distanceKm,
  localDate,
  locationsOf,
  storeLabelIn,
  storesInArea,
} from '@tora/core';
import { type Db, type Store, cachedStores } from '@tora/db';
import { getLocale, getTranslations } from 'next-intl/server';
import { storeLabel } from './post-views';

export interface Location {
  id: string;
  /** The area's name ("Ikebukuro"), or the store's when no area is near it. */
  label: string;
  /** Its stores and the place itself. */
  storeIds: string[];
  /** Km from the person's point (distance areas only). */
  km: number | null;
}

/**
 * The person's stores grouped by location (the nearest place within 1.5 km, else the store
 * alone), nearest first when the area is a distance, else by name.
 */
export async function areaLocations(db: Db, area: StoreArea | null) {
  const [t, locale, all] = await Promise.all([
    getTranslations('stores'),
    getLocale(),
    cachedStores(db),
  ]);
  const inArea = storesInArea(area, all, localDate());
  const locationOf = locationsOf(all);
  const byId = new Map(all.map((s) => [s.id, s]));
  const choice = area ? activeArea(area, localDate()) : null;
  const point: GeoPoint | null = choice?.mode === 'distance' ? choice.point : null;
  const label = (s: Store) =>
    s.chain === PLACE ? (storeLabelIn(s, locale) ?? s.name) : storeLabel(t, locale, s);
  const locations = new Map<string, Location>();
  for (const s of all) {
    const id = locationOf.get(s.id)!;
    let loc = locations.get(id);
    if (!loc) {
      const at = byId.get(id)!;
      loc = {
        id,
        label: label(at),
        storeIds: [],
        km:
          point && at.lat != null && at.lon != null
            ? distanceKm(point, { lat: at.lat, lon: at.lon })
            : null,
      };
      locations.set(id, loc);
    }
    loc.storeIds.push(s.id);
  }
  // The area's locations: those holding one of its stores.
  const mine = [...locations.values()]
    .filter((l) => l.storeIds.some((id) => inArea.has(id)))
    .sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity) || a.label.localeCompare(b.label));
  return { all, byId, inArea, locationOf, locations, mine, label };
}

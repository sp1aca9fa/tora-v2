'use client';

import { type RefObject, useEffect, useRef, useState } from 'react';

/**
 * A long list drawn in parts (S14): `first` items with the page, `more` each time the element
 * at `end` (placed after the items drawn) comes within 1,500 px of the screen.
 */
export function useInParts(
  total: number,
  first: number,
  more: number,
): { limit: number; end: RefObject<HTMLDivElement | null> } {
  const [limit, setLimit] = useState(first);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (limit >= total || !end.current) return;
    const seen = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit((n) => n + more);
      },
      { rootMargin: '1500px 0px' },
    );
    seen.observe(end.current);
    return () => seen.disconnect();
  }, [limit, total, more]);
  return { limit, end };
}

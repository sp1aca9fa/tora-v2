import type { NoticeLevel } from '@tora/core';

/** How each notice level looks (requirements S8): its colour on cards, dots and banners. */
export const LEVEL_STYLE: Record<NoticeLevel, { bar: string; dot: string; banner: string }> = {
  red: {
    bar: 'border-l-red-500',
    dot: 'bg-red-500',
    banner: 'border-red-500/40 bg-red-500/10',
  },
  orange: {
    bar: 'border-l-orange-500',
    dot: 'bg-orange-500',
    banner: 'border-orange-500/40 bg-orange-500/10',
  },
  yellow: {
    bar: 'border-l-amber-400',
    dot: 'bg-amber-400',
    banner: 'border-amber-400/40 bg-amber-400/10',
  },
  blue: {
    bar: 'border-l-sky-500',
    dot: 'bg-sky-500',
    banner: 'border-sky-500/40 bg-sky-500/10',
  },
  grey: {
    bar: 'border-l-zinc-400',
    dot: 'bg-zinc-400',
    banner: 'border-zinc-400/40 bg-zinc-400/10',
  },
};

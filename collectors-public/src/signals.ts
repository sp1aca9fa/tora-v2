import type { SignalRule } from '@tora/core';

/** A graded copy's price against a raw one's that marks a cheap slab (S27). */
const SLAB_RATIO = 2;

/**
 * A rule many card investors use: a PSA 10 selling for under twice a near-mint raw copy is cheap
 * (grading costs, and most raw copies would not get a 10). Looked at on the PSA 10 prices, so it
 * is tested on what a PSA 10 did next. An example of a signal plug-in: tested like the built-in
 * signals, it ranks items only once proven.
 */
export const slabCheap: SignalRule = {
  key: 'slab_cheap',
  label: 'PSA 10 under 2x raw',
  about: 'A PSA 10 sells for under twice a near-mint raw copy (last 30 days).',
  kinds: ['single'],
  on(item) {
    if (item.bucket !== 'graded:PSA:10') return false;
    const slab = item.price('graded:PSA:10', 30);
    const raw = item.price('raw:A', 30);
    return !!slab && !!raw && slab < SLAB_RATIO * raw;
  },
};

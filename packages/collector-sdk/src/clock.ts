/**
 * Working time of a run (requirements S16): wall time minus the time the PC slept. A timer beats
 * every `beatMs`; a beat that comes much later than that means the process was suspended, and
 * the gap past one beat is not counted.
 */
export function awakeClock(beatMs = 5_000, lateMs = 60_000, now: () => number = Date.now) {
  const start = now();
  let last = start;
  let slept = 0;
  const beat = () => {
    const t = now();
    if (t - last > lateMs) slept += t - last - beatMs;
    last = t;
  };
  const timer = setInterval(beat, beatMs);
  timer.unref?.();
  return {
    /** Stops the clock; the working time in ms. */
    stop(): number {
      beat();
      clearInterval(timer);
      return Math.max(0, now() - start - slept);
    },
  };
}

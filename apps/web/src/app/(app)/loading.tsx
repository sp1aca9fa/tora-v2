/** Shown at once while a page loads (S8 speed): the page's shape, filled in when ready. */
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy>
      <div className="h-8 w-40 animate-pulse rounded-md bg-muted" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl border bg-card" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl border bg-card" />
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl border bg-card" />
        ))}
      </div>
    </div>
  );
}

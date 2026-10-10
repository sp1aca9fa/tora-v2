import type { Product } from '@tora/db';
import { Box, Gamepad2, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

/** URL of a stored product thumbnail (null when there is none). */
export function productImageUrl(productId: string, version: string | null | undefined) {
  return version ? `/img/products/${productId}?v=${encodeURIComponent(version)}` : null;
}

/** The product's stored thumbnail, or an icon for its kind when there is none. */
export function ProductImage({
  product,
  version,
  className,
}: {
  product: Pick<Product, 'id' | 'name' | 'category' | 'kind'>;
  version: string | null | undefined;
  className?: string;
}) {
  const src = productImageUrl(product.id, version);
  const Icon = product.category === 'game' ? Gamepad2 : product.kind === 'single' ? Layers : Box;
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted',
        className,
      )}
    >
      {src ? (
        // A small stored WebP served by the app; next/image optimisation is not needed.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" className="size-full object-contain" />
      ) : (
        <Icon className="size-1/2 text-muted-foreground/60" aria-hidden />
      )}
    </div>
  );
}

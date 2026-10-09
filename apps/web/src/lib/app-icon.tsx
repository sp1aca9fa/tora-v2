import { ImageResponse } from 'next/og';

/** App icon as PNG. Full-bleed background with the glyph inside the maskable safe zone. */
export function appIcon(size: number) {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#171717',
        color: '#f59e0b',
        fontSize: size * 0.5,
        fontWeight: 700,
        letterSpacing: -size * 0.02,
      }}
    >
      T
    </div>,
    { width: size, height: size },
  );
}

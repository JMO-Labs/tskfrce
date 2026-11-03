import { ReactNode } from 'react';
// Simple Icons are imported individually to avoid bloating the bundle.
// Amazon and Nintendo were removed upstream (v16, trademark requests), so those vendors get no logo.
import { siApple, siSamsung, siGoogle, siSony, siLg } from 'simple-icons';

export type MakerKey = 'apple' | 'samsung' | 'google' | 'sony' | 'lg';

const MAKER_MAP: Record<string, MakerKey> = {
  apple: 'apple',
  samsung: 'samsung',
  google: 'google',
  sony: 'sony',
  lg: 'lg',
};

const ICONS: Record<MakerKey, { title: string; path: string }> = {
  apple: siApple,
  samsung: siSamsung,
  google: siGoogle,
  sony: siSony,
  lg: siLg,
};

/**
 * Map a vendor string (case-insensitive substring) to a MakerKey.
 * Returns null for unknown vendors.
 */
export function makerKey(vendor: string | null): MakerKey | null {
  if (!vendor) return null;
  const lower = vendor.toLowerCase();
  for (const [key, value] of Object.entries(MAKER_MAP)) {
    if (lower.includes(key)) return value;
  }
  return null;
}

interface MakerLogoProps {
  vendor?: string | null;
  size?: number;
}

/**
 * Renders a maker logo as an SVG for a known vendor.
 * Unknown vendors or null return null.
 */
export function MakerLogo({ vendor, size = 16 }: MakerLogoProps): ReactNode {
  const key = makerKey(vendor || null);
  if (!key) return null;

  const icon = ICONS[key];
  if (!icon) return null;

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
      aria-label={icon.title}
    >
      <path d={icon.path} />
    </svg>
  );
}

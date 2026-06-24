/**
 * Avatar — a DETERMINISTIC, art-deco-noir identicon (QoL "social rendering"
 * wave). No upload, no storage, no network: the entire SVG is derived purely
 * from a hash of the user id, so the same id always renders the same mark and
 * different ids differ.
 *
 * Security: the SVG is built from a fixed palette + a fixed set of geometric
 * shapes selected by the hash; the only user-derived text is a single uppercased
 * initial of the (sanitized) name, rendered as a plain SVG <text> node (React
 * escapes it — no markup injection). There is NO `dangerouslySetInnerHTML` and
 * no user-supplied SVG/markup. `aria-label` carries the username for SR users.
 *
 * Theme: colors are drawn from the noir/brass/faction palette (mirrors the CSS
 * tokens in styles/theme.css) so avatars sit on-theme without depending on
 * runtime CSS-variable resolution inside an SVG fill.
 */

import { sanitizeInline } from '../lib/sanitize.js';

/** Avatar sizes (px). `md` is the default inline size beside a username. */
const SIZES = { sm: 18, md: 28, lg: 56 } as const;
export type AvatarSize = keyof typeof SIZES | number;

/**
 * Noir/brass/faction palette (hex mirrors of the theme tokens). Two indices are
 * picked from the hash for the background + glyph; kept high-contrast against
 * the ink backdrop so the mark reads at small sizes.
 */
const PALETTE = [
  '#c9a45a', // brass
  '#a3343a', // blood
  '#3f7d6e', // verdigris
  '#5c8fc9', // town blue
  '#b07ad6', // neutral violet
  '#3fa66a', // triad jade
  '#8a3b54', // vampire crimson
  '#7d8a2e', // cult olive
  '#e0b65c', // amber
  '#6fb3a0', // verdigris-text
] as const;

/** 32-bit FNV-1a hash of a string → unsigned int. Pure + stable. */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    // h *= 16777619, kept in 32-bit space.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** The first letter of the name, uppercased, or '•' when none. */
function initialOf(name: string): string {
  const clean = sanitizeInline(name);
  const ch = clean.match(/[A-Za-z0-9]/)?.[0];
  return ch ? ch.toUpperCase() : '•';
}

/**
 * A deterministic, symmetric art-deco glyph chosen by the hash. We render a few
 * mirrored shapes inside a 32×32 viewBox so the mark stays balanced and
 * "deco" regardless of id. Symmetry across the vertical axis keeps it legible.
 */
function glyph(h: number, fg: string): JSX.Element {
  const shape = h % 4;
  if (shape === 0) {
    // A central diamond + two flanking bars.
    return (
      <g fill={fg}>
        <rect x="15" y="6" width="2" height="20" />
        <path d="M16 9 L22 16 L16 23 L10 16 Z" />
      </g>
    );
  }
  if (shape === 1) {
    // Stepped chevrons (a deco zigzag), mirrored.
    return (
      <g fill="none" stroke={fg} strokeWidth="2.4">
        <path d="M8 12 L16 19 L24 12" />
        <path d="M8 19 L16 26 L24 19" />
      </g>
    );
  }
  if (shape === 2) {
    // Concentric rings (a sunburst stand-in).
    return (
      <g fill="none" stroke={fg} strokeWidth="2.2">
        <circle cx="16" cy="16" r="8" />
        <circle cx="16" cy="16" r="3.2" />
      </g>
    );
  }
  // A fan/triangle pair (mirrored deco wedges).
  return (
    <g fill={fg}>
      <path d="M16 7 L24 24 L16 19 Z" />
      <path d="M16 7 L8 24 L16 19 Z" opacity="0.78" />
    </g>
  );
}

/** Resolve a size token (or raw px) to a pixel value. */
function pxFor(size: AvatarSize): number {
  return typeof size === 'number' ? size : SIZES[size];
}

/**
 * Deterministic noir avatar for a user id. `name` is used only for the SR label
 * and the monogram initial; the visual mark depends solely on `id`.
 */
export function Avatar({
  id,
  name,
  size = 'md',
  showMonogram = true,
}: {
  id: string;
  name: string;
  size?: AvatarSize;
  showMonogram?: boolean;
}) {
  const px = pxFor(size);
  const h = fnv1a(id || name || '?');
  const bgIdx = h % PALETTE.length;
  // A second, distinct hue for the glyph/ring (offset from bg, never equal).
  const fgIdx = (bgIdx + 1 + ((h >> 8) % (PALETTE.length - 1))) % PALETTE.length;
  const bg = PALETTE[bgIdx]!;
  const fg = PALETTE[fgIdx]!;
  const label = sanitizeInline(name) || 'player';
  const showText = showMonogram && px >= 24;

  return (
    <span
      className="avatar"
      style={{ width: px, height: px, display: 'inline-flex', flex: '0 0 auto' }}
    >
      <svg
        width={px}
        height={px}
        viewBox="0 0 32 32"
        role="img"
        aria-label={label}
        className="avatar-svg"
      >
        {/* Backdrop: ink panel with a brass-ish ring drawn from the hash hue. */}
        <rect x="0" y="0" width="32" height="32" rx="6" fill="#141320" />
        <rect
          x="1.2"
          y="1.2"
          width="29.6"
          height="29.6"
          rx="5"
          fill="none"
          stroke={bg}
          strokeWidth="1.4"
          opacity="0.85"
        />
        {showText ? (
          <text
            x="16"
            y="16"
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="15"
            fontWeight="700"
            fontFamily="'Cormorant Garamond', Georgia, serif"
            fill={fg}
          >
            {initialOf(name)}
          </text>
        ) : (
          glyph(h, fg)
        )}
      </svg>
    </span>
  );
}

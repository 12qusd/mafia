/**
 * Original inline SVG iconography (BUILD_SPEC §2.1.4, §13.2: simple original
 * shapes, no heavy assets, no StarCraft / Town of Salem references). These are
 * deliberately abstract art-deco glyphs drawn from scratch.
 *
 * Faction icons accompany every faction color so color is never the only signal
 * (colorblind requirement, §13.1 Settings).
 */

import type { Faction } from '@nocturne/shared';

type P = { size?: number; className?: string };

const svg = (size: number, children: React.ReactNode, extra?: string) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={extra}
    aria-hidden="true"
  >
    {children}
  </svg>
);

/** Town: a shield (the law). */
export function IconTown({ size = 14, className }: P) {
  return svg(size, <path d="M12 3l7 3v5c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3z" />, className);
}
/** Mafia: a fedora silhouette. */
export function IconMafia({ size = 14, className }: P) {
  return svg(
    size,
    <>
      <path d="M4 16h16" />
      <path d="M7 16c0-4 1-7 5-7s5 3 5 7" />
    </>,
    className,
  );
}
/** Triad: a coiled dragon / interlocking knot (distinct from the fedora). */
export function IconTriad({ size = 14, className }: P) {
  return svg(
    size,
    <>
      <path d="M5 9c3-4 11-4 14 0" />
      <path d="M19 15c-3 4-11 4-14 0" />
      <path d="M12 7v10" />
    </>,
    className,
  );
}
/** Neutral killing: a dagger. */
export function IconNK({ size = 14, className }: P) {
  return svg(
    size,
    <>
      <path d="M12 2v12" />
      <path d="M9 14h6l-3 8z" />
      <path d="M8 14h8" />
    </>,
    className,
  );
}
/** Neutral benign: a domino mask / spade-ish lozenge. */
export function IconNB({ size = 14, className }: P) {
  return svg(size, <path d="M12 3c4 4 6 7 6 10a6 6 0 11-12 0c0-3 2-6 6-10z" />, className);
}

export function FactionIcon({ faction, size, className }: P & { faction: Faction }) {
  const p: P = { ...(size !== undefined ? { size } : {}), ...(className ? { className } : {}) };
  switch (faction) {
    case 'TOWN':
      return <IconTown {...p} />;
    case 'MAFIA':
      return <IconMafia {...p} />;
    case 'TRIAD':
      return <IconTriad {...p} />;
    case 'NEUTRAL_KILLING':
      return <IconNK {...p} />;
    case 'NEUTRAL_BENIGN':
      return <IconNB {...p} />;
    default:
      return null;
  }
}

/** A few utility glyphs. */
export function IconMoon({ size = 16, className }: P) {
  return svg(size, <path d="M20 14a8 8 0 11-9-10 6.5 6.5 0 009 10z" />, className);
}
export function IconSun({ size = 16, className }: P) {
  return svg(
    size,
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
    </>,
    className,
  );
}
export function IconCopy({ size = 14, className }: P) {
  return svg(
    size,
    <>
      <rect x="9" y="9" width="11" height="11" rx="1.5" />
      <path d="M5 15V5a1 1 0 011-1h10" />
    </>,
    className,
  );
}
export function IconGavel({ size = 14, className }: P) {
  return svg(
    size,
    <>
      <path d="M4 20h8" />
      <path d="M14 6l4 4-6 6-4-4z" />
      <path d="M13 3l4 4" />
    </>,
    className,
  );
}
export function IconSkull({ size = 14, className }: P) {
  return svg(
    size,
    <>
      <path d="M12 3a7 7 0 00-7 7c0 2 1 4 3 5v3h8v-3c2-1 3-3 3-5a7 7 0 00-7-7z" />
      <circle cx="9.5" cy="10.5" r="1" fill="currentColor" />
      <circle cx="14.5" cy="10.5" r="1" fill="currentColor" />
    </>,
    className,
  );
}

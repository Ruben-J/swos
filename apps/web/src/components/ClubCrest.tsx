import { useId } from "react";

/**
 * Procedureel clubwapen (SVG): een schild met een patroon in de clubkleuren en
 * een monogram-rondel. Volledig DETERMINISTISCH op de clubnaam — dezelfde club
 * krijgt altijd hetzelfde wapen — en schaalt scherp op elk formaat.
 */

const SHIELD = "M4 3 H30 V19 C30 28 24 33 17 35 C10 33 4 28 4 19 Z";

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function rngFrom(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  let h = (hex || "#888888").replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return { r: 136, g: 136, b: 136 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function luminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Verhelder (amt>0) of verdonker (amt<0) een kleur, amt in [-1,1]. */
function adjust(hex: string, amt: number): string {
  const { r, g, b } = parseHex(hex);
  const f = (c: number): number => (amt >= 0 ? Math.round(c + (255 - c) * amt) : Math.round(c * (1 + amt)));
  const to = (c: number): string => Math.max(0, Math.min(255, f(c))).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** 1-2 letter monogram uit de clubnaam ("Manchester Red" -> "MR"). */
function monogram(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0]!.charAt(0) + words[1]!.charAt(0)).toUpperCase();
  return (words[0] ?? "?").slice(0, 2).toUpperCase();
}

export function ClubCrest({
  name,
  primary,
  secondary,
  size = 24,
}: {
  name: string;
  primary: string;
  secondary: string;
  size?: number;
}): React.JSX.Element {
  const clip = useId();
  const rnd = rngFrom(hashStr(name));
  const pattern = Math.floor(rnd() * 7);
  const star = rnd() < 0.35;

  // Patroonkleur moet contrasteren met het schild; anders een af-/lichtere tint.
  let pat = secondary;
  if (Math.abs(luminance(primary) - luminance(secondary)) < 0.16) {
    pat = luminance(primary) > 0.5 ? adjust(primary, -0.5) : adjust(primary, 0.55);
  }
  const lightShield = luminance(primary) > 0.55;
  const roundelFill = lightShield ? "#1a1d23" : "#f4f6ef";
  const roundelInk = lightShield ? "#f4f6ef" : "#16181d";
  const mono = monogram(name);

  return (
    <svg
      className="club-crest"
      viewBox="0 0 34 38"
      width={(size * 34) / 38}
      height={size}
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clip}>
          <path d={SHIELD} />
        </clipPath>
      </defs>
      <path d={SHIELD} fill={primary} />
      <g clipPath={`url(#${clip})`}>
        {pattern === 0 && <rect x="4" y="3" width="13" height="32" fill={pat} />}
        {pattern === 1 &&
          [10, 17, 24].map((x) => <rect key={x} x={x - 1.7} y="0" width="3.4" height="38" fill={pat} />)}
        {pattern === 2 && <rect x="0" y="15" width="34" height="8" fill={pat} />}
        {pattern === 3 && <rect x="0" y="3" width="34" height="10" fill={pat} />}
        {pattern === 4 && (
          <>
            <rect x="15" y="0" width="4" height="38" fill={pat} />
            <rect x="0" y="14" width="34" height="4" fill={pat} />
          </>
        )}
        {pattern === 5 && (
          <path d="M4 3 L30 34 M30 3 L4 34" stroke={pat} strokeWidth="3.6" fill="none" />
        )}
        {pattern === 6 && (
          <>
            <rect x="4" y="3" width="13" height="15" fill={pat} />
            <rect x="17" y="18" width="13" height="17" fill={pat} />
          </>
        )}
      </g>
      {/* Monogram-rondel. */}
      <circle cx="17" cy="18.5" r="7.4" fill={roundelFill} stroke="rgba(0,0,0,0.35)" strokeWidth="0.8" />
      <text
        x="17"
        y="19"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={mono.length > 1 ? 8.4 : 11}
        fontWeight="800"
        fontFamily="system-ui, -apple-system, sans-serif"
        fill={roundelInk}
      >
        {mono}
      </text>
      {star && (
        <path
          d="M0 -3 L0.9 -0.9 L3 -0.9 L1.3 0.5 L1.9 2.6 L0 1.3 L-1.9 2.6 L-1.3 0.5 L-3 -0.9 L-0.9 -0.9 Z"
          transform="translate(17 7)"
          fill="#f2c01e"
          stroke="rgba(0,0,0,0.3)"
          strokeWidth="0.3"
        />
      )}
      <path d={SHIELD} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** Clubwapen + naam naast elkaar (voor stand-/lijstrijen). */
export function ClubLabel({
  team,
  size = 16,
}: {
  team: { name: string; colors: { primary: string; secondary: string } };
  size?: number;
}): React.JSX.Element {
  return (
    <span className="club-label">
      <ClubCrest name={team.name} primary={team.colors.primary} secondary={team.colors.secondary} size={size} />
      <span className="club-label-name">{team.name}</span>
    </span>
  );
}

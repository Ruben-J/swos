import { useId } from "react";

/**
 * Procedureel clubwapen (SVG): een badge in één van meerdere VORMEN (schild,
 * rond/roundel, zeshoek, afgerond vierkant, pennant) met een PATROON in de
 * clubkleuren en een MIDDENSTUK (monogram of een embleem: ster, voetbal, kroon).
 * Volledig DETERMINISTISCH op de clubnaam — dezelfde club krijgt altijd hetzelfde
 * wapen — en schaalt scherp op elk formaat. ViewBox is altijd 0 0 40 40.
 */

// Polygoon-/padvormen binnen een 40x40-box (midden = 20,20).
const SHAPES: Record<string, string> = {
  shield: "M7 4 H33 V21 C33 31 27 36 20 38 C13 36 7 31 7 21 Z",
  rsquare: "M11 5 H29 A6 6 0 0 1 35 11 V29 A6 6 0 0 1 29 35 H11 A6 6 0 0 1 5 29 V11 A6 6 0 0 1 11 5 Z",
  hex: "M20 3 L34 11 L34 29 L20 37 L6 29 L6 11 Z",
  pennant: "M7 4 H33 V19 L20 37 L7 19 Z",
};

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

const STAR =
  "M0 -7 L1.6 -2.2 L6.7 -2.2 L2.5 0.9 L4.1 5.9 L0 2.8 L-4.1 5.9 L-2.5 0.9 L-6.7 -2.2 L-1.6 -2.2 Z";

/** Voetbal: witte bol met een centrale zwarte vijfhoek en spaken. */
function Ball(): React.JSX.Element {
  const pts: [number, number][] = [0, 1, 2, 3, 4].map((k) => {
    const a = (-90 + k * 72) * (Math.PI / 180);
    return [Math.cos(a) * 2.4, Math.sin(a) * 2.4];
  });
  const outer: [number, number][] = [0, 1, 2, 3, 4].map((k) => {
    const a = (-90 + k * 72) * (Math.PI / 180);
    return [Math.cos(a) * 6, Math.sin(a) * 6];
  });
  return (
    <g>
      <circle cx="0" cy="0" r="6.4" fill="#f4f6ef" stroke="#16181d" strokeWidth="0.9" />
      <polygon points={pts.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ")} fill="#16181d" />
      {pts.map((p, i) => (
        <line
          key={i}
          x1={p[0].toFixed(2)}
          y1={p[1].toFixed(2)}
          x2={outer[i]![0].toFixed(2)}
          y2={outer[i]![1].toFixed(2)}
          stroke="#16181d"
          strokeWidth="0.8"
        />
      ))}
    </g>
  );
}

/** Kroon: gouden zigzag met drie topbolletjes. */
function Crown(): React.JSX.Element {
  return (
    <g>
      <path
        d="M-6.5 4.5 L-6.5 -2.5 L-2.7 1.2 L0 -5 L2.7 1.2 L6.5 -2.5 L6.5 4.5 Z"
        fill="#f2c01e"
        stroke="#7a5a10"
        strokeWidth="0.7"
        strokeLinejoin="round"
      />
      <rect x="-6.5" y="3.4" width="13" height="2.4" rx="0.6" fill="#e0a81a" stroke="#7a5a10" strokeWidth="0.6" />
      <circle cx="-6.5" cy="-2.8" r="1.2" fill="#ffe27a" stroke="#7a5a10" strokeWidth="0.5" />
      <circle cx="0" cy="-5.6" r="1.3" fill="#ffe27a" stroke="#7a5a10" strokeWidth="0.5" />
      <circle cx="6.5" cy="-2.8" r="1.2" fill="#ffe27a" stroke="#7a5a10" strokeWidth="0.5" />
    </g>
  );
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
  const shapeKind = (["shield", "circle", "roundel", "rsquare", "hex", "pennant"] as const)[
    Math.floor(rnd() * 6)
  ]!;
  const pattern = Math.floor(rnd() * 8);
  const center = rnd() < 0.5 ? "mono" : (["star", "ball", "crown"] as const)[Math.floor(rnd() * 3)]!;
  const ringStars = shapeKind === "roundel" && rnd() < 0.7;

  // Patroonkleur moet contrasteren met het schild; anders een af-/lichtere tint.
  let pat = secondary;
  if (Math.abs(luminance(primary) - luminance(secondary)) < 0.16) {
    pat = luminance(primary) > 0.5 ? adjust(primary, -0.5) : adjust(primary, 0.55);
  }
  const light = luminance(primary) > 0.55;
  const discFill = light ? "#1a1d23" : "#f4f6ef";
  const discInk = light ? "#f4f6ef" : "#16181d";
  const gold = "#e8c84d";
  const mono = monogram(name);

  const isCircle = shapeKind === "circle" || shapeKind === "roundel";
  const roundel = shapeKind === "roundel";
  const fieldR = roundel ? 13.5 : 17;

  // Het PATROON (geclipt op het veld). Werkt voor elke vorm.
  const Pattern = (
    <g clipPath={`url(#${clip})`}>
      {pattern === 0 && <rect x="0" y="0" width="20" height="40" fill={pat} />}
      {pattern === 1 &&
        [10, 17, 24, 31].map((x) => <rect key={x} x={x - 1.7} y="0" width="3.4" height="40" fill={pat} />)}
      {pattern === 2 && <rect x="0" y="16" width="40" height="8" fill={pat} />}
      {pattern === 3 && <rect x="0" y="0" width="40" height="12" fill={pat} />}
      {pattern === 4 && (
        <>
          <rect x="17.5" y="0" width="5" height="40" fill={pat} />
          <rect x="0" y="17.5" width="40" height="5" fill={pat} />
        </>
      )}
      {pattern === 5 && <path d="M2 2 L38 38 M38 2 L2 38" stroke={pat} strokeWidth="4.2" fill="none" />}
      {pattern === 6 && (
        <>
          <rect x="0" y="0" width="20" height="20" fill={pat} />
          <rect x="20" y="20" width="20" height="20" fill={pat} />
        </>
      )}
      {pattern === 7 && (
        <>
          <rect x="0" y="9" width="40" height="5" fill={pat} />
          <rect x="0" y="26" width="40" height="5" fill={pat} />
        </>
      )}
    </g>
  );

  // Het MIDDENSTUK.
  const cy = shapeKind === "shield" ? 19 : 20;
  const Center =
    center === "mono" ? (
      <>
        <circle cx="20" cy={cy} r={roundel ? 7.2 : 7.6} fill={discFill} stroke="rgba(0,0,0,0.35)" strokeWidth="0.8" />
        <text
          x="20"
          y={cy + 0.4}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={mono.length > 1 ? 8.4 : 11}
          fontWeight="800"
          fontFamily="system-ui, -apple-system, sans-serif"
          fill={discInk}
        >
          {mono}
        </text>
      </>
    ) : (
      <g transform={`translate(20 ${cy})`}>
        {/* Subtiele achtergrond-disc voor contrast. */}
        <circle cx="0" cy="0" r="8.4" fill={light ? "rgba(0,0,0,0.16)" : "rgba(255,255,255,0.14)"} />
        {center === "star" && <path d={STAR} fill={gold} stroke="rgba(0,0,0,0.35)" strokeWidth="0.5" />}
        {center === "ball" && <Ball />}
        {center === "crown" && <Crown />}
      </g>
    );

  return (
    <svg className="club-crest" viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          {isCircle ? <circle cx="20" cy="20" r={fieldR} /> : <path d={SHAPES[shapeKind]} />}
        </clipPath>
      </defs>

      {/* Roundel: gouden buitenring. */}
      {roundel && <circle cx="20" cy="20" r="18" fill={gold} stroke="rgba(0,0,0,0.5)" strokeWidth="1.1" />}
      {roundel && <circle cx="20" cy="20" r="14.6" fill={adjust(primary, -0.35)} />}

      {/* Veld + patroon. */}
      {isCircle ? (
        <circle cx="20" cy="20" r={fieldR} fill={primary} />
      ) : (
        <path d={SHAPES[shapeKind]} fill={primary} />
      )}
      {Pattern}

      {/* Roundel-sterretjes op de ring. */}
      {ringStars &&
        [-1, 1].map((dir) => (
          <path
            key={dir}
            d={STAR}
            transform={`translate(20 ${20 + dir * 16}) scale(0.34)`}
            fill="#1a1d23"
          />
        ))}

      {Center}

      {/* Rand. */}
      {isCircle ? (
        <circle cx="20" cy="20" r={fieldR} fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth={roundel ? 0.8 : 1.4} />
      ) : (
        <path d={SHAPES[shapeKind]} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth="1.5" strokeLinejoin="round" />
      )}
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

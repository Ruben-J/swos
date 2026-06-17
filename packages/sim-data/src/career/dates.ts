/**
 * Kleine datum-helpers op ISO-strings (YYYY-MM-DD). Deterministisch: gebruikt
 * UTC-rekenen, geen Date.now(). Voldoende voor een wekelijkse seizoenskalender.
 */

export function parseISO(iso: string): number {
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  return Date.UTC(y!, (m ?? 1) - 1, d ?? 1);
}

export function toISO(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(iso: string, days: number): string {
  return toISO(parseISO(iso) + days * 86_400_000);
}

/** Leesbare datum (NL): "za 15 aug". */
const WEEKDAYS = ["zo", "ma", "di", "wo", "do", "vr", "za"];
const MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
export function formatShort(iso: string): string {
  const d = new Date(parseISO(iso));
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

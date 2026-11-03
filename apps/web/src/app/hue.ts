/**
 * The one palette for profile tiles and project marks, so both read as one
 * system. A thing's hue comes from its id, so it never changes.
 */
const HUES = [25, 45, 75, 105, 145, 174, 210, 250, 285, 320, 345];

export function hueOf(id: string): number {
  const seed = [...id].reduce((hash, ch) => (hash * 31 + ch.charCodeAt(0)) >>> 0, 2166136261);
  return HUES[seed % HUES.length]!;
}

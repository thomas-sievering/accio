/**
 * Project colours drawn from the Herdr reference. An id always selects the
 * same colour.
 */
const COLORS = ['#ce885d', '#bb9b65', '#b3a26f', '#86a66f', '#5ea66f', '#53a69a', '#5d9fae', '#6586d8', '#8876db', '#a779b2', '#c0808d'];

export function identityColorOf(id: string): string {
  const seed = [...id].reduce((hash, ch) => (hash * 31 + ch.charCodeAt(0)) >>> 0, 2166136261);
  return COLORS[seed % COLORS.length]!;
}

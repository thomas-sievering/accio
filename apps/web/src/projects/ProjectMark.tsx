/** A project's mark: a square in the project's own colour, picked from its id so it never changes. */
const hues = [25, 45, 75, 105, 145, 174, 210, 250, 285, 320, 345];

const seedOf = (text: string) => [...text].reduce((hash, ch) => (hash * 31 + ch.charCodeAt(0)) >>> 0, 2166136261);

export function ProjectMark({ id, size = 12 }: { id: string; size?: number }) {
  const hue = hues[seedOf(id) % hues.length]!;
  return (
    <span
      className="project-mark"
      aria-hidden="true"
      style={{ inlineSize: size, blockSize: size, background: `oklch(0.74 0.2 ${hue})` }}
    />
  );
}

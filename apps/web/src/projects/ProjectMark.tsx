import { hueOf } from '../app/hue';

/** A project's mark: a square in the project's own colour. */
export function ProjectMark({ id, size = 12 }: { id: string; size?: number }) {
  return (
    <span
      className="project-mark"
      aria-hidden="true"
      style={{ inlineSize: size, blockSize: size, background: `oklch(0.74 0.2 ${hueOf(id)})` }}
    />
  );
}

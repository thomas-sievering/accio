import { identityColorOf } from '../app/identityColor';

/** A project's mark: a square in the project's own colour. */
export function ProjectMark({ id, size = 12 }: { id: string; size?: number }) {
  return (
    <span
      className="project-mark"
      aria-hidden="true"
      style={{ inlineSize: size, blockSize: size, background: identityColorOf(id) }}
    />
  );
}

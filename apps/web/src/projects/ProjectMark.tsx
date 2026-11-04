import { identityColorOf } from '../app/identityColor';
import { useProjects } from './projects';

/** A project's mark: its initial on a tile tinted with the project's own colour. */
export function ProjectMark({ id, size = 18, name: fallback }: { id: string; size?: number; name?: string }) {
  const { state } = useProjects();
  const name = state?.projects.find((p) => p.id === id)?.name ?? fallback ?? '';
  const initial = name.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? '';
  return (
    <span
      className="project-mark"
      aria-hidden="true"
      style={{ inlineSize: size, blockSize: size, fontSize: Math.round(size * 0.58), '--mark': identityColorOf(name || id) } as React.CSSProperties}
    >
      {initial}
    </span>
  );
}

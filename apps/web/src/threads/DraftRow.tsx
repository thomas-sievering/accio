import { Close } from '../app/icons';
import { useProjects } from '../projects/projects';
import { ProjectMark } from '../projects/ProjectMark';
import { discardDraft, type NewThreadDraft } from './drafts';
import { useThreads } from './threads';

/** What a draft says first: its first line, else what was pasted. */
export function draftTitle(d: NewThreadDraft): string {
  const line = d.text.split('\n').map((l) => l.trim()).find(Boolean);
  if (line) return line;
  if (d.pastes.length) return 'Pasted text';
  return d.images.length > 1 ? `${d.images.length} images` : 'Pasted image';
}

/** GLOSSARY: Draft. A new thread not started yet, listed in the inbox because its composer has something in it. */
export function DraftRow({ draft: d }: { draft: NewThreadDraft }) {
  const { draft: open, openDraft } = useThreads();
  const { state } = useProjects();
  const projectId = state?.checkouts.find((c) => c.id === d.checkoutId)?.projectId;
  const where = (projectId && state?.projects.find((p) => p.id === projectId)?.name) || 'No project';
  const active = !!open && open.checkoutId === d.checkoutId && (open.profileId ?? '') === (d.profileId ?? '');
  const title = draftTitle(d);
  return (
    <div className={`row open draft${active ? ' active' : ''}`}>
      <button className="row-main" onClick={() => openDraft(d.checkoutId, d.profileId)} title={`${title} · ${where} · Draft`}
        aria-current={active ? 'page' : undefined}>
        {projectId ? <ProjectMark id={projectId} /> : <span className="no-project-mark" />}
        <span className="row-name">
          <span className="row-title">{title}</span>
          <span className="row-project with-state">
            <span className="row-project-name">{where}</span>
            <span className="row-state row-draft-state"><span className="row-state-label">Draft</span></span>
          </span>
        </span>
      </button>
      <span className="row-actions">
        <button className="row-action" tabIndex={-1} title="Discard draft" aria-label="Discard draft" onClick={() => discardDraft(d.key)}>
          <Close />
        </button>
      </span>
    </div>
  );
}

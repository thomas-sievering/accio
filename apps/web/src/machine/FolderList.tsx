import { useState } from 'react';
import { Close } from '../app/icons';

/** Profile folders as a list: type a path or browse for one, the same picker as Add project. */
export function FolderList({ folders, onChange, disabled }: { folders: string[]; onChange: (f: string[]) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState('');
  const add = (path: string) => {
    const p = path.trim();
    if (p && !folders.includes(p)) onChange([...folders, p]);
    setDraft('');
  };
  const browse = async () => {
    const picked = await window.accioDesktop?.pickFolder();
    if (picked) add(picked);
  };
  return (
    <div className="folder-list">
      {folders.map((f) => (
        <div key={f} className="folder-row">
          <code className="grow">{f}</code>
          <button type="button" className="row-action" disabled={disabled} aria-label={`Remove ${f}`} title="Remove" onClick={() => onChange(folders.filter((x) => x !== f))}>
            <Close />
          </button>
        </div>
      ))}
      <span className="row-input">
        <input
          aria-label="Folder path" disabled={disabled} value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="S:\hrc"
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(draft);
            }
          }}
          onBlur={() => add(draft)}
        />
        {window.accioDesktop && (
          <button type="button" className="ghost" disabled={disabled} onClick={browse}>
            Browse…
          </button>
        )}
      </span>
    </div>
  );
}

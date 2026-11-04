import { useState } from 'react';
import type { ProjectView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { SettingsFooter, SettingsSection, useEscape, type SettingsRoute } from '../app/Settings';
import { useAction } from '../app/useAction';
import { useProfiles } from '../profiles/profiles';
import { useThreads } from '../threads/threads';
import { useProjects } from './projects';
import { FolderLink } from './FolderLink';
import { MenuSelect } from '../ui/MenuSelect';
import { MidPath } from './MidPath';
import { ResourcePicker } from '../resources/ResourcePicker';
import { projectKey, toggled, useResources } from '../resources/resources';

/**
 * A project's profile, delivery and skills, staged until Save like the rest of settings, and its checkouts on this machine.
 * A checkout is removed only after a second, explicit click (which also deletes its threads).
 * The Settings / Projects detail page; the header chip and the Filter gear open it too.
 */
export function ProjectForm({ project, onClose, onOpenSettings }: { project: ProjectView; onClose: () => void; onOpenSettings: (route: SettingsRoute) => void }) {
  const client = useClient();
  const { profiles = [] } = useProfiles();
  const { checkoutsOf } = useProjects();
  const { threads = [] } = useThreads();
  const { state: resources } = useResources();
  const threadCount = threads.filter((t) => t.projectId === project.id).length;
  const { busy, error, run } = useAction();
  const [confirming, setConfirming] = useState<string>();
  const [profileId, setProfileId] = useState(project.profileId);
  const [policy, setPolicy] = useState(project.deliveryPolicy ?? 'direct');
  const [previewCommand, setPreviewCommand] = useState(project.previewCommand ?? '');
  const [startCommand, setStartCommand] = useState(project.startCommand ?? '');
  const [setupCommand, setSetupCommand] = useState(project.setupCommand ?? '');
  const [testCommand, setTestCommand] = useState(project.testCommand ?? '');
  // Skill choices wait here until Save, keyed by skill id.
  const [skills, setSkills] = useState<Record<string, boolean>>({});
  const key = projectKey(project);
  const skillChanges = Object.entries(skills).flatMap(([id, on]) => {
    const skill = resources?.skills.find((s) => s.id === id);
    return skill && skill.scope.projectKeys.includes(key) !== on ? [{ skill, on }] : [];
  });
  const deliveryChanged = policy !== (project.deliveryPolicy ?? 'direct') || previewCommand !== (project.previewCommand ?? '') || testCommand !== (project.testCommand ?? '');
  const appChanged = startCommand !== (project.startCommand ?? '') || setupCommand !== (project.setupCommand ?? '');
  const dirty = profileId !== project.profileId || deliveryChanged || appChanged || skillChanges.length > 0;
  // An open inline confirmation takes Escape first.
  useEscape(confirming !== undefined, () => setConfirming(undefined));

  const remove = (checkoutId: string) =>
    run(async () => {
      await client.call('checkouts.remove', { id: checkoutId, deleteThreads: confirming === checkoutId });
    }).finally(() => setConfirming(undefined));

  const save = async () => {
    const done = await run(async () => {
      if (profileId !== project.profileId) await client.call('projects.setProfile', { projectId: project.id, profileId });
      if (deliveryChanged) await client.call('projects.setDelivery', { projectId: project.id, deliveryPolicy: policy, previewCommand, testCommand });
      if (appChanged) await client.call('projects.setApp', { projectId: project.id, startCommand, setupCommand });
      for (const { skill, on } of skillChanges) await client.call('skills.setScope', { id: skill.id, scope: { ...skill.scope, projectKeys: toggled(skill.scope.projectKeys, key, on) } });
      return true;
    });
    if (done) onClose();
  };

  const fields = (
    <>
      <div className="facts">
        <div>
          <span className="dim">Repository</span> {project.repoKey ?? 'no git remote'}
        </div>
      </div>
      {profiles.length > 1 && (
        <div className="field">
          <span>Profile</span>
          <MenuSelect label="Profile" value={profileId} disabled={busy || threadCount > 0} onChange={setProfileId} options={profiles.map((a) => ({ value: a.id, label: a.name }))} />
          {threadCount > 0 && <small className="hint">Fixed while the project has threads ({threadCount}): each thread keeps the profile it started with.</small>}
        </div>
      )}
      <div className="field">
        <span>Ship changes</span>
        <MenuSelect label="Ship changes" value={policy} disabled={busy} onChange={setPolicy} options={[
          { value: 'direct', label: 'Directly to the default branch' },
          { value: 'pull-request', label: 'Through a pull request' },
        ]} />
      </div>
      <label className="field">
        <span>Test command</span>
        <input value={testCommand} onChange={e => setTestCommand(e.target.value)} placeholder="pnpm install && pnpm test" />
        <small className="hint">Optional. Ship commits, rebases, runs this and pushes without the agent; it steps in only when something fails.</small>
      </label>
      <label className="field">
        <span>Preview command</span>
        <input value={previewCommand} onChange={e => setPreviewCommand(e.target.value)} placeholder="pnpm dev --port {port}" />
        <small className="hint">Optional. Runs in the thread’s worktree with its own PORT and app state. Use {'{port}'} where the command needs its assigned port.</small>
      </label>
      <label className="field">
        <span>Start command</span>
        <input value={startCommand} onChange={e => setStartCommand(e.target.value)} placeholder="pnpm start" />
      </label>
      <label className="field">
        <span>Setup command</span>
        <input value={setupCommand} onChange={e => setSetupCommand(e.target.value)} placeholder="pnpm install" />
      </label>
      <div className="field">
        <span>Checkouts on this machine</span>
        <div className="checkouts">
          {checkoutsOf(project.id).map((c) => {
            const count = threads.filter((t) => t.checkoutId === c.id).length;
            return (
              <div key={c.id} className="checkout-row">
                <FolderLink path={c.path} className="path-link">
                  <MidPath text={c.path} />
                </FolderLink>
                {confirming === c.id ? (
                  <>
                    <button type="button" disabled={busy} className="ghost" onClick={() => setConfirming(undefined)}>
                      Cancel
                    </button>
                    <button type="button" disabled={busy} className="ghost danger" onClick={() => remove(c.id)}>
                      {count > 0 ? `Remove checkout and delete ${count} ${count === 1 ? 'thread' : 'threads'}` : 'Confirm remove'}
                    </button>
                  </>
                ) : (
                  <button type="button" disabled={busy} className="ghost danger" aria-label={`Remove checkout ${c.path}`} onClick={() => setConfirming(c.id)}>
                    Remove checkout
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="field">
        <span>Skills</span>
        <ResourcePicker context={{ kind: 'project', project }} staged={{ values: skills, set: (id, on) => setSkills((s) => ({ ...s, [id]: on })) }} />
        <span className="signin-links">
          <button type="button" className="link" onClick={() => onOpenSettings({ section: 'tools' })}>Tools</button>
          <span aria-hidden="true">·</span>
          <button type="button" className="link" onClick={() => onOpenSettings({ section: 'mcps' })}>MCP servers</button>
          <span aria-hidden="true">·</span>
          <button type="button" className="link" onClick={() => onOpenSettings({ section: 'skills' })}>Skills</button>
        </span>
      </div>
      {error && <p className="error">{error}</p>}
    </>
  );

  return (
    <form className="settings-profile-form" onSubmit={(event) => { event.preventDefault(); if (!busy && dirty) void save(); }}>
      <SettingsSection>
        <div className="setting-form">{fields}</div>
      </SettingsSection>
      <SettingsFooter busy={busy} onCancel={onClose} saveLabel="Save" saveDisabled={busy || !dirty} dirty={dirty && !busy} />
    </form>
  );
}

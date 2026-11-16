import { DEFAULT_MODEL, type SkillContext, type WorkspaceSkill, type WorkspaceSkills } from '@accio/protocol';
import type { HarnessSkill } from './harness.js';
import type { Profiles } from '../profiles/profiles.js';
import type { Projects } from '../projects/projects.js';
import type { ResourceManager } from '../resources/resources.js';
import { readSkillFile, repositorySkillTarget, saveRepositorySkill } from '../resources/workspaceSkills.js';
import { UserError, type Router } from '../rpc/router.js';
import type { ThreadState } from './state.js';

type SkillDeps = {
  state: ThreadState;
  profiles: Profiles;
  projects: Projects;
  resources: () => ResourceManager | undefined;
  /** GLOSSARY: Harness skill. Undefined when that harness isn't on this machine or can't list its own. */
  harnessSkills(profileId: string, harnessId: string, cwd?: string): Promise<HarnessSkill[] | undefined>;
  withLifecycle<T>(threadId: string, action: () => Promise<T>): Promise<T>;
};

/** The skills a thread, or a draft's project or profile, can use, and editing its repository skills. */
export function registerThreadSkills(router: Router, deps: SkillDeps) {
  const { state, projects } = deps;
  const resources = () => deps.resources()!;

  const skillContext = (context: SkillContext) => {
    if (context.threadId) {
      if (context.checkoutId || context.profileId || context.harnessId) throw new UserError('Choose a thread or a draft skill context, not both');
      const thread = state.require(context.threadId);
      return { thread, harnessId: thread.model.harnessId, checkoutId: thread.checkoutId, projectId: thread.projectId || undefined, profileId: thread.profileId, cwd: thread.checkoutId && !thread.workspace?.releasedAt ? state.cwd(thread) : undefined, unavailable: thread.workspace?.releasedAt ? 'This thread’s worktree was released. Repository skills are unavailable until it is restored.' : undefined };
    }
    // A draft starts on the harness it names, else on the default model's.
    const draftHarness = context.harnessId ?? DEFAULT_MODEL.harnessId;
    if (context.checkoutId) {
      const checkout = projects.checkout(context.checkoutId);
      const project = projects.projectOf(checkout);
      if (context.profileId && context.profileId !== project.profileId) throw new UserError('This project belongs to another profile');
      return { harnessId: draftHarness, checkoutId: checkout.id, projectId: project.id, profileId: project.profileId, cwd: checkout.path, thread: undefined, unavailable: undefined };
    }
    if (!context.profileId) throw new UserError('Choose a thread, project or profile to see skills');
    deps.profiles.require(context.profileId);
    return { harnessId: draftHarness, profileId: context.profileId, checkoutId: undefined, projectId: undefined, cwd: undefined, thread: undefined, unavailable: undefined };
  };

  const workspaceSkills = async (context: SkillContext): Promise<WorkspaceSkills> => {
    if (!deps.resources()) throw new UserError('Skills are unavailable');
    const scope = skillContext(context);
    const [levels, shipped] = await Promise.all([
      resources().workspaceSkills(scope.profileId, scope.projectId, scope.cwd),
      // The panel still lists the levels when the harness can't say what it ships with.
      deps.harnessSkills(scope.profileId, scope.harnessId, scope.cwd).catch(() => undefined),
    ]);
    const harness: WorkspaceSkill[] = (shipped ?? []).map(skill => ({ id: `harness:${scope.harnessId}:${skill.name}`, name: skill.name, description: skill.description,
      path: skill.path ?? '', origin: 'harness', enabled: true, enabledBy: null }));
    const skills = [...levels, ...harness.sort((a, b) => a.name.localeCompare(b.name))];
    if (scope.thread) {
      const live = await state.transcripts.get(scope.thread.id);
      for (const item of live.items) if (item.kind === 'tool' && item.status === 'done') {
        for (const loaded of item.loadedSkills ?? []) {
          const skill = skills.find(skill => skill.id === loaded.id);
          if (skill) skill.loaded = { itemId: item.id, turnId: item.turnId };
        }
      }
    }
    const space = resources().spaceOf(scope.projectId);
    return { skills, projectId: scope.projectId, ...(space ? { space: { id: space.id, name: space.name } } : {}), ...(shipped ? { harnessId: scope.harnessId } : {}), unavailable: scope.unavailable };
  };

  const workspaceSkill = async (input: SkillContext & { skillId: string }) => {
    const scope = skillContext(input);
    const { skills } = await workspaceSkills(input);
    const skill = skills.find(skill => skill.id === input.skillId);
    if (!skill) throw new UserError('No such skill in this workspace');
    return { scope, skill };
  };

  router
    .on('threads.skills', context => workspaceSkills(context))
    .on('threads.skillContent', async input => {
      const { scope, skill } = await workspaceSkill(input);
      if (skill.origin === 'library') return { content: await resources().skillContent(skill.id), path: skill.path, editable: false };
      if (skill.origin === 'harness') {
        if (!skill.path) throw new UserError('This harness doesn’t share the instructions of its own skills');
        return { content: await readSkillFile(skill.path), path: skill.path, editable: false };
      }
      // GLOSSARY: Home. Its skill files change through a thread in the home, which ships them.
      if (skill.enabledBy === 'space') return { content: await readSkillFile(skill.path), path: skill.path, editable: false };
      if (!scope.cwd) throw new UserError('This workspace is unavailable');
      const file = await repositorySkillTarget(scope.cwd, skill);
      return { content: await readSkillFile(file), path: skill.path, editable: true };
    })
    .on('threads.saveSkillContent', async input => {
      const save = async () => {
        const { scope, skill } = await workspaceSkill(input);
        if (skill.origin === 'repository' && skill.enabledBy === 'space') throw new UserError('The space’s home skills are edited in a thread in the home');
        if (!scope.cwd || skill.origin !== 'repository') throw new UserError('Only repository skills can be edited here');
        if (scope.thread?.status === 'running') throw new UserError('Wait for this turn to finish before editing its skills');
        const release = scope.checkoutId ? projects.useCheckout(scope.checkoutId) : undefined;
        try { await saveRepositorySkill(scope.cwd, skill, input.content); resources().skillsChanged(); }
        finally { release?.(); }
        return null;
      };
      return input.threadId ? deps.withLifecycle(input.threadId, save) : save();
    })
    .on('threads.setSkillEnabled', async input => {
      const { scope, skill } = await workspaceSkill(input);
      if (!scope.projectId) throw new UserError('Choose a project to enable skills');
      if (skill.origin === 'harness') throw new UserError('Skills that ship with the harness are always on');
      if (skill.origin !== 'library') throw new UserError('Repository skills are managed in the repository');
      if (input.level === 'space') {
        const space = resources().spaceOf(scope.projectId);
        if (!space) throw new UserError('This project is in no space');
        await resources().setSpaceSkill(skill.id, space.id, input.enabled);
        return null;
      }
      if (!input.enabled && skill.enabledBy && skill.enabledBy !== 'project') throw new UserError('This skill is inherited. Change its selection in Settings.');
      await resources().setProjectSkill(skill.id, scope.projectId, input.enabled);
      return null;
    });
}

import type { SkillContext, WorkspaceSkills } from '@accio/protocol';
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
  withLifecycle<T>(threadId: string, action: () => Promise<T>): Promise<T>;
};

/** The skills a thread, or a draft's project or profile, can use, and editing its repository skills. */
export function registerThreadSkills(router: Router, deps: SkillDeps) {
  const { state, projects } = deps;
  const resources = () => deps.resources()!;

  const skillContext = (context: SkillContext) => {
    if (context.threadId) {
      if (context.checkoutId || context.profileId) throw new UserError('Choose a thread or a draft skill context, not both');
      const thread = state.require(context.threadId);
      return { thread, checkoutId: thread.checkoutId, projectId: thread.projectId || undefined, profileId: thread.profileId, cwd: thread.checkoutId && !thread.workspace?.releasedAt ? state.cwd(thread) : undefined, unavailable: thread.workspace?.releasedAt ? 'This workspace was archived. Repository skills are unavailable until it is restored.' : undefined };
    }
    if (context.checkoutId) {
      const checkout = projects.checkout(context.checkoutId);
      const project = projects.projectOf(checkout);
      if (context.profileId && context.profileId !== project.profileId) throw new UserError('This project belongs to another profile');
      return { checkoutId: checkout.id, projectId: project.id, profileId: project.profileId, cwd: checkout.path, thread: undefined, unavailable: undefined };
    }
    if (!context.profileId) throw new UserError('Choose a thread, project or profile to see skills');
    deps.profiles.require(context.profileId);
    return { profileId: context.profileId, checkoutId: undefined, projectId: undefined, cwd: undefined, thread: undefined, unavailable: undefined };
  };

  const workspaceSkills = async (context: SkillContext): Promise<WorkspaceSkills> => {
    if (!deps.resources()) throw new UserError('Skills are unavailable');
    const scope = skillContext(context);
    const skills = await resources().workspaceSkills(scope.profileId, scope.projectId, scope.cwd);
    if (scope.thread) {
      const live = await state.transcripts.get(scope.thread.id);
      for (const item of live.items) if (item.kind === 'tool' && item.status === 'done') {
        for (const loaded of item.loadedSkills ?? []) {
          const skill = skills.find(skill => skill.id === loaded.id);
          if (skill) skill.loaded = { itemId: item.id, turnId: item.turnId };
        }
      }
    }
    return { skills, projectId: scope.projectId, unavailable: scope.unavailable };
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
      if (!scope.cwd) throw new UserError('This workspace is unavailable');
      const file = await repositorySkillTarget(scope.cwd, skill);
      return { content: await readSkillFile(file), path: skill.path, editable: true };
    })
    .on('threads.saveSkillContent', async input => {
      const save = async () => {
        const { scope, skill } = await workspaceSkill(input);
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
      if (skill.origin !== 'library') throw new UserError('Repository skills are managed in the repository');
      if (!input.enabled && (skill.enabledBy === 'global' || skill.enabledBy === 'profile')) throw new UserError('This skill is inherited. Change its selection in Settings.');
      await resources().setProjectSkill(skill.id, scope.projectId, input.enabled);
      return null;
    });
}

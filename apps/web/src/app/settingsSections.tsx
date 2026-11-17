import type { SectionData, SectionEntry, LimitsLink } from './Settings';
import { BookOpen, Folder, Hub, IdCard, Key, Layers, Limits, Monitor, Plug, ScrollText, Spaces, Users, Wrench } from './icons';
import { AddHub, HubSettings } from '../hub/HubSettings';
import { MachinePage, MachinesList, useMachinesData } from '../machine/MachineSettings';
import { HarnessDetail, HarnessesList, useHarnessesData } from '../harnesses/HarnessesSettings';
import { SystemPromptSettings } from '../harnesses/SystemPromptSettings';
import { NamingSettings } from '../threads/NamingSettings';
import { AccountDetail, AccountsList, NewAccount, useAccountsData } from '../profiles/AccountsSettings';
import { NewProfile, ProfileDetail, ProfilesList, useProfilesData } from '../profiles/ProfilesSettings';
import { NewSecret, SecretDetail, SecretsList, useSecretsData } from '../secrets/SecretsSettings';
import { NewTool, ToolDetail, ToolsList, useToolsData } from '../tools/ToolsSettings';
import { McpDetail, McpList, NewMcp, useMcpData } from '../mcp/McpSettings';
import { NewSource, SkillsList, SourcePage, useSkillsData } from '../skills/SkillsSettings';
import { ProjectDetail, ProjectsList, useProjectsData } from '../projects/ProjectsSettings';
import { NewSpace, SpaceDetail, SpacesList, useSpacesData } from '../spaces/SpacesSettings';

/** Registers a section; the table holds entries of every item type. */
function section<T extends { id: string }, D extends SectionData<T>>(entry: SectionEntry<T, D>): SectionEntry {
  return entry as unknown as SectionEntry;
}

/**
 * Every Settings section, in sidebar order. Settings draws each one's sidebar link, breadcrumb and
 * list, new, loading, error and deleted pages from its entry here; a new section is its id in `Section`, one entry and its panels.
 */
export type Section = 'profiles' | 'accounts' | 'secrets' | 'harnesses' | 'systemPrompt' | 'naming' | 'tools' | 'mcps' | 'skills' | 'projects' | 'spaces' | 'machines' | 'hub';

export const SETTINGS: Record<Section | 'limits', SectionEntry | LimitsLink> = {
  profiles: section({ label: 'Profiles', icon: <Users />, group: 'Profiles', noun: 'profile', plural: 'profiles', useData: useProfilesData, List: ProfilesList, New: NewProfile, Detail: ProfileDetail }),
  accounts: section({ label: 'Accounts', icon: <IdCard />, group: 'Profiles', noun: 'account', plural: 'accounts', useData: useAccountsData, List: AccountsList, New: NewAccount, Detail: AccountDetail }),
  limits: { label: 'Limits', icon: <Limits />, group: 'Profiles', opensLimits: true },
  secrets: section({
    label: 'Secrets', icon: <Key />, group: 'Profiles', noun: 'secret', plural: 'secrets', useData: useSecretsData, listLoads: true,
    name: (_, route) => route.extra?.replace ? 'Replace value' : 'Edit secret',
    // Back to the list of the same profile's secrets.
    list: (route) => ({ section: 'secrets', ...(route.extra?.profileId ? { extra: { profileId: route.extra.profileId } } : {}) }),
    List: SecretsList, New: NewSecret, Detail: SecretDetail,
  }),
  harnesses: section({ label: 'Harnesses', icon: <Layers />, group: 'Threads', noun: 'harness', plural: 'harnesses', useData: useHarnessesData, name: () => 'Built-in tools', List: HarnessesList, Detail: HarnessDetail }),
  systemPrompt: section({ label: 'System prompt', icon: <ScrollText />, group: 'Threads', List: SystemPromptSettings }),
  naming: section({ label: 'Thread naming', icon: <ScrollText />, group: 'Threads', List: NamingSettings }),
  tools: section({ label: 'CLIs', icon: <Wrench />, group: 'Tools and skills', noun: 'CLI', plural: 'CLIs', useData: useToolsData, List: ToolsList, New: NewTool, Detail: ToolDetail }),
  mcps: section({ label: 'MCP servers', icon: <Plug />, group: 'Tools and skills', noun: 'MCP server', plural: 'MCP servers', useData: useMcpData, List: McpList, New: NewMcp, Detail: McpDetail }),
  skills: section({ label: 'Skills', icon: <BookOpen />, group: 'Tools and skills', noun: 'skill source', plural: 'skill sources', useData: useSkillsData, List: SkillsList, New: NewSource, Detail: SourcePage }),
  projects: section({ label: 'Projects', icon: <Folder />, group: 'Projects and machines', noun: 'project', plural: 'projects', useData: useProjectsData, List: ProjectsList, Detail: ProjectDetail }),
  spaces: section({ label: 'Spaces', icon: <Spaces />, group: 'Projects and machines', noun: 'space', plural: 'spaces', useData: useSpacesData, List: SpacesList, New: NewSpace, Detail: SpaceDetail }),
  machines: section({ label: 'Machines', icon: <Monitor />, group: 'Projects and machines', noun: 'machine', plural: 'machines', useData: useMachinesData, List: MachinesList, Detail: MachinePage }),
  // This machine's saved hubs, opened from the hub selector's menu rather than the sidebar.
  hub: section({ label: 'Hubs', icon: <Hub />, newLabel: 'Add hub', List: HubSettings, New: AddHub }),
};

